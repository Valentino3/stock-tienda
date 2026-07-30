import { alicuotaDe } from "@/domain/fiscal-catalogs";

/**
 * Matemática de importes de un comprobante. Módulo PURO: sin DB, sin red.
 *
 * Los precios del sistema son BRUTOS (IVA incluido, un solo número). ARCA
 * necesita el desglose y valida al centavo:
 *
 *   ImpNeto + ImpIVA + ImpTotConc + ImpOpEx + ImpTrib === ImpTotal
 *   Σ Iva[].BaseImp === ImpNeto
 *   Σ Iva[].Importe === ImpIVA
 *   |Iva[].Importe − Iva[].BaseImp × alícuota| ≤ 0.01
 *
 * LA CLAVE: descomponer UNA VEZ POR BUCKET DE ALÍCUOTA, nunca por línea, y
 * derivar el IVA por RESTA. Casi todo algoritmo de "absorber el centavo
 * sobrante" que circula existe solo porque alguien descompuso línea por línea y
 * sumó, acumulando hasta N centavos de error. Hecho en este orden no hay residuo
 * que absorber: los invariantes valen por construcción.
 *
 * Todo se calcula en CENTAVOS ENTEROS. numeric(12,2, mode:"number") entrega
 * floats de JS, y dividir por 1.21 con floats es exactamente cómo nacen los
 * rechazos de ARCA.
 */

export type LineaFiscal = {
  descripcion: string;
  cantidad: number;
  /** Precio unitario BRUTO (con IVA incluido), tal como se guardó en sale_items. */
  precioUnitario: number;
  /** Descuento de la línea, en $, tal como se guardó en sale_items. */
  descuentoLinea: number;
  ivaId: number;
};

export type LineaCalculada = LineaFiscal & {
  /** Bruto de la línea ya neto del descuento general prorrateado, en $. */
  netoAsignado: number;
  baseImp: number;
  importeIva: number;
};

export type IvaBucket = { id: number; baseImp: number; importe: number };

export type ImportesComprobante = {
  impTotal: number;
  impNeto: number;
  impIva: number;
  impTotConc: number;
  impOpEx: number;
  impTrib: number;
  iva: IvaBucket[];
  lineas: LineaCalculada[];
};

const cents = (n: number) => Math.round(n * 100);
const pesos = (c: number) => c / 100;

/** Serializa para el XML. `toFixed(2)` y no String(n): evita "826.4500000000001". */
export function aMoneda(valor: number): string {
  return valor.toFixed(2);
}

/**
 * Fecha del comprobante en hora de Argentina, formato `YYYYMMDD` para WSFE.
 *
 * El server corre en UTC en Vercel. Una venta a las 22:00 de Buenos Aires ya es
 * el día siguiente en UTC, así que `toISOString().slice(0,10)` está mal ~3 h por
 * día. NO reusar src/lib/dates.ts (isoDate), que es justamente eso.
 *
 * Se usa Intl con la zona IANA y no un offset -3 fijo: Argentina tuvo horario de
 * verano y podría volver a tenerlo; con Intl queda correcto sin mantenimiento.
 */
export function fechaArca(d: Date = new Date()): string {
  return fechaArcaIso(d).replace(/-/g, "");
}

