import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createTestDb, seedTestUser, seedTestStore, seedTestSale } from "./helpers/db";
import { products, productVariants, comprobantes, type NuevoComprobante } from "@/db/schema";

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

// Los índices parciales de 0015_comprobantes_indices.sql están escritos a mano:
// no pasan por el tipado de drizzle, así que estos tests son lo ÚNICO que los
// prueba. Corren contra PGlite, que replaya las migraciones reales.
describe("índices parciales de comprobantes (0015)", () => {
  async function setup() {
    const db = await createTestDb();
    const store = await seedTestStore(db);
    await seedTestUser(db, "u1", "owner", store);
    const { sale } = await seedTestSale(db, { storeId: store });
    const base = (over: Partial<NuevoComprobante> = {}): NuevoComprobante => ({
      storeId: store, saleId: sale.id, clase: "factura", cbteTipo: 6,
      ambiente: "homologacion", ptoVta: 1, numero: 1, estado: "pendiente",
      docTipo: 99, docNro: "0", condIvaReceptor: 5, receptorNombre: "Consumidor Final",
      impTotal: 1000, impNeto: 826.45, impIva: 173.55,
      ivaDesglose: [{ id: 5, baseImp: 826.45, importe: 173.55 }],
      lineas: [], cbteFch: "2026-07-30", cuitEmisor: "20111111112", createdBy: "u1",
      ...over,
    });
    return { db, store, saleId: sale.id, base };
  }

  it("rechaza dos comprobantes vivos con el mismo número en la misma secuencia", async () => {
    const { db, base } = await setup();
    await db.insert(comprobantes).values(base({ numero: 7, estado: "pendiente" }));
    await expect(
      db.insert(comprobantes).values(base({ numero: 7, estado: "autorizado", clase: "nota_credito", cbteTipo: 6 }))
    ).rejects.toThrow();
  });

  it("un rechazado LIBERA el número: se puede reusar", async () => {
    const { db, base } = await setup();
    // ARCA no avanza su numeración cuando responde Resultado = R, así que el
    // número sigue libre y el reintento tiene que poder reusarlo.
    await db.insert(comprobantes).values(base({ numero: 7, estado: "rechazado" }));
    await db.insert(comprobantes).values(base({ numero: 7, estado: "autorizado" }));
    const filas = await db.select().from(comprobantes);
    expect(filas).toHaveLength(2);
  });

  it("dos rechazados con el mismo número también se permiten (varios reintentos)", async () => {
    const { db, base } = await setup();
    await db.insert(comprobantes).values(base({ numero: 3, estado: "rechazado" }));
    await db.insert(comprobantes).values(base({ numero: 3, estado: "rechazado" }));
    expect(await db.select().from(comprobantes)).toHaveLength(2);
  });

  it("distinto ambiente es distinta secuencia: el mismo número convive", async () => {
    const { db, base } = await setup();
    await db.insert(comprobantes).values(base({ numero: 1, ambiente: "homologacion" }));
    await db.insert(comprobantes).values(base({ numero: 1, ambiente: "produccion", clase: "nota_credito" }));
    expect(await db.select().from(comprobantes)).toHaveLength(2);
  });

  it("una sola factura viva por venta: el doble clic rebota contra la DB", async () => {
    const { db, base } = await setup();
    await db.insert(comprobantes).values(base({ numero: 1, estado: "autorizado" }));
    await expect(
      db.insert(comprobantes).values(base({ numero: 2, estado: "pendiente" }))
    ).rejects.toThrow();
  });

  it("una factura viva y una nota de crédito viva conviven en la misma venta", async () => {
    const { db, base } = await setup();
    await db.insert(comprobantes).values(base({ numero: 1, estado: "autorizado", clase: "factura", cbteTipo: 6 }));
    await db.insert(comprobantes).values(base({ numero: 1, estado: "autorizado", clase: "nota_credito", cbteTipo: 8 }));
    expect(await db.select().from(comprobantes)).toHaveLength(2);
  });

  it("una factura rechazada no bloquea el reintento de la misma venta", async () => {
    const { db, base } = await setup();
    await db.insert(comprobantes).values(base({ numero: 1, estado: "rechazado" }));
    await db.insert(comprobantes).values(base({ numero: 1, estado: "autorizado" }));
    expect(await db.select().from(comprobantes)).toHaveLength(2);
  });
});
