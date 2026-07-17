import { eq, inArray } from "drizzle-orm";
import { products, productVariants, sales, saleItems, type Sale } from "@/db/schema";
import { applyStockMovement } from "@/domain/stock";
import { getOpenSession } from "@/domain/cash";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type SaleInput = {
  sellerId: string;
  paymentMethod: "efectivo" | "transferencia" | "tarjeta";
  items: { variantId: number; quantity: number }[];
};

export async function createSale(db: any, input: SaleInput): Promise<Sale> {
  if (input.items.length === 0) throw new Error("EMPTY_SALE");
  if (input.items.some((i) => i.quantity <= 0)) throw new Error("INVALID_QUANTITY");

  const session = await getOpenSession(db);
  if (!session) throw new Error("NO_OPEN_SESSION");

  return db.transaction(async (tx: any) => {
    const variantRows = await tx
      .select({
        id: productVariants.id,
        price: productVariants.price,
        basePrice: products.basePrice,
      })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(inArray(productVariants.id, input.items.map((i) => i.variantId)));

    const priceOf = new Map(variantRows.map((v: any) => [v.id, v.price ?? v.basePrice]));
    if (priceOf.size !== new Set(input.items.map((i) => i.variantId)).size) throw new Error("VARIANT_NOT_FOUND");

    const total = round2(input.items.reduce((acc, i) => acc + (priceOf.get(i.variantId) as number) * i.quantity, 0));

    const [sale] = await tx.insert(sales).values({
      sellerId: input.sellerId,
      cashSessionId: session.id,
      total,
      paymentMethod: input.paymentMethod,
    }).returning();

    for (const item of input.items) {
      await tx.insert(saleItems).values({
        saleId: sale.id,
        variantId: item.variantId,
        quantity: item.quantity,
        unitPrice: priceOf.get(item.variantId) as number,
      });
      await applyStockMovement(tx, {
        variantId: item.variantId,
        type: "venta",
        quantity: -item.quantity,
        userId: input.sellerId,
        saleId: sale.id,
      });
    }
    return sale;
  });
}

export async function voidSale(db: any, input: { saleId: number; userId: string }): Promise<void> {
  await db.transaction(async (tx: any) => {
    const [sale] = await tx.select().from(sales).where(eq(sales.id, input.saleId));
    if (!sale) throw new Error("SALE_NOT_FOUND");
    if (sale.voided) throw new Error("ALREADY_VOIDED");

    const items = await tx.select().from(saleItems).where(eq(saleItems.saleId, input.saleId));
    for (const item of items) {
      await applyStockMovement(tx, {
        variantId: item.variantId,
        type: "anulacion",
        quantity: item.quantity,
        userId: input.userId,
        saleId: input.saleId,
      });
    }
    await tx.update(sales)
      .set({ voided: true, voidedAt: new Date(), voidedBy: input.userId })
      .where(eq(sales.id, input.saleId));
  });
}
