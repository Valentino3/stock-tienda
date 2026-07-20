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

  it("supports card attribute columns on a variant, foil defaults to false", async () => {
    const db = await createTestDb();
    await seedTestUser(db);
    const [p] = await db.insert(products).values({ name: "Charizard", basePrice: 50000 }).returning();
    const [withAttrs] = await db.insert(productVariants).values({
      productId: p.id, name: "Base Set NM", stock: 3,
      setName: "Base Set", condition: "NM", foil: true, language: "EN",
    }).returning();
    expect(withAttrs.setName).toBe("Base Set");
    expect(withAttrs.condition).toBe("NM");
    expect(withAttrs.foil).toBe(true);
    expect(withAttrs.language).toBe("EN");

    const [defaults] = await db.insert(productVariants).values({ productId: p.id, name: "sin atributos" }).returning();
    expect(defaults.foil).toBe(false);
    expect(defaults.setName).toBeNull();
  });
});
