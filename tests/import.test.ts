import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser } from "./helpers/db";
import { products, productVariants, stockMovements } from "@/db/schema";
import { validateImportRows, executeImport, type ImportRow } from "@/domain/import";
import { eq } from "drizzle-orm";

let db: Awaited<ReturnType<typeof createTestDb>>;

const row = (n: number, over: Partial<ImportRow> = {}): ImportRow => ({
  rowNumber: n, product: "Remera", variant: "M", sku: null, price: 1000, stock: 5, ...over,
});

beforeEach(async () => {
  db = await createTestDb();
  await seedTestUser(db, "u1");
});

describe("validateImportRows", () => {
  it("flags invalid rows and duplicate SKUs in file", async () => {
    const out = await validateImportRows(db, [
      row(2),
      row(3, { product: "" }),
      row(4, { price: -5 }),
      row(5, { stock: -1 }),
      row(6, { sku: "A1" }),
      row(7, { sku: "A1" }),
    ]);
    expect(out[0].error).toBeNull();
    expect(out[1].error).toMatch(/producto/i);
    expect(out[2].error).toMatch(/precio/i);
    expect(out[3].error).toMatch(/stock/i);
    expect(out[4].error).toBeNull();
    expect(out[5].error).toMatch(/duplicado/i);
  });

  it("marks update when SKU exists in db", async () => {
    const [p] = await db.insert(products).values({ name: "Gorra", basePrice: 500 }).returning();
    await db.insert(productVariants).values({ productId: p.id, name: "", sku: "G1", stock: 1 });
    const out = await validateImportRows(db, [row(2, { sku: "G1" }), row(3, { sku: "NEW" })]);
    expect(out[0].action).toBe("update");
    expect(out[1].action).toBe("create");
  });

  it("does not flag a valid row as duplicate SKU when an earlier row with the same SKU errored for another reason", async () => {
    const out = await validateImportRows(db, [
      row(2, { product: "", sku: "X1" }),
      row(3, { sku: "X1" }),
    ]);
    expect(out[0].error).toMatch(/producto/i);
    expect(out[1].error).toBeNull();
  });
});

describe("executeImport", () => {
  it("creates products grouping variants, updates existing by sku, skips errors", async () => {
    const [p] = await db.insert(products).values({ name: "Gorra", basePrice: 500 }).returning();
    await db.insert(productVariants).values({ productId: p.id, name: "", sku: "G1", stock: 1 });

    const validated = await validateImportRows(db, [
      row(2, { product: "Remera", variant: "M", sku: "R-M", stock: 5 }),
      row(3, { product: "Remera", variant: "L", sku: "R-L", stock: 3 }),
      row(4, { sku: "G1", price: 800, stock: 10, product: "Gorra", variant: "" }),
      row(5, { product: "" }),
    ]);
    const res = await executeImport(db, validated, "u1");
    expect(res).toEqual({ created: 2, updated: 1, skipped: 1 });

    const allProducts = await db.select().from(products);
    expect(allProducts).toHaveLength(2); // Gorra + Remera (variantes agrupadas)

    const [g1] = await db.select().from(productVariants).where(eq(productVariants.sku, "G1"));
    expect(g1.stock).toBe(10);
    expect(g1.price).toBe(800);

    const adjustments = await db.select().from(stockMovements).where(eq(stockMovements.type, "ajuste"));
    expect(adjustments.length).toBeGreaterThanOrEqual(3); // R-M, R-L, G1
    expect(adjustments.every((m) => m.reason === "importación")).toBe(true);
  });

  it("attaches a new variant to an existing active product instead of creating a duplicate", async () => {
    const [remera] = await db.insert(products).values({ name: "Remera", basePrice: 1000 }).returning();
    await db.insert(productVariants).values({ productId: remera.id, name: "M", sku: "R-M", stock: 5 });

    const validated = await validateImportRows(db, [
      row(2, { product: "Remera", variant: "L", sku: "R-L", stock: 7 }),
    ]);
    const res = await executeImport(db, validated, "u1");
    expect(res).toEqual({ created: 1, updated: 0, skipped: 0 });

    const remeras = await db.select().from(products).where(eq(products.name, "Remera"));
    expect(remeras).toHaveLength(1); // no duplicate "Remera" product created

    const [newVariant] = await db.select().from(productVariants).where(eq(productVariants.sku, "R-L"));
    expect(newVariant.productId).toBe(remera.id);
  });

  it("preserves the imported variant price instead of silently inheriting the reused product's basePrice", async () => {
    const [remera] = await db.insert(products).values({ name: "Remera", basePrice: 1000 }).returning();
    await db.insert(productVariants).values({ productId: remera.id, name: "M", sku: "R-M", stock: 5 });

    const validated = await validateImportRows(db, [
      row(2, { product: "Remera", variant: "XL", sku: "R-XL", price: 1500, stock: 2 }),
    ]);
    const res = await executeImport(db, validated, "u1");
    expect(res).toEqual({ created: 1, updated: 0, skipped: 0 });

    const remeras = await db.select().from(products).where(eq(products.name, "Remera"));
    expect(remeras).toHaveLength(1); // still no duplicate product

    const [newVariant] = await db.select().from(productVariants).where(eq(productVariants.sku, "R-XL"));
    expect(newVariant.productId).toBe(remera.id);
    expect(newVariant.price).toBe(1500); // NOT null, NOT inheriting the 1000 basePrice
  });
});
