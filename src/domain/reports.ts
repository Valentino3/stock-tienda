import { and, between, desc, eq, ilike, isNotNull, sql } from "drizzle-orm";
import { cashMovements, cashSessions, products, productVariants, sales, saleItems, user } from "@/db/schema";

// Todos los reportes están scopeados por tienda (storeId).

const round2 = (n: number) => Math.round(n * 100) / 100;

export type ResumenVendedor = {
  sellerId: string;
  name: string;
  count: number;
  /** Todo lo vendido, anuladas afuera. `normal + promo` da exactamente esto. */
  total: number;
  normal: number;
  promo: number;
  /**
   * De `total`, cuánto se vendió a cuenta corriente y todavía no se cobró.
   * Va aparte y NO se resta: quién comisiona por una venta fiado es una
   * decisión del comercio, no del sistema. La pantalla la muestra para que el
   * dueño la reste si así lo arregló con el empleado.
   */
  aCuenta: number;
};

/**
 * Ventas por vendedor en un rango, partidas entre promo y no promo.
 *
 * La partición se hace por LÍNEA (`sale_items.isPromo`, que es el snapshot del
 * momento de vender) y no por el flag actual del producto: las promos rotan, y
 * calcular julio en agosto con el flag ya limpio movería esas ventas al
 * porcentaje alto. Un informe de comisiones que da distinto cada vez que se
 * abre, para un período cerrado, no es un informe.
 *
 * ⚠️ Sobre el descuento general: `sales.total` ya viene neto de él, pero el
 * descuento vive en la cabecera y no se puede atribuir a una línea. Se reparte
 * proporcional al peso de cada mitad, y —esto es lo importante— `normal` se
 * define como el RESTO: `total − promo`. Así `normal + promo === total` sale
 * exacto por construcción, sin depender de que dos redondeos coincidan. La
 * tabla "Ventas por empleado" está justo arriba en la misma pantalla, y una
 * diferencia de un centavo ahí se reporta como bug.
 *
 * No se reusa `repartirDescuento` de fiscal-importes: eso reparte un descuento
 * entre N líneas en enteros para que un comprobante cierre ante ARCA. Acá el
 * problema es partir cada venta en dos, y definir una mitad como el resto lo
 * resuelve exacto y sin importar aritmética fiscal a un reporte.
 */
export async function getSellerSalesSummary(
  db: any, storeId: number, range: { from: Date; to: Date },
): Promise<ResumenVendedor[]> {
  const filas = await db
    .select({
      sellerId: sales.sellerId,
      name: user.name,
      saleId: sales.id,
      total: sales.total,
      paymentMethod: sales.paymentMethod,
      // Bruto neto de descuento de línea, partido por el snapshot de promo.
      subtotal: sql<number>`coalesce(sum(${saleItems.quantity} * ${saleItems.unitPrice} - ${saleItems.discountAmount}), 0)`.mapWith(Number),
      subtotalPromo: sql<number>`coalesce(sum(case when ${saleItems.isPromo} then ${saleItems.quantity} * ${saleItems.unitPrice} - ${saleItems.discountAmount} else 0 end), 0)`.mapWith(Number),
    })
    .from(sales)
    .innerJoin(user, eq(sales.sellerId, user.id))
    // leftJoin y no inner: una venta sin líneas (no debería existir, pero si
    // existiera) no puede desaparecer del total del vendedor en silencio.
    .leftJoin(saleItems, eq(saleItems.saleId, sales.id))
    .where(and(eq(sales.storeId, storeId), eq(sales.voided, false), between(sales.createdAt, range.from, range.to)))
    .groupBy(sales.id, sales.sellerId, user.name, sales.total, sales.paymentMethod);

  const porVendedor = new Map<string, ResumenVendedor>();
  for (const f of filas as any[]) {
    const acc = porVendedor.get(f.sellerId) ?? {
      sellerId: f.sellerId, name: f.name, count: 0, total: 0, normal: 0, promo: 0, aCuenta: 0,
    };
    const promo = f.subtotal > 0 ? round2((f.total * f.subtotalPromo) / f.subtotal) : 0;
    acc.count += 1;
    acc.total = round2(acc.total + f.total);
    acc.promo = round2(acc.promo + promo);
    acc.normal = round2(acc.normal + (f.total - promo));
    if (f.paymentMethod === "cuenta") acc.aCuenta = round2(acc.aCuenta + f.total);
    porVendedor.set(f.sellerId, acc);
  }

  return [...porVendedor.values()].sort((a, b) => b.total - a.total);
}

