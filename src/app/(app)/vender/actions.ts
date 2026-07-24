"use server";
import { db } from "@/db";
import { requireStore } from "@/lib/session";
import { createSale, type Discount } from "@/domain/sales";
import { searchVariants as searchVariantsQuery } from "@/domain/catalog";
import { createClient } from "@/domain/clients";

// Alta rápida de cliente desde la pantalla de venta (para venta a cuenta).
export async function createClientForSale(name: string, phone?: string) {
  const { storeId } = await requireStore();
  if (!name.trim()) return { error: "Nombre requerido" };
  try {
    const c = await createClient(db, { storeId, name, phone });
    return { ok: true as const, id: c.id, name: c.name };
  } catch {
    return { error: "No se pudo crear el cliente" };
  }
}

// Un descuento es válido si es monto ≥ 0, o porcentaje entre 0 y 100.
function validDiscount(d: Discount | undefined): boolean {
  if (d === undefined) return true;
  if (d.kind !== "amount" && d.kind !== "percent") return false;
  if (typeof d.value !== "number" || Number.isNaN(d.value) || d.value < 0) return false;
  if (d.kind === "percent" && d.value > 100) return false;
  return true;
}

export async function searchVariants(term: string) {
  const { storeId } = await requireStore();
  return searchVariantsQuery(db, storeId, term);
}

const ERROR_MESSAGES: Record<string, string> = {
  NO_OPEN_SESSION: "No hay caja abierta. Abrí la caja antes de vender.",
  INSUFFICIENT_STOCK: "Stock insuficiente para uno de los productos.",
  EMPTY_SALE: "El carrito está vacío.",
  INVALID_QUANTITY: "Cantidad inválida",
  VARIANT_NOT_FOUND: "Producto no encontrado",
  CLIENT_REQUIRED: "Elegí un cliente para la venta a cuenta.",
  CLIENT_NOT_FOUND: "Cliente no encontrado.",
};

export async function submitSale(input: {
  paymentMethod: "efectivo" | "transferencia" | "tarjeta" | "cuenta";
  items: { variantId: number; quantity: number; discount?: Discount }[];
  saleDiscount?: Discount;
  clientId?: number | null;
}) {
  const { id: sellerId, storeId } = await requireStore();
  const invalid = input.items.some(
    (i) =>
      !Number.isInteger(i.variantId) ||
      !Number.isInteger(i.quantity) ||
      i.quantity <= 0 ||
      !validDiscount(i.discount)
  );
  if (invalid || !validDiscount(input.saleDiscount)) return { error: "Cantidad o descuento inválido" };
  try {
    const sale = await createSale(db, { storeId, sellerId, ...input });
    return { ok: true as const, saleId: sale.id, total: sale.total };
  } catch (e) {
    const msg = e instanceof Error ? ERROR_MESSAGES[e.message] : undefined;
    return { error: msg ?? "Error al registrar la venta" };
  }
}
