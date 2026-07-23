"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { products, productVariants } from "@/db/schema";
import { requireStoreOwner } from "@/lib/session";
import { applyStockMovement } from "@/domain/stock";

// Código de error de Postgres (y PGlite) para violación de restricción
// unique/exclusion. Drizzle envuelve el error real del driver (con el
// `code` de Postgres) en `err.cause` — mismo patrón que
// src/domain/cash.ts openCashSession.
const PG_UNIQUE_VIOLATION = "23505";

export async function saveProduct(input: { id?: number; name: string; basePrice: number; lowStockThreshold: number }) {
  const { storeId } = await requireStoreOwner();
  if (
    !input.name.trim() ||
    input.basePrice < 0 ||
    !Number.isInteger(input.lowStockThreshold) ||
    input.lowStockThreshold < 0
  ) return { error: "Datos inválidos" };
  if (input.id) {
    await db.update(products).set({
      name: input.name.trim(), basePrice: input.basePrice, lowStockThreshold: input.lowStockThreshold,
    }).where(and(eq(products.id, input.id), eq(products.storeId, storeId)));
  } else {
    const [p] = await db.insert(products).values({
      storeId, name: input.name.trim(), basePrice: input.basePrice, lowStockThreshold: input.lowStockThreshold,
    }).returning();
    // variante default para producto sin variantes reales
    await db.insert(productVariants).values({ storeId, productId: p.id, name: "" });
  }
  revalidatePath("/productos");
  return { ok: true };
}

export async function saveVariant(input: {
  id?: number;
  productId: number;
  name: string;
  sku: string | null;
  price: number | null;
  setName?: string | null;
  condition?: string | null;
  foil?: boolean;
  language?: string | null;
}) {
  const { storeId } = await requireStoreOwner();
  // Empty name is legitimate on UPDATE: every product gets a hidden "default"
  // variant with `name: ""` (see saveProduct above), and its SKU/price must
  // stay editable without forcing the owner to name it. Only INSERT (a new,
  // explicit variant) requires a non-empty name.
  if ((!input.id && !input.name.trim()) || (input.price !== null && input.price < 0)) return { error: "Datos inválidos" };
  const values = {
    name: input.name.trim(),
    sku: input.sku?.trim() || null,
    price: input.price,
    setName: input.setName?.trim() || null,
    condition: input.condition?.trim() || null,
    foil: input.foil ?? false,
    language: input.language?.trim() || null,
  };
  try {
    if (input.id) {
      await db.update(productVariants).set(values)
        .where(and(eq(productVariants.id, input.id), eq(productVariants.storeId, storeId)));
    } else {
      // El producto padre debe ser de la tienda (evita atar variantes a
      // productos de otra tienda por id).
      const [parent] = await db.select({ id: products.id }).from(products)
        .where(and(eq(products.id, input.productId), eq(products.storeId, storeId)));
      if (!parent) return { error: "Producto no encontrado" };
      await db.insert(productVariants).values({ ...values, storeId, productId: input.productId });
    }
  } catch (err) {
    const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
    const code = e?.code ?? e?.cause?.code;
    const message = String(e?.message ?? e?.cause?.message ?? err ?? "");
    if (code === PG_UNIQUE_VIOLATION || /sku/i.test(message)) return { error: "SKU ya existe" };
    return { error: "No se pudo guardar la variante" };
  }
  revalidatePath("/productos");
  return { ok: true };
}

export async function restock(variantId: number, quantity: number) {
  const { id: userId, storeId } = await requireStoreOwner();
  if (!Number.isInteger(quantity) || quantity <= 0) return { error: "Cantidad inválida" };
  try {
    await db.transaction(async (tx) => {
      await applyStockMovement(tx, { variantId, storeId, type: "reposicion", quantity, userId });
    });
  } catch {
    return { error: "No se pudo reponer" };
  }
  revalidatePath("/productos");
  return { ok: true };
}

export async function adjustStock(variantId: number, newStock: number, reason: string) {
  const { id: userId, storeId } = await requireStoreOwner();
  if (!Number.isInteger(newStock) || newStock < 0 || !reason.trim()) return { error: "Datos inválidos" };
  try {
    await db.transaction(async (tx) => {
      const [v] = await tx.select().from(productVariants)
        .where(and(eq(productVariants.id, variantId), eq(productVariants.storeId, storeId)));
      if (!v) throw new Error("VARIANT_NOT_FOUND");
      const delta = newStock - v.stock;
      if (delta !== 0) {
        await applyStockMovement(tx, { variantId, storeId, type: "ajuste", quantity: delta, userId, reason: reason.trim() });
      }
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INSUFFICIENT_STOCK") {
      return { error: "Stock insuficiente para el ajuste" };
    }
    return { error: "No se pudo ajustar el stock" };
  }
  revalidatePath("/productos");
  return { ok: true };
}

export async function toggleProductActive(productId: number, active: boolean) {
  const { storeId } = await requireStoreOwner();
  await db.update(products).set({ active })
    .where(and(eq(products.id, productId), eq(products.storeId, storeId)));
  revalidatePath("/productos");
  return { ok: true };
}

export async function toggleVariantActive(variantId: number, active: boolean) {
  const { storeId } = await requireStoreOwner();
  await db.update(productVariants).set({ active })
    .where(and(eq(productVariants.id, variantId), eq(productVariants.storeId, storeId)));
  revalidatePath("/productos");
  return { ok: true };
}
