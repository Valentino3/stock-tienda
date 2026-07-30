import type { AccessTicket, ArcaAmbiente } from "@/lib/arca/types";
import { resolveEndpoints } from "@/lib/arca/config";
import {
  ArcaError, esCertInvalido, esCertSinDelegacion, esTaYaVigente,
} from "@/lib/arca/errors";
import { signCms } from "@/lib/arca/cms";
import { buildTra } from "@/lib/arca/tra";
import { envelope, fetchTransport, parseSoapResponse, SoapFault, type SoapTransport } from "@/lib/arca/soap";
import { asString, parseXml, pick } from "@/lib/arca/xml";

/**
 * WSAA: autenticación contra ARCA.
 *
 * Se firma un LoginTicketRequest (TRA) como CMS con el certificado de la tienda
 * y se lo manda a LoginCms. La respuesta trae un token y una firma válidos por
 * 12 horas.
 *
 * ⚠️ ARCA RECHAZA pedir un ticket nuevo mientras haya uno válido para el mismo
 * (CUIT, servicio). El cacheo del ticket no es una optimización: es un requisito
 * del protocolo. Ver src/domain/fiscal-config.ts (TicketStore).
 */

/**
 * Parsea la respuesta de LoginCms. PURA — es la que se testea con fixtures.
 *
 * El `loginTicketResponse` viene XML-ESCAPADO dentro del body SOAP, así que hay
 * que parsear dos veces: primero el sobre, después el documento interno ya
 * desescapado por el parser.
 */
export function parseLoginTicketResponse(xml: string): AccessTicket {
  const body = parseSoapResponse(xml);
  const interno = asString(pick(body, "loginCmsResponse", "loginCmsReturn"));
  if (!interno) throw new ArcaError("ARCA_RESPUESTA_INVALIDA");

  const doc = parseXml(interno);
  const credentials = pick(doc, "loginTicketResponse", "credentials");
  const header = pick(doc, "loginTicketResponse", "header");

  const token = asString(pick(credentials, "token"));
  const sign = asString(pick(credentials, "sign"));
  if (!token || !sign) throw new ArcaError("ARCA_RESPUESTA_INVALIDA");

  const generationTime = asString(pick(header, "generationTime"));
  const expirationTime = asString(pick(header, "expirationTime"));

  const generatedAt = generationTime ? new Date(generationTime) : new Date();
  // Si ARCA no diera expiración (no debería pasar), se asume el mínimo seguro.
  const expiresAt = expirationTime && !Number.isNaN(Date.parse(expirationTime))
    ? new Date(expirationTime)
    : new Date(generatedAt.getTime() + 12 * 3600_000);

  return { token, sign, generatedAt, expiresAt };
}

export type LoginCmsInput = {
  ambiente: ArcaAmbiente;
  certPem: string;
  keyPem: string;
  service?: string;
  now?: Date;
};

/**
 * Pide un ticket de acceso a WSAA.
 *
 * NO llamar directo desde el flujo de emisión: entrar siempre por el TicketStore,
 * que cachea y serializa la renovación.
 */
export async function loginCms(
  input: LoginCmsInput,
  transport: SoapTransport = fetchTransport,
): Promise<AccessTicket> {
  const { wsaa } = resolveEndpoints(input.ambiente);
  const tra = buildTra({ service: input.service ?? "wsfe", now: input.now });
  const cms = signCms({ tra, certPem: input.certPem, keyPem: input.keyPem });

  const body = envelope(
    `<loginCms xmlns="https://wsaa.afip.gov.ar/ws/services/LoginCms">` +
    `<in0>${cms}</in0>` +
    `</loginCms>`,
  );

  let xml: string;
  try {
    // WSAA no exige SOAPAction; se manda vacío.
    xml = await transport({ url: wsaa, soapAction: "", body, timeoutMs: 15_000 });
  } catch (err) {
    throw traducirFalloWsaa(err);
  }

  try {
    return parseLoginTicketResponse(xml);
  } catch (err) {
    throw traducirFalloWsaa(err);
  }
}

/**
 * Traduce el fault de WSAA al error del dominio. Los mensajes de WSAA son
 * crípticos pero distinguibles, y la diferencia importa mucho para el usuario:
 * "falta delegar wsfe" es accionable, "error de autenticación" no.
 */
function traducirFalloWsaa(err: unknown): Error {
  if (err instanceof ArcaError) return err;

  if (err instanceof SoapFault) {
    const msg = err.faultstring;
    // Error BLANDO: significa que otra invocación ganó la carrera y ya escribió
    // el ticket. Quien llama re-lee el cache en vez de fallar.
    if (esTaYaVigente(msg)) return new ArcaError("ARCA_TA_EN_RENOVACION", msg);
    if (esCertSinDelegacion(msg)) return new ArcaError("ARCA_CERT_SIN_DELEGACION", msg);
    if (esCertInvalido(msg)) return new ArcaError("ARCA_CERT_INVALIDO", msg);
    console.error("[arca/wsaa] fault no clasificado:", err.faultcode, msg);
    return new ArcaError("ARCA_AUTENTICACION", msg);
  }

  console.error("[arca/wsaa] fallo:", err instanceof Error ? err.message : typeof err);
  return new ArcaError("ARCA_AUTENTICACION");
}
