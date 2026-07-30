import type {
  ArcaAmbiente, ArcaAuth, FeCaeRequest, FeCaeResponse, FeCompConsultarResponse, FeDummyResponse,
} from "@/lib/arca/types";
import { resolveEndpoints, WSFE_NS } from "@/lib/arca/config";
import { ArcaError, WSFE_ERR_NO_EXISTE } from "@/lib/arca/errors";
import { envelope, fetchTransport, parseSoapResponse, SoapFault, type SoapTransport } from "@/lib/arca/soap";
import { asMensajes, asNumber, asString, esc, pick, tag } from "@/lib/arca/xml";
import { aMoneda } from "@/domain/fiscal-importes";

/**
 * WSFEv1: los métodos de facturación electrónica.
 *
 * Cada método es un wrapper tipado; los PARSERS se exportan aparte y son PUROS,
 * que es lo que se testea con fixtures capturados.
 */

export type WsfeCtx = {
  ambiente: ArcaAmbiente;
  auth: ArcaAuth;
  transport?: SoapTransport;
  timeoutMs?: number;
};

async function llamar(
  ctx: { ambiente: ArcaAmbiente; transport?: SoapTransport; timeoutMs?: number },
  metodo: string,
  bodyInterno: string,
): Promise<Record<string, unknown>> {
  const { wsfe } = resolveEndpoints(ctx.ambiente);
  const body = envelope(`<${metodo} xmlns="${WSFE_NS}">${bodyInterno}</${metodo}>`);
  const transport = ctx.transport ?? fetchTransport;

  const xml = await transport({
    url: wsfe,
    soapAction: `${WSFE_NS}${metodo}`,
    body,
    timeoutMs: ctx.timeoutMs ?? 30_000,
  });

  try {
    return parseSoapResponse(xml);
  } catch (err) {
    if (err instanceof SoapFault) {
      console.error(`[arca/wsfe] fault en ${metodo}:`, err.faultcode, err.faultstring);
      throw new ArcaError("ARCA_SOAP_FAULT", err.faultstring);
    }
    throw err;
  }
}

function authXml(auth: ArcaAuth): string {
  return `<Auth><Token>${esc(auth.token)}</Token><Sign>${esc(auth.sign)}</Sign>` +
    `<Cuit>${esc(auth.cuit)}</Cuit></Auth>`;
}

// ---- FEDummy: health check, no requiere autenticación ----

export async function feDummy(ctx: Omit<WsfeCtx, "auth">): Promise<FeDummyResponse> {
  const body = await llamar(ctx, "FEDummy", "");
  const r = pick(body, "FEDummyResponse", "FEDummyResult");
  return {
    appServer: asString(pick(r, "AppServer")) ?? "?",
    dbServer: asString(pick(r, "DbServer")) ?? "?",
    authServer: asString(pick(r, "AuthServer")) ?? "?",
  };
}

// ---- FECompUltimoAutorizado ----

export function parseFeCompUltimoAutorizado(body: Record<string, unknown>): number {
  const r = pick(body, "FECompUltimoAutorizadoResponse", "FECompUltimoAutorizadoResult");
  const errores = asMensajes(pick(r, "Errors", "Err"));
  if (errores.length > 0) throw new ArcaError("ARCA_SOAP_FAULT", errores[0].msg);
  const nro = asNumber(pick(r, "CbteNro"));
  if (nro == null) throw new ArcaError("ARCA_RESPUESTA_INVALIDA");
  return nro;
}

/** Último número autorizado por ARCA para esa secuencia. 0 si nunca se emitió. */
export async function feCompUltimoAutorizado(
  ctx: WsfeCtx,
  p: { ptoVta: number; cbteTipo: number },
): Promise<number> {
  const body = await llamar(ctx, "FECompUltimoAutorizado",
    `${authXml(ctx.auth)}${tag("PtoVta", p.ptoVta)}${tag("CbteTipo", p.cbteTipo)}`);
  return parseFeCompUltimoAutorizado(body);
}

// ---- FECAESolicitar ----

