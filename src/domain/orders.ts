import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  diningTables, orderItems, orders, products, productVariants, sales,
  type DiningTable, type Order, type Sale,
} from "@/db/schema";
import { createSale, type Discount } from "@/domain/sales";

/**
 * Órdenes del salón: la mesa abierta que se cobra al final.
 *
 * La orden NO es una venta en borrador (ver la nota extensa junto a la tabla
 * `orders` en src/db/schema.ts). Al cobrar se llama al `createSale` de
 * siempre, sin tocarlo, y desde ese momento la venta es indistinguible de una
 * de mostrador: entra en el cierre de caja, en los reportes, en la cuenta
 * corriente y se puede facturar por ARCA. Ese es todo el argumento del diseño.
 *
 * Todo está scopeado por tienda, como el resto del dominio: no se puede tocar
 * una orden de otra tienda pasando su id.
 */

const PG_UNIQUE_VIOLATION = "23505";

const codigoDe = (err: unknown) =>
  (err as { code?: string; cause?: { code?: string } })?.code
  ?? (err as { cause?: { code?: string } })?.cause?.code;

/** Estados en los que la orden todavía admite cambios. */
const EDITABLES = ["abierta", "a_cobrar"] as const;

async function traerOrdenEditable(tx: any, storeId: number, orderId: number): Promise<Order> {
  const [orden] = await tx.select().from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.storeId, storeId)));
  if (!orden) throw new Error("ORDEN_NO_ENCONTRADA");
  if (!EDITABLES.includes(orden.status)) throw new Error("ORDEN_CERRADA");
  return orden;
}

/**
 * Recalcula los totales desde los ítems, siempre del lado servidor y dentro de
 * la misma transacción que el cambio. Un total que manda el cliente es una
 * sugerencia, no un dato.
 */
async function recalcularTotales(tx: any, orderId: number): Promise<Order> {
  const [agg] = await tx
    .select({ subtotal: sql<number>`coalesce(sum(${orderItems.quantity} * ${orderItems.unitPrice}), 0)`.mapWith(Number) })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  const subtotal = Math.round((agg?.subtotal ?? 0) * 100) / 100;
  const [orden] = await tx.update(orders)
    .set({ subtotal, total: subtotal })
    .where(eq(orders.id, orderId))
    .returning();
  return orden;
}

export async function abrirOrden(
  db: any,
  input: { storeId: number; userId: string; tableId?: number | null; guests?: number; uid?: string | null },
): Promise<Order> {
  const uid = input.uid?.trim() || null;

  try {
    return await db.transaction(async (tx: any) => {
      if (uid) {
        const [ya] = await tx.select().from(orders)
          .where(and(eq(orders.storeId, input.storeId), eq(orders.uid, uid))).limit(1);
        if (ya) return ya;
      }

      // La mesa tiene que ser de esta tienda y estar activa.
      if (input.tableId != null) {
        const [mesa] = await tx.select({ id: diningTables.id, active: diningTables.active })
          .from(diningTables)
          .where(and(eq(diningTables.id, input.tableId), eq(diningTables.storeId, input.storeId)));
        if (!mesa) throw new Error("MESA_NO_ENCONTRADA");
        if (!mesa.active) throw new Error("MESA_INACTIVA");
      }

      const [orden] = await tx.insert(orders).values({
        storeId: input.storeId,
        uid,
        tableId: input.tableId ?? null,
        openedBy: input.userId,
        guests: input.guests ?? null,
      }).returning();
      return orden;
    });
  } catch (err) {
    // El pre-chequeo del uid es check-then-insert, y la mesa la protege el
    // índice único parcial. Los dos empates los resuelve la base.
    if (codigoDe(err) === PG_UNIQUE_VIOLATION) {
      if (uid) {
        const [ya] = await db.select().from(orders)
          .where(and(eq(orders.storeId, input.storeId), eq(orders.uid, uid))).limit(1);
        if (ya) return ya;
      }
      throw new Error("MESA_YA_OCUPADA");
    }
    throw err;
  }
}

