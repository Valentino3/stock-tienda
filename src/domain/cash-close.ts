import { and, asc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  cashMovements, cashSessions, clients, products, productVariants,
  sales, saleItems, user,
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

  // Dos queries, sea el turno de 3 ventas o de 300. Mismo patrón que
  // getSalesHistory: nunca una consulta por venta.
  const filas = await db
    .select({ sale: sales, sellerName: user.name, clientName: clients.name })
    .from(sales)
    .innerJoin(user, eq(sales.sellerId, user.id))
    .leftJoin(clients, eq(sales.clientId, clients.id))
    .where(and(eq(sales.storeId, storeId), eq(sales.cashSessionId, sessionId)))
    .orderBy(asc(sales.id));

  const saleIds = filas.map((f: any) => f.sale.id);
  const items = saleIds.length
    ? await db
        .select({
          saleId: saleItems.saleId,
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

  const cerradaEn: Date | null = session.closedAt ?? null;
  const remitos: Remito[] = filas.map((f: any) => ({
    saleId: f.sale.id,
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
