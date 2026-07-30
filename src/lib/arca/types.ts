/**
 * Tipos del protocolo WSFEv1 de ARCA. Módulo PURO sin dependencias: lo importan
 * tanto el cliente (src/lib/arca) como el dominio (src/domain/fiscal-*).
 *
 * Los nombres de campo respetan los del web service (PascalCase) donde
 * representan el mensaje de cable, para que se puedan contrastar contra el
 * manual del desarrollador sin traducir mentalmente.
 */

export type ArcaAmbiente = "homologacion" | "produccion";

/** Una alícuota de IVA del comprobante. */
export type FeIvaItem = {
  Id: number;
  BaseImp: number;
  Importe: number;
};

/** Comprobante asociado (una nota de crédito referencia a su factura). */
export type FeCbteAsoc = {
  Tipo: number;
  PtoVta: number;
  Nro: number;
  Cuit?: string;
  CbteFch?: string; // YYYYMMDD
};

/** Un comprobante dentro de FECAESolicitar. Siempre mandamos uno solo. */
export type FeDetRequest = {
  /** 1 = productos, 2 = servicios, 3 = ambos. Siempre 1 en un comercio. */
  Concepto: 1 | 2 | 3;
  DocTipo: number;
  DocNro: string;
  CbteDesde: number;
  CbteHasta: number;
  /** YYYYMMDD en hora de Argentina. */
  CbteFch: string;
  ImpTotal: number;
  /** No gravado. */
  ImpTotConc: number;
  ImpNeto: number;
  /** Exento. */
  ImpOpEx: number;
  ImpIVA: number;
  /** Otros tributos. */
  ImpTrib: number;
  MonId: "PES";
  MonCotiz: number;
  /** Obligatorio desde la RG 5616. */
  CondicionIVAReceptorId: number;
  Iva: FeIvaItem[];
  CbtesAsoc?: FeCbteAsoc[];
};

export type FeCaeRequest = {
  FeCabReq: {
    CantReg: number;
    PtoVta: number;
    CbteTipo: number;
  };
  FeDetReq: FeDetRequest[];
};

export type ArcaMensaje = { code: number; msg: string };

export type FeCaeResponse = {
  resultado: "A" | "R" | "P";
  cae: string | null;
  /** YYYYMMDD tal como lo devuelve ARCA. */
  caeVto: string | null;
  cbteDesde: number | null;
  /** Un comprobante puede salir APROBADO con observaciones: las dos listas importan. */
  observaciones: ArcaMensaje[];
  errores: ArcaMensaje[];
  raw: unknown;
};

export type FeCompConsultarResponse = {
  cbteTipo: number;
  ptoVta: number;
  cbteDesde: number;
  cae: string | null;
  caeVto: string | null;
  cbteFch: string | null;
  impTotal: number | null;
  docTipo: number | null;
  docNro: string | null;
  resultado: string | null;
  observaciones: ArcaMensaje[];
  raw: unknown;
};

export type AccessTicket = {
  token: string;
  sign: string;
  generatedAt: Date;
  expiresAt: Date;
};

export type ArcaAuth = {
  token: string;
  sign: string;
  cuit: string;
};

export type FeDummyResponse = {
  appServer: string;
  dbServer: string;
  authServer: string;
};