export async function agregarItem(
  db: any,
  input: {
    storeId: number; orderId: number; variantId: number; quantity: number; notes?: string | null;
  },
): Promise<Order> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw new Error("INVALID_QUANTITY");

  return db.transaction(async (tx: any) => {
    await traerOrdenEditable(tx, input.storeId, input.orderId);

    const [v] = await tx
      .select({
        id: productVariants.id,
        variantName: productVariants.name,
        productName: products.name,
        price: productVariants.price,
        basePrice: products.basePrice,
      })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(and(eq(productVariants.id, input.variantId), eq(productVariants.storeId, input.storeId)));
    if (!v) throw new Error("VARIANT_NOT_FOUND");

    await tx.insert(orderItems).values({
      orderId: input.orderId,
      storeId: input.storeId,
      variantId: input.variantId,
      quantity: input.quantity,
      // Precio y nombre del momento del pedido. El precio definitivo lo vuelve
      // a resolver createSale al cobrar; este es el que ve el mozo y el que
      // sale impreso en la cuenta.
      unitPrice: v.price ?? v.basePrice,
      nameSnapshot: v.variantName ? `${v.productName} — ${v.variantName}` : v.productName,
      notes: input.notes?.trim() || null,
    });

    return recalcularTotales(tx, input.orderId);
  });
}

/** Cantidad 0 borra la línea. Solo se pueden tocar ítems impagos. */
export async function cambiarCantidad(
  db: any,
  input: { storeId: number; orderId: number; itemId: number; quantity: number },
): Promise<Order> {
  if (!Number.isInteger(input.quantity) || input.quantity < 0) throw new Error("INVALID_QUANTITY");

  return db.transaction(async (tx: any) => {
    await traerOrdenEditable(tx, input.storeId, input.orderId);

    const [item] = await tx.select().from(orderItems)
      .where(and(
        eq(orderItems.id, input.itemId),
        eq(orderItems.orderId, input.orderId),
        eq(orderItems.storeId, input.storeId),
      ));
    if (!item) throw new Error("ITEM_NO_ENCONTRADO");
    // Un ítem ya cobrado es historia: cambiarlo desajustaría la venta que lo pagó.
    if (item.saleId != null) throw new Error("ITEM_YA_COBRADO");

    if (input.quantity === 0) {
      await tx.delete(orderItems).where(eq(orderItems.id, input.itemId));
    } else {
      await tx.update(orderItems).set({ quantity: input.quantity }).where(eq(orderItems.id, input.itemId));
    }

    return recalcularTotales(tx, input.orderId);
  });
}

/**
 * Nota de cocina de una línea: "sin sal", "a punto", "sin cebolla".
 *
 * Es lo que hace que la comanda sirva de verdad. Igual que la cantidad, solo
 * se puede tocar mientras el ítem esté impago.
 */
export async function cambiarNota(
  db: any,
  input: { storeId: number; orderId: number; itemId: number; notes: string | null },
): Promise<void> {
  await db.transaction(async (tx: any) => {
    await traerOrdenEditable(tx, input.storeId, input.orderId);

    const [item] = await tx.select().from(orderItems)
      .where(and(
        eq(orderItems.id, input.itemId),
        eq(orderItems.orderId, input.orderId),
        eq(orderItems.storeId, input.storeId),
      ));
    if (!item) throw new Error("ITEM_NO_ENCONTRADO");
    if (item.saleId != null) throw new Error("ITEM_YA_COBRADO");

    await tx.update(orderItems)
      .set({ notes: input.notes?.trim() || null })
      .where(eq(orderItems.id, input.itemId));
  });
}

/** Cuántos se sentaron. Sirve para dividir la cuenta y para estadística. */
export async function cambiarComensales(
  db: any,
  input: { storeId: number; orderId: number; guests: number | null },
): Promise<Order> {
  if (input.guests != null && (!Number.isInteger(input.guests) || input.guests < 1)) {
    throw new Error("INVALID_QUANTITY");
  }
  return db.transaction(async (tx: any) => {
    await traerOrdenEditable(tx, input.storeId, input.orderId);
    const [orden] = await tx.update(orders)
      .set({ guests: input.guests })
      .where(eq(orders.id, input.orderId))
      .returning();
    return orden;
  });
}

