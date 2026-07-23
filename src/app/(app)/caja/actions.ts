"use server";
import { db } from "@/db";
import { requireStore, requireStoreOwner } from "@/lib/session";
import { openCashSession, closeCashSession, getOpenSession, createCashMovement } from "@/domain/cash";
import { revalidatePath } from "next/cache";

const MOVEMENT_ERRORS: Record<string, string> = {
  INVALID_AMOUNT: "Monto inválido",
  EMPTY_DESCRIPTION: "Escribí una descripción",
  NO_OPEN_SESSION: "No hay caja abierta",
};

async function recordMovement(kind: "gasto" | "egreso", storeId: number, userId: string, amount: number, description: string) {
  const open = await getOpenSession(db, storeId);
  if (!open) return { error: "No hay caja abierta" };
  try {
    await createCashMovement(db, { storeId, sessionId: open.id, kind, amount, description, userId });
  } catch (e) {
    return { error: (e instanceof Error && MOVEMENT_ERRORS[e.message]) || "No se pudo registrar" };
  }
  revalidatePath("/caja");
  return { ok: true as const };
}

// Gasto: compra/pago operativo. Lo puede cargar cualquier usuario de la tienda.
export async function addGasto(amount: number, description: string) {
  const { id, storeId } = await requireStore();
  return recordMovement("gasto", storeId, id, amount, description);
}

// Egreso: retiro de efectivo. Solo dueño.
export async function addEgreso(amount: number, description: string) {
  const { id, storeId } = await requireStoreOwner();
  return recordMovement("egreso", storeId, id, amount, description);
}

export async function openSession(openingCash: number) {
  const { id, storeId } = await requireStore();
  if (openingCash < 0) return { error: "Monto inválido" };
  try {
    await openCashSession(db, { storeId, userId: id, openingCash });
  } catch {
    return { error: "Ya hay una caja abierta" };
  }
  revalidatePath("/caja"); revalidatePath("/vender");
  return { ok: true };
}

export async function closeSession(countedCash: number, notes: string) {
  const { id, storeId } = await requireStore();
  if (countedCash < 0) return { error: "Monto inválido" };
  const open = await getOpenSession(db, storeId);
  if (!open) return { error: "No hay caja abierta" };
  let closed;
  try {
    closed = await closeCashSession(db, { storeId, sessionId: open.id, userId: id, countedCash, notes: notes || undefined });
  } catch (e) {
    return { error: e instanceof Error && e.message === "SESSION_NOT_OPEN" ? "La caja ya fue cerrada" : "No se pudo cerrar la caja" };
  }
  revalidatePath("/caja"); revalidatePath("/vender");
  return { ok: true as const, expectedCash: closed.expectedCash, difference: closed.difference };
}
