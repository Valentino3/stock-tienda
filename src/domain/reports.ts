import { and, between, desc, eq, ilike, isNotNull, sql } from "drizzle-orm";
import { cashMovements, cashSessions, products, productVariants, sales, saleItems, user } from "@/db/schema";

// Todos los reportes están scopeados por tienda (storeId).

// Ventas por vendedor en un rango (para decidir comisiones). Solo no anuladas.
export async function getSellerSalesSummary(db: any, storeId: number, range: { from: Date; to: Date }) {
  return db
    .select({
      sellerId: sales.sellerId,
      name: user.name,
      count: sql<number>`count(*)`.mapWith(Number),
      total: sql<number>`coalesce(sum(${sales.total}), 0)`.mapWith(Number),
    })
    .from(sales)
    .innerJoin(user, eq(sales.sellerId, user.id))
    .where(and(eq(sales.storeId, storeId), eq(sales.voided, false), between(sales.createdAt, range.from, range.to)))
    .groupBy(sales.sellerId, user.name)
    .orderBy(desc(sql`coalesce(sum(${sales.total}), 0)`));
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
