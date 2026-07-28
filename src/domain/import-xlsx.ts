import type ExcelJS from "exceljs";
import type { ImportRow } from "@/domain/import";
import {
  findHeaderRow, HEADER_SCAN_ROWS, LEGACY_ORDER, type ImportField,
} from "@/domain/import-columns";

/**
 * Resultado puro de interpretar la primera hoja. El Route Handler se ocupa
 * después de autenticar, validar contra la base y guardar el lote.
 */
export type ParsedImportWorksheet = {
  rows: ImportRow[];
  headers: string[];
  columns: Map<ImportField, number>;
  usedLegacy: boolean;
  headerRowNumber: number;
  hasStock: boolean;
  matchByName: boolean;
};

/**
 * Texto de una celda. exceljs devuelve formas distintas según el tipo: número
 * y string planos, `{ text }` para rich text e hyperlinks, y `{ result }` para
 * fórmulas — este último es habitual en las planillas reales, donde el costo en
 * pesos o el precio de venta salen de una cuenta.
 */
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("result" in v) return v.result === null || v.result === undefined ? "" : String(v.result);
    if ("text" in v) return String(v.text);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if (v instanceof Date) return v.toISOString();
  }
  return String(v);
}

/**
 * Importe de una celda, tolerante al formato que sale de Excel: símbolos de
 * moneda, espacios, separadores de miles y coma decimal.
 * "$ 90.706,00" y "$ 90,706.00" y 90706 dan todos 90706.
 * Devuelve null si la celda está vacía o no contiene dígitos, y NaN si contiene
 * una combinación numérica inválida.
 */
function cellMoney(v: ExcelJS.CellValue): number | null {
  const raw = cellText(v).trim();
  if (raw === "") return null;
  if (typeof v === "number") return v;

  let s = raw.replace(/[^0-9.,-]/g, "");
  if (s === "" || s === "-") return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // El separador decimal es el que aparece último: "1.234,50" vs "1,234.50".
    s = lastComma > lastDot
      ? s.replace(/\./g, "").replace(",", ".")
      : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    // Una sola coma: decimal ("12,50") salvo que agrupe de a 3 ("1,234").
    s = /,\d{3}$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  }
  return Number(s);
}

const TRUTHY = ["true", "1", "sí", "si", "x", "yes"];

/** Interpreta filas y columnas de una hoja de Excel sin tocar base de datos. */
export function parseImportWorksheet(ws: ExcelJS.Worksheet): ParsedImportWorksheet {
  // Las planillas reales suelen tener títulos, fechas o cotizaciones arriba de
  // la tabla. Inspeccionamos un tramo acotado y elegimos la fila que reconoce
  // más encabezados, en vez de asumir que siempre es la primera.
  const candidateRows: string[][] = [];
  const rowsToScan = Math.min(ws.rowCount, HEADER_SCAN_ROWS);
  for (let r = 1; r <= rowsToScan; r++) {
    const row = ws.getRow(r);
    const values: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) values.push(cellText(row.getCell(c).value));
    candidateRows.push(values);
  }

  const headerMatch = findHeaderRow(candidateRows);
  const headerRowNumber = headerMatch?.rowNumber ?? 1;
  const headers = headerMatch?.headers ?? candidateRows[0] ?? [];
  const columns = headerMatch?.columns
    ?? new Map(LEGACY_ORDER.map((field, i) => [field, i + 1]));
  const usedLegacy = headerMatch === null;

  const at = (row: ExcelJS.Row, field: ImportField) => {
    const column = columns.get(field);
    return column === undefined ? undefined : row.getCell(column).value;
  };
  const text = (row: ExcelJS.Row, field: ImportField) => {
    const value = at(row, field);
    return value === undefined ? undefined : cellText(value).trim();
  };
  const money = (row: ExcelJS.Row, field: ImportField) => {
    const value = at(row, field);
    return value === undefined ? undefined : cellMoney(value);
  };

  // Una planilla que no trae columna de Stock es una LISTA DE PRECIOS, no un
  // inventario. Importarla en modo absoluto pondría en cero el stock de todo lo
  // que toca, así que en ese caso el stock no se modifica.
  const hasStock = columns.has("stock");
  // Sin columna de SKU no hay con qué reconocer lo ya cargado, y cada importe
  // duplicaría el catálogo. Se matchea por nombre de producto.
  const matchByName = !columns.has("sku");

  const rows: ImportRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return; // metadata previa + encabezados
    const product = text(row, "product") ?? "";
    const variant = text(row, "variant") ?? "";
    const sku = text(row, "sku") || null;
    const price = money(row, "price") ?? null;
    const stock = hasStock ? (money(row, "stock") ?? 0) : null;
    const foilRaw = (text(row, "foil") ?? "").toLowerCase();

    // Fila totalmente vacía (separadores, filas de totales sueltas).
    if (!product && !variant && !sku && price === null && !stock) return;

    rows.push({
      rowNumber, product, variant, sku, price, stock,
      setName: text(row, "setName") || null,
      condition: text(row, "condition") || null,
      foil: foilRaw === "" ? undefined : TRUTHY.includes(foilRaw),
      language: text(row, "language") || null,
      priceCash: money(row, "priceCash"),
      priceWholesale: money(row, "priceWholesale"),
      costUsd: money(row, "costUsd"),
      costArs: money(row, "costArs"),
      supplier: text(row, "supplier") ?? undefined,
      supplierSku: text(row, "supplierSku") ?? undefined,
    });
  });

  return {
    rows, headers, columns, usedLegacy, headerRowNumber, hasStock, matchByName,
  };
}
