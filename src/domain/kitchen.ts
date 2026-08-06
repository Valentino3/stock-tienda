import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { diningTables, orderItems, orders, products, productVariants } from "@/db/schema";

/**
 * Comandas de cocina.
 *
 * Dos marcas por línea, y son distintas a propósito:
 *
 *   `sentAt`    — el mozo la mandó a preparar. Es una decisión humana: se
 *                 cargan cuatro cosas en la mesa y recién ahí se manda todo
 *                 junto, no cada plato al tipearlo.
 *   `printedAt` — la pantalla de cocina ya la sacó por la impresora. Sirve
 *                 para no imprimir dos veces si alguien recarga la página.
 *
 * Separarlas es lo que permite que la cocina tenga pantalla, papel, o las dos.
 */

export type LineaDeComanda = {
  itemId: number;
  orderId: number;
  quantity: number;
  nombre: string;
  notes: string | null;
  station: string | null;
  sentAt: Date;
};

export type Comanda = {
  orderId: number;
  mesa: string | null;
  sector: string | null;
  mandadaEn: Date;
  lineas: LineaDeComanda[];
};

/**
 * Marca como mandados a cocina los ítems que todavía no lo estaban.
 *
 * Solo los que no tienen `sentAt`: mandar dos veces no puede duplicar la
 * comanda ni reimprimir lo que la cocina ya está preparando. Devuelve cuántos
 * salieron, para que la UI diga "3 ítems a cocina" y no mienta cuando no había
 * ninguno.
 */
export async function mandarACocina(
  db: any,
  input: { storeId: number; orderId: number },
): Promise<number> {
  const [orden] = await db.select({ id: orders.id, status: orders.status }).from(orders)
    .where(and(eq(orders.id, input.orderId), eq(orders.storeId, input.storeId)));
  if (!orden) throw new Error("ORDEN_NO_ENCONTRADA");
  if (orden.status !== "abierta" && orden.status !== "a_cobrar") throw new Error("ORDEN_CERRADA");

  const mandados = await db.update(orderItems)
    .set({ sentAt: new Date() })
    .where(and(
      eq(orderItems.orderId, input.orderId),
      eq(orderItems.storeId, input.storeId),
      isNull(orderItems.sentAt),
    ))
    .returning({ id: orderItems.id });

  return mandados.length;
}

/** Cuántos ítems de la orden están sin mandar. Lo usa el botón del mozo. */
export async function sinMandar(db: any, storeId: number, orderId: number): Promise<number> {
  const [fila] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(orderItems)
    .where(and(
      eq(orderItems.orderId, orderId),
      eq(orderItems.storeId, storeId),
      isNull(orderItems.sentAt),
    ));
  return fila?.n ?? 0;
}

/**
 * Lo que la cocina tiene para preparar, agrupado por comanda.
 *
 * `estacion` filtra por `products.station`: cada estación abre la pantalla con
 * su filtro y ve solo lo suyo. Sin filtro se ve todo, que es lo correcto para
 * una cocina chica con una sola impresora.
 *
 * `soloSinImprimir` es lo que consume el auto-impresor; la pantalla de cocina
 * sin filtrar muestra también lo ya impreso, porque el cocinero necesita ver
 * lo que está en curso, no solo lo que acaba de entrar.
 */
export async function comandasPendientes(
  db: any,
  storeId: number,
  opts: { estacion?: string | null; soloSinImprimir?: boolean } = {},
): Promise<Comanda[]> {
  const condiciones = [
    eq(orderItems.storeId, storeId),
    isNotNull(orderItems.sentAt),
    // Un ítem ya cobrado salió hace rato: no tiene nada que hacer en cocina.
    isNull(orderItems.saleId),
    inArray(orders.status, ["abierta", "a_cobrar"]),
  ];
  if (opts.soloSinImprimir) condiciones.push(isNull(orderItems.printedAt));
  if (opts.estacion) condiciones.push(eq(products.station, opts.estacion));

  const filas = await db
    .select({
      itemId: orderItems.id,
      orderId: orderItems.orderId,
      quantity: orderItems.quantity,
      nombre: orderItems.nameSnapshot,
      notes: orderItems.notes,
      station: products.station,
      sentAt: orderItems.sentAt,
      mesa: diningTables.name,
      sector: diningTables.sector,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .innerJoin(productVariants, eq(orderItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .leftJoin(diningTables, eq(orders.tableId, diningTables.id))
    .where(and(...condiciones))
    .orderBy(asc(orderItems.sentAt), asc(orderItems.id));

  const porOrden = new Map<number, Comanda>();
  for (const f of filas) {
    let c = porOrden.get(f.orderId);
    if (!c) {
      c = { orderId: f.orderId, mesa: f.mesa, sector: f.sector, mandadaEn: f.sentAt, lineas: [] };
      porOrden.set(f.orderId, c);
    }
    c.lineas.push({
      itemId: f.itemId, orderId: f.orderId, quantity: f.quantity,
      nombre: f.nombre, notes: f.notes, station: f.station, sentAt: f.sentAt,
    });
  }

  // Más vieja primero: es el orden en que la cocina tiene que trabajar.
  return [...porOrden.values()].sort((a, b) => a.mandadaEn.getTime() - b.mandadaEn.getTime());
}

/** Marca impresos. Scopeado por tienda, como todo. */
export async function marcarImpresas(
  db: any,
  input: { storeId: number; itemIds: number[] },
): Promise<number> {
  if (input.itemIds.length === 0) return 0;
  const filas = await db.update(orderItems)
    .set({ printedAt: new Date() })
    .where(and(
      eq(orderItems.storeId, input.storeId),
      inArray(orderItems.id, input.itemIds),
      // Solo lo que se mandó y no se imprimió: reimprimir a mano es otra
      // acción, y esta corre sola en un intervalo.
      isNotNull(orderItems.sentAt),
      isNull(orderItems.printedAt),
    ))
    .returning({ id: orderItems.id });
  return filas.length;
}

/** Estaciones que realmente usa el menú de esta tienda. */
export async function estacionesDelMenu(db: any, storeId: number): Promise<string[]> {
  const filas = await db
    .selectDistinct({ station: products.station })
    .from(products)
    .where(and(eq(products.storeId, storeId), isNotNull(products.station)));
  return filas.map((f: { station: string }) => f.station).sort();
}