export async function getSalesReport(db: any, storeId: number, range: { from: Date; to: Date }) {
  const notVoided = and(eq(sales.storeId, storeId), eq(sales.voided, false), between(sales.createdAt, range.from, range.to));
  const byDay = await db
    .select({
      day: sql<string>`to_char(${sales.createdAt}, 'YYYY-MM-DD')`,
      count: sql<number>`count(*)`.mapWith(Number),
      total: sql<number>`sum(${sales.total})`.mapWith(Number),
    })
    .from(sales).where(notVoided)
    .groupBy(sql`to_char(${sales.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${sales.createdAt}, 'YYYY-MM-DD')`);
  const byMethod = await db
    .select({
      method: sales.paymentMethod,
      count: sql<number>`count(*)`.mapWith(Number),
      total: sql<number>`sum(${sales.total})`.mapWith(Number),
    })
    .from(sales).where(notVoided).groupBy(sales.paymentMethod);
  return { byDay, byMethod };
}

export async function getTopProducts(db: any, storeId: number, opts: { from: Date; to: Date; limit?: number; setName?: string }) {
  return db
    .select({
      productName: products.name,
      variantName: productVariants.name,
      setName: productVariants.setName,
      unitsSold: sql<number>`sum(${saleItems.quantity})`.mapWith(Number),
      revenue: sql<number>`sum(${saleItems.quantity} * ${saleItems.unitPrice} - ${saleItems.discountAmount})`.mapWith(Number),
    })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .innerJoin(productVariants, eq(saleItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(
      eq(sales.storeId, storeId),
      eq(sales.voided, false),
      between(sales.createdAt, opts.from, opts.to),
      opts.setName ? ilike(productVariants.setName, `%${opts.setName}%`) : undefined,
    ))
    .groupBy(products.name, productVariants.name, productVariants.setName)
    .orderBy(desc(sql`sum(${saleItems.quantity})`))
    .limit(opts.limit ?? 10);
}

export async function getLowStock(db: any, storeId: number, opts: { setName?: string } = {}) {
  return db
    .select({
      productName: products.name,
      variantName: productVariants.name,
      setName: productVariants.setName,
      stock: productVariants.stock,
      threshold: products.lowStockThreshold,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(
      eq(productVariants.storeId, storeId),
      eq(products.active, true), eq(productVariants.active, true),
      // Lo que no lleva stock no puede tener stock bajo. Sin esto, TODOS los
      // platos de un restaurante aparecen en rojo con 0 ≤ 3.
      eq(products.tracksStock, true),
      sql`${productVariants.stock} <= ${products.lowStockThreshold}`,
      opts.setName ? ilike(productVariants.setName, `%${opts.setName}%`) : undefined,
    ))
    .orderBy(productVariants.stock);
}

export async function getCashMovementsReport(db: any, storeId: number, range: { from: Date; to: Date }) {
  // cashMovements no tiene storeId directo: se filtra por la caja (cashSessions).
  return db
    .select({
      kind: cashMovements.kind,
      count: sql<number>`count(*)`.mapWith(Number),
      total: sql<number>`coalesce(sum(${cashMovements.amount}), 0)`.mapWith(Number),
    })
    .from(cashMovements)
    .innerJoin(cashSessions, eq(cashMovements.cashSessionId, cashSessions.id))
    .where(and(eq(cashSessions.storeId, storeId), between(cashMovements.createdAt, range.from, range.to)))
    .groupBy(cashMovements.kind);
}

export async function getCashSessionHistory(db: any, storeId: number, opts: { limit?: number } = {}) {
  return db.select().from(cashSessions)
    .where(and(eq(cashSessions.storeId, storeId), isNotNull(cashSessions.closedAt)))
    .orderBy(desc(cashSessions.closedAt))
    .limit(opts.limit ?? 30);
}
