"use server";
import { db } from "@/db";
import { requireStore } from "@/lib/session";
import { createSale, type Discount } from "@/domain/sales";
import { searchVariants as searchVariantsQuery } from "@/domain/catalog";
import { createClient } from "@/domain/clients";
import { DOC_CUIT, DOC_DNI, normalizarDoc, validarCuit } from "@/domain/fiscal-catalogs";
import { esErrorDeRed } from "@/lib/errores-red";

/**
 * Alta rápida de cliente desde la pantalla de venta (para venta a cuenta).
 *
 * Este diálogo tiene UN solo campo fiscal opcional (documento) y el tipo se
 * infiere por el largo. No lleva razón social, domicilio ni condición frente al
 * IVA a propósito: existe porque hay cola en el mostrador, y cargarlo de campos
 * fiscales mataría la razón por la que se construyó. Lo que falte se pide
 * después, al facturar o desde la ficha del cliente.
 */
export async function createClientForSale(name: string, phone?: string, doc?: string) {
  const { storeId } = await requireStore();
  if (!name.trim()) return { error: "Nombre requerido" };

  const docNro = normalizarDoc(doc);
  if (docNro && docNro.length === 11 && !validarCuit(docNro)) {
    return { error: "El CUIT no es válido" };
  }
  if (docNro && docNro.length !== 11 && (docNro.length < 7 || docNro.length > 8)) {
    return { error: "Poné un DNI (7-8 dígitos) o un CUIT (11)" };
  }

  try {
    const c = await createClient(db, {
      storeId, name, phone,
      docNro,
      docTipo: docNro ? (docNro.length === 11 ? DOC_CUIT : DOC_DNI) : null,
    });
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

// Un uid válido es el crypto.randomUUID() que arma el carrito en el cliente.
// Se valida el formato para que el índice único no termine indexando basura
// arbitraria mandada a mano.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function submitSale(input: {
  paymentMethod: "efectivo" | "transferencia" | "tarjeta" | "cuenta";
  items: { variantId: number; quantity: number; discount?: Discount }[];
  saleDiscount?: Discount;
  clientId?: number | null;
  // Clave de idempotencia del carrito. El cliente la conserva entre reintentos.
  uid?: string;
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
  if (input.uid !== undefined && !UUID_RE.test(input.uid)) return { error: "Identificador de venta inválido" };
  try {
    const sale = await createSale(db, { storeId, sellerId, ...input });
    return { ok: true as const, saleId: sale.id, total: sale.total, duplicada: sale.duplicada === true };
  } catch (e) {
    // Un corte de red no dice si la venta entró: puede haberse perdido solo la
    // respuesta. Se marca como reintentable para que el form reuse el uid en
    // vez de armar un carrito nuevo (que sí cobraría dos veces).
    if (esErrorDeRed(e)) {
      return {
        error: "Sin conexión con el servidor. Reintentá: si la venta ya entró, no se va a duplicar.",
        reintentable: true as const,
      };
    }
    const msg = e instanceof Error ? ERROR_MESSAGES[e.message] : undefined;
    return { error: msg ?? "Error al registrar la venta" };
  }
}
