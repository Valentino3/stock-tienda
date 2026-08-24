import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  cashMovements, cashSessions, clients, products, productVariants,
  sales, saleItems, storeFiscalConfig, stores, user,
} from "@/db/schema";

/**
 * El cierre de caja como documento: el arqueo más el remito de cada venta del
 * turno.
 *
 * Lectura pura y sin UI, para poder testear los números contra lo que guardó
 * `closeCashSession` sin levantar un navegador. La página imprimible y la ruta
 * del `.xlsx` son consumidores finos de esto.
 *
 * ⚠️ El documento DECLARA sus inconsistencias en vez de esconderlas. Son dos y
 * las dos son inevitables; lo que no es aceptable es que sean silenciosas:
 *
 *   1. Las ventas anuladas están en la lista pero fuera del total del paquete.
 *      `closeCashSession` suma solo `voided = false`, así que si el paquete no
 *      las trajera, su total no cuadraría contra el arqueo y alguien perdería
 *      una hora buscando la diferencia.
 *
 *   2. Una venta offline puede sincronizarse contra una caja YA CERRADA —
 *      `replaySale` lo permite a propósito, porque rechazarla perdería una
 *      venta ya cobrada. Un cierre reimpreso una semana después puede entonces
 *      contener ventas que el `expectedCash` guardado no contempla.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export type LineaRemito = {
  variantId: number;
  /** Codigo del item en el remito. Si la variante no tiene, se usa su id. */
  sku: string | null;
  productName: string;
  variantName: string | null;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  priceList: "venta" | "efectivo" | "mayorista";
  neto: number;
};

export type Remito = {
  saleId: number;
  /**
   * Numero dentro de la serie de la tienda. `null` para las ventas anteriores
   * a la feature, que nunca tuvieron remito: el papel sale igual, referenciando
   * la venta, en vez de inventar un numero que nadie entrego.
   */
  numero: number | null;
  clientDoc: string | null;
  createdAt: Date;
  sellerName: string;
  paymentMethod: string;
  clientName: string | null;
  voided: boolean;
  voidedReason: string | null;
  discountAmount: number;
  total: number;
  /** Sincronizada después de que la caja se cerró. Ver el aviso de arriba. */
  posteriorAlCierre: boolean;
  lineas: LineaRemito[];
};

export type CierreDeCaja = {
  session: typeof cashSessions.$inferSelect;
  abiertaPor: string | null;
  cerradaPor: string | null;
  /** Totales por medio de pago, solo de las NO anuladas. */
  porMedio: { method: string; count: number; total: number }[];
  movimientos: { kind: string; amount: number; description: string; createdAt: Date }[];
  totalSalidas: number;
  remitos: Remito[];
  /** Cuántas ventas del paquete están anuladas, y por cuánto. */
  anuladas: { count: number; total: number };
  /** Ventas que entraron después del cierre. Vacío es lo normal. */
  tardias: { count: number; total: number };
  /**
   * `openingCash + efectivo − salidas`. Se recalcula acá para que la hoja se
   * auto-verifique contra el `expectedCash` que quedó guardado al cerrar: si
   * no coinciden, entraron ventas tardías.
   */
  efectivoEsperado: number;
};

