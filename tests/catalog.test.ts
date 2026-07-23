import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { products, productVariants } from "@/db/schema";
import { searchVariants } from "@/domain/catalog";

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);
});

describe("searchVariants", () => {
  it("matches by variant name and by set name, not just product name or SKU", async () => {
    const [p] = await db.insert(products).values({ storeId: store, name: "Charizard", basePrice: 50000 }).returning();
    await db.insert(productVariants).values([
      { storeId: store, productId: p.id, name: "Base Set NM", sku: "CHAR-BS-NM", stock: 3, setName: "Base Set", condition: "NM" },
      { storeId: store, productId: p.id, name: "Jungle LP", sku: "CHAR-JU-LP", stock: 1, setName: "Jungle", condition: "LP" },
    ]);

    const byVariantName = await searchVariants(db, store, "Jungle LP");
    expect(byVariantName.map((r: { sku: string | null }) => r.sku)).toEqual(["CHAR-JU-LP"]);

    const bySetName = await searchVariants(db, store, "Base Set");
    expect(bySetName.map((r: { sku: string | null }) => r.sku)).toEqual(["CHAR-BS-NM"]);
  });

  it("returns empty for terms under 2 characters", async () => {
    expect(await searchVariants(db, store, "a")).toEqual([]);
  });

  it("excludes inactive products and variants", async () => {
    const [p] = await db.insert(products).values({ storeId: store, name: "Pikachu", basePrice: 1000, active: false }).returning();
    await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "NM", sku: "PIKA-NM", stock: 1 });
    expect(await searchVariants(db, store, "Pikachu")).toEqual([]);
  });

  it("no filtra productos de otra tienda", async () => {
    const store2 = await seedTestStore(db, "t2");
    const [p] = await db.insert(products).values({ storeId: store2, name: "Charizard", basePrice: 50000 }).returning();
    await db.insert(productVariants).values({ storeId: store2, productId: p.id, name: "NM", sku: "OTRA-NM", stock: 3 });
    // Buscando en la tienda 1 no aparece el producto de la tienda 2.
    expect(await searchVariants(db, store, "Charizard")).toEqual([]);
    expect((await searchVariants(db, store2, "Charizard")).map((r: { sku: string | null }) => r.sku)).toEqual(["OTRA-NM"]);
  });
});
