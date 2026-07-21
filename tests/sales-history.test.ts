import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser } from "./helpers/db";
import { products, productVariants, sales } from "@/db/schema";
import { openCashSession } from "@/domain/cash";
import { createSale } from "@/domain/sales";
import { getSalesHistory } from "@/domain/sales-history";

let db: Awaited<ReturnType<typeof createTestDb>>;
let variantId: number;
let cashSessionId: number;

const OLD_DATE = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

beforeEach(async () => {
  db = await createTestDb();
  await seedTestUser(db, "u1");
  const [p] = await db.insert(products).values({ name: "Remera", basePrice: 1000 }).returning();
  const [v] = await db.insert(productVariants).values({ productId: p.id, name: "M", stock: 100 }).returning();
  variantId = v.id;
  const session = await openCashSession(db, { userId: "u1", openingCash: 0 });
  cashSessionId = session.id;
});

describe("getSalesHistory", () => {
  it("defaults to the last 30 days when no from/to is given", async () => {
    // Insert a sale outside the 30-day window directly (bypassing createSale,
    // which always stamps createdAt via defaultNow()) so the default window
    // actually has something to exclude.
    await db.insert(sales).values({
      sellerId: "u1",
      cashSessionId,
      total: 1000,
      paymentMethod: "efectivo",
      createdAt: OLD_DATE,
    });
    await createSale(db, { sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId, quantity: 1 }] });

    const result = await getSalesHistory(db, { page: 1 });

    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].sale.createdAt.getTime()).not.toEqual(OLD_DATE.getTime());
  });

  it("paginates results (page size 50) and reports hasNextPage", async () => {
    for (let i = 0; i < 55; i++) {
      await createSale(db, { sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId, quantity: 1 }] });
    }
    const page1 = await getSalesHistory(db, { page: 1 });
    expect(page1.sales).toHaveLength(50);
    expect(page1.hasNextPage).toBe(true);

    const page2 = await getSalesHistory(db, { page: 2 });
    expect(page2.sales).toHaveLength(5);
    expect(page2.hasNextPage).toBe(false);
  });

  it("an explicit wide from/to range bypasses the 30-day default but still paginates", async () => {
    await db.insert(sales).values({
      sellerId: "u1",
      cashSessionId,
      total: 1000,
      paymentMethod: "efectivo",
      createdAt: OLD_DATE,
    });

    const result = await getSalesHistory(db, {
      from: new Date(0),
      to: new Date(Date.now() + 24 * 60 * 60 * 1000),
      page: 1,
    });

    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].sale.createdAt.getTime()).toEqual(OLD_DATE.getTime());
  });
});
