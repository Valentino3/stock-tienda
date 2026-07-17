"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { products, productVariants } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { applyStockMovement } from "@/domain/stock";

export async function saveProduct(input: { id?: number; name: string; basePrice: number; lowStockThreshold: number }) {
  await requireOwner();
  if (!input.name.trim() || input.basePrice < 0) return { error: "Datos inválidos" };
  if (input.id) {
    await db.update(products).set({
      name: input.name.trim(), basePrice: input.basePrice, lowStockThreshold: input.lowStockThreshold,
    }).where(eq(products.id, input.id));
  } else {
    const [p] = await db.insert(products).values({
      name: input.name.trim(), basePrice: input.basePrice, lowStockThreshold: input.lowStockThreshold,
    }).returning();
    // variante default para producto sin variantes reales
    await db.insert(productVariants).values({ productId: p.id, name: "" });
  }
  revalidatePath("/productos");
  return { ok: true };
}

export async function saveVariant(input: { id?: number; productId: number; name: string; sku: string | null; price: number | null }) {
  await requireOwner();
  const values = { name: input.name.trim(), sku: input.sku?.trim() || null, price: input.price };
  try {
    if (input.id) await db.update(productVariants).set(values).where(eq(productVariants.id, input.id));
    else await db.insert(productVariants).values({ ...values, productId: input.productId });
  } catch {
    return { error: "SKU ya existe" };
  }
  revalidatePath("/productos");
  return { ok: true };
}

export async function restock(variantId: number, quantity: number) {
  const user = await requireOwner();
  if (!Number.isInteger(quantity) || quantity <= 0) return { error: "Cantidad inválida" };
  await db.transaction(async (tx) => {
    await applyStockMovement(tx, { variantId, type: "reposicion", quantity, userId: user.id });
  });
  revalidatePath("/productos");
  return { ok: true };
}

export async function adjustStock(variantId: number, newStock: number, reason: string) {
  const user = await requireOwner();
  if (!Number.isInteger(newStock) || newStock < 0 || !reason.trim()) return { error: "Datos inválidos" };
  await db.transaction(async (tx) => {
    const [v] = await tx.select().from(productVariants).where(eq(productVariants.id, variantId));
    const delta = newStock - v.stock;
    if (delta !== 0) {
      await applyStockMovement(tx, { variantId, type: "ajuste", quantity: delta, userId: user.id, reason: reason.trim() });
    }
  });
  revalidatePath("/productos");
  return { ok: true };
}

export async function toggleProductActive(productId: number, active: boolean) {
  await requireOwner();
  await db.update(products).set({ active }).where(eq(products.id, productId));
  revalidatePath("/productos");
  return { ok: true };
}

export async function toggleVariantActive(variantId: number, active: boolean) {
  await requireOwner();
  await db.update(productVariants).set({ active }).where(eq(productVariants.id, variantId));
  revalidatePath("/productos");
  return { ok: true };
}
