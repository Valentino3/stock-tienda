import { XMLParser } from "fast-xml-parser";
import { ArcaError } from "@/lib/arca/errors";

/**
 * Armado y parseo de XML. Módulo PURO.
 *
 * Se ARMA con template strings: las formas de request son fijas, chicas y
 * conocidas, y un builder genérico no aporta nada.
 *
 * Se PARSEA con fast-xml-parser y nunca con regex. Regex falla apenas ARCA
 * devuelve un <soap:Fault>, o manda `Observaciones` con un solo `Obs` en vez de
 * N (la forma cambia), o devuelve una página HTML de mantenimiento.
 */

/** Escapa texto para insertarlo en un nodo o atributo XML. */
export function esc(v: string | number | null | undefined): string {
  if (v == null) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** `<Tag>valor</Tag>`, o "" si el valor es null/undefined (campo opcional). */
export function tag(nombre: string, valor: string | number | null | undefined): string {
  if (valor == null) return "";
  return `<${nombre}>${esc(valor)}</${nombre}>`;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Los valores se mantienen como STRING: el CAE tiene 14 dígitos (excede el
  // entero seguro de JS) y los números de documento pueden tener ceros a la
  // izquierda. Convertir a number acá corrompe datos en silencio.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // Quita prefijos de namespace (soap:, soapenv:) para no depender del que use
  // ARCA en cada endpoint.
  removeNSPrefix: true,
  // Estos nodos SIEMPRE son array, vengan uno o N. Es la diferencia entre
  // manejar un rechazo y explotar con "obs.map is not a function".
  isArray: (name) => ["Obs", "Err", "Event", "FECAEDetResponse", "AlicIva"].includes(name),
});

/**
 * Parsea XML. Detecta antes que nada si vino HTML: ARCA devuelve una página de
 * mantenimiento con status 200 y eso rompe cualquier parser sin diagnóstico.
 */
export function parseXml(xml: string): Record<string, unknown> {
  const inicio = xml.trimStart().slice(0, 200).toLowerCase();
  if (inicio.startsWith("<!doctype html") || inicio.startsWith("<html")) {
    throw new ArcaError("ARCA_MANTENIMIENTO");
  }
  try {
    return parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw new ArcaError("ARCA_RESPUESTA_INVALIDA");
  }
}

/**
 * Navega un objeto parseado por camino de claves, tolerando que falten nodos.
 * `pick(doc, "Envelope", "Body", "FECAESolicitarResponse")`.
 */
export function pick(obj: unknown, ...ruta: string[]): unknown {
  let actual = obj;
  for (const clave of ruta) {
    if (actual == null || typeof actual !== "object") return undefined;
    actual = (actual as Record<string, unknown>)[clave];
  }
  return actual;
}

/** Fuerza a array un nodo que puede venir suelto, ausente o como lista. */
export function asArray<T = unknown>(v: unknown): T[] {
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]) as T[];
}

export function asString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object") return null; // nodo vacío: fast-xml-parser da {}
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

export function asNumber(v: unknown): number | null {
  const s = asString(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Lista de {code,msg} a partir de un nodo Errors/Observaciones de WSFE. */
export function asMensajes(nodo: unknown): { code: number; msg: string }[] {
  return asArray<Record<string, unknown>>(nodo).map((m) => ({
    code: asNumber(m.Code) ?? 0,
    msg: asString(m.Msg) ?? "",
  })).filter((m) => m.code !== 0 || m.msg !== "");
}
