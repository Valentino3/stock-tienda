"use server";
import { db } from "@/db";
import { requireUser } from "@/lib/session";
import { createSale } from "@/domain/sales";
import { searchVariants as searchVariantsQuery } from "@/domain/catalog";

export async function searchVariants(term: string) {
  await requireUser();
  return searchVariantsQuery(db, term);
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
