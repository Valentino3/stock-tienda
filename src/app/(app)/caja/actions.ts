"use server";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { openCashSession, closeCashSession, getOpenSession } from "@/domain/cash";
import { revalidatePath } from "next/cache";

export async function openSession(openingCash: number) {
  const user = await requireUser();
  if (openingCash < 0) return { error: "Monto inválido" };
  try {
    await openCashSession(db, { userId: user.id, openingCash });
  } catch {
    return { error: "Ya hay una caja abierta" };
  }
  revalidatePath("/caja"); revalidatePath("/vender");
  return { ok: true };
}

export async function closeSession(countedCash: number, notes: string) {
  const user = await requireUser();
  if (countedCash < 0) return { error: "Monto inválido" };
  const open = await getOpenSession(db);
  if (!open) return { error: "No hay caja abierta" };
  let closed;
  try {
    closed = await closeCashSession(db, { sessionId: open.id, userId: user.id, countedCash, notes: notes || undefined });
  } catch (e) {
    return { error: e instanceof Error && e.message === "SESSION_NOT_OPEN" ? "La caja ya fue cerrada" : "No se pudo cerrar la caja" };
  }
  revalidatePath("/caja"); revalidatePath("/vender");
  return { ok: true as const, expectedCash: closed.expectedCash, difference: closed.difference };
}
