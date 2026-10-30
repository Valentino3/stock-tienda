"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireStore, requireStoreOwner } from "@/lib/session";
import {
  abrirOrden, agregarItem, anularItem, cambiarCantidad, cambiarComensales, cambiarNota, cancelarOrden,
  crearMesa, dividirItem, faltaStock, moverOrden, pagarOrden, transferirMozo,
} from "@/domain/orders";
import { esMetodoValido, type Pago, type PaymentMethod } from "@/domain/pagos";
import { money } from "@/lib/format";
import {
  acomodarMesasSinUbicar, borrarMarcador, crearMarcador, moverMarcador, moverMesa,
} from "@/domain/floor-plan";
import {
  comandasPendientes, deshacerListo, mandarACocina, marcarAgotado, marcarCorreccionesVistas,
  marcarImpresas, marcarListo, platosParaAgotar, variantesAgotadas,
} from "@/domain/kitchen";
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
  MOZO_INVALIDO: "Ese usuario no puede atender mesas en este local.",
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
  ITEM_ENVIADO: "Ya está en la cocina: para sacarlo, anulalo con un motivo.",
  ITEM_NO_ENVIADO: "Ese ítem todavía no se mandó: quitalo directamente.",
  ITEM_ANULADO: "Ese ítem ya está anulado.",
  MOTIVO_REQUERIDO: "Poné un motivo (al menos 3 letras).",
  CANTIDAD_NO_DIVISIBLE: "Elegí una cantidad menor a la de la línea.",
  ITEMS_NO_ENCONTRADOS: "No quedan ítems por cobrar de los que elegiste.",
  ITEMS_YA_COBRADOS: "Alguien cobró parte de esto recién. Revisá la cuenta antes de cobrar.",
  UID_REPETIDO: "No se pudo cobrar. Volvé a intentar.",
  PAYMENT_INPUT_INVALID: "Elegí cómo se paga.",
  INVALID_PAYMENT_METHOD: "Medio de pago inválido.",
  INVALID_PAYMENT_AMOUNT: "Monto de pago inválido.",
  VARIANT_NOT_FOUND: "Ese producto no existe.",
  PRODUCTO_AGOTADO: "La cocina lo marcó agotado por hoy.",
  PRODUCTO_NO_ENCONTRADO: "Ese plato no existe.",
  INVALID_QUANTITY: "Cantidad inválida.",
  NO_OPEN_SESSION: "No hay caja abierta. Abrí la caja antes de cobrar.",
  INSUFFICIENT_STOCK: "No hay stock suficiente de uno de los productos.",
  CLIENT_REQUIRED: "Elegí un cliente para la venta a cuenta.",
  CLIENT_NOT_FOUND: "Cliente no encontrado.",
  EMPTY_NAME: "Poné un nombre.",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const resultados = await searchVariantsQuery(db, storeId, term);
  // Lo agotado se muestra igual, tachado: que el mozo vea que existe y que hoy
  // no hay, en vez de pensar que lo buscó mal.
  const agotadas = await variantesAgotadas(db, storeId, resultados.map((r) => r.variantId));
  return resultados.map((r) => ({ ...r, agotado: agotadas.has(r.variantId) }));
}

