import { esc } from "@/lib/arca/xml";

/**
 * LoginTicketRequest (TRA) de WSAA. Módulo PURO.
 *
 * Es el XML que se firma como CMS y se manda a LoginCms para obtener el ticket
 * de acceso.
 */

export type TraOptions = {
  service?: string;
  now?: Date;
  /** Ventana de validez del TRA, hacia adelante. */
  ttlSeconds?: number;
  /** Tolerancia de desfasaje de reloj, hacia atrás. */
  skewSeconds?: number;
  uniqueId?: number;
};

/**
 * Fecha en ISO-8601 CON offset, que es lo que WSAA exige (no acepta la "Z" de
 * toISOString). Se usa el offset real de Buenos Aires vía Intl y no "-03:00"
 * fijo, por si Argentina vuelve a tener horario de verano.
 */
export function isoConOffset(d: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false, timeZoneName: "longOffset",
  }).formatToParts(d);

  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? "";
  // "GMT-03:00" -> "-03:00". Si la zona diera GMT pelado, es offset cero.
  const offset = (p("timeZoneName").replace("GMT", "") || "+00:00");
  // Intl puede devolver "24" para medianoche en algunos runtimes.
  const hora = p("hour") === "24" ? "00" : p("hour");

  return `${p("year")}-${p("month")}-${p("day")}T${hora}:${p("minute")}:${p("second")}${offset}`;
}

/**
 * Arma el TRA.
 *
 * La ventana es corta (10 minutos a cada lado) a propósito: un TRA de larga
 * duración ensancha la ventana en la que ARCA responde "ya posee un TA valido".
 * El ticket que devuelve WSAA dura 12 h igual, sin importar esta ventana.
 */
export function buildTra(opts: TraOptions = {}): string {
  const {
    service = "wsfe",
    now = new Date(),
    ttlSeconds = 600,
    skewSeconds = 600,
    // uniqueId tiene que entrar en un unsigned de 32 bits.
    uniqueId = Math.floor(now.getTime() / 1000) % 0xffffffff,
  } = opts;

  const generationTime = isoConOffset(new Date(now.getTime() - skewSeconds * 1000));
  const expirationTime = isoConOffset(new Date(now.getTime() + ttlSeconds * 1000));

  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${uniqueId}</uniqueId>
    <generationTime>${generationTime}</generationTime>
    <expirationTime>${expirationTime}</expirationTime>
  </header>
  <service>${esc(service)}</service>
</loginTicketRequest>`;
}
