import { describe, it, expect } from "vitest";
import { createTestDb, seedTestUser } from "./helpers/db";
import { products, productVariants } from "@/db/schema";

describe("schema", () => {
  it("migrates and inserts a product with variant", async () => {
    const db = await createTestDb();
    await seedTestUser(db);
    const [p] = await db.insert(products).values({ name: "Remera", basePrice: 1500.5 }).returning();
    const [v] = await db.insert(productVariants).values({ productId: p.id, name: "M", stock: 10 }).returning();
    expect(v.stock).toBe(10);
    expect(p.basePrice).toBe(1500.5);
  });
});
