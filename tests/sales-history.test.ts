import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedTestUser } from "./helpers/db";
import { products, productVariants } from "@/db/schema";
import { openCashSession } from "@/domain/cash";
import { createSale } from "@/domain/sales";
import { getSalesHistory } from "@/domain/sales-history";

let db: Awaited<ReturnType<typeof createTestDb>>;
let variantId: number;

beforeEach(async () => {
  db = await createTestDb();
  await seedTestUser(db, "u1");
  const [p] = await db.insert(products).values({ name: "Remera", basePrice: 1000 }).returning();
  const [v] = await db.insert(productVariants).values({ productId: p.id, name: "M", stock: 100 }).returning();
  variantId = v.id;
  await openCashSession(db, { userId: "u1", openingCash: 0 });
});

describe("getSalesHistory", () => {
  it("defaults to the last 30 days when no from/to is given", async () => {
    await createSale(db, { sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId, quantity: 1 }] });
    const result = await getSalesHistory(db, { page: 1 });
    expect(result.sales).toHaveLength(1);
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
    await createSale(db, { sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId, quantity: 1 }] });
    const oldFrom = new Date("2000-01-01");
    const result = await getSalesHistory(db, { from: oldFrom, to: new Date(), page: 1 });
    expect(result.sales).toHaveLength(1);
  });
});