export async function getCashSessionClose(
  db: any, storeId: number, sessionId: number,
): Promise<CierreDeCaja | null> {
  // Scope por tienda innegociable: los ids son secuenciales y un `eq(id)`
  // pelado filtraría el turno de otro comercio.
  const [session] = await db.select().from(cashSessions)
    .where(and(eq(cashSessions.id, sessionId), eq(cashSessions.storeId, storeId)));
  if (!session) return null;

  const abridor = alias(user, "abridor");
  const cerrador = alias(user, "cerrador");
  const [nombres] = await db
    .select({ abiertaPor: abridor.name, cerradaPor: cerrador.name })
    .from(cashSessions)
    .leftJoin(abridor, eq(cashSessions.openedBy, abridor.id))
    .leftJoin(cerrador, eq(cashSessions.closedBy, cerrador.id))
    .where(eq(cashSessions.id, sessionId));

  const remitos = await armarRemitos(
    db,
    and(eq(sales.storeId, storeId), eq(sales.cashSessionId, sessionId)),
    session.closedAt ?? null,
  );

  const vivas = remitos.filter((r) => !r.voided);
  const porMedio = [...vivas.reduce((m, r) => {
    const acc = m.get(r.paymentMethod) ?? { method: r.paymentMethod, count: 0, total: 0 };
    acc.count += 1;
    acc.total = round2(acc.total + r.total);
    return m.set(r.paymentMethod, acc);
  }, new Map<string, { method: string; count: number; total: number }>()).values()];

  const movs = await db
    .select({
      kind: cashMovements.kind,
      amount: cashMovements.amount,
      description: cashMovements.description,
      createdAt: cashMovements.createdAt,
    })
    .from(cashMovements)
    .where(eq(cashMovements.cashSessionId, sessionId))
    .orderBy(asc(cashMovements.createdAt));

  const totalSalidas = round2((movs as any[]).reduce((a, m) => a + m.amount, 0));
  const efectivo = porMedio.find((m) => m.method === "efectivo")?.total ?? 0;

  const anuladasList = remitos.filter((r) => r.voided);
  const tardiasList = remitos.filter((r) => r.posteriorAlCierre && !r.voided);

  return {
    session,
    abiertaPor: nombres?.abiertaPor ?? null,
    cerradaPor: nombres?.cerradaPor ?? null,
    porMedio,
    movimientos: movs as any[],
    totalSalidas,
    remitos,
    anuladas: {
      count: anuladasList.length,
      total: round2(anuladasList.reduce((a, r) => a + r.total, 0)),
    },
    tardias: {
      count: tardiasList.length,
      total: round2(tardiasList.reduce((a, r) => a + r.total, 0)),
    },
    efectivoEsperado: round2(session.openingCash + efectivo - totalSalidas),
  };
}

/**
 * Arma los remitos de las ventas que matcheen la condicion.
 *
 * Dos queries, sea una venta o trescientas: la lista de ventas y despues sus
 * lineas con `inArray`. Nunca una consulta por venta — es el mismo patron que
 * getSalesHistory, y es lo que hace que el cierre de un turno grande siga
 * siendo barato.
 *
 * Compartido entre el cierre de caja (todas las ventas de una sesion) y el
 * remito suelto de una venta. Si se duplicara, las dos vistas del mismo papel
 * empezarian a diferir en el primer cambio.
 */
async function armarRemitos(db: any, condicion: any, cerradaEn: Date | null): Promise<Remito[]> {
  const filas = await db
    .select({
      sale: sales,
      sellerName: user.name,
      clientName: clients.name,
      clientDoc: clients.docNro,
    })
    .from(sales)
    .innerJoin(user, eq(sales.sellerId, user.id))
    .leftJoin(clients, eq(sales.clientId, clients.id))
    .where(condicion)
    .orderBy(asc(sales.id));

  const saleIds = filas.map((f: any) => f.sale.id);
  const items = saleIds.length
    ? await db
        .select({
          saleId: saleItems.saleId,
          variantId: saleItems.variantId,
          sku: productVariants.sku,
          productName: products.name,
          variantName: productVariants.name,
          quantity: saleItems.quantity,
          unitPrice: saleItems.unitPrice,
          discountAmount: saleItems.discountAmount,
          priceList: saleItems.priceList,
        })
        .from(saleItems)
        .innerJoin(productVariants, eq(saleItems.variantId, productVariants.id))
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(inArray(saleItems.saleId, saleIds))
        .orderBy(asc(saleItems.id))
    : [];

  const porVenta = new Map<number, LineaRemito[]>();
  for (const i of items as any[]) {
    const lista = porVenta.get(i.saleId) ?? [];
    lista.push({
      variantId: i.variantId,
      sku: i.sku ?? null,
      productName: i.productName,
      variantName: i.variantName || null,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discountAmount: i.discountAmount,
      priceList: i.priceList,
      neto: round2(i.quantity * i.unitPrice - i.discountAmount),
    });
    porVenta.set(i.saleId, lista);
  }

  return filas.map((f: any) => ({
    saleId: f.sale.id,
    numero: f.sale.remitoNumero ?? null,
    clientDoc: f.clientDoc ?? null,
    createdAt: f.sale.createdAt,
    sellerName: f.sellerName,
    paymentMethod: f.sale.paymentMethod,
    clientName: f.clientName ?? null,
    voided: f.sale.voided,
    voidedReason: f.sale.voidedReason ?? null,
    discountAmount: f.sale.discountAmount,
    total: f.sale.total,
    posteriorAlCierre: cerradaEn != null && f.sale.createdAt > cerradaEn,
    lineas: porVenta.get(f.sale.id) ?? [],
  }));
}

