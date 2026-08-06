"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireStore, requireStoreOwner } from "@/lib/session";
import {
  abrirOrden, agregarItem, cambiarCantidad, cambiarComensales, cambiarNota, cancelarOrden,
  crearMesa, pagarOrden,
} from "@/domain/orders";
import {
  acomodarMesasSinUbicar, borrarMarcador, crearMarcador, moverMarcador, moverMesa,
} from "@/domain/floor-plan";
import { searchVariants as searchVariantsQuery } from "@/domain/catalog";
import type { Discount } from "@/domain/sales";
import type { FloorMarkerType } from "@/db/schema";

/**
 * Acciones del salón. Finas a propósito: resuelven sesión, llaman al dominio y
 * traducen el error a castellano. La lógica vive en src/domain/orders.ts, que
 * es lo que se testea.
 */

const MENSAJES: Record<string, string> = {
  MESA_YA_OCUPADA: "Esa mesa ya tiene una comanda abierta.",
  MARCADOR_NO_ENCONTRADO: "Esa referencia del plano no existe.",
  TIPO_INVALIDO: "Tipo de referencia desconocido.",
  MESA_NO_ENCONTRADA: "La mesa no existe.",
  MESA_INACTIVA: "Esa mesa está desactivada.",
  MESA_DUPLICADA: "Ya hay una mesa con ese nombre en el sector.",
  ORDEN_NO_ENCONTRADA: "La comanda no existe.",
  ORDEN_CERRADA: "La comanda ya está cerrada.",
  ORDEN_SIN_ITEMS: "La comanda está vacía.",
  ORDEN_CON_PAGOS: "Ya se cobró una parte: anulá la venta desde Ventas.",
  ITEM_NO_ENCONTRADO: "Ese ítem no existe en la comanda.",
  ITEM_YA_COBRADO: "Ese ítem ya se cobró.",
  ITEMS_NO_ENCONTRADOS: "No quedan ítems por cobrar de los que elegiste.",
  VARIANT_NOT_FOUND: "Ese producto no existe.",
  INVALID_QUANTITY: "Cantidad inválida.",
  NO_OPEN_SESSION: "No hay caja abierta. Abrí la caja antes de cobrar.",
  INSUFFICIENT_STOCK: "No hay stock suficiente de uno de los productos.",
  CLIENT_REQUIRED: "Elegí un cliente para la venta a cuenta.",
  CLIENT_NOT_FOUND: "Cliente no encontrado.",
  EMPTY_NAME: "Poné un nombre.",
};

const traducir = (e: unknown) =>
  (e instanceof Error ? MENSAJES[e.message] : undefined) ?? "No se pudo completar la operación.";

export async function abrirMesa(tableId: number | null, guests?: number) {
  const { storeId, id: userId } = await requireStore();
  try {
    const orden = await abrirOrden(db, { storeId, userId, tableId, guests });
    revalidatePath("/salon");
    return { ok: true as const, orderId: orden.id };
  } catch (e) {
    return { error: traducir(e) };
  }
}

export async function buscarParaComanda(term: string) {
  const { storeId } = await requireStore();
  return searchVariantsQuery(db, storeId, term);
}

export async function agregarALaComanda(orderId: number, variantId: number, quantity: number, notes?: string) {
  const { storeId } = await requireStore();
  try {
    const orden = await agregarItem(db, { storeId, orderId, variantId, quantity, notes });
    revalidatePath(`/salon/${orderId}`);
    revalidatePath("/salon");
    return { ok: true as const, total: orden.total };
  } catch (e) {
    return { error: traducir(e) };
  }
}

export async function cambiarCantidadDeItem(orderId: number, itemId: number, quantity: number) {
  const { storeId } = await requireStore();
  try {
    const orden = await cambiarCantidad(db, { storeId, orderId, itemId, quantity });
    revalidatePath(`/salon/${orderId}`);
    revalidatePath("/salon");
    return { ok: true as const, total: orden.total };
  } catch (e) {
    return { error: traducir(e) };
  }
}

