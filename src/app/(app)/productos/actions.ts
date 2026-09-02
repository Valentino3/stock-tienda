"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { products, productVariants } from "@/db/schema";
import { requireStore, requireStoreOwner } from "@/lib/session";
import { applyStockMovement } from "@/domain/stock";
import { crearProducto, crearVariante } from "@/domain/products";
import { createLowStockNotification } from "@/domain/notifications";

// Aviso de stock bajo al dueño. Cualquier usuario de la tienda (empleado o dueño).
export async function notifyLowStock(variantId: number, note?: string) {
  const { id, storeId } = await requireStore();
  try {
    await createLowStockNotification(db, { storeId, variantId, userId: id, note });
  } catch {
    return { error: "No se pudo enviar el aviso" };
  }
  revalidatePath("/avisos");
  return { ok: true as const };
}

// Código de error de Postgres (y PGlite) para violación de restricción
// unique/exclusion. Drizzle envuelve el error real del driver (con el
// `code` de Postgres) en `err.cause` — mismo patrón que
// src/domain/cash.ts openCashSession.
const PG_UNIQUE_VIOLATION = "23505";

/**
 * Traduce el error del driver a un mensaje que se pueda leer en el diálogo.
 * Drizzle envuelve el error real en `err.cause`, así que hay que mirar los
 * dos niveles. Lo único que puede chocar acá es el SKU: es el único índice
 * único de `product_variants` que la UI puede llegar a violar.
 */
function errorDeGuardado(err: unknown, fallback: string) {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = e?.code ?? e?.cause?.code;
  const message = String(e?.message ?? e?.cause?.message ?? err ?? "");
  if (code === PG_UNIQUE_VIOLATION || /sku/i.test(message)) return { error: "SKU ya existe" };
  return { error: fallback };
}

export async function saveProduct(input: {
  id?: number; name: string; category?: string; basePrice: number;
  lowStockThreshold: number; tracksStock?: boolean; station?: string | null;
  isPromo?: boolean; sku?: string | null; stockInicial?: number;
  basePriceUsd?: number | null;
}) {
  const { id: userId, storeId } = await requireStoreOwner();
  // El stock inicial se valida con el mismo criterio que `restock`, salvo que
  // acá 0 es legítimo: significa "todavía no llegó la mercadería".
  const stockInicial = input.stockInicial ?? 0;
  if (
    !input.name.trim() ||
    input.basePrice < 0 ||
    !Number.isInteger(input.lowStockThreshold) ||
    input.lowStockThreshold < 0 ||
    !Number.isInteger(stockInicial) ||
    stockInicial < 0 ||
    (input.basePriceUsd != null && (Number.isNaN(input.basePriceUsd) || input.basePriceUsd < 0))
  ) return { error: "Datos inválidos" };
  const category = input.category?.trim() || null;
  // `!== false` para que un cliente viejo que no manda el campo conserve el
  // comportamiento de siempre.
  const tracksStock = input.tracksStock !== false;
  const isPromo = input.isPromo === true;
  const station = input.station?.trim() || null;
  if (input.id) {
    // En edición el stock no se toca: se mueve por Reponer y Ajustar, que son
    // por variante y dejan su movimiento.
    await db.update(products).set({
      name: input.name.trim(), category, basePrice: input.basePrice,
      basePriceUsd: input.basePriceUsd ?? null,
      lowStockThreshold: input.lowStockThreshold, tracksStock, station, isPromo,
    }).where(and(eq(products.id, input.id), eq(products.storeId, storeId)));
  } else {
    try {
      await crearProducto(db, {
        storeId, userId, name: input.name, category, basePrice: input.basePrice,
        lowStockThreshold: input.lowStockThreshold, tracksStock, station, isPromo,
        basePriceUsd: input.basePriceUsd ?? null,
        sku: input.sku ?? null, stockInicial,
      });
    } catch (err) {
      return errorDeGuardado(err, "No se pudo guardar el producto");
    }
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
  priceUsd?: number | null;
  priceCash?: number | null;
  priceWholesale?: number | null;
  costUsd?: number | null;
  costArs?: number | null;
  supplier?: string | null;
  supplierSku?: string | null;
  setName?: string | null;
  condition?: string | null;
  foil?: boolean;
  language?: string | null;
  stockInicial?: number;
}) {
  const { id: userId, storeId } = await requireStoreOwner();
  // Empty name is legitimate on UPDATE: every product gets a hidden "default"
  // variant with `name: ""` (see saveProduct above), and its SKU/price must
  // stay editable without forcing the owner to name it. Only INSERT (a new,
  // explicit variant) requires a non-empty name.
  if (!input.id && !input.name.trim()) return { error: "Datos inválidos" };
  // Ningún importe puede ser negativo. Los alternativos se validan igual que
  // `price`; null significa "no informado" y es válido.
  const amounts = [input.price, input.priceUsd, input.priceCash, input.priceWholesale, input.costUsd, input.costArs];
  if (amounts.some((n) => n != null && (Number.isNaN(n) || n < 0))) return { error: "Datos inválidos" };
  const stockInicial = input.stockInicial ?? 0;
  if (!Number.isInteger(stockInicial) || stockInicial < 0) return { error: "Datos inválidos" };
  const values = {
    name: input.name.trim(),
    sku: input.sku?.trim() || null,
    price: input.price,
    priceUsd: input.priceUsd ?? null,
    priceCash: input.priceCash ?? null,
    priceWholesale: input.priceWholesale ?? null,
    costUsd: input.costUsd ?? null,
    costArs: input.costArs ?? null,
    supplier: input.supplier?.trim() || null,
    supplierSku: input.supplierSku?.trim() || null,
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
      // La guarda de tienda sobre el producto padre va adentro de la
      // transacción de `crearVariante`, junto con el stock inicial.
      const creada = await crearVariante(db, {
        storeId, userId, productId: input.productId, values, stockInicial,
      });
      if (!creada) return { error: "Producto no encontrado" };
    }
  } catch (err) {
    return errorDeGuardado(err, "No se pudo guardar la variante");
  }
  revalidatePath("/productos");
  return { ok: true };
}

/**
 * ¿Esta variante lleva stock? Se valida en el servidor y no solo escondiendo
 * el botón: la regla del repo es que una acción no puede confiar en que la UI
 * la haya filtrado.
 */
async function llevaStock(tx: any, variantId: number, storeId: number): Promise<boolean> {
  const [row] = await tx
    .select({ tracksStock: products.tracksStock })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(eq(productVariants.id, variantId), eq(productVariants.storeId, storeId)));
  if (!row) throw new Error("VARIANT_NOT_FOUND");
  return row.tracksStock !== false;
}

export async function restock(variantId: number, quantity: number) {
  const { id: userId, storeId } = await requireStoreOwner();
  if (!Number.isInteger(quantity) || quantity <= 0) return { error: "Cantidad inválida" };
  try {
    await db.transaction(async (tx) => {
      if (!(await llevaStock(tx, variantId, storeId))) throw new Error("NO_LLEVA_STOCK");
      await applyStockMovement(tx, { variantId, storeId, type: "reposicion", quantity, userId });
    });
  } catch (err) {
    if (err instanceof Error && err.message === "NO_LLEVA_STOCK") {
      return { error: "Este producto no lleva stock." };
    }
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
      if (!(await llevaStock(tx, variantId, storeId))) throw new Error("NO_LLEVA_STOCK");
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
    if (err instanceof Error && err.message === "NO_LLEVA_STOCK") {
      return { error: "Este producto no lleva stock." };
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
