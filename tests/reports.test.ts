import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser } from "./helpers/db";
import { products, productVariants } from "@/db/schema";
import { openCashSession } from "@/domain/cash";
import { createSale } from "@/domain/sales";
import { getTopProducts, getLowStock } from "@/domain/reports";

let db: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  db = await createTestDb();
  await seedTestUser(db, "u1");
});

describe("getTopProducts with setName filter", () => {
  it("filters top products by set when provided, and is unaffected when omitted", async () => {
    const [charizard] = await db.insert(products).values({ name: "Charizard", basePrice: 50000 }).returning();
    const [baseSet] = await db.insert(productVariants).values({ productId: charizard.id, name: "Base Set", stock: 5, setName: "Base Set" }).returning();
    const [jungle] = await db.insert(productVariants).values({ productId: charizard.id, name: "Jungle", stock: 5, setName: "Jungle" }).returning();

    await openCashSession(db, { userId: "u1", openingCash: 0 });
    await createSale(db, { sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId: baseSet.id, quantity: 2 }] });
    await createSale(db, { sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId: jungle.id, quantity: 1 }] });

    const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const allSets = await getTopProducts(db, { from, to });
    expect(allSets).toHaveLength(2);

    const onlyBaseSet = await getTopProducts(db, { from, to, setName: "Base Set" });
    expect(onlyBaseSet).toHaveLength(1);
    expect(onlyBaseSet[0].variantName).toBe("Base Set");
  });
});

describe("getLowStock with setName filter", () => {
  it("filters low-stock variants by set when provided", async () => {
    const [charizard] = await db.insert(products).values({ name: "Charizard", basePrice: 50000, lowStockThreshold: 5 }).returning();
    await db.insert(productVariants).values([
      { productId: charizard.id, name: "Base Set", stock: 1, setName: "Base Set" },
      { productId: charizard.id, name: "Jungle", stock: 1, setName: "Jungle" },
    ]);

    const all = await getLowStock(db);
    expect(all).toHaveLength(2);

    const onlyJungle = await getLowStock(db, { setName: "Jungle" });
    expect(onlyJungle).toHaveLength(1);
    expect(onlyJungle[0].variantName).toBe("Jungle");
  });
});