export async function agregarALaComanda(orderId: number, variantId: number, quantity: number, notes?: string) {
  const { storeId } = await requireStore();
  try {
    const orden = await agregarItem(db, { storeId, orderId, variantId, quantity, notes });
    const falta = await faltaStock(db, { storeId, orderId, variantId });
    revalidatePath(`/salon/${orderId}`);
    revalidatePath("/salon");
    return { ok: true as const, total: orden.total, falta };
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

/** Parte una línea para poder cobrar cada parte por separado. */
export async function dividirLinea(orderId: number, itemId: number, cantidad: number) {
  const { storeId } = await requireStore();
  try {
    await dividirItem(db, { storeId, orderId, itemId, cantidad });
    revalidatePath(`/salon/${orderId}`);
    return { ok: true as const };
  } catch (e) {
    return { error: traducir(e) };
  }
}

/** Anula una línea ya enviada a cocina: no se borra, queda con su motivo. */
export async function anularLinea(input: {
  orderId: number; itemId: number; cantidad: number; motivo: string; wasted: boolean;
}) {
  const { storeId, id: userId } = await requireStore();
  try {
    // Campo por campo y la sesión al final: el argumento de una server action
    // lo arma el cliente, y un `storeId` colado en `input` pisaría el real.
    const { orderId, itemId, cantidad, motivo, wasted } = input;
    const orden = await anularItem(db, {
      orderId, itemId, cantidad, motivo, wasted: wasted === true, storeId, userId,
    });
    revalidatePath(`/salon/${input.orderId}`);
    revalidatePath("/salon");
    revalidatePath("/cocina");
    return { ok: true as const, total: orden.total };
  } catch (e) {
    return { error: traducir(e) };
  }
}

export async function cancelarComanda(orderId: number, motivo?: string, wasted?: boolean) {
  const { storeId, id: userId } = await requireStore();
  try {
    await cancelarOrden(db, { storeId, orderId, userId, motivo, wasted });
    revalidatePath("/cocina");
    revalidatePath("/salon");
    return { ok: true as const };
  } catch (e) {
    return { error: traducir(e) };
  }
}

export async function cobrarComanda(input: {
  orderId: number;
  paymentMethod?: PaymentMethod;
  pagos?: Pago[];
  clientId?: number | null;
  saleDiscount?: Discount;
  itemIds?: number[];
  uid?: string;
}) {
  const { storeId, id: userId } = await requireStore();
  // La forma se valida acá, igual que en /vender: el argumento lo arma el
  // navegador y el tipo de TypeScript no existe en runtime.
  if (input.pagos !== undefined) {
    const invalidos = !Array.isArray(input.pagos) || input.pagos.length === 0 ||
      input.pagos.some((p) => !esMetodoValido(p?.method) || !Number.isFinite(p?.amount) || p.amount <= 0);
    if (invalidos) return { error: "Pago inválido." };
  }
  if (input.uid !== undefined && !UUID_RE.test(input.uid)) return { error: "Identificador de cobro inválido." };
  try {
    const r = await pagarOrden(db, { ...input, storeId, userId });
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
    // El total del servidor va en el mensaje: si un precio cambió con la mesa
    // abierta, repartir otra vez con el total viejo falla siempre.
    if (e instanceof Error && e.message === "PAYMENT_TOTAL_MISMATCH") {
      const total = (e as Error & { total?: number }).total;
      return {
        error: total != null
          ? `Los pagos no suman el total a cobrar (${money(total)}). Cambió un precio: volvé a repartir el pago.`
          : "Los pagos no suman el total a cobrar.",
      };
    }
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
    await moverMesa(db, { ...g, storeId, tableId });
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
    await moverMarcador(db, { ...g, storeId, markerId });
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

// ---- cocina ----

/**
 * Manda a preparar lo que todavía no salió. Es del mozo, no del dueño.
 */
export async function mandarComandaACocina(orderId: number) {
  const { storeId } = await requireStore();
  try {
    const n = await mandarACocina(db, { storeId, orderId });
    revalidatePath(`/salon/${orderId}`);
    revalidatePath("/cocina");
    return { ok: true as const, mandados: n };
  } catch (e) {
    return { error: traducir(e) };
  }
}

/** Lo que la cocina tiene para preparar. La consulta la pantalla en intervalo. */
export async function traerComandas(estacion?: string | null) {
  const { storeId } = await requireStore();
  return comandasPendientes(db, storeId, { estacion });
}

/** La cocina que trabaja solo con pantalla confirma que vio las correcciones. */
export async function confirmarCorrecciones(itemIds: number[]) {
  const { storeId } = await requireStore();
  try {
    const n = await marcarCorreccionesVistas(db, { storeId, itemIds });
    return { ok: true as const, vistas: n };
  } catch (e) {
    return { error: traducir(e) };
  }
}

/** La pantalla de cocina avisa que ya salió por impresora. */
export async function confirmarImpresion(itemIds: number[]) {
  const { storeId } = await requireStore();
  try {
    const n = await marcarImpresas(db, { storeId, itemIds });
    return { ok: true as const, impresas: n };
  } catch (e) {
    return { error: traducir(e) };
  }
}

/** La cocina sacó estas líneas. */
export async function marcarListos(itemIds: number[]) {
  const { storeId } = await requireStore();
  try {
    const n = await marcarListo(db, { storeId, itemIds });
    revalidatePath("/salon", "layout");
    return { ok: true as const, listos: n };
  } catch (e) {
    return { error: traducir(e) };
  }
}

/** Un «Listo» tocado por error. */
export async function deshacerListos(itemIds: number[]) {
  const { storeId } = await requireStore();
  try {
    const n = await deshacerListo(db, { storeId, itemIds });
    revalidatePath("/salon", "layout");
    return { ok: true as const, deshechos: n };
  } catch (e) {
    return { error: traducir(e) };
  }
}

/** La carta, para marcar lo que se acabó. */
export async function traerPlatosParaAgotar(estacion?: string | null) {
  const { storeId } = await requireStore();
  return platosParaAgotar(db, storeId, { estacion });
}

/**
 * Agotado por hoy. Lo marca la cocina, no el dueño: es quien se entera
 * primero, y no puede esperar a que alguien con permisos entre a Menú.
 */
export async function cambiarAgotado(productId: number, agotado: boolean) {
  const { storeId } = await requireStore();
  try {
    await marcarAgotado(db, { storeId, productId, agotado: agotado === true });
    revalidatePath("/cocina");
    return { ok: true as const };
  } catch (e) {
    return { error: traducir(e) };
  }
}

/** Pasa la mesa a otro mozo: a quien se le va a acreditar la venta. */
export async function cambiarMozo(orderId: number, waiterId: string) {
  const { storeId } = await requireStore();
  try {
    await transferirMozo(db, { storeId, orderId, waiterId: String(waiterId) });
    revalidatePath(`/salon/${orderId}`);
    revalidatePath("/salon");
    return { ok: true as const };
  } catch (e) {
    return { error: traducir(e) };
  }
}

/** Pasa la orden entera a otra mesa libre. */
export async function pasarAMesa(orderId: number, tableId: number) {
  const { storeId } = await requireStore();
  try {
    await moverOrden(db, { storeId, orderId, tableId: Number(tableId) });
    revalidatePath(`/salon/${orderId}`);
    revalidatePath("/salon");
    revalidatePath("/cocina");
    return { ok: true as const };
  } catch (e) {
    return { error: traducir(e) };
  }
}
