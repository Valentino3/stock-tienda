import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { products, productVariants, stockMovements } from "@/db/schema";
import { applyStockMovement } from "@/domain/stock";
import { eq } from "drizzle-orm";

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;
let variantId: number;

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);
  const [p] = await db.insert(products).values({ storeId: store, name: "Remera", basePrice: 1000 }).returning();
  const [v] = await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "M", stock: 5 }).returning();
  variantId = v.id;
});

describe("applyStockMovement", () => {
  it("decrements stock and records movement", async () => {
    await db.transaction(async (tx) => {
      await applyStockMovement(tx, { variantId, storeId: store, type: "venta", quantity: -3, userId: "u1" });
    });
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
    expect(v.stock).toBe(2);
    const movs = await db.select().from(stockMovements);
    expect(movs).toHaveLength(1);
    expect(movs[0].quantity).toBe(-3);
  });

  it("rejects movement that would make stock negative", async () => {
    await expect(
      db.transaction(async (tx) => {
        await applyStockMovement(tx, { variantId, storeId: store, type: "venta", quantity: -6, userId: "u1" });
      })
    ).rejects.toThrow("INSUFFICIENT_STOCK");
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
    expect(v.stock).toBe(5); // rollback
    expect(await db.select().from(stockMovements)).toHaveLength(0);
  });

  it("increments stock on reposicion", async () => {
    await db.transaction(async (tx) => {
      await applyStockMovement(tx, { variantId, storeId: store, type: "reposicion", quantity: 10, userId: "u1" });
    });
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
    expect(v.stock).toBe(15);
  });

  it("no mueve stock de una variante de otra tienda (guardia por storeId)", async () => {
    const store2 = await seedTestStore(db, "t2");
    await expect(
      db.transaction(async (tx) => {
        await applyStockMovement(tx, { variantId, storeId: store2, type: "venta", quantity: -1, userId: "u1" });
      })
    ).rejects.toThrow("INSUFFICIENT_STOCK");
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
    expect(v.stock).toBe(5); // intacto
  });
});
