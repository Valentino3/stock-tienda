import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
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
 *
 * Y una tercera, para lo que cambia después de mandado:
 *
 *   `correccionVistaAt` — la cocina ya recibió la última corrección de la
 *                 línea (una anulación o un cambio de nota), en papel o con el
 *                 botón de la pantalla. Mientras la corrección sea más nueva
 *                 que esta marca, la línea aparece como «ANULADO» o «MODIF».
 *                 Sin esto, un plato anulado desaparecía de la pantalla en
 *                 silencio y el cocinero lo seguía haciendo con el papel viejo.
 */

export type LineaDeComanda = {
  itemId: number;
  orderId: number;
  quantity: number;
  nombre: string;
  notes: string | null;
  station: string | null;
  sentAt: Date;
  /** Anulada después de mandada, y la cocina todavía no se enteró. */
  anulada: boolean;
  motivoAnulacion: string | null;
  /** Le cambiaron la nota después de mandada, y la cocina no lo vio. */
  modificada: boolean;
  /** Nunca salió en papel, o tiene una corrección que no salió. */
  porImprimir: boolean;
  /**
   * Cambia con cada corrección. La pantalla la usa para saber si una línea
   * que ya imprimió volvió a necesitar papel.
   */
  version: string;
};

export type Comanda = {
  orderId: number;
  mesa: string | null;
  sector: string | null;
  mandadaEn: Date;
  /** La mesa se canceló entera con cosas en la cocina. */
  cancelada: boolean;
  lineas: LineaDeComanda[];
};

/**
 * La línea tiene una corrección que la cocina no vio. `greatest` ignora los
 * null: es la más nueva entre la anulación y el último cambio de nota.
 */
const correccionPendiente = sql`(
  greatest(${orderItems.voidedAt}, ${orderItems.modifiedAt}) is not null
  and (${orderItems.correccionVistaAt} is null
       or ${orderItems.correccionVistaAt} < greatest(${orderItems.voidedAt}, ${orderItems.modifiedAt}))
)`;

const VIVAS = ["abierta", "a_cobrar"] as const;

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
 *
 * Además de lo vivo, trae lo anulado que la cocina todavía no vio, también de
 * mesas canceladas: es lo que le dice «no hagas esto» a alguien que ya lo
 * tiene en papel.
 */
export async function comandasPendientes(
  db: any,
  storeId: number,
  opts: { estacion?: string | null; soloSinImprimir?: boolean } = {},
): Promise<Comanda[]> {
  const condiciones = [
    eq(orderItems.storeId, storeId),
    isNotNull(orderItems.sentAt),
    or(
      // Lo vivo. Un ítem ya cobrado salió hace rato: no tiene nada que hacer
      // en cocina.
      and(
        isNull(orderItems.voidedAt),
        isNull(orderItems.saleId),
        inArray(orders.status, [...VIVAS]),
      ),
      // Lo anulado que la cocina no vio, aunque la mesa ya no exista.
      and(
        isNotNull(orderItems.voidedAt),
        correccionPendiente,
        inArray(orders.status, [...VIVAS, "cancelada"]),
      ),
    ),
  ];
  if (opts.soloSinImprimir) condiciones.push(or(isNull(orderItems.printedAt), correccionPendiente));
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
      printedAt: orderItems.printedAt,
      voidedAt: orderItems.voidedAt,
      voidReason: orderItems.voidReason,
      modifiedAt: orderItems.modifiedAt,
      correccionVistaAt: orderItems.correccionVistaAt,
      status: orders.status,
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
      c = {
        orderId: f.orderId, mesa: f.mesa, sector: f.sector, mandadaEn: f.sentAt,
        cancelada: f.status === "cancelada", lineas: [],
      };
      porOrden.set(f.orderId, c);
    }

    const vista = f.correccionVistaAt?.getTime() ?? -Infinity;
    const anulada = f.voidedAt != null;
    const modificada = !anulada && f.modifiedAt != null && f.modifiedAt.getTime() > vista;
    const ultimoCambio = Math.max(
      f.sentAt.getTime(), f.voidedAt?.getTime() ?? 0, f.modifiedAt?.getTime() ?? 0,
    );
    c.lineas.push({
      itemId: f.itemId, orderId: f.orderId, quantity: f.quantity,
      nombre: f.nombre, notes: f.notes, station: f.station, sentAt: f.sentAt,
      anulada,
      motivoAnulacion: f.voidReason,
      modificada,
      porImprimir: f.printedAt == null || anulada || modificada,
      version: `${f.itemId}@${ultimoCambio}`,
    });
  }

  // Más vieja primero: es el orden en que la cocina tiene que trabajar.
  return [...porOrden.values()].sort((a, b) => a.mandadaEn.getTime() - b.mandadaEn.getTime());
}

/**
 * Marca impresos. Scopeado por tienda, como todo.
 *
 * Imprimir también es enterarse: una corrección que salió en papel queda vista.
 */
export async function marcarImpresas(
  db: any,
  input: { storeId: number; itemIds: number[] },
): Promise<number> {
  if (input.itemIds.length === 0) return 0;
  const ahora = new Date();
  const filas = await db.update(orderItems)
    .set({ printedAt: sql`coalesce(${orderItems.printedAt}, ${ahora})`, correccionVistaAt: ahora })
    .where(and(
      eq(orderItems.storeId, input.storeId),
      inArray(orderItems.id, input.itemIds),
      // Solo lo que se mandó y todavía no salió en papel —la línea o su
      // corrección—: reimprimir a mano es otra acción, y esta corre sola en un
      // intervalo.
      isNotNull(orderItems.sentAt),
      or(isNull(orderItems.printedAt), correccionPendiente),
    ))
    .returning({ id: orderItems.id });
  return filas.length;
}

/**
 * La cocina que trabaja solo con pantalla confirma que vio las correcciones.
 * Sin esto, un «ANULADO» quedaría en la pantalla hasta que se cierre la mesa.
 */
export async function marcarCorreccionesVistas(
  db: any,
  input: { storeId: number; itemIds: number[] },
): Promise<number> {
  if (input.itemIds.length === 0) return 0;
  const filas = await db.update(orderItems)
    .set({ correccionVistaAt: new Date() })
    .where(and(
      eq(orderItems.storeId, input.storeId),
      inArray(orderItems.id, input.itemIds),
      correccionPendiente,
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
