import { and, between, desc, eq, ilike, isNotNull, sql } from "drizzle-orm";
import { cashSessions, products, productVariants, sales, saleItems } from "@/db/schema";

export async function getSalesReport(db: any, range: { from: Date; to: Date }) {
  const notVoided = and(eq(sales.voided, false), between(sales.createdAt, range.from, range.to));
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

export async function getTopProducts(db: any, opts: { from: Date; to: Date; limit?: number; setName?: string }) {
  return db
    .select({
      productName: products.name,
      variantName: productVariants.name,
      setName: productVariants.setName,
      unitsSold: sql<number>`sum(${saleItems.quantity})`.mapWith(Number),
      revenue: sql<number>`sum(${saleItems.quantity} * ${saleItems.unitPrice})`.mapWith(Number),
    })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .innerJoin(productVariants, eq(saleItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(
      eq(sales.voided, false),
      between(sales.createdAt, opts.from, opts.to),
      opts.setName ? ilike(productVariants.setName, `%${opts.setName}%`) : undefined,
    ))
    .groupBy(products.name, productVariants.name, productVariants.setName)
    .orderBy(desc(sql`sum(${saleItems.quantity})`))
    .limit(opts.limit ?? 10);
}

export async function getLowStock(db: any, opts: { setName?: string } = {}) {
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
      eq(products.active, true), eq(productVariants.active, true),
      sql`${productVariants.stock} <= ${products.lowStockThreshold}`,
      opts.setName ? ilike(productVariants.setName, `%${opts.setName}%`) : undefined,
    ))
    .orderBy(productVariants.stock);
}

export async function getCashSessionHistory(db: any, opts: { limit?: number } = {}) {
  return db.select().from(cashSessions)
    .where(isNotNull(cashSessions.closedAt))
    .orderBy(desc(cashSessions.closedAt))
    .limit(opts.limit ?? 30);
}
