import { ArcaError } from "@/lib/arca/errors";
import { asString, parseXml, pick } from "@/lib/arca/xml";

/**
 * Transporte SOAP. ÚNICO archivo del módulo que llama a `fetch`.
 *
 * Se usa SOAP 1.1 (Content-Type text/xml + header SOAPAction explícito): es lo
 * que documentan todos los manuales de AFIP y lo que usan todos los ejemplos de
 * la comunidad. SOAP 1.2 funciona, pero su forma de fault difiere y se depura
 * en soledad.
 */

export type SoapRequest = {
  url: string;
  soapAction: string;
  body: string;
  timeoutMs?: number;
};

/** Devuelve el XML crudo de la respuesta. Inyectable para testear sin red. */
export type SoapTransport = (req: SoapRequest) => Promise<string>;

export class SoapFault extends Error {
  constructor(readonly faultcode: string, readonly faultstring: string) {
    super(faultstring);
    this.name = "SoapFault";
  }
}

export function envelope(bodyXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soapenv:Header/>` +
    `<soapenv:Body>${bodyXml}</soapenv:Body>` +
    `</soapenv:Envelope>`;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export const fetchTransport: SoapTransport = async (req) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(req.url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: req.soapAction,
      },
      body: req.body,
      signal: controller.signal,
      cache: "no-store",
    });

    const texto = await res.text();
    // Un soap:Fault viene con status 500: el cuerpo igual hay que parsearlo,
    // porque es donde está el motivo real. Solo se corta en otros 5xx/4xx.
    if (!res.ok && res.status !== 500) {
      // scrubXml antes de loguear: el cuerpo puede traer de vuelta el Token y la
      // Sign que mandamos, y los logs de Vercel los lee todo el equipo.
      console.error(`[arca/soap] HTTP ${res.status} en ${req.soapAction || "LoginCms"}:`,
        scrubXml(texto).slice(0, 500));
      if (res.status === 503 || res.status === 502) throw new ArcaError("ARCA_MANTENIMIENTO");
      throw new ArcaError("ARCA_RESPUESTA_INVALIDA", `HTTP ${res.status}`);
    }
    return texto;
  } catch (err) {
    if (err instanceof ArcaError) throw err;
    if (err instanceof Error && (err.name === "AbortError" || /aborted|timeout/i.test(err.message))) {
      throw new ArcaError("ARCA_TIMEOUT");
    }
    console.error("[arca/soap] error de red:", err instanceof Error ? err.message : typeof err);
    throw new ArcaError("ARCA_TIMEOUT");
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Parsea la respuesta y lanza SoapFault si el server devolvió uno.
 * El resto de los módulos entran por acá y nunca parsean crudo.
 */
export function parseSoapResponse(xml: string): Record<string, unknown> {
  const doc = parseXml(xml);
  const fault = pick(doc, "Envelope", "Body", "Fault");
  if (fault) {
    const faultcode = asString(pick(fault, "faultcode")) ?? "unknown";
    const faultstring = asString(pick(fault, "faultstring"))
      ?? asString(pick(fault, "Reason", "Text"))
      ?? "Fault sin detalle";
    throw new SoapFault(faultcode, faultstring);
  }
  const body = pick(doc, "Envelope", "Body");
  if (!body) throw new ArcaError("ARCA_RESPUESTA_INVALIDA");
  return body as Record<string, unknown>;
}

/**
 * Redacta credenciales antes de que cualquier XML llegue a un log.
 *
 * Los logs de Vercel los lee todo el equipo. `<token>` y `<sign>` son
 * credenciales bearer de 12 h, y `<in0>` es el CMS firmado que contiene el
 * certificado. Un "loguear el request para debuggear" ingenuo los vuelca enteros.
 */
export function scrubXml(xml: string): string {
  return xml
    .replace(/(<(?:\w+:)?token>)[\s\S]*?(<\/(?:\w+:)?token>)/gi, "$1[REDACTADO]$2")
    .replace(/(<(?:\w+:)?sign>)[\s\S]*?(<\/(?:\w+:)?sign>)/gi, "$1[REDACTADO]$2")
    .replace(/(<(?:\w+:)?in0>)[\s\S]*?(<\/(?:\w+:)?in0>)/gi, "$1[REDACTADO]$2")
    .replace(/(<(?:\w+:)?Token>)[\s\S]*?(<\/(?:\w+:)?Token>)/g, "$1[REDACTADO]$2")
    .replace(/(<(?:\w+:)?Sign>)[\s\S]*?(<\/(?:\w+:)?Sign>)/g, "$1[REDACTADO]$2");
}

/** Redacta Token/Sign de un payload que se va a guardar como auditoría. */
export function scrubPayload<T>(payload: T): T {
  const clon = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  for (const clave of ["Auth", "auth"]) {
    const auth = clon[clave] as Record<string, unknown> | undefined;
    if (auth) {
      if ("Token" in auth) auth.Token = "[REDACTADO]";
      if ("Sign" in auth) auth.Sign = "[REDACTADO]";
      if ("token" in auth) auth.token = "[REDACTADO]";
      if ("sign" in auth) auth.sign = "[REDACTADO]";
    }
  }
  return clon as T;
}
