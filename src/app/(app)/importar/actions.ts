"use server";
import { db } from "@/db";
import { requireStoreOwner } from "@/lib/session";
import { confirmImportBatch } from "@/domain/import-batches";
import { revalidatePath } from "next/cache";

/**
 * Lo que puede salir mal al confirmar, dicho de forma que el dueño sepa qué
 * hacer. Antes cualquier falla llegaba al navegador como un error de server
 * action y la pantalla decía solo "No se pudo confirmar".
 */
const MENSAJES: Record<string, string> = {
  BATCH_NOT_FOUND: "Esta importación ya se confirmó o venció. Volvé a subir el archivo.",
  VARIANT_GONE: "Un producto de la planilla se borró mientras importabas. Volvé a subir el archivo.",
  INSUFFICIENT_STOCK:
    "Se vendió algo mientras importabas y el stock no cerraba. No se aplicó nada: confirmá de nuevo.",
};

/**
 * Confirma un lote ya validado y guardado por /importar/parse o /importar/extract.
 *
 * Recibe solo el id: las filas nunca viajan por el navegador. Antes se mandaba
 * el array entero de vuelta, lo que en planillas medianas pasaba los 4.5 MB que
 * Vercel acepta por request y devolvía 413.
 *
 * El tiempo máximo lo da el `maxDuration` de la página (importar/page.tsx): una
 * server action hereda el del segmento donde vive.
 */
export async function confirmImport(batchId: string) {
  const user = await requireStoreOwner();
  try {
    const result = await confirmImportBatch(db, user.storeId, String(batchId), user.id);
    revalidatePath("/productos");
    return { ok: true as const, ...result };
  } catch (e) {
    const codigo = e instanceof Error ? e.message : "";
    // En el log de Vercel con el lote: es lo único que permite saber después
    // qué planilla falló y por qué.
    console.error("[importar] confirmación falló", { batchId, storeId: user.storeId, error: e });
    return {
      error: MENSAJES[codigo]
        ?? "No se pudo aplicar la importación. No se cambió nada: probá confirmar de nuevo.",
    };
  }
}
