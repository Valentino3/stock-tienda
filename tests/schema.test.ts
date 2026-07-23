import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { products, productVariants } from "@/db/schema";

describe("schema", () => {
  it("migrates and inserts a product with variant", async () => {
    const db = await createTestDb();
    const store = await seedTestStore(db);
    await seedTestUser(db, "u1", "owner", store);
    const [p] = await db.insert(products).values({ storeId: store, name: "Remera", basePrice: 1500.5 }).returning();
    const [v] = await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "M", stock: 10 }).returning();
    expect(v.stock).toBe(10);
    expect(p.basePrice).toBe(1500.5);
  });

  it("supports card attribute columns on a variant, foil defaults to false", async () => {
    const db = await createTestDb();
    const store = await seedTestStore(db);
    await seedTestUser(db, "u1", "owner", store);
    const [p] = await db.insert(products).values({ storeId: store, name: "Charizard", basePrice: 50000 }).returning();
    const [withAttrs] = await db.insert(productVariants).values({
      storeId: store, productId: p.id, name: "Base Set NM", stock: 3,
      setName: "Base Set", condition: "NM", foil: true, language: "EN",
    }).returning();
    expect(withAttrs.setName).toBe("Base Set");
    expect(withAttrs.condition).toBe("NM");
    expect(withAttrs.foil).toBe(true);
    expect(withAttrs.language).toBe("EN");

    const [defaults] = await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "sin atributos" }).returning();
    expect(defaults.foil).toBe(false);
    expect(defaults.setName).toBeNull();
  });

  it("pg_trgm indexes are created and support ILIKE with a leading wildcard", async () => {
    const db = await createTestDb();
    const store = await seedTestStore(db);
    await seedTestUser(db, "u1", "owner", store);
    const [p] = await db.insert(products).values({ storeId: store, name: "Charizard Base Set", basePrice: 50000 }).returning();
    await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "NM Foil", sku: "CHAR-BS-NM-F", stock: 1 });

    const found = await db.execute(sql`SELECT id FROM products WHERE name ILIKE '%izard%'`);
    expect(found.rows).toHaveLength(1);
  });

  it("set_name trgm index supports ILIKE search on the set name", async () => {
    const db = await createTestDb();
    const store = await seedTestStore(db);
    await seedTestUser(db, "u1", "owner", store);
    const [p] = await db.insert(products).values({ storeId: store, name: "Charizard", basePrice: 50000 }).returning();
    await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "NM", stock: 1, setName: "Base Set" });

    const found = await db.execute(sql`SELECT id FROM product_variants WHERE set_name ILIKE '%base%'`);
    expect(found.rows).toHaveLength(1);
  });

  it("SKU único por tienda: dos tiendas pueden reusar el mismo SKU", async () => {
    const db = await createTestDb();
    const s1 = await seedTestStore(db, "t1");
    const s2 = await seedTestStore(db, "t2");
    const [p1] = await db.insert(products).values({ storeId: s1, name: "A", basePrice: 100 }).returning();
    const [p2] = await db.insert(products).values({ storeId: s2, name: "A", basePrice: 100 }).returning();
    await db.insert(productVariants).values({ storeId: s1, productId: p1.id, name: "v", sku: "DUP" });
    // Mismo SKU en otra tienda: permitido.
    await db.insert(productVariants).values({ storeId: s2, productId: p2.id, name: "v", sku: "DUP" });
    // Mismo SKU en la MISMA tienda: rechazado por el unique compuesto.
    await expect(
      db.insert(productVariants).values({ storeId: s1, productId: p1.id, name: "v2", sku: "DUP" })
    ).rejects.toThrow();
  });
});
