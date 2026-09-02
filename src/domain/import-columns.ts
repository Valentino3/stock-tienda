// Mapeo de columnas del Excel por NOMBRE de encabezado, no por posición.
//
// Cada comercio arma su planilla como quiere: distinto orden, columnas de más
// que no nos interesan (un id interno, una cotización suelta), y los mismos
// datos con otro nombre ("Descripción" en vez de "Producto"). Exigir la
// plantilla exacta obligaba a rearmar el archivo a mano antes de cada importe.
//
// Se inspeccionan las primeras filas, se normaliza cada celda y se busca contra
// los alias de abajo. Si no se reconoce ningún encabezado, el caller cae a las
// posiciones fijas de la plantilla vieja (ver LEGACY_ORDER).

export type ImportField =
  | "product" | "variant" | "sku" | "price" | "stock"
  | "setName" | "condition" | "foil" | "language"
  | "priceCash" | "priceWholesale" | "priceUsd" | "costUsd" | "costArs"
  | "supplier" | "supplierSku";

/** Orden posicional de la plantilla original, para archivos sin encabezado reconocible. */
export const LEGACY_ORDER: ImportField[] = [
  "product", "variant", "sku", "price", "stock",
  "setName", "condition", "foil", "language",
];

/** Filas iniciales que se inspeccionan para admitir títulos o metadata arriba. */
export const HEADER_SCAN_ROWS = 25;

/**
 * minúsculas, sin acentos, sin puntuación, espacios colapsados.
 * "COSTO/USD" -> "costo usd"; "Precio Venta " -> "precio venta".
 */
export function normalizeHeader(raw: string): string {
  return raw
    .normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Orden importante: el primer alias que matchea gana. Los más específicos van
// antes que los genéricos ("precio venta" antes que "precio").
const ALIASES: [ImportField, string[]][] = [
  ["priceCash", ["efectivo menor", "precio efectivo", "efectivo", "contado", "precio contado"]],
  ["priceWholesale", ["precio mayorista", "mayorista", "precio mayor"]],
  ["priceUsd", ["precio usd", "precio en usd", "precio venta usd", "precio dolares", "precio en dolares", "pvp usd"]],
  ["costUsd", ["costo usd", "costo u s", "costo dolares", "costo en usd", "usd"]],
  ["costArs", ["costo ars", "costo pesos", "costo", "costo en pesos"]],
  ["supplierSku", ["sku proveedor", "codigo proveedor", "cod proveedor", "sku prov"]],
  ["supplier", ["proveedor"]],
  ["price", ["precio venta", "precio de venta", "precio", "pvp", "venta"]],
  ["product", ["producto", "descripcion", "nombre", "articulo", "detalle"]],
  ["variant", ["variante", "version"]],
  ["sku", ["sku", "codigo", "cod", "codigo interno"]],
  ["stock", ["stock", "cantidad", "cant", "unidades", "existencia"]],
  ["setName", ["set", "set name", "expansion", "coleccion"]],
  ["condition", ["condicion", "estado"]],
  ["foil", ["foil", "holo"]],
  ["language", ["idioma", "lenguaje", "lang"]],
];

/**
 * Índice de columna (1-based, como exceljs) por campo, leído de la fila de
 * encabezados. Los campos que no aparecen quedan fuera del Map.
 *
 * Una misma columna nunca se asigna a dos campos, y un campo se queda con la
 * PRIMERA columna que lo matchea: si la planilla trae "Precio venta" y
 * "Precio mayorista", cada una cae en su campo y no compiten.
 */
export function mapHeaderRow(headers: string[]): Map<ImportField, number> {
  const found = new Map<ImportField, number>();
  const usedColumns = new Set<number>();

  for (const [field, aliases] of ALIASES) {
    if (found.has(field)) continue;
    for (let i = 0; i < headers.length; i++) {
      const col = i + 1;
      if (usedColumns.has(col)) continue;
      const h = normalizeHeader(headers[i]);
      if (!h) continue;
      if (aliases.includes(h)) {
        found.set(field, col);
        usedColumns.add(col);
        break;
      }
    }
  }
  return found;
}

export type HeaderRowMatch = {
  /** Número 1-based de la fila, igual que Excel y exceljs. */
  rowNumber: number;
  headers: string[];
  columns: Map<ImportField, number>;
};

/**
 * Encuentra la fila de encabezados dentro del comienzo de una hoja.
 *
 * Algunas planillas tienen arriba un título, una fecha o cotizaciones y recién
 * después los encabezados. Se elige la fila que reconoce más campos, siempre
 * que incluya Producto. Fuera de la primera fila se exigen al menos dos campos
 * para no confundir con encabezado una fila de datos cuyo producto se llame
 * literalmente "Producto".
 */
export function findHeaderRow(rows: string[][]): HeaderRowMatch | null {
  let best: HeaderRowMatch | null = null;

  for (let i = 0; i < rows.length; i++) {
    const headers = rows[i];
    const columns = mapHeaderRow(headers);
    if (!columns.has("product")) continue;
    if (i > 0 && columns.size < 2) continue;

    if (!best || columns.size > best.columns.size) {
      best = { rowNumber: i + 1, headers, columns };
    }
  }

  return best;
}

/** Etiquetas para mostrarle al usuario qué columnas se reconocieron. */
export const FIELD_LABELS: Record<ImportField, string> = {
  product: "Producto",
  variant: "Variante",
  sku: "SKU",
  price: "Precio venta",
  stock: "Stock",
  setName: "Set",
  condition: "Condición",
  foil: "Foil",
  language: "Idioma",
  priceCash: "Efectivo menor",
  priceWholesale: "Precio mayorista",
  priceUsd: "Precio USD",
  costUsd: "Costo USD",
  costArs: "Costo ARS",
  supplier: "Proveedor",
  supplierSku: "SKU proveedor",
};
