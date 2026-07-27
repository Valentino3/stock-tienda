import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { db } from "@/db";
import { requireStoreOwner } from "@/lib/session";
import { MAX_UPLOAD_BYTES, tooLargeMessage } from "@/lib/import-limits";
import { validateImportRows, type ImportRow } from "@/domain/import";
import { createImportBatch } from "@/domain/import-batches";

// Leer una factura con visión tarda decenas de segundos con imágenes grandes.
export const maxDuration = 300;

// El modelo se puede cambiar por env sin redeployar. Pasó una vez que el alias
// `gpt-4o` dejó de estar habilitado en el proyecto de OpenAI y el import quedó
// muerto; con esto se corrige cambiando una variable.
const MODEL = process.env.OPENAI_IMPORT_MODEL ?? "gpt-5.1";

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

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(req: Request) {
  const { storeId, id: userId } = await requireStoreOwner();

  // Falla antes de gastar la subida entera si falta la config.
  if (!process.env.OPENAI_API_KEY) {
    console.error("[importar/extract] OPENAI_API_KEY no configurada");
    return fail(500, "Falta configurar la API key de OpenAI. Avisale a quien administra el sistema.");
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return fail(400, "Subí una imagen o PDF");
  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf";
  if (!isImage && !isPdf) return fail(400, "El archivo debe ser una imagen o un PDF");
  // El cliente comprime las fotos y corta los PDF pesados antes de subir; esto
  // cubre el endpoint llamado directo.
  if (file.size > MAX_UPLOAD_BYTES) {
    return fail(413, tooLargeMessage(isPdf ? "pdf" : "image", file.size));
  }

  let object: z.infer<typeof extractSchema>;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await generateObject({
      model: openai(MODEL),
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
  } catch (err) {
    console.error("[importar/extract] generateObject falló", err);
    // Un problema de configuración (modelo no habilitado en el proyecto de
    // OpenAI, cuota agotada) no se arregla sacando otra foto. Decirle al usuario
    // "probá con una imagen más nítida" lo manda a perseguir un problema que no
    // existe, así que esos casos se separan.
    const msg = err instanceof Error ? err.message : "";
    if (/does not have access to model|model_not_found|does not exist/i.test(msg)) {
      return fail(500, `El modelo de IA (${MODEL}) no está habilitado en la cuenta de OpenAI. Avisale a quien administra el sistema.`);
    }
    if (/quota|billing|rate limit/i.test(msg)) {
      return fail(500, "La cuenta de OpenAI no tiene crédito o superó el límite. Avisale a quien administra el sistema.");
    }
    return fail(500, "No se pudo leer el documento con IA. Probá con una imagen más nítida.");
  }

  const rows: ImportRow[] = object.products.map((p, i) => ({
    rowNumber: i + 1,
    product: p.product,
    variant: p.variant ?? "",
    sku: p.sku?.trim() || null,
    price: p.price,
    stock: Number.isInteger(p.quantity) && p.quantity > 0 ? p.quantity : 0,
  }));
  if (rows.length === 0) return fail(400, "No se detectaron productos en el documento");

  try {
    // Match por nombre para poder editar stock de productos que ya existen.
    const validated = await validateImportRows(db, storeId, rows, { matchByName: true });
    // Factura: las cantidades son unidades recibidas, se SUMAN al stock actual.
    const summary = await createImportBatch(db, {
      storeId, userId, source: "ai", mode: "add", rows: validated,
    });
    return Response.json(summary);
  } catch (err) {
    console.error("[importar/extract] validación o guardado del lote falló", err);
    return fail(500, "No se pudo procesar el documento. Probá de nuevo.");
  }
}