export async function ponerNota(orderId: number, itemId: number, notes: string) {
  const { storeId } = await requireStore();
  try {
    await cambiarNota(db, { storeId, orderId, itemId, notes });
    revalidatePath(`/salon/${orderId}`);
    return { ok: true as const };
  } catch (e) {
    return { error: traducir(e) };
  }
}

export async function ponerComensales(orderId: number, guests: number | null) {
  const { storeId } = await requireStore();
  try {
    await cambiarComensales(db, { storeId, orderId, guests });
    revalidatePath(`/salon/${orderId}`);
    return { ok: true as const };
  } catch (e) {
    return { error: traducir(e) };
  }
}

export async function cancelarComanda(orderId: number) {
  const { storeId } = await requireStore();
  try {
    await cancelarOrden(db, { storeId, orderId });
    revalidatePath("/salon");
    return { ok: true as const };
  } catch (e) {
    return { error: traducir(e) };
  }
}

export async function cobrarComanda(input: {
  orderId: number;
  paymentMethod: "efectivo" | "transferencia" | "tarjeta" | "cuenta";
  clientId?: number | null;
  saleDiscount?: Discount;
  itemIds?: number[];
}) {
  const { storeId, id: userId } = await requireStore();
  try {
    const r = await pagarOrden(db, { storeId, userId, ...input });
    revalidatePath("/salon");
    revalidatePath(`/salon/${input.orderId}`);
    revalidatePath("/ventas");
    return {
      ok: true as const,
      saleId: r.sale.id,
      total: r.sale.total,
      parcial: r.parcial,
      avisoDePrecio: r.avisoDePrecio,
    };
  } catch (e) {
    return { error: traducir(e) };
  }
}

// ---- plano del salón ----
// Todas con guarda de dueño: acomodar el salón es configuración, no operación.
// El mozo ve el plano, no lo edita.

export async function moverMesaEnPlano(
  tableId: number,
  g: { floorX?: number; floorY?: number; floorWidth?: number; floorHeight?: number },
) {
  const { storeId } = await requireStoreOwner();
  try {
    await moverMesa(db, { storeId, tableId, ...g });
    // Sin revalidatePath a propósito: el editor ya tiene la posición en su
    // estado local y esto se llama al soltar CADA mesa. Revalidar acá haría un
    // refetch completo del RSC por cada arrastre.
    return { ok: true as const };
  } catch (e) {
    return { error: traducir(e) };
  }
}

export async function moverMarcadorEnPlano(
  markerId: number,
  g: { floorX?: number; floorY?: number; floorWidth?: number; floorHeight?: number },
) {
  const { storeId } = await requireStoreOwner();
  try {
    await moverMarcador(db, { storeId, markerId, ...g });
    return { ok: true as const };
  } catch (e) {
    return { error: traducir(e) };
  }
}

export async function agregarMarcador(type: FloorMarkerType, sector: string) {
  const { storeId } = await requireStoreOwner();
  try {
    await crearMarcador(db, { storeId, type, sector });
    revalidatePath("/mesas");
    revalidatePath("/salon");
    return { ok: true as const };
  } catch (e) {
    return { error: traducir(e) };
  }
}

export async function quitarMarcador(markerId: number) {
  const { storeId } = await requireStoreOwner();
  try {
    await borrarMarcador(db, { storeId, markerId });
    revalidatePath("/mesas");
    revalidatePath("/salon");
    return { ok: true as const };
  } catch (e) {
    return { error: traducir(e) };
  }
}

/** Reparte en grilla las mesas que nunca se ubicaron. */
export async function acomodarPlano() {
  const { storeId } = await requireStoreOwner();
  try {
    const n = await acomodarMesasSinUbicar(db, storeId);
    revalidatePath("/mesas");
    revalidatePath("/salon");
    return { ok: true as const, acomodadas: n };
  } catch (e) {
    return { error: traducir(e) };
  }
}

/** Alta de mesa: es configuración del local, así que va con guarda de dueño. */
export async function nuevaMesa(name: string, sector?: string, capacity?: number) {
  const { storeId } = await requireStoreOwner();
  try {
    await crearMesa(db, { storeId, name, sector, capacity });
    revalidatePath("/mesas");
    revalidatePath("/salon");
    return { ok: true as const };
  } catch (e) {
    return { error: traducir(e) };
  }
}