/** Serializa el request. Los importes van con 2 decimales fijos, nunca String(n). */
export function feCaeRequestXml(req: FeCaeRequest): string {
  // Siempre mandamos un comprobante por request. Fallar acá con un código del
  // dominio es mucho mejor que un "Cannot read properties of undefined".
  const d = req.FeDetReq[0];
  if (!d) throw new Error("SIN_LINEAS");

  const iva = d.Iva.length === 0 ? "" : `<Iva>${d.Iva.map((i) =>
    `<AlicIva>${tag("Id", i.Id)}${tag("BaseImp", aMoneda(i.BaseImp))}${tag("Importe", aMoneda(i.Importe))}</AlicIva>`,
  ).join("")}</Iva>`;

  const asoc = !d.CbtesAsoc?.length ? "" : `<CbtesAsoc>${d.CbtesAsoc.map((c) =>
    `<CbteAsoc>${tag("Tipo", c.Tipo)}${tag("PtoVta", c.PtoVta)}${tag("Nro", c.Nro)}` +
    `${tag("Cuit", c.Cuit)}${tag("CbteFch", c.CbteFch)}</CbteAsoc>`,
  ).join("")}</CbtesAsoc>`;

  return `<FeCAEReq>` +
    `<FeCabReq>${tag("CantReg", req.FeCabReq.CantReg)}${tag("PtoVta", req.FeCabReq.PtoVta)}` +
    `${tag("CbteTipo", req.FeCabReq.CbteTipo)}</FeCabReq>` +
    `<FeDetReq><FECAEDetRequest>` +
    tag("Concepto", d.Concepto) +
    tag("DocTipo", d.DocTipo) +
    tag("DocNro", d.DocNro) +
    tag("CbteDesde", d.CbteDesde) +
    tag("CbteHasta", d.CbteHasta) +
    tag("CbteFch", d.CbteFch) +
    tag("ImpTotal", aMoneda(d.ImpTotal)) +
    tag("ImpTotConc", aMoneda(d.ImpTotConc)) +
    tag("ImpNeto", aMoneda(d.ImpNeto)) +
    tag("ImpOpEx", aMoneda(d.ImpOpEx)) +
    tag("ImpTrib", aMoneda(d.ImpTrib)) +
    tag("ImpIVA", aMoneda(d.ImpIVA)) +
    tag("MonId", d.MonId) +
    tag("MonCotiz", d.MonCotiz) +
    tag("CondicionIVAReceptorId", d.CondicionIVAReceptorId) +
    asoc +
    iva +
    `</FECAEDetRequest></FeDetReq>` +
    `</FeCAEReq>`;
}

/**
 * PURA. Se testea con fixtures.
 *
 * Nunca colapsa `Observaciones` con `Errors`: un comprobante puede salir
 * APROBADO con observaciones, y perder esa distinción convertiría un éxito con
 * advertencia en un falso error (o al revés).
 */
export function parseFeCaeResponse(body: Record<string, unknown>): FeCaeResponse {
  const r = pick(body, "FECAESolicitarResponse", "FECAESolicitarResult");
  if (!r) throw new ArcaError("ARCA_RESPUESTA_INVALIDA");

  const errores = asMensajes(pick(r, "Errors", "Err"));
  const cab = pick(r, "FeCabResp");
  const det = pick(r, "FeDetResp", "FECAEDetResponse");
  const primero = Array.isArray(det) ? det[0] : det;

  // Errores de cabecera sin detalle: ARCA ni procesó el comprobante.
  if (!primero) {
    if (errores.length > 0) {
      return { resultado: "R", cae: null, caeVto: null, cbteDesde: null, observaciones: [], errores, raw: r };
    }
    throw new ArcaError("ARCA_RESPUESTA_INVALIDA");
  }

  const resultadoDet = asString(pick(primero, "Resultado"));
  const resultadoCab = asString(pick(cab, "Resultado"));
  const resultado = (resultadoDet ?? resultadoCab ?? "R") as "A" | "R" | "P";

  return {
    resultado,
    cae: asString(pick(primero, "CAE")),
    caeVto: asString(pick(primero, "CAEFchVto")),
    cbteDesde: asNumber(pick(primero, "CbteDesde")),
    observaciones: asMensajes(pick(primero, "Observaciones", "Obs")),
    errores,
    raw: r,
  };
}

