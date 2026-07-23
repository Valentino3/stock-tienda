"use server";
import { db } from "@/db";
import { requireStoreOwner } from "@/lib/session";
import { voidSale } from "@/domain/sales";
import { revalidatePath } from "next/cache";

export async function voidSaleAction(saleId: number) {
  const { id, storeId } = await requireStoreOwner();
  try {
    await voidSale(db, { saleId, storeId, userId: id });
  } catch (e) {
    return { error: e instanceof Error && e.message === "ALREADY_VOIDED" ? "La venta ya está anulada" : "No se pudo anular" };
  }
  revalidatePath("/ventas");
  return { ok: true };
}
