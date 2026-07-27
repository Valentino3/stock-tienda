import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { products, productVariants, stockMovements, importBatches } from "@/db/schema";
import { validateImportRows, executeImport, type ImportRow } from "@/domain/import";
import { createImportBatch, confirmImportBatch, PREVIEW_ROWS } from "@/domain/import-batches";
import { eq } from "drizzle-orm";

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;

const row = (n: number, over: Partial<ImportRow> = {}): ImportRow => ({
  rowNumber: n, product: "Remera", variant: "M", sku: null, price: 1000, stock: 5, ...over,
});

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);
});

describe("validateImportRows", () => {
  it("flags invalid rows and duplicate SKUs in file", async () => {
    const out = await validateImportRows(db, store, [
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
    const [p] = await db.insert(products).values({ storeId: store, name: "Gorra", basePrice: 500 }).returning();
    await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "", sku: "G1", stock: 1 });
    const out = await validateImportRows(db, store, [row(2, { sku: "G1" }), row(3, { sku: "NEW" })]);
    expect(out[0].action).toBe("update");
    expect(out[1].action).toBe("create");
  });

  it("does not flag a valid row as duplicate SKU when an earlier row with the same SKU errored for another reason", async () => {
    const out = await validateImportRows(db, store, [
      row(2, { product: "", sku: "X1" }),
      row(3, { sku: "X1" }),
    ]);
    expect(out[0].error).toMatch(/producto/i);
    expect(out[1].error).toBeNull();
  });
});

