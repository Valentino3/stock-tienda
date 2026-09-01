import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { products, productVariants } from "@/db/schema";
import { searchVariants, snapshotCatalogo } from "@/domain/catalog";
import { buscarEnCatalogo, indexarCatalogo } from "@/lib/offline/busqueda";

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

/** Crea `n` productos que CONTIENEN el término pero no arrancan con él. */
async function sembrarRuido(storeId: number, n: number) {
  for (let i = 0; i < n; i++) {
    const nombre = `Caja con boosters ${String(i).padStart(2, "0")}`;
    const [p] = await db.insert(products).values({ storeId, name: nombre, basePrice: 1000 }).returning();
    await db.insert(productVariants).values({ storeId, productId: p.id, name: "", stock: 5 });
  }
}

describe("orden de searchVariants", () => {
  it("el producto recién cargado no se cae del corte de 20", async () => {
    // El bug exacto que reportó el local: 30 coincidencias y el producto que
    // el dueño acaba de cargar sale último en orden de heap, así que era
    // sistemáticamente el que se comía el LIMIT.
    await sembrarRuido(store, 30);
    const [p] = await db.insert(products)
      .values({ storeId: store, name: "Booster Pack", basePrice: 9500 }).returning();
    await db.insert(productVariants)
      .values({ storeId: store, productId: p.id, name: "", sku: "BOOST-1", stock: 3 });

    const r = await searchVariants(db, store, "boost");
    expect(r).toHaveLength(20);
    // Y no solo entra: arranca con el término, así que va primero.
    expect(r[0].productName).toBe("Booster Pack");
  });

  it("el SKU exacto va primero, aunque haya otros que contengan el término", async () => {
    await sembrarRuido(store, 5);
    const [p] = await db.insert(products)
      .values({ storeId: store, name: "Zzz último alfabéticamente", basePrice: 100 }).returning();
    await db.insert(productVariants)
      .values({ storeId: store, productId: p.id, name: "", sku: "boosters", stock: 1 });

    // Un lector de código de barras tipea el SKU: tiene que caer primero
    // aunque su nombre lo mande al final del alfabeto.
    const r = await searchVariants(db, store, "boosters");
    expect(r[0].sku).toBe("boosters");
  });

  it("dos corridas idénticas devuelven el mismo orden con filas empatadas", async () => {
    // Mismo nombre de producto: sin el desempate por id, el orden entre estas
    // filas queda indefinido y el corte puede variar entre llamadas.
    const [p] = await db.insert(products)
      .values({ storeId: store, name: "Sobre igual", basePrice: 1000 }).returning();
    await db.insert(productVariants).values(
      Array.from({ length: 25 }, (_, i) => ({
        storeId: store, productId: p.id, name: "", sku: `IGUAL-${i}`, stock: 1,
      }))
    );

    const a = await searchVariants(db, store, "Sobre igual");
    const b = await searchVariants(db, store, "Sobre igual");
    expect(a.map((r) => r.variantId)).toEqual(b.map((r) => r.variantId));
  });

  it("paridad: la búsqueda del servidor y la del dispositivo dan el mismo orden", async () => {
    // El invariante que hasta ahora solo vivía en un comentario. Si vuelven a
    // divergir, el vendedor ve una lista distinta según haya o no conexión.
    await sembrarRuido(store, 30);
    const [p] = await db.insert(products)
      .values({ storeId: store, name: "Booster Pack", basePrice: 9500 }).returning();
    await db.insert(productVariants)
      .values({ storeId: store, productId: p.id, name: "", sku: "BOOST-1", stock: 3 });

    const { variantes } = await snapshotCatalogo(db, store);
    const offline = buscarEnCatalogo(indexarCatalogo(variantes), "boost");
    const online = await searchVariants(db, store, "boost");

    expect(online.map((r) => r.variantId)).toEqual(offline.map((r) => r.variantId));
  });
});
