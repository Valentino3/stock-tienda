"use server";
import ExcelJS from "exceljs";
import { db } from "@/db";
import { requireOwner } from "@/lib/session";
import { validateImportRows, executeImport, type ImportRow, type ValidatedRow } from "@/domain/import";
import { revalidatePath } from "next/cache";

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "text" in v) return String(v.text);
  return String(v);
}

export async function parseAndValidate(formData: FormData): Promise<{ rows?: ValidatedRow[]; error?: string }> {
  await requireOwner();
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Subí un archivo .xlsx" };
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
  } catch {
    return { error: "El archivo no es un .xlsx válido" };
  }
  const ws = wb.worksheets[0];
  if (!ws) return { error: "El archivo no tiene hojas" };

  const rows: ImportRow[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const product = cellText(row.getCell(1).value).trim();
    const variant = cellText(row.getCell(2).value).trim();
    const sku = cellText(row.getCell(3).value).trim() || null;
    const priceRaw = cellText(row.getCell(4).value).trim();
    const stockRaw = cellText(row.getCell(5).value).trim();
    if (!product && !variant && !sku && !priceRaw && !stockRaw) return; // fila vacía
    rows.push({
      rowNumber, product, variant, sku,
      price: priceRaw === "" ? null : Number(priceRaw.replace(",", ".")),
      stock: stockRaw === "" ? 0 : Number(stockRaw),
    });
  });
  if (rows.length === 0) return { error: "El archivo no tiene filas de datos" };
  return { rows: await validateImportRows(db, rows) };
}

export async function confirmImport(rows: ValidatedRow[]) {
  const user = await requireOwner();
  const result = await executeImport(db, rows, user.id);
  revalidatePath("/productos");
  return { ok: true as const, ...result };
}
