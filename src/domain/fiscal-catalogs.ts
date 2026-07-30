/**
 * Tablas de códigos de ARCA y validaciones de documento. Módulo PURO: sin DB,
 * sin red, sin fecha del sistema.
 *
 * Los códigos son valores de cable de ARCA. Se guardan como smallint en la DB
 * (ver la nota en src/db/schema.ts) y la seguridad de tipos la dan estas
 * uniones.
 */

// ---- tipos de comprobante ----
// Emisor Responsable Inscripto. Factura C / NC C (monotributista emisor) quedan
// fuera de alcance por ahora: agregarlas es sumar 11 y 13 acá, sin migración.
export const CBTE_FACTURA_A = 1;
export const CBTE_NOTA_CREDITO_A = 3;
export const CBTE_FACTURA_B = 6;
export const CBTE_NOTA_CREDITO_B = 8;

export type CbteTipoFactura = typeof CBTE_FACTURA_A | typeof CBTE_FACTURA_B;
export type CbteTipoNotaCredito = typeof CBTE_NOTA_CREDITO_A | typeof CBTE_NOTA_CREDITO_B;
export type CbteTipo = CbteTipoFactura | CbteTipoNotaCredito;

export const CBTE_LABEL: Record<CbteTipo, string> = {
  [CBTE_FACTURA_A]: "Factura A",
  [CBTE_NOTA_CREDITO_A]: "Nota de Crédito A",
  [CBTE_FACTURA_B]: "Factura B",
  [CBTE_NOTA_CREDITO_B]: "Nota de Crédito B",
};

/** Código que va en el recuadro central del comprobante impreso ("COD. 01"). */
export const CBTE_COD_IMPRESO: Record<CbteTipo, string> = {
  [CBTE_FACTURA_A]: "01",
  [CBTE_NOTA_CREDITO_A]: "03",
  [CBTE_FACTURA_B]: "06",
  [CBTE_NOTA_CREDITO_B]: "08",
};

/** Letra del comprobante, para el recuadro grande. */
export const CBTE_LETRA: Record<CbteTipo, "A" | "B"> = {
  [CBTE_FACTURA_A]: "A",
  [CBTE_NOTA_CREDITO_A]: "A",
  [CBTE_FACTURA_B]: "B",
  [CBTE_NOTA_CREDITO_B]: "B",
};

/** La nota de crédito que corresponde a una factura. */
export function ncPara(tipoFactura: CbteTipoFactura): CbteTipoNotaCredito {
  return tipoFactura === CBTE_FACTURA_A ? CBTE_NOTA_CREDITO_A : CBTE_NOTA_CREDITO_B;
}

export function esNotaCredito(tipo: number): boolean {
  return tipo === CBTE_NOTA_CREDITO_A || tipo === CBTE_NOTA_CREDITO_B;
}

// ---- tipos de documento del receptor ----
export const DOC_CUIT = 80;
export const DOC_CUIL = 86;
export const DOC_DNI = 96;
export const DOC_CONSUMIDOR_FINAL = 99;

export type DocTipo = typeof DOC_CUIT | typeof DOC_CUIL | typeof DOC_DNI | typeof DOC_CONSUMIDOR_FINAL;

export const DOC_LABEL: Record<DocTipo, string> = {
  [DOC_CUIT]: "CUIT",
  [DOC_CUIL]: "CUIL",
  [DOC_DNI]: "DNI",
  [DOC_CONSUMIDOR_FINAL]: "Consumidor Final",
};

// ---- condición del receptor frente al IVA (CondicionIVAReceptorId) ----
// Obligatorio en FECAESolicitar (RG 5616). La tabla completa se puede traer en
// runtime con FEParamGetCondicionIvaReceptor; acá van las que usa el comercio.
export const IVA_RESPONSABLE_INSCRIPTO = 1;
export const IVA_SUJETO_EXENTO = 4;
export const IVA_CONSUMIDOR_FINAL = 5;
export const IVA_MONOTRIBUTO = 6;

export type CondicionIva =
  | typeof IVA_RESPONSABLE_INSCRIPTO
  | typeof IVA_SUJETO_EXENTO
  | typeof IVA_CONSUMIDOR_FINAL
  | typeof IVA_MONOTRIBUTO;

export const CONDICION_IVA_LABEL: Record<CondicionIva, string> = {
  [IVA_RESPONSABLE_INSCRIPTO]: "IVA Responsable Inscripto",
  [IVA_SUJETO_EXENTO]: "IVA Sujeto Exento",
  [IVA_CONSUMIDOR_FINAL]: "Consumidor Final",
  [IVA_MONOTRIBUTO]: "Responsable Monotributo",
};

export const CONDICIONES_IVA_RECEPTOR: CondicionIva[] = [
  IVA_CONSUMIDOR_FINAL, IVA_RESPONSABLE_INSCRIPTO, IVA_MONOTRIBUTO, IVA_SUJETO_EXENTO,
];

/**
 * ¿Le corresponde Factura A?
 *
 * ⚠️ Se decide por la condición frente al IVA, NUNCA por "tiene CUIT". Un
 * monotributista tiene CUIT y le corresponde Factura B. Emitirle A es un error
 * fiscal real, no un detalle de presentación.
 */
export function esInscripto(condicionIva: number | null | undefined): boolean {
  return condicionIva === IVA_RESPONSABLE_INSCRIPTO;
}

// ---- alícuotas de IVA ----
// Id de ARCA -> alícuota como fracción.
export const ALICUOTAS: Record<number, number> = {
  3: 0,      // 0%
  4: 0.105,  // 10.5%
  5: 0.21,   // 21%
  6: 0.27,   // 27%
  8: 0.05,   // 5%
  9: 0.025,  // 2.5%
};

export const ALICUOTA_LABEL: Record<number, string> = {
  3: "0%", 4: "10,5%", 5: "21%", 6: "27%", 8: "5%", 9: "2,5%",
};

export const IVA_ID_21 = 5;

export function alicuotaDe(ivaId: number): number {
  const a = ALICUOTAS[ivaId];
  if (a === undefined) throw new Error("ALICUOTA_DESCONOCIDA");
  return a;
}

// ---- documentos ----

/** Deja solo dígitos. `null` si no queda ninguno. */
export function normalizarDoc(v: string | null | undefined): string | null {
  if (!v) return null;
  const soloDigitos = v.replace(/\D/g, "");
  return soloDigitos.length > 0 ? soloDigitos : null;
}

/**
 * Validación del dígito verificador del CUIT/CUIL (módulo 11).
 * No verifica que el CUIT exista en ARCA, solo que esté bien formado.
 */
export function validarCuit(cuit: string | null | undefined): boolean {
  const d = normalizarDoc(cuit);
  if (!d || d.length !== 11) return false;

  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, peso, i) => acc + peso * Number(d[i]), 0);
  const resto = suma % 11;
  // 11 - resto, con los dos casos especiales del algoritmo: resto 0 -> 0,
  // resto 1 -> 9 (los CUIT que darían 10 se emiten con prefijo 23).
  const verificador = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto;
  return verificador === Number(d[10]);
}

/** `20111111112` -> `20-11111111-2`. Solo presentación. */
export function formatearCuit(cuit: string | null | undefined): string {
  const d = normalizarDoc(cuit);
  if (!d || d.length !== 11) return cuit ?? "";
  return `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;
}

/** `1` + `123` -> `0001-00000123`. */
export function formatearNumeroComprobante(ptoVta: number, numero: number): string {
  return `${String(ptoVta).padStart(4, "0")}-${String(numero).padStart(8, "0")}`;
}
