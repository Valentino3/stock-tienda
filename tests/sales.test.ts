import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser } from "./helpers/db";
import { products, productVariants, sales, saleItems, stockMovements } from "@/db/schema";
import { openCashSession } from "@/domain/cash";
import { createSale, voidSale } from "@/domain/sales";
import { eq } from "drizzle-orm";

let db: Awaited<ReturnType<typeof createTestDb>>;
let vId: number, vId2: number;

beforeEach(async () => {
  db = await createTestDb();
  await seedTestUser(db, "u1");
  const [p] = await db.insert(products).values({ name: "Remera", basePrice: 1000 }).returning();
  const [v1] = await db.insert(productVariants).values({ productId: p.id, name: "M", stock: 5 }).returning();
  const [v2] = await db.insert(productVariants).values({ productId: p.id, name: "L", stock: 2, price: 1200 }).returning();
  vId = v1.id; vId2 = v2.id;
});

describe("createSale", () => {
  it("fails without open cash session", async () => {
    await expect(
      createSale(db, { sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId: vId, quantity: 1 }] })
    ).rejects.toThrow("NO_OPEN_SESSION");
  });

  it("creates sale, decrements stock, snapshots prices (variant override wins)", async () => {
    await openCashSession(db, { userId: "u1", openingCash: 0 });
    const sale = await createSale(db, {
      sellerId: "u1", paymentMethod: "efectivo",
      items: [{ variantId: vId, quantity: 2 }, { variantId: vId2, quantity: 1 }],
    });
    expect(sale.total).toBe(3200); // 2*1000 + 1*1200
    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    expect(items.map((i) => i.unitPrice).sort()).toEqual([1000, 1200]);
    const [v1] = await db.select().from(productVariants).where(eq(productVariants.id, vId));
    expect(v1.stock).toBe(3);
  });

  it("rolls back everything on insufficient stock", async () => {
    await openCashSession(db, { userId: "u1", openingCash: 0 });
    await expect(
      createSale(db, {
        sellerId: "u1", paymentMethod: "efectivo",
        items: [{ variantId: vId, quantity: 1 }, { variantId: vId2, quantity: 99 }],
      })
    ).rejects.toThrow("INSUFFICIENT_STOCK");
    expect(await db.select().from(sales)).toHaveLength(0);
    const [v1] = await db.select().from(productVariants).where(eq(productVariants.id, vId));
    expect(v1.stock).toBe(5); // rollback del primer item
  });

  it("rejects empty sale", async () => {
    await openCashSession(db, { userId: "u1", openingCash: 0 });
    await expect(createSale(db, { sellerId: "u1", paymentMethod: "efectivo", items: [] })).rejects.toThrow("EMPTY_SALE");
  });
});

describe("voidSale", () => {
  it("restores stock and marks voided", async () => {
    await openCashSession(db, { userId: "u1", openingCash: 0 });
    const sale = await createSale(db, { sellerId: "u1", paymentMethod: "tarjeta", items: [{ variantId: vId, quantity: 2 }] });
    await voidSale(db, { saleId: sale.id, userId: "u1" });
    const [v1] = await db.select().from(productVariants).where(eq(productVariants.id, vId));
    expect(v1.stock).toBe(5);
    const [s] = await db.select().from(sales).where(eq(sales.id, sale.id));
    expect(s.voided).toBe(true);
    const movs = await db.select().from(stockMovements).where(eq(stockMovements.type, "anulacion"));
    expect(movs).toHaveLength(1);
    expect(movs[0].quantity).toBe(2);
  });

  it("rejects double void", async () => {
    await openCashSession(db, { userId: "u1", openingCash: 0 });
    const sale = await createSale(db, { sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId: vId, quantity: 1 }] });
    await voidSale(db, { saleId: sale.id, userId: "u1" });
    await expect(voidSale(db, { saleId: sale.id, userId: "u1" })).rejects.toThrow("ALREADY_VOIDED");
  });
});
