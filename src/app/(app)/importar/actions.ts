"use server";
import ExcelJS from "exceljs";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
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
    const setName = cellText(row.getCell(6).value).trim() || null;
    const condition = cellText(row.getCell(7).value).trim() || null;
    const foilRaw = cellText(row.getCell(8).value).trim().toLowerCase();
    const foil = foilRaw === "" ? undefined : ["true", "1", "sí", "si", "x"].includes(foilRaw);
    const language = cellText(row.getCell(9).value).trim() || null;
    if (!product && !variant && !sku && !priceRaw && !stockRaw) return; // fila vacía
    rows.push({
      rowNumber, product, variant, sku,
      price: priceRaw === "" ? null : Number(priceRaw.replace(",", ".")),
      stock: stockRaw === "" ? 0 : Number(stockRaw),
      setName, condition, foil, language,
    });
  });
  if (rows.length === 0) return { error: "El archivo no tiene filas de datos" };
  return { rows: await validateImportRows(db, rows) };
}

// Import con IA: lee una factura (foto o PDF) y extrae productos, cantidad y
// precio. Devuelve filas validadas (match por nombre) para la misma preview.
const EXTRACT_PROMPT = `Sos un asistente de carga de stock para un comercio. Te paso una factura o remito de proveedor (foto o PDF). Extraé cada producto listado con su cantidad recibida y su precio unitario. Reglas:
- product: nombre del producto tal como aparece.
- variant: variante si la hubiera (talle, color, etc.), o cadena vacía.
- sku: código del producto si figura, o null.
- price: precio UNITARIO como número (sin símbolos, punto decimal), o null si no aparece.
- quantity: unidades recibidas como entero.
No inventes filas ni precios. Si un dato no está, dejalo en null (o 0 en quantity).`;

const extractSchema = z.object({
  products: z.array(
    z.object({
      product: z.string(),
      variant: z.string().nullable(),
      sku: z.string().nullable(),
      price: z.number().nullable(),
      quantity: z.number().int(),
    })
  ),
});

export async function extractFromDocument(
  formData: FormData
): Promise<{ rows?: ValidatedRow[]; error?: string }> {
  await requireOwner();
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Subí una imagen o PDF" };
  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf";
  if (!isImage && !isPdf) return { error: "El archivo debe ser una imagen o un PDF" };

  let object: z.infer<typeof extractSchema>;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await generateObject({
      model: openai("gpt-4o"),
      schema: extractSchema,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: EXTRACT_PROMPT },
            { type: "file", data: bytes, mediaType: file.type },
          ],
        },
      ],
    });
    object = result.object;
  } catch {
    return { error: "No se pudo leer el documento con IA. Probá con una imagen más nítida." };
  }

  const rows: ImportRow[] = object.products.map((p, i) => ({
    rowNumber: i + 1,
    product: p.product,
    variant: p.variant ?? "",
    sku: p.sku?.trim() || null,
    price: p.price,
    stock: Number.isInteger(p.quantity) && p.quantity > 0 ? p.quantity : 0,
  }));
  if (rows.length === 0) return { error: "No se detectaron productos en el documento" };

  // Match por nombre para poder editar stock de productos que ya existen.
  return { rows: await validateImportRows(db, rows, { matchByName: true }) };
}

export async function confirmImport(rows: ValidatedRow[], mode: "absolute" | "add" = "absolute") {
  const user = await requireOwner();
  const result = await executeImport(db, rows, user.id, { mode });
  revalidatePath("/productos");
  return { ok: true as const, ...result };
}
