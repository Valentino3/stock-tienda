"use server";
import { and, eq, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { products, productVariants } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { createSale } from "@/domain/sales";

export async function searchVariants(term: string) {
  await requireUser();
  if (term.trim().length < 2) return [];
  const t = `%${term.trim()}%`;
  return db
    .select({
      variantId: productVariants.id,
      productName: products.name,
      variantName: productVariants.name,
      sku: productVariants.sku,
      stock: productVariants.stock,
      price: productVariants.price,
      basePrice: products.basePrice,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(
      eq(products.active, true), eq(productVariants.active, true),
      or(ilike(products.name, t), ilike(productVariants.sku, t))
    ))
    .limit(20);
}

const ERROR_MESSAGES: Record<string, string> = {
  NO_OPEN_SESSION: "No hay caja abierta. Abrí la caja antes de vender.",
  INSUFFICIENT_STOCK: "Stock insuficiente para uno de los productos.",
  EMPTY_SALE: "El carrito está vacío.",
  INVALID_QUANTITY: "Cantidad inválida",
  VARIANT_NOT_FOUND: "Producto no encontrado",
};

export async function submitSale(input: {
  paymentMethod: "efectivo" | "transferencia" | "tarjeta";
  items: { variantId: number; quantity: number }[];
}) {
  const user = await requireUser();
  const invalid = input.items.some(
    (i) => !Number.isInteger(i.variantId) || !Number.isInteger(i.quantity) || i.quantity <= 0
  );
  if (invalid) return { error: "Cantidad inválida" };
  try {
    const sale = await createSale(db, { sellerId: user.id, ...input });
    return { ok: true as const, saleId: sale.id, total: sale.total };
  } catch (e) {
    const msg = e instanceof Error ? ERROR_MESSAGES[e.message] : undefined;
    return { error: msg ?? "Error al registrar la venta" };
  }
}
