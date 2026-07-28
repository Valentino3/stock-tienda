import ExcelJS from "exceljs";
import { db } from "@/db";
import { requireStoreOwner } from "@/lib/session";
import { MAX_UPLOAD_BYTES, tooLargeMessage } from "@/lib/import-limits";
import { validateImportRows, type ImportRow } from "@/domain/import";
import { createImportBatch } from "@/domain/import-batches";
import {
  mapHeaderRow, LEGACY_ORDER, FIELD_LABELS, type ImportField,
} from "@/domain/import-columns";

// El default de la plataforma ya es 300s, pero declararlo deja el techo
// explícito en el código en vez de depender de la config del proyecto.
export const maxDuration = 300;

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
 * Devuelve null si la celda está vacía, NaN si hay algo que no es un número.
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

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(req: Request) {
  const { storeId, id: userId } = await requireStoreOwner();

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return fail(400, "Subí un archivo .xlsx");
  // El cliente ya corta antes de subir; esto cubre el endpoint llamado directo.
  if (file.size > MAX_UPLOAD_BYTES) return fail(413, tooLargeMessage("xlsx", file.size));

  const wb = new ExcelJS.Workbook();
  try {
    // exceljs's own d.ts resolves `Buffer` against its transitive dep
    // fast-csv's bundled @types/node@14 (non-generic Buffer), while this
    // project's @types/node@20 makes Buffer.from(...) generic (Buffer<ArrayBuffer>).
    // Same runtime value, two structurally-incompatible type declarations from
    // duplicated @types/node — `as unknown as Buffer` still resolves to the
    // ambient (node20) Buffer in scope here, so `any` is the only escape.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as any);
  } catch (err) {
    console.error("[importar/parse] xlsx.load falló", err);
    return fail(400, "El archivo no es un .xlsx válido");
  }
  const ws = wb.worksheets[0];
  if (!ws) return fail(400, "El archivo no tiene hojas");

  // ---- Resolver qué columna es cada campo ----
  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  for (let c = 1; c <= ws.columnCount; c++) headers.push(cellText(headerRow.getCell(c).value));

  let cols = mapHeaderRow(headers);
  let usedLegacy = false;
  if (!cols.has("product")) {
    // Sin encabezado reconocible: se asume la plantilla original por posición.
    cols = new Map(LEGACY_ORDER.map((f, i) => [f, i + 1]));
    usedLegacy = true;
  }

  const at = (row: ExcelJS.Row, field: ImportField) => {
    const c = cols.get(field);
    return c === undefined ? undefined : row.getCell(c).value;
  };
  const text = (row: ExcelJS.Row, field: ImportField) => {
    const v = at(row, field);
    return v === undefined ? undefined : cellText(v).trim();
  };
  const money = (row: ExcelJS.Row, field: ImportField) => {
    const v = at(row, field);
    return v === undefined ? undefined : cellMoney(v);
  };

  // Una planilla que no trae columna de Stock es una LISTA DE PRECIOS, no un
  // inventario. Importarla en modo absoluto pondría en cero el stock de todo lo
  // que toca, así que en ese caso el stock no se modifica.
  const hasStock = cols.has("stock");
  // Sin columna de SKU no hay con qué reconocer lo ya cargado, y cada importe
  // duplicaría el catálogo. Se matchea por nombre de producto.
  const matchByName = !cols.has("sku");

  const rows: ImportRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
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
  if (rows.length === 0) return fail(400, "El archivo no tiene filas de datos");

  try {
    const validated = await validateImportRows(db, storeId, rows, { matchByName });
    const summary = await createImportBatch(db, {
      storeId, userId, source: "excel",
      // Excel: el stock de la fila es el valor final, no un incremento.
      mode: "absolute",
      rows: validated,
    });
    return Response.json({
      ...summary,
      // Para que el usuario confirme que su planilla se leyó como esperaba.
      mapping: {
        detected: [...cols.entries()].map(([field, col]) => ({
          field, label: FIELD_LABELS[field], column: headers[col - 1] || `Columna ${col}`,
        })),
        ignored: headers
          .map((h, i) => ({ h: h.trim(), col: i + 1 }))
          .filter(({ h, col }) => h !== "" && ![...cols.values()].includes(col))
          .map(({ h }) => h),
        usedLegacy,
        hasStock,
        matchByName,
      },
    });
  } catch (err) {
    console.error("[importar/parse] validación o guardado del lote falló", err);
    return fail(500, "No se pudo procesar la planilla. Probá de nuevo.");
  }
}