describe("executeImport", () => {
  it("creates products grouping variants, updates existing by sku, skips errors", async () => {
    const [p] = await db.insert(products).values({ storeId: store, name: "Gorra", basePrice: 500 }).returning();
    await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "", sku: "G1", stock: 1 });

    const validated = await validateImportRows(db, store, [
      row(2, { product: "Remera", variant: "M", sku: "R-M", stock: 5 }),
      row(3, { product: "Remera", variant: "L", sku: "R-L", stock: 3 }),
      row(4, { sku: "G1", price: 800, stock: 10, product: "Gorra", variant: "" }),
      row(5, { product: "" }),
    ]);
    const res = await executeImport(db, store, validated, "u1");
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
    const [remera] = await db.insert(products).values({ storeId: store, name: "Remera", basePrice: 1000 }).returning();
    await db.insert(productVariants).values({ storeId: store, productId: remera.id, name: "M", sku: "R-M", stock: 5 });

    const validated = await validateImportRows(db, store, [
      row(2, { product: "Remera", variant: "L", sku: "R-L", stock: 7 }),
    ]);
    const res = await executeImport(db, store, validated, "u1");
    expect(res).toEqual({ created: 1, updated: 0, skipped: 0 });

    const remeras = await db.select().from(products).where(eq(products.name, "Remera"));
    expect(remeras).toHaveLength(1); // no duplicate "Remera" product created

    const [newVariant] = await db.select().from(productVariants).where(eq(productVariants.sku, "R-L"));
    expect(newVariant.productId).toBe(remera.id);
  });

  it("preserves the imported variant price instead of silently inheriting the reused product's basePrice", async () => {
    const [remera] = await db.insert(products).values({ storeId: store, name: "Remera", basePrice: 1000 }).returning();
    await db.insert(productVariants).values({ storeId: store, productId: remera.id, name: "M", sku: "R-M", stock: 5 });

    const validated = await validateImportRows(db, store, [
      row(2, { product: "Remera", variant: "XL", sku: "R-XL", price: 1500, stock: 2 }),
    ]);
    const res = await executeImport(db, store, validated, "u1");
    expect(res).toEqual({ created: 1, updated: 0, skipped: 0 });

    const remeras = await db.select().from(products).where(eq(products.name, "Remera"));
    expect(remeras).toHaveLength(1); // still no duplicate product

    const [newVariant] = await db.select().from(productVariants).where(eq(productVariants.sku, "R-XL"));
    expect(newVariant.productId).toBe(remera.id);
    expect(newVariant.price).toBe(1500); // NOT null, NOT inheriting the 1000 basePrice
  });

  it("stores card attributes on create and syncs them on update when provided", async () => {
    const validated = await validateImportRows(db, store, [
      row(2, {
        product: "Charizard", variant: "Base Set NM", sku: "CHAR-BS-NM", stock: 3,
        setName: "Base Set", condition: "NM", foil: true, language: "EN",
      }),
    ]);
    await executeImport(db, store, validated, "u1");
    const [created] = await db.select().from(productVariants).where(eq(productVariants.sku, "CHAR-BS-NM"));
    expect(created.setName).toBe("Base Set");
    expect(created.condition).toBe("NM");
    expect(created.foil).toBe(true);
    expect(created.language).toBe("EN");
    expect(created.stock).toBe(3); // stock real al crear, no 0 + movimiento

    const reimport = await validateImportRows(db, store, [
      row(3, { product: "Charizard", variant: "Base Set NM", sku: "CHAR-BS-NM", stock: 3, condition: "LP" }),
    ]);
    await executeImport(db, store, reimport, "u1");
    const [updated] = await db.select().from(productVariants).where(eq(productVariants.sku, "CHAR-BS-NM"));
    expect(updated.condition).toBe("LP"); // sincronizado en el update
    expect(updated.setName).toBe("Base Set"); // no se borró por no venir en la segunda fila... espera, ver Step 3
  });

  it("leaves foil untouched when a re-import row omits it (blank Foil cell), but still honors an explicit false", async () => {
    const created = await validateImportRows(db, store, [
      row(2, {
        product: "Blastoise", variant: "Base Set NM", sku: "BLAST-BS-NM", stock: 4, foil: true,
      }),
    ]);
    await executeImport(db, store, created, "u1");
    const [afterCreate] = await db.select().from(productVariants).where(eq(productVariants.sku, "BLAST-BS-NM"));
    expect(afterCreate.foil).toBe(true);

    // Simula una fila de re-importación con la celda Foil en blanco (foil: undefined,
    // como produce actions.ts para una celda vacía): NO debe pisar el foil existente.
    const blankFoilReimport = await validateImportRows(db, store, [
      row(3, { product: "Blastoise", variant: "Base Set NM", sku: "BLAST-BS-NM", stock: 4 }),
    ]);
    await executeImport(db, store, blankFoilReimport, "u1");
    const [afterBlankReimport] = await db.select().from(productVariants).where(eq(productVariants.sku, "BLAST-BS-NM"));
    expect(afterBlankReimport.foil).toBe(true); // no se pisó por una celda Foil en blanco

    // Un valor explícito (foil: false) sí debe sincronizarse.
    const explicitFalseReimport = await validateImportRows(db, store, [
      row(4, { product: "Blastoise", variant: "Base Set NM", sku: "BLAST-BS-NM", stock: 4, foil: false }),
    ]);
    await executeImport(db, store, explicitFalseReimport, "u1");
    const [afterExplicitFalse] = await db.select().from(productVariants).where(eq(productVariants.sku, "BLAST-BS-NM"));
    expect(afterExplicitFalse.foil).toBe(false); // explicit false still syncs
  });

  it("modo 'add': suma la cantidad al stock existente en vez de reemplazarlo", async () => {
    const [p] = await db.insert(products).values({ storeId: store, name: "Gorra", basePrice: 500 }).returning();
    await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "", sku: "G1", stock: 10 });

    const validated = await validateImportRows(db, store, [row(2, { sku: "G1", product: "Gorra", variant: "", stock: 4, price: null })]);
    expect(validated[0].action).toBe("update");
    await executeImport(db, store, validated, "u1", { mode: "add" });

    const [g1] = await db.select().from(productVariants).where(eq(productVariants.sku, "G1"));
    expect(g1.stock).toBe(14); // 10 + 4 (no reemplaza por 4)
    const movs = await db.select().from(stockMovements).where(eq(stockMovements.type, "reposicion"));
    expect(movs).toHaveLength(1);
    expect(movs[0].quantity).toBe(4);
  });

  it("matchByName: sin SKU, matchea variante existente por nombre y la marca update", async () => {
    const [p] = await db.insert(products).values({ storeId: store, name: "Remera", basePrice: 1000 }).returning();
    await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "M", stock: 5 });

    const validated = await validateImportRows(
      db,
      store,
      [
        row(2, { product: "Remera", variant: "M", sku: null, price: null, stock: 3 }), // sin precio: ok porque es update
        row(3, { product: "Remera", variant: "XXL", sku: null, price: 1200, stock: 2 }), // no existe: create
      ],
      { matchByName: true }
    );
    expect(validated[0].action).toBe("update");
    expect(validated[0].error).toBeNull();
    expect(validated[1].action).toBe("create");

    await executeImport(db, store, validated, "u1", { mode: "add" });
    const [m] = await db.select().from(productVariants).where(eq(productVariants.name, "M"));
    expect(m.stock).toBe(8); // 5 + 3
  });

  it("handles a large batch of create rows correctly (batching sanity check)", async () => {
    const rows = Array.from({ length: 150 }, (_, i) =>
      row(i + 2, { product: `Carta ${i}`, variant: "NM", sku: `BULK-${i}`, price: 100 + i, stock: i })
    );
    const validated = await validateImportRows(db, store, rows);
    const res = await executeImport(db, store, validated, "u1");
    expect(res).toEqual({ created: 150, updated: 0, skipped: 0 });

    const allVariants = await db.select().from(productVariants).where(eq(productVariants.sku, "BULK-100"));
    expect(allVariants[0].stock).toBe(100);
    // Cada producto de este batch tiene una sola fila, por lo que su basePrice recién
    // creado (group[0].price) coincide siempre con el price de esa fila. Por contrato
    // (ver "creates agrupados"), el price de la variante se guarda como null cuando
    // coincide con el basePrice del producto resuelto — null == "hereda basePrice",
    // no un bug de la variante. El precio efectivo (200) sigue viniendo del producto.
    expect(allVariants[0].price).toBeNull();
    const [bulkProduct] = await db.select().from(products).where(eq(products.name, "Carta 100"));
    expect(bulkProduct.basePrice).toBe(200);

    const movements = await db.select().from(stockMovements).where(eq(stockMovements.reason, "importación"));
    // 149 filas con stock > 0 (la fila 0 tiene stock: 0, no genera movimiento)
    expect(movements.length).toBe(149);
  });
});

