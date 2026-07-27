"use server";
import { db } from "@/db";
import { requireStoreOwner } from "@/lib/session";
import { confirmImportBatch } from "@/domain/import-batches";
import { revalidatePath } from "next/cache";

/**
 * Confirma un lote ya validado y guardado por /importar/parse o /importar/extract.
 *
 * Recibe solo el id: las filas nunca viajan por el navegador. Antes se mandaba
 * el array entero de vuelta, lo que en planillas medianas pasaba los 4.5 MB que
 * Vercel acepta por request y devolvía 413.
 */
export async function confirmImport(batchId: string) {
  const user = await requireStoreOwner();
  const result = await confirmImportBatch(db, user.storeId, batchId, user.id);
  revalidatePath("/productos");
  return { ok: true as const, ...result };
}
