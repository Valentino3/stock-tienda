import { and, asc, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { diningTables, orderItems, orders, products, productVariants } from "@/db/schema";
import { diaOperativo } from "@/lib/dates";

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
  /** Una por ronda: orden + momento del envío. */
  clave: string;
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

  const ahora = new Date();
  return db.transaction(async (tx: any) => {
    const mandados: { id: number; variantId: number }[] = await tx.update(orderItems)
      .set({ sentAt: ahora })
      .where(and(
        eq(orderItems.orderId, input.orderId),
        eq(orderItems.storeId, input.storeId),
        isNull(orderItems.sentAt),
      ))
      .returning({ id: orderItems.id, variantId: orderItems.variantId });

    // Lo que no tiene estación no lo prepara nadie: la gaseosa la saca el mozo
    // de la heladera. Sale «Listo» en el mismo momento en que se manda, y no
    // aparece en ninguna pantalla de cocina.
    if (mandados.length > 0) {
      const sinEstacion = await tx.select({ id: productVariants.id })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(and(
          inArray(productVariants.id, [...new Set(mandados.map((m) => m.variantId))]),
          isNull(products.station),
        ));
      const variantes = new Set(sinEstacion.map((v: { id: number }) => v.id));
      const listos = mandados.filter((m) => variantes.has(m.variantId)).map((m) => m.id);
      if (listos.length > 0) {
        await tx.update(orderItems).set({ readyAt: ahora }).where(inArray(orderItems.id, listos));
      }
    }

    return mandados.length;
  });
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
 *
 * Una línea sale de la pantalla cuando la cocina la marca «Listo», no cuando
 * se cobra: un pedido para llevar se paga antes de prepararse. Lo que no tiene
 * estación no aparece nunca: no lo prepara nadie.
 *
 * Cada envío del mozo es una comanda aparte (una ronda): el postre de la mesa
 * 4 no es la misma comanda que su entrada, ni tiene la misma espera.
 */
export async function comandasPendientes(
  db: any,
  storeId: number,
  opts: { estacion?: string | null; soloSinImprimir?: boolean } = {},
): Promise<Comanda[]> {
  const condiciones = [
    eq(orderItems.storeId, storeId),
    isNotNull(orderItems.sentAt),
    isNotNull(products.station),
    or(
      // Lo que falta sacar.
      and(
        isNull(orderItems.voidedAt),
        isNull(orderItems.readyAt),
        or(
          inArray(orders.status, [...VIVAS]),
          // Un pedido para llevar ya cobrado sigue en la cocina hasta que
          // sale. Con tope: uno que nadie marcó listo no puede quedar en la
          // pantalla para siempre.
          and(
            eq(orders.status, "pagada"),
            isNull(orders.tableId),
            gt(orderItems.sentAt, new Date(Date.now() - 12 * 60 * 60 * 1000)),
          ),
        ),
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

  // Una ronda es todo lo que salió en el mismo envío: mandarACocina estampa el
  // mismo instante en todas sus líneas, y dividir o anular una parte lo hereda.
  const porRonda = new Map<string, Comanda>();
  for (const f of filas) {
    const clave = `${f.orderId}@${f.sentAt.getTime()}`;
    let c = porRonda.get(clave);
    if (!c) {
      c = {
        clave, orderId: f.orderId, mesa: f.mesa, sector: f.sector, mandadaEn: f.sentAt,
        cancelada: f.status === "cancelada", lineas: [],
      };
      porRonda.set(clave, c);
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
  return [...porRonda.values()].sort((a, b) => a.mandadaEn.getTime() - b.mandadaEn.getTime());
}

/**
 * La cocina sacó estas líneas: «Listo». Salen de la pantalla y el mozo las ve
 * listas para retirar. Solo lo mandado, vivo y no marcado antes.
 */
export async function marcarListo(
  db: any,
  input: { storeId: number; itemIds: number[] },
): Promise<number> {
  if (input.itemIds.length === 0) return 0;
  const filas = await db.update(orderItems)
    .set({ readyAt: new Date() })
    .where(and(
      eq(orderItems.storeId, input.storeId),
      inArray(orderItems.id, input.itemIds),
      isNotNull(orderItems.sentAt),
      isNull(orderItems.readyAt),
      isNull(orderItems.voidedAt),
    ))
    .returning({ id: orderItems.id });
  return filas.length;
}

/** Un «Listo» tocado por error vuelve a la pantalla. */
export async function deshacerListo(
  db: any,
  input: { storeId: number; itemIds: number[] },
): Promise<number> {
  if (input.itemIds.length === 0) return 0;
  const filas = await db.update(orderItems)
    .set({ readyAt: null })
    .where(and(
      eq(orderItems.storeId, input.storeId),
      inArray(orderItems.id, input.itemIds),
      isNotNull(orderItems.readyAt),
    ))
    .returning({ id: orderItems.id });
  return filas.length;
}

// ---- agotado ----

export type PlatoParaAgotar = { productId: number; nombre: string; station: string | null; agotado: boolean };

/**
 * La carta, para que la cocina marque lo que se acabó. Con `estacion`, solo lo
 * suyo: la barra agota bebidas, no platos.
 */
export async function platosParaAgotar(
  db: any,
  storeId: number,
  opts: { estacion?: string | null; hoy?: string } = {},
): Promise<PlatoParaAgotar[]> {
  const hoy = opts.hoy ?? diaOperativo();
  const condiciones = [eq(products.storeId, storeId), eq(products.active, true)];
  if (opts.estacion) condiciones.push(eq(products.station, opts.estacion));
  const filas = await db
    .select({ productId: products.id, nombre: products.name, station: products.station, soldOutOn: products.soldOutOn })
    .from(products)
    .where(and(...condiciones))
    .orderBy(asc(products.name));
  return filas.map((f: { productId: number; nombre: string; station: string | null; soldOutOn: string | null }) => ({
    productId: f.productId, nombre: f.nombre, station: f.station, agotado: f.soldOutOn === hoy,
  }));
}

/**
 * Marca o desmarca un plato como agotado por lo que queda del día operativo.
 * Al día siguiente vuelve solo.
 */
export async function marcarAgotado(
  db: any,
  input: { storeId: number; productId: number; agotado: boolean; hoy?: string },
): Promise<void> {
  const [fila] = await db.update(products)
    .set({ soldOutOn: input.agotado ? (input.hoy ?? diaOperativo()) : null })
    .where(and(eq(products.id, input.productId), eq(products.storeId, input.storeId)))
    .returning({ id: products.id });
  if (!fila) throw new Error("PRODUCTO_NO_ENCONTRADO");
}

/** De estas variantes, cuáles son de un plato agotado hoy. */
export async function variantesAgotadas(
  db: any,
  storeId: number,
  variantIds: number[],
  hoy: string = diaOperativo(),
): Promise<Set<number>> {
  if (variantIds.length === 0) return new Set();
  const filas = await db.select({ id: productVariants.id })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(
      eq(productVariants.storeId, storeId),
      inArray(productVariants.id, variantIds),
      eq(products.soldOutOn, hoy),
    ));
  return new Set(filas.map((f: { id: number }) => f.id));
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

/**
 * Lo que no va a ninguna pantalla de cocina. Bien para la gaseosa; un plato
 * acá es un plato que nunca se prepara, y el dueño lo tiene que ver en Menú.
 */
export async function sinEstacion(db: any, storeId: number): Promise<string[]> {
  const filas = await db.select({ nombre: products.name })
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.active, true), isNull(products.station)))
    .orderBy(asc(products.name));
  return filas.map((f: { nombre: string }) => f.nombre);
}