// El lote se guarda en la base y el navegador solo maneja un id: mandar las
// filas de ida y vuelta pasaba el límite de 4.5 MB por request de la plataforma.
describe("import batches", () => {
  it("acota el preview y cuenta el total real del archivo", async () => {
    const many = Array.from({ length: PREVIEW_ROWS + 50 }, (_, i) =>
      row(i + 2, { product: `Carta ${i}`, sku: `P-${i}` })
    );
    // Una fila inválida para verificar que los contadores no son el largo del preview.
    many.push(row(999, { product: "", sku: "BAD" }));
    const validated = await validateImportRows(db, store, many);

    const summary = await createImportBatch(db, {
      storeId: store, userId: "u1", source: "excel", mode: "absolute", rows: validated,
    });

    expect(summary.total).toBe(PREVIEW_ROWS + 51);
    expect(summary.valid).toBe(PREVIEW_ROWS + 50);
    expect(summary.errors).toBe(1);
    expect(summary.preview).toHaveLength(PREVIEW_ROWS);
  });

  it("confirmar por batchId da el mismo resultado que ejecutar las filas directo", async () => {
    const [p] = await db.insert(products).values({ storeId: store, name: "Gorra", basePrice: 500 }).returning();
    await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "", sku: "G1", stock: 1 });

    const validated = await validateImportRows(db, store, [
      row(2, { product: "Remera", variant: "M", sku: "R-M", stock: 5 }),
      row(3, { product: "Remera", variant: "L", sku: "R-L", stock: 3 }),
      row(4, { sku: "G1", price: 800, stock: 10, product: "Gorra", variant: "" }),
      row(5, { product: "" }),
    ]);
    const { batchId } = await createImportBatch(db, {
      storeId: store, userId: "u1", source: "excel", mode: "absolute", rows: validated,
    });

    const res = await confirmImportBatch(db, store, batchId, "u1");
    // Mismos números que el test equivalente de executeImport de arriba: las
    // filas con error tienen que llegar al lote para que `skipped` no dé 0.
    expect(res).toEqual({ created: 2, updated: 1, skipped: 1 });

    const [g1] = await db.select().from(productVariants).where(eq(productVariants.sku, "G1"));
    expect(g1.stock).toBe(10);
  });

  it("respeta el modo guardado en el lote (add suma, no reemplaza)", async () => {
    const [p] = await db.insert(products).values({ storeId: store, name: "Gorra", basePrice: 500 }).returning();
    await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "", sku: "G1", stock: 10 });

    const validated = await validateImportRows(db, store, [
      row(2, { sku: "G1", product: "Gorra", variant: "", stock: 4, price: null }),
    ]);
    const { batchId } = await createImportBatch(db, {
      storeId: store, userId: "u1", source: "ai", mode: "add", rows: validated,
    });
    await confirmImportBatch(db, store, batchId, "u1");

    const [g1] = await db.select().from(productVariants).where(eq(productVariants.sku, "G1"));
    expect(g1.stock).toBe(14); // 10 + 4
  });

  it("rechaza un lote de otra tienda aunque se conozca el id", async () => {
    const otherStore = await seedTestStore(db, "t2", "Otra Tienda");
    await seedTestUser(db, "u2", "owner", otherStore);

    const validated = await validateImportRows(db, otherStore, [
      row(2, { product: "Remera", variant: "M", sku: "R-M", stock: 5 }),
    ]);
    const { batchId } = await createImportBatch(db, {
      storeId: otherStore, userId: "u2", source: "excel", mode: "absolute", rows: validated,
    });

    await expect(confirmImportBatch(db, store, batchId, "u1")).rejects.toThrow("BATCH_NOT_FOUND");
    // Y no tocó el stock de ninguna de las dos tiendas.
    expect(await db.select().from(productVariants)).toHaveLength(0);
  });

  it("rechaza un lote ya confirmado: un doble click no duplica el stock", async () => {
    const [p] = await db.insert(products).values({ storeId: store, name: "Gorra", basePrice: 500 }).returning();
    await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "", sku: "G1", stock: 10 });

    const validated = await validateImportRows(db, store, [
      row(2, { sku: "G1", product: "Gorra", variant: "", stock: 4, price: null }),
    ]);
    const { batchId } = await createImportBatch(db, {
      storeId: store, userId: "u1", source: "ai", mode: "add", rows: validated,
    });

    await confirmImportBatch(db, store, batchId, "u1");
    await expect(confirmImportBatch(db, store, batchId, "u1")).rejects.toThrow("BATCH_NOT_FOUND");

    const [g1] = await db.select().from(productVariants).where(eq(productVariants.sku, "G1"));
    expect(g1.stock).toBe(14); // 10 + 4 una sola vez, no 18
  });

  it("borra los lotes pendientes viejos de la tienda al crear uno nuevo", async () => {
    const validated = await validateImportRows(db, store, [row(2, { sku: "R-M" })]);
    const stale = await createImportBatch(db, {
      storeId: store, userId: "u1", source: "excel", mode: "absolute", rows: validated,
    });
    // Envejecerlo más de 24 h.
    await db.update(importBatches)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(importBatches.id, stale.batchId));

    const fresh = await createImportBatch(db, {
      storeId: store, userId: "u1", source: "excel", mode: "absolute", rows: validated,
    });

    const remaining = await db.select().from(importBatches);
    expect(remaining.map((b) => b.id)).toEqual([fresh.batchId]);
  });
});
