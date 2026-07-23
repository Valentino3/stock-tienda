import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { products, productVariants, sales } from "@/db/schema";
import { openCashSession } from "@/domain/cash";
import { createSale } from "@/domain/sales";
import { getSalesHistory } from "@/domain/sales-history";

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;
let variantId: number;
let cashSessionId: number;

const OLD_DATE = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);
  const [p] = await db.insert(products).values({ storeId: store, name: "Remera", basePrice: 1000 }).returning();
  const [v] = await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "M", stock: 100 }).returning();
  variantId = v.id;
  const session = await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
  cashSessionId = session.id;
});

describe("getSalesHistory", () => {
  it("defaults to the last 30 days when no from/to is given", async () => {
    // Insert a sale outside the 30-day window directly (bypassing createSale,
    // which always stamps createdAt via defaultNow()) so the default window
    // actually has something to exclude.
    await db.insert(sales).values({
      storeId: store,
      sellerId: "u1",
      cashSessionId,
      total: 1000,
      paymentMethod: "efectivo",
      createdAt: OLD_DATE,
    });
    await createSale(db, { storeId: store, sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId, quantity: 1 }] });

    const result = await getSalesHistory(db, { storeId: store, page: 1 });

    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].sale.createdAt.getTime()).not.toEqual(OLD_DATE.getTime());
  });

  it("paginates results (page size 50) and reports hasNextPage", async () => {
    for (let i = 0; i < 55; i++) {
      await createSale(db, { storeId: store, sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId, quantity: 1 }] });
    }
    const page1 = await getSalesHistory(db, { storeId: store, page: 1 });
    expect(page1.sales).toHaveLength(50);
    expect(page1.hasNextPage).toBe(true);

    const page2 = await getSalesHistory(db, { storeId: store, page: 2 });
    expect(page2.sales).toHaveLength(5);
    expect(page2.hasNextPage).toBe(false);
  });

  it("an explicit wide from/to range bypasses the 30-day default but still paginates", async () => {
    await db.insert(sales).values({
      storeId: store,
      sellerId: "u1",
      cashSessionId,
      total: 1000,
      paymentMethod: "efectivo",
      createdAt: OLD_DATE,
    });

    const result = await getSalesHistory(db, {
      storeId: store,
      from: new Date(0),
      to: new Date(Date.now() + 24 * 60 * 60 * 1000),
      page: 1,
    });

    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].sale.createdAt.getTime()).toEqual(OLD_DATE.getTime());
  });

  it("solo trae ventas de la tienda pedida", async () => {
    const store2 = await seedTestStore(db, "t2");
    await seedTestUser(db, "u2", "owner", store2);
    const s2 = await openCashSession(db, { storeId: store2, userId: "u2", openingCash: 0 });
    await db.insert(sales).values({ storeId: store2, sellerId: "u2", cashSessionId: s2.id, total: 999, paymentMethod: "efectivo" });
    await createSale(db, { storeId: store, sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId, quantity: 1 }] });

    const r1 = await getSalesHistory(db, { storeId: store, page: 1 });
    expect(r1.sales).toHaveLength(1);
    expect(r1.sales.every((row: { sale: { storeId: number } }) => row.sale.storeId === store)).toBe(true);
  });
});
