import { and, eq, lt } from "drizzle-orm";
import { importBatches } from "@/db/schema";
import { executeImport, type ValidatedRow } from "@/domain/import";

/** Filas que se le mandan al navegador para revisar. El resto vive en la base. */
export const PREVIEW_ROWS = 200;

/** Los lotes sin confirmar se descartan después de esto. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export type BatchSummary = {
  batchId: string;
  /** Filas totales del archivo (no del preview). */
  total: number;
  valid: number;
  errors: number;
  preview: ValidatedRow[];
};

/**
 * Guarda un lote validado y devuelve el resumen que ve el cliente.
 *
 * `rows` DEBE ser el output completo de validateImportRows, con las filas
 * erróneas incluidas: executeImport calcula `skipped` a partir de ellas
 * (ver el comentario en domain/import.ts).
 */
export async function createImportBatch(
  db: any,
  input: {
    storeId: number;
    userId: string;
    source: "excel" | "ai";
    mode: "absolute" | "add";
    rows: ValidatedRow[];
  }
): Promise<BatchSummary> {
  // Limpieza oportunista, sin cron: los lotes viejos sin confirmar se borran
  // cuando la misma tienda arranca uno nuevo.
  await db.delete(importBatches).where(and(
    eq(importBatches.storeId, input.storeId),
    eq(importBatches.status, "pending"),
    lt(importBatches.createdAt, new Date(Date.now() - STALE_AFTER_MS)),
  ));

  const batchId = crypto.randomUUID();
  await db.insert(importBatches).values({
    id: batchId,
    storeId: input.storeId,
    createdBy: input.userId,
    source: input.source,
    mode: input.mode,
    rows: input.rows,
  });

  return {
    batchId,
    total: input.rows.length,
    valid: input.rows.filter((r) => !r.error).length,
    errors: input.rows.filter((r) => r.error).length,
    preview: input.rows.slice(0, PREVIEW_ROWS),
  };
}

/**
 * Ejecuta un lote pendiente.
 *
 * Scopeado por tienda: un lote de OTRA tienda no se encuentra, aunque se
 * conozca su id. Un lote ya confirmado tampoco.
 *
 * El lote se marca confirmado ANTES de ejecutarlo, con un UPDATE condicional
 * que devuelve la fila. Ese UPDATE es la reclamación: si dos requests entran a
 * la vez (doble click), solo una consigue la fila y la otra ve 0 y aborta. Un
 * SELECT-y-después-UPDATE tendría una ventana de carrera en la que ambas leen
 * "pending" y ambas importan, duplicando el stock.
 *
 * La contra es que si executeImport falla, el lote queda marcado y hay que
 * volver a subir el archivo. Es el lado seguro para fallar: peor sería duplicar
 * el stock de una tienda.
 */
export async function confirmImportBatch(
  db: any,
  storeId: number,
  batchId: string,
  userId: string
): Promise<{ created: number; updated: number; skipped: number }> {
  const [batch] = await db.update(importBatches)
    .set({ status: "confirmed" })
    .where(and(
      eq(importBatches.id, batchId),
      eq(importBatches.storeId, storeId),
      eq(importBatches.status, "pending"),
    ))
    .returning();
  if (!batch) throw new Error("BATCH_NOT_FOUND");

  return executeImport(
    db,
    storeId,
    batch.rows as ValidatedRow[],
    userId,
    { mode: batch.mode as "absolute" | "add" }
  );
}