/** Igual que fechaArca pero `YYYY-MM-DD` (para la columna `date` y para el QR). */
export function fechaArcaIso(d: Date = new Date()): string {
  // "en-CA" produce YYYY-MM-DD, que es exactamente el formato que queremos.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

/** `20260730` -> `2026-07-30`. Lo que devuelve ARCA en CAEFchVto. */
export function isoDesdeArca(yyyymmdd: string): string {
  const d = yyyymmdd.replace(/\D/g, "");
  if (d.length !== 8) throw new Error("FECHA_ARCA_INVALIDA");
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
}

/**
 * Calcula todos los importes de un comprobante a partir de las líneas de la
 * venta y su descuento general.
 *
 * `totalEsperado` es `sales.total`: se usa como aserción, no como insumo. Si no
 * cierra con las líneas, se corta antes de mandarle a ARCA números que no
 * coinciden con lo que el cliente pagó.
 */
export function calcularImportes(input: {
  lineas: LineaFiscal[];
  descuentoGeneral: number;
  totalEsperado: number;
}): ImportesComprobante {
  const { lineas, descuentoGeneral, totalEsperado } = input;
  if (lineas.length === 0) throw new Error("SIN_LINEAS");

  // --- Paso 1: brutos de línea, espejando lo que createSale realmente guardó ---
  const brutos = lineas.map((l) => cents(l.cantidad * l.precioUnitario) - cents(l.descuentoLinea));
  if (brutos.some((b) => b < 0)) throw new Error("IMPORTES_INCONSISTENTES");

  const S = brutos.reduce((a, b) => a + b, 0);
  const D = cents(descuentoGeneral);
  const T = cents(totalEsperado);

  if (S - D !== T) throw new Error("IMPORTES_INCONSISTENTES");
  if (T <= 0) throw new Error("IMPORTE_CERO"); // ARCA rechaza ImpTotal = 0

  // --- Paso 2: bajar el descuento general a las líneas (largest-remainder) ---
  // Hace falta porque el descuento general se aplica DESPUÉS de los netos de
  // línea, pero los buckets de IVA son por línea.
  const netos = repartirDescuento(brutos, S, D);

  // --- Paso 3: agrupar por alícuota y descomponer cada bucket UNA vez ---
  const porAlicuota = new Map<number, number>();
  lineas.forEach((l, i) => {
    alicuotaDe(l.ivaId); // valida el id acá, antes de sumar nada
    porAlicuota.set(l.ivaId, (porAlicuota.get(l.ivaId) ?? 0) + netos[i]);
  });

  const buckets: { id: number; base: number; iva: number }[] = [];
  for (const [ivaId, bruto] of [...porAlicuota.entries()].sort((a, b) => a[0] - b[0])) {
    // ⚠️ ARCA rechaza entradas de Iva[] con BaseImp = 0. Se descartan.
    if (bruto === 0) continue;
    const p = alicuotaDe(ivaId);
    const base = Math.round(bruto / (1 + p));
    // RESTA, nunca round(base * p): es lo que hace que base + iva === bruto
    // valga EXACTO por bucket.
    buckets.push({ id: ivaId, base, iva: bruto - base });
  }
  if (buckets.length === 0) throw new Error("IMPORTE_CERO");

  // --- Paso 4: agregar ---
  const impNeto = buckets.reduce((a, b) => a + b.base, 0);
  const impIva = buckets.reduce((a, b) => a + b.iva, 0);

  // Los invariantes valen por construcción; se afirman igual porque son baratos
  // y convierten un bug futuro en un error legible en vez de un rechazo de ARCA.
  if (impNeto + impIva !== T) throw new Error("IMPORTES_INCONSISTENTES");

  // Base y proporción de IVA por línea, para el detalle impreso de la Factura A.
  // Se derivan del bucket para que el total impreso coincida con el declarado.
  const lineasCalculadas = lineas.map((l, i) => {
    const netoLinea = netos[i];
    const p = alicuotaDe(l.ivaId);
    const base = Math.round(netoLinea / (1 + p));
    return {
      ...l,
      netoAsignado: pesos(netoLinea),
      baseImp: pesos(base),
      importeIva: pesos(netoLinea - base),
    };
  });

  return {
    impTotal: pesos(T),
    impNeto: pesos(impNeto),
    impIva: pesos(impIva),
    impTotConc: 0,
    impOpEx: 0,
    impTrib: 0,
    iva: buckets.map((b) => ({ id: b.id, baseImp: pesos(b.base), importe: pesos(b.iva) })),
    lineas: lineasCalculadas,
  };
}

/**
 * Reparte `D` centavos de descuento entre líneas proporcionalmente a su bruto,
 * por el método del mayor resto. Devuelve los brutos ya netos.
 *
 * Post-condición exacta: `Σ resultado === S − D`.
 *
 * El desempate (fracción, después bruto descendente, después índice) es
 * determinista a propósito: hace los tests reproducibles y, sobre todo, hace que
 * re-emitir un comprobante rechazado dé exactamente los mismos números.
 */
function repartirDescuento(brutos: number[], S: number, D: number): number[] {
  if (D === 0) return brutos.slice();
  if (S === 0) throw new Error("IMPORTES_INCONSISTENTES");

  const crudos = brutos.map((b) => (b * D) / S);
  const asignados = crudos.map((c) => Math.floor(c));
  let resto = D - asignados.reduce((a, b) => a + b, 0);

  const orden = brutos
    .map((bruto, i) => ({ i, bruto, frac: crudos[i] - asignados[i] }))
    .sort((a, b) => b.frac - a.frac || b.bruto - a.bruto || a.i - b.i);

  for (let k = 0; resto > 0 && k < orden.length; k++, resto--) {
    asignados[orden[k].i] += 1;
  }
  // Con Σfloor ≤ D < Σfloor + n, `resto` nunca supera la cantidad de líneas.
  if (resto !== 0) throw new Error("IMPORTES_INCONSISTENTES");

  return brutos.map((b, i) => b - asignados[i]);
}
