import ExcelJS from "exceljs";
import { db } from "@/db";
import { requireStoreOwner } from "@/lib/session";
import { MAX_UPLOAD_BYTES, tooLargeMessage } from "@/lib/import-limits";
import { validateImportRows } from "@/domain/import";
import { createImportBatch } from "@/domain/import-batches";
import { FIELD_LABELS } from "@/domain/import-columns";
import { parseImportWorksheet } from "@/domain/import-xlsx";

// El default de la plataforma ya es 300s, pero declararlo deja el techo
// explícito en el código en vez de depender de la config del proyecto.
export const maxDuration = 300;

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

  const {
    rows, headers, columns, usedLegacy, headerRowNumber, hasStock, matchByName,
  } = parseImportWorksheet(ws);
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
        detected: [...columns.entries()].map(([field, col]) => ({
          field, label: FIELD_LABELS[field], column: headers[col - 1] || `Columna ${col}`,
        })),
        ignored: headers
          .map((h, i) => ({ h: h.trim(), col: i + 1 }))
          .filter(({ h, col }) => h !== "" && ![...columns.values()].includes(col))
          .map(({ h }) => h),
        usedLegacy,
        headerRow: headerRowNumber,
        hasStock,
        matchByName,
      },
    });
  } catch (err) {
    console.error("[importar/parse] validación o guardado del lote falló", err);
    return fail(500, "No se pudo procesar la planilla. Probá de nuevo.");
  }
}