/**
 * El remito de UNA venta, para imprimir desde el historial o apenas se cobra.
 *
 * `posteriorAlCierre` siempre queda en false: fuera del contexto de un cierre
 * de caja esa marca no significa nada. La caja a la que pertenece la venta se
 * ve en el documento del cierre, que es donde importa.
 */
export async function getRemito(
  db: any,
  storeId: number,
  saleId: number,
  // Empleado: solo sus propias ventas, misma regla que /ventas. Se filtra en
  // la CONSULTA y no despues, para que el resultado sea indistinguible de una
  // venta que no existe — un 404 no confirma que el id sea de otro vendedor.
  opts: { sellerId?: string } = {},
): Promise<Remito | null> {
  // Scope por tienda: los ids son secuenciales y un `eq(id)` pelado imprimiria
  // la venta de otro comercio.
  const condiciones = [eq(sales.storeId, storeId), eq(sales.id, saleId)];
  if (opts.sellerId) condiciones.push(eq(sales.sellerId, opts.sellerId));

  const [remito] = await armarRemitos(db, and(...condiciones), null);
  return remito ?? null;
}

/**
 * Los datos del comercio que van en el encabezado del remito.
 *
 * Salen de la config fiscal porque es donde ya viven el CUIT y el domicilio, y
 * el remito los muestra igual que una factura. Un comercio que nunca configuro
 * facturacion igual puede entregar remitos: en ese caso salen solo con el
 * nombre, y el punto de venta cae a 1.
 */
export type EmisorRemito = {
  nombre: string;
  cuit: string | null;
  domicilio: string | null;
  puntoVenta: number;
  logoUrl: string | null;
};

export async function getEmisorRemito(db: any, storeId: number): Promise<EmisorRemito> {
  const [store] = await db.select({ name: stores.name }).from(stores).where(eq(stores.id, storeId));
  const [cfg] = await db
    .select({
      cuit: storeFiscalConfig.cuit,
      razonSocial: storeFiscalConfig.razonSocial,
      nombreFantasia: storeFiscalConfig.nombreFantasia,
      domicilio: storeFiscalConfig.domicilio,
      puntoVenta: storeFiscalConfig.puntoVenta,
      logoUrl: storeFiscalConfig.logoUrl,
    })
    .from(storeFiscalConfig)
    .where(eq(storeFiscalConfig.storeId, storeId));

  return {
    // Nombre de fantasia primero: es como lo conoce el cliente que recibe el
    // papel. La razon social es para la factura, no para el remito.
    nombre: cfg?.nombreFantasia || cfg?.razonSocial || store?.name || "",
    cuit: cfg?.cuit ?? null,
    domicilio: cfg?.domicilio ?? null,
    puntoVenta: cfg?.puntoVenta ?? 1,
    logoUrl: cfg?.logoUrl ?? null,
  };
}