export async function cancelarOrden(
  db: any,
  input: { storeId: number; orderId: number },
): Promise<void> {
  await db.transaction(async (tx: any) => {
    const orden = await traerOrdenEditable(tx, input.storeId, input.orderId);

    // Si ya se cobró aunque sea una parte, no se cancela: hay una venta con su
    // comprobante colgando. Lo que corresponde es anular esa venta.
    const [pagados] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(orderItems)
      .where(and(eq(orderItems.orderId, orden.id), sql`${orderItems.saleId} is not null`));
    if ((pagados?.n ?? 0) > 0) throw new Error("ORDEN_CON_PAGOS");

    await tx.update(orders)
      .set({ status: "cancelada", closedAt: new Date() })
      .where(eq(orders.id, orden.id));
  });
}

export type ResultadoPago = {
  sale: Sale;
  orden: Order;
  /** Quedan ítems impagos: fue un pago parcial y la orden sigue abierta. */
  parcial: boolean;
  /**
   * El catálogo cambió entre el pedido y el cobro. Se cobra lo que resolvió el
   * servidor —es la fuente de verdad del precio— pero el cajero tiene que
   * enterarse, porque el papel que vio el cliente decía otra cosa.
   */
  avisoDePrecio?: { totalEnLaCuenta: number; totalCobrado: number };
};

/**
 * Cobra la orden y la convierte en una venta común.
 *
 * `itemIds` permite cobrar solo una parte (dividir la cuenta): cada tanda es
 * una venta con su propio comprobante, y los ítems quedan estampados con el
 * `saleId` que los pagó. Sin `itemIds` se cobra todo lo que esté impago.
 *
 * Una sola transacción: si createSale falla —por ejemplo, no hay caja
 * abierta— la orden queda intacta y abierta.
 */
export async function pagarOrden(
  db: any,
  input: {
    storeId: number;
    orderId: number;
    userId: string;
    paymentMethod: "efectivo" | "transferencia" | "tarjeta" | "cuenta";
    clientId?: number | null;
    saleDiscount?: Discount;
    itemIds?: number[];
    uid?: string | null;
  },
): Promise<ResultadoPago> {
  return db.transaction(async (tx: any) => {
    const orden = await traerOrdenEditable(tx, input.storeId, input.orderId);

    const impagos = await tx.select().from(orderItems)
      .where(and(eq(orderItems.orderId, orden.id), isNull(orderItems.saleId)));
    if (impagos.length === 0) throw new Error("ORDEN_SIN_ITEMS");

    const aCobrar = input.itemIds?.length
      ? impagos.filter((i: { id: number }) => input.itemIds!.includes(i.id))
      : impagos;
    if (aCobrar.length === 0) throw new Error("ITEMS_NO_ENCONTRADOS");

    const totalEnLaCuenta = aCobrar.reduce(
      (acc: number, i: { quantity: number; unitPrice: number }) => acc + i.quantity * i.unitPrice,
      0,
    );

    // Se agrupa por variante: dos pedidos de la misma milanesa son una línea de
    // dos unidades en la venta, como en cualquier venta de mostrador.
    const porVariante = new Map<number, number>();
    for (const i of aCobrar) {
      porVariante.set(i.variantId, (porVariante.get(i.variantId) ?? 0) + i.quantity);
    }

    // El createSale de siempre, sin modificar: resuelve precios contra el
    // catálogo, descuenta stock donde corresponde, arma la cuenta corriente y
    // exige caja abierta. Corre como savepoint dentro de esta transacción.
    const sale = await createSale(tx, {
      storeId: input.storeId,
      sellerId: input.userId,
      paymentMethod: input.paymentMethod,
      clientId: input.clientId,
      saleDiscount: input.saleDiscount,
      orderId: orden.id,
      uid: input.uid,
      items: [...porVariante].map(([variantId, quantity]) => ({ variantId, quantity })),
    });

    await tx.update(orderItems)
      .set({ saleId: sale.id })
      .where(inArray(orderItems.id, aCobrar.map((i: { id: number }) => i.id)));

    const [restantes] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(orderItems)
      .where(and(eq(orderItems.orderId, orden.id), isNull(orderItems.saleId)));
    const parcial = (restantes?.n ?? 0) > 0;

    const [ordenFinal] = await tx.update(orders)
      .set(parcial ? { status: "a_cobrar" } : { status: "pagada", closedAt: new Date() })
      .where(eq(orders.id, orden.id))
      .returning();

    // Sin descuento general, la cuenta impresa y lo cobrado deberían coincidir.
    // Si no coinciden, alguien editó el precio con la mesa abierta.
    const esperado = Math.round((totalEnLaCuenta - (sale.discountAmount ?? 0)) * 100) / 100;
    const avisoDePrecio = esperado !== sale.total
      ? { totalEnLaCuenta: esperado, totalCobrado: sale.total }
      : undefined;

    return { sale, orden: ordenFinal, parcial, avisoDePrecio };
  });
}