export async function feCAESolicitar(ctx: WsfeCtx, req: FeCaeRequest): Promise<FeCaeResponse> {
  const body = await llamar(ctx, "FECAESolicitar", `${authXml(ctx.auth)}${feCaeRequestXml(req)}`);
  return parseFeCaeResponse(body);
}

// ---- FECompConsultar: recuperación cuando perdimos la respuesta ----

export function parseFeCompConsultar(body: Record<string, unknown>): FeCompConsultarResponse | null {
  const r = pick(body, "FECompConsultarResponse", "FECompConsultarResult");
  const errores = asMensajes(pick(r, "Errors", "Err"));
  const get = pick(r, "ResultGet");

  if (!get) {
    // ⚠️ "No existe" (602) NO es lo mismo que "no te pude responder".
    //
    // Quien llama usa el `null` para concluir que el número quedó libre y
    // reasignarlo. Si un error de sesión o de parámetros también devolviera
    // null, un número que ARCA SÍ tiene autorizado se reasignaría a otra venta.
    // Todo lo que no sea explícitamente "no existe" se propaga como excepción,
    // que la reconciliación interpreta como "no aprendimos nada, no toco nada".
    const noExiste = errores.length === 0
      || errores.some((e) => e.code === WSFE_ERR_NO_EXISTE || /no existen datos|no se encontr/i.test(e.msg));
    if (noExiste) return null;
    throw new ArcaError("ARCA_SOAP_FAULT", errores[0].msg);
  }

  return {
    cbteTipo: asNumber(pick(get, "CbteTipo")) ?? 0,
    ptoVta: asNumber(pick(get, "PtoVta")) ?? 0,
    cbteDesde: asNumber(pick(get, "CbteDesde")) ?? 0,
    cae: asString(pick(get, "CodAutorizacion")),
    caeVto: asString(pick(get, "FchVto")),
    cbteFch: asString(pick(get, "CbteFch")),
    impTotal: asNumber(pick(get, "ImpTotal")),
    docTipo: asNumber(pick(get, "DocTipo")),
    docNro: asString(pick(get, "DocNro")),
    resultado: asString(pick(get, "Resultado")),
    observaciones: asMensajes(pick(get, "Observaciones", "Obs")),
    raw: get,
  };
}

export async function feCompConsultar(
  ctx: WsfeCtx,
  p: { ptoVta: number; cbteTipo: number; cbteNro: number },
): Promise<FeCompConsultarResponse | null> {
  const body = await llamar(ctx, "FECompConsultar",
    `${authXml(ctx.auth)}<FeCompConsReq>${tag("CbteTipo", p.cbteTipo)}` +
    `${tag("CbteNro", p.cbteNro)}${tag("PtoVta", p.ptoVta)}</FeCompConsReq>`);
  return parseFeCompConsultar(body);
}

// ---- FEParamGetCondicionIvaReceptor ----

/**
 * Tabla vigente de condiciones frente al IVA del receptor. Se trae en runtime en
 * vez de hardcodear los códigos, porque ARCA los actualiza.
 */
export async function feParamGetCondicionIvaReceptor(
  ctx: WsfeCtx,
): Promise<{ id: number; desc: string }[]> {
  const body = await llamar(ctx, "FEParamGetCondicionIvaReceptor", authXml(ctx.auth));
  const r = pick(body, "FEParamGetCondicionIvaReceptorResponse", "FEParamGetCondicionIvaReceptorResult");
  const items = pick(r, "ResultGet", "CondicionIvaReceptor");
  return (Array.isArray(items) ? items : items ? [items] : []).map((i) => ({
    id: asNumber(pick(i, "Id")) ?? 0,
    desc: asString(pick(i, "Desc")) ?? "",
  })).filter((i) => i.id !== 0);
}
