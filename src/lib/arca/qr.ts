import { QR_BASE_URL } from "@/lib/arca/config";

/**
 * Código QR de comprobantes electrónicos (RG 4892). Módulo PURO.
 *
 * El QR apunta al microsite de ARCA con un JSON en base64 en el parámetro `p`.
 */

export type QrPayload = {
  ver: 1;
  /** YYYY-MM-DD (con guiones, a diferencia de CbteFch). */
  fecha: string;
  cuit: number;
  ptoVta: number;
  tipoCmp: number;
  nroCmp: number;
  importe: number;
  moneda: "PES";
  ctz: number;
  tipoDocRec: number;
  nroDocRec: number;
  /** "E" = CAE (electrónico). "A" sería CAEA. */
  tipoCodAut: "E";
  codAut: number;
};

/**
 * ⚠️ `cuit`, `nroDocRec` y `codAut` son NÚMEROS en la especificación, no
 * strings. Comillarlos es el bug clásico que hace que el QR no resuelva nada en
 * el sitio de ARCA.
 */
export function buildQrPayload(cbte: {
  cbteFch: string;      // YYYY-MM-DD
  cuitEmisor: string;
  ptoVta: number;
  cbteTipo: number;
  numero: number;
  impTotal: number;
  docTipo: number;
  docNro: string;
  cae: string;
}): QrPayload {
  return {
    ver: 1,
    fecha: cbte.cbteFch,
    cuit: Number(cbte.cuitEmisor),
    ptoVta: cbte.ptoVta,
    tipoCmp: cbte.cbteTipo,
    nroCmp: cbte.numero,
    importe: cbte.impTotal,
    moneda: "PES",
    ctz: 1,
    tipoDocRec: cbte.docTipo,
    nroDocRec: Number(cbte.docNro),
    tipoCodAut: "E",
    codAut: Number(cbte.cae),
  };
}

export function qrUrl(payload: QrPayload): string {
  const json = JSON.stringify(payload);
  return `${QR_BASE_URL}?p=${Buffer.from(json, "utf8").toString("base64")}`;
}

/** Atajo: de la fila del comprobante a la URL. `null` si todavía no tiene CAE. */
export function qrUrlDeComprobante(cbte: {
  cbteFch: string; cuitEmisor: string; ptoVta: number; cbteTipo: number;
  numero: number; impTotal: number; docTipo: number; docNro: string; cae: string | null;
}): string | null {
  if (!cbte.cae) return null;
  return qrUrl(buildQrPayload({ ...cbte, cae: cbte.cae }));
}
