import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { sales, saleItems, productVariants, products, user } from "@/db/schema";

const PAGE_SIZE = 50;

export type SalesHistoryOpts = {
  from?: Date;
  to?: Date;
  sellerId?: string;
  page: number;
};

export async function getSalesHistory(db: any, opts: SalesHistoryOpts) {
  // Sin rango explícito, se acota a los últimos 30 días — un pedido sin
  // filtro no debe traer TODO el historial de ventas de por vida.
  const from = opts.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const to = opts.to ?? new Date();

  const conditions = [gte(sales.createdAt, from), lt(sales.createdAt, to)];
  if (opts.sellerId) conditions.push(eq(sales.sellerId, opts.sellerId));

  const rows = await db
    .select({ sale: sales, sellerName: user.name })
    .from(sales)
    .innerJoin(user, eq(sales.sellerId, user.id))
    .where(and(...conditions))
    .orderBy(desc(sales.createdAt))
    .limit(PAGE_SIZE + 1)
    .offset((opts.page - 1) * PAGE_SIZE);

  const hasNextPage = rows.length > PAGE_SIZE;
  const pageRows = rows.slice(0, PAGE_SIZE);
  const saleIds = pageRows.map((r: any) => r.sale.id);

  const itemRows = saleIds.length
    ? await db
        .select({
          id: saleItems.id,
          saleId: saleItems.saleId,
          quantity: saleItems.quantity,
          unitPrice: saleItems.unitPrice,
          productName: products.name,
          variantName: productVariants.name,
        })
        .from(saleItems)
        .innerJoin(productVariants, eq(saleItems.variantId, productVariants.id))
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(inArray(saleItems.saleId, saleIds))
    : [];

  return { sales: pageRows, itemRows, hasNextPage };
}
