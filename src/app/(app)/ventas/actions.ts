"use server";
import { db } from "@/db";
import { requireOwner } from "@/lib/session";
import { voidSale } from "@/domain/sales";
import { revalidatePath } from "next/cache";

export async function voidSaleAction(saleId: number) {
  const user = await requireOwner();
  try {
    await voidSale(db, { saleId, userId: user.id });
  } catch (e) {
    return { error: e instanceof Error && e.message === "ALREADY_VOIDED" ? "La venta ya está anulada" : "No se pudo anular" };
  }
  revalidatePath("/ventas");
  return { ok: true };
}