// ---- lecturas ----

export type OrdenViva = {
  id: number;
  status: Order["status"];
  total: number;
  openedAt: Date;
  guests: number | null;
  tableId: number | null;
  /** null en las órdenes de mostrador, que no tienen mesa. */
  tableName: string | null;
  sector: string | null;
};

/** Órdenes vivas de la tienda, con su mesa. Es lo que muestra el salón. */
export async function listarOrdenesAbiertas(db: any, storeId: number): Promise<OrdenViva[]> {
  return db
    .select({
      id: orders.id,
      status: orders.status,
      total: orders.total,
      openedAt: orders.openedAt,
      guests: orders.guests,
      tableId: orders.tableId,
      tableName: diningTables.name,
      sector: diningTables.sector,
    })
    .from(orders)
    .leftJoin(diningTables, eq(orders.tableId, diningTables.id))
    .where(and(eq(orders.storeId, storeId), inArray(orders.status, [...EDITABLES])))
    .orderBy(orders.openedAt);
}

export async function getOrden(db: any, storeId: number, orderId: number) {
  const [orden] = await db.select().from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.storeId, storeId)));
  if (!orden) return null;

  const items = await db.select().from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(orderItems.createdAt, orderItems.id);

  const [mesa] = orden.tableId
    ? await db.select().from(diningTables).where(eq(diningTables.id, orden.tableId))
    : [null];

  return { orden, items, mesa };
}

export type MesaConOrden = { mesa: DiningTable; orden: OrdenViva | null };

/** Mesas activas de la tienda, con la orden viva de cada una si la hay. */
export async function listarMesas(db: any, storeId: number): Promise<MesaConOrden[]> {
  const mesas: DiningTable[] = await db.select().from(diningTables)
    .where(and(eq(diningTables.storeId, storeId), eq(diningTables.active, true)))
    .orderBy(diningTables.sector, diningTables.name);

  const abiertas = await listarOrdenesAbiertas(db, storeId);
  const porMesa = new Map<number, OrdenViva>(
    abiertas.flatMap((o) => (o.tableId != null ? [[o.tableId, o] as const] : [])),
  );

  return mesas.map((m) => ({ mesa: m, orden: porMesa.get(m.id) ?? null }));
}

export async function crearMesa(
  db: any,
  input: { storeId: number; name: string; sector?: string; capacity?: number | null },
) {
  if (!input.name.trim()) throw new Error("EMPTY_NAME");
  try {
    const [mesa] = await db.insert(diningTables).values({
      storeId: input.storeId,
      name: input.name.trim(),
      sector: input.sector?.trim() || "Salón",
      capacity: input.capacity ?? null,
    }).returning();
    return mesa;
  } catch (err) {
    if (codigoDe(err) === PG_UNIQUE_VIOLATION) throw new Error("MESA_DUPLICADA");
    throw err;
  }
}

/** Ventas de una orden, para el detalle y para dividir la cuenta. */
export async function ventasDeOrden(db: any, storeId: number, orderId: number) {
  return db.select().from(sales)
    .where(and(eq(sales.orderId, orderId), eq(sales.storeId, storeId)))
    .orderBy(sales.id);
}
