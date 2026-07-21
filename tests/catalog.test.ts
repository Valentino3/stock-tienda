import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser } from "./helpers/db";
import { products, productVariants } from "@/db/schema";
import { searchVariants } from "@/domain/catalog";

let db: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  db = await createTestDb();
  await seedTestUser(db, "u1");
});

describe("searchVariants", () => {
  it("matches by variant name and by set name, not just product name or SKU", async () => {
    const [p] = await db.insert(products).values({ name: "Charizard", basePrice: 50000 }).returning();
    await db.insert(productVariants).values([
      { productId: p.id, name: "Base Set NM", sku: "CHAR-BS-NM", stock: 3, setName: "Base Set", condition: "NM" },
      { productId: p.id, name: "Jungle LP", sku: "CHAR-JU-LP", stock: 1, setName: "Jungle", condition: "LP" },
    ]);

    const byVariantName = await searchVariants(db, "Jungle LP");
    expect(byVariantName.map((r: { sku: string | null }) => r.sku)).toEqual(["CHAR-JU-LP"]);

    const bySetName = await searchVariants(db, "Base Set");
    expect(bySetName.map((r: { sku: string | null }) => r.sku)).toEqual(["CHAR-BS-NM"]);
  });

  it("returns empty for terms under 2 characters", async () => {
    expect(await searchVariants(db, "a")).toEqual([]);
  });

  it("excludes inactive products and variants", async () => {
    const [p] = await db.insert(products).values({ name: "Pikachu", basePrice: 1000, active: false }).returning();
    await db.insert(productVariants).values({ productId: p.id, name: "NM", sku: "PIKA-NM", stock: 1 });
    expect(await searchVariants(db, "Pikachu")).toEqual([]);
  });
});
