import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestStore, seedTestUser } from "./helpers/db";
import { products, productVariants } from "@/db/schema";
import {
  listInventory, getInventoryFacets, EMPTY_FILTERS, PAGE_SIZE,
  type InventoryFilters,
} from "@/domain/inventory";

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;

/** Filtros por defecto con overrides, para no repetir las listas vacías. */
const f = (over: Partial<InventoryFilters> = {}): InventoryFilters => ({ ...EMPTY_FILTERS, ...over });

/** Crea un producto con una variante y devuelve el id de la variante. */
async function seedVariant(over: {
  product?: string; category?: string | null; basePrice?: number; threshold?: number;
  productActive?: boolean;
  variant?: string; sku?: string | null; stock?: number; price?: number | null;
  costArs?: number | null; supplier?: string | null; supplierSku?: string | null;
  setName?: string | null;
  condition?: string | null; language?: string | null; foil?: boolean; active?: boolean;
  storeId?: number;
} = {}) {
  const storeId = over.storeId ?? store;
  const [p] = await db.insert(products).values({
    storeId,
    name: over.product ?? "Producto",
    category: over.category ?? null,
    basePrice: over.basePrice ?? 1000,
    lowStockThreshold: over.threshold ?? 3,
    active: over.productActive ?? true,
  }).returning();
  const [v] = await db.insert(productVariants).values({
    storeId,
    productId: p.id,
    name: over.variant ?? "",
    sku: over.sku ?? null,
    stock: over.stock ?? 10,
    price: over.price ?? null,
    costArs: over.costArs ?? null,
    supplier: over.supplier ?? null,
    supplierSku: over.supplierSku ?? null,
    setName: over.setName ?? null,
    condition: over.condition ?? null,
    language: over.language ?? null,
    foil: over.foil ?? false,
    active: over.active ?? true,
  }).returning();
  return v.id;
}

const names = async (filters: InventoryFilters) =>
  (await listInventory(db, store, filters)).rows.map((r) => r.productName);

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);
});

describe("listInventory — la fila es la variante", () => {
  it("devuelve una fila por variante, no una por producto", async () => {
    const [p] = await db.insert(products).values({ storeId: store, name: "Remera", basePrice: 1000 }).returning();
    await db.insert(productVariants).values([
      { storeId: store, productId: p.id, name: "M", sku: "R-M", stock: 5 },
      { storeId: store, productId: p.id, name: "L", sku: "R-L", stock: 2 },
    ]);

    const { rows, total } = await listInventory(db, store, f());
    expect(rows).toHaveLength(2);
    expect(total).toBe(2);
    expect(rows.map((r) => r.variantName).sort()).toEqual(["L", "M"]);
  });

  it("filtrar por proveedor descarta las variantes hermanas de otro proveedor", async () => {
    // Este es el bug que motivó el rediseño: antes el producto entero entraba
    // si CUALQUIERA de sus variantes cumplía.
    const [p] = await db.insert(products).values({ storeId: store, name: "Fundas", basePrice: 1000 }).returning();
    await db.insert(productVariants).values([
      { storeId: store, productId: p.id, name: "Negro", sku: "F-N", supplier: "ORION" },
      { storeId: store, productId: p.id, name: "Azul", sku: "F-A", supplier: "BABAJI" },
    ]);

    const { rows } = await listInventory(db, store, f({ suppliers: ["ORION"] }));
    expect(rows).toHaveLength(1);
    expect(rows[0].variantName).toBe("Negro");
  });
});

describe("listInventory — precio y margen", () => {
  it("resuelve el precio de la variante o hereda el base del producto", async () => {
    await seedVariant({ product: "Hereda", basePrice: 1000, price: null });
    await seedVariant({ product: "Propio", basePrice: 1000, price: 1500 });

    const { rows } = await listInventory(db, store, f({ sort: "product" }));
    const hereda = rows.find((r) => r.productName === "Hereda")!;
    const propio = rows.find((r) => r.productName === "Propio")!;

    expect(hereda.price).toBe(1000);
    expect(hereda.priceOverridden).toBe(false);
    expect(propio.price).toBe(1500);
    expect(propio.priceOverridden).toBe(true);
  });

  it("filtra por rango de precio usando el precio heredado, no solo el propio", async () => {
    await seedVariant({ product: "Barato", basePrice: 500, price: null });
    await seedVariant({ product: "Caro", basePrice: 5000, price: null });

    expect(await names(f({ priceMin: 1000 }))).toEqual(["Caro"]);
    expect(await names(f({ priceMax: 1000 }))).toEqual(["Barato"]);
  });

  it("calcula el margen sobre el precio efectivo", async () => {
    // precio 1000, costo 400 -> margen 60%
    await seedVariant({ product: "Con costo", basePrice: 1000, costArs: 400 });
    const { rows } = await listInventory(db, store, f());
    expect(rows[0].margin).toBe(60);
  });

  it("deja el margen en null cuando no hay costo, y esas filas quedan fuera del filtro", async () => {
    await seedVariant({ product: "Sin costo", basePrice: 1000, costArs: null });
    await seedVariant({ product: "Costo cero", basePrice: 1000, costArs: 0 });
    await seedVariant({ product: "Con costo", basePrice: 1000, costArs: 900 }); // 10%

    const { rows } = await listInventory(db, store, f({ sort: "product" }));
    expect(rows.find((r) => r.productName === "Sin costo")!.margin).toBeNull();
    expect(rows.find((r) => r.productName === "Costo cero")!.margin).toBeNull();

    // Un margen null NO cuenta como 0: pedir "margen menor a 30" no debe
    // arrastrar todo lo que no tiene costo cargado.
    expect(await names(f({ marginMax: 30 }))).toEqual(["Con costo"]);
  });
});

describe("listInventory — stock", () => {
  beforeEach(async () => {
    await seedVariant({ product: "Agotado", stock: 0, threshold: 3 });
    await seedVariant({ product: "Bajo", stock: 2, threshold: 3 });
    await seedVariant({ product: "Justo en umbral", stock: 3, threshold: 3 });
    await seedVariant({ product: "Sobrado", stock: 50, threshold: 3 });
  });

  it("separa agotado, bajo y con stock", async () => {
    expect(await names(f({ stockState: "out" }))).toEqual(["Agotado"]);
    expect((await names(f({ stockState: "low" }))).sort()).toEqual(["Bajo", "Justo en umbral"]);
    expect(await names(f({ stockState: "in" }))).toEqual(["Sobrado"]);
  });

  it("respeta el umbral de cada producto, que no es una constante global", async () => {
    // Mismo stock (10) pero umbrales distintos: para uno es bajo, para el otro no.
    await seedVariant({ product: "Umbral alto", stock: 10, threshold: 20 });
    await seedVariant({ product: "Umbral bajo", stock: 10, threshold: 5 });

    expect(await names(f({ stockState: "low" }))).toContain("Umbral alto");
    expect(await names(f({ stockState: "in" }))).toContain("Umbral bajo");
  });
});

describe("listInventory — estado activo", () => {
  it("por defecto muestra activos e inactivos", async () => {
    await seedVariant({ product: "Activo" });
    await seedVariant({ product: "Variante inactiva", active: false });
    await seedVariant({ product: "Producto inactivo", productActive: false });

    expect((await names(f())).sort()).toEqual(["Activo", "Producto inactivo", "Variante inactiva"]);
  });

  it("una variante activa de un producto desactivado cuenta como inactiva", async () => {
    await seedVariant({ product: "Activo" });
    await seedVariant({ product: "Producto inactivo", productActive: false, active: true });

    expect(await names(f({ active: true }))).toEqual(["Activo"]);
    expect(await names(f({ active: false }))).toEqual(["Producto inactivo"]);
  });
});

describe("listInventory — búsqueda y atributos", () => {
  it("busca por nombre de producto, de variante, SKU, set y SKU de proveedor", async () => {
    await seedVariant({ product: "Charizard", variant: "NM", sku: "CHAR-1", setName: "Base Set", supplier: "CC" });
    await seedVariant({ product: "Pikachu", variant: "Holo", sku: "PIKA-1", setName: "Jungle" });
    await seedVariant({ product: "Toploader", sku: "X-1", supplierSku: "PROV-999" });

    expect(await names(f({ q: "chari" }))).toEqual(["Charizard"]);   // nombre de producto
    expect(await names(f({ q: "holo" }))).toEqual(["Pikachu"]);      // nombre de variante
    expect(await names(f({ q: "PIKA" }))).toEqual(["Pikachu"]);      // SKU, sin distinguir mayúsculas
    expect(await names(f({ q: "jungle" }))).toEqual(["Pikachu"]);    // set
    expect(await names(f({ q: "PROV-999" }))).toEqual(["Toploader"]); // SKU del proveedor
  });

  it("filtra por condición, idioma, set y foil", async () => {
    await seedVariant({ product: "A", condition: "NM", language: "EN", setName: "Base", foil: true });
    await seedVariant({ product: "B", condition: "LP", language: "ES", setName: "Jungle", foil: false });

    expect(await names(f({ conditions: ["NM"] }))).toEqual(["A"]);
    expect(await names(f({ languages: ["ES"] }))).toEqual(["B"]);
    expect(await names(f({ sets: ["Jungle"] }))).toEqual(["B"]);
    expect(await names(f({ foil: true }))).toEqual(["A"]);
    expect(await names(f({ foil: false }))).toEqual(["B"]);
  });

  it("la multi-selección suma opciones dentro del mismo filtro", async () => {
    await seedVariant({ product: "A", supplier: "ORION" });
    await seedVariant({ product: "B", supplier: "CP" });
    await seedVariant({ product: "C", supplier: "DEVIR" });

    expect((await names(f({ suppliers: ["ORION", "CP"] }))).sort()).toEqual(["A", "B"]);
  });

  it("filtros distintos se intersecan, no se suman", async () => {
    await seedVariant({ product: "Cumple los dos", supplier: "ORION", stock: 0 });
    await seedVariant({ product: "Solo proveedor", supplier: "ORION", stock: 50 });
    await seedVariant({ product: "Solo stock", supplier: "CP", stock: 0 });

    expect(await names(f({ suppliers: ["ORION"], stockState: "out" }))).toEqual(["Cumple los dos"]);
  });
});

describe("listInventory — orden y paginación", () => {
  it("ordena por stock en las dos direcciones", async () => {
    await seedVariant({ product: "Medio", stock: 5 });
    await seedVariant({ product: "Poco", stock: 1 });
    await seedVariant({ product: "Mucho", stock: 9 });

    expect(await names(f({ sort: "stock", dir: "asc" }))).toEqual(["Poco", "Medio", "Mucho"]);
    expect(await names(f({ sort: "stock", dir: "desc" }))).toEqual(["Mucho", "Medio", "Poco"]);
  });

  it("ordena por margen", async () => {
    await seedVariant({ product: "Margen 10", basePrice: 1000, costArs: 900 });
    await seedVariant({ product: "Margen 60", basePrice: 1000, costArs: 400 });

    expect((await names(f({ sort: "margin", dir: "asc" }))).slice(0, 2))
      .toEqual(["Margen 10", "Margen 60"]);
  });

  it("pagina sin repetir ni perder filas aunque todas empaten en el orden", async () => {
    // Mismo stock en todas: sin desempate estable, LIMIT/OFFSET puede devolver
    // una misma variante en dos páginas y saltearse otra.
    const total = PAGE_SIZE + 10;
    for (let i = 0; i < total; i++) {
      await seedVariant({ product: `Item ${String(i).padStart(3, "0")}`, stock: 7 });
    }

    const p1 = await listInventory(db, store, f({ sort: "stock", page: 1 }));
    const p2 = await listInventory(db, store, f({ sort: "stock", page: 2 }));

    expect(p1.total).toBe(total);
    expect(p1.hasNextPage).toBe(true);
    expect(p1.rows).toHaveLength(PAGE_SIZE);
    expect(p2.hasNextPage).toBe(false);
    expect(p2.rows).toHaveLength(10);

    const vistos = [...p1.rows, ...p2.rows].map((r) => r.variantId);
    expect(new Set(vistos).size).toBe(total); // ni repetidos ni faltantes
  });

  it("el total refleja los filtros, no el catálogo entero", async () => {
    await seedVariant({ product: "A", supplier: "ORION" });
    await seedVariant({ product: "B", supplier: "CP" });

    expect((await listInventory(db, store, f())).total).toBe(2);
    expect((await listInventory(db, store, f({ suppliers: ["ORION"] }))).total).toBe(1);
  });
});

describe("aislamiento multi-tienda", () => {
  it("no devuelve filas ni facetas de otra tienda", async () => {
    const otra = await seedTestStore(db, "t2", "Otra");
    await seedVariant({ product: "Mío", supplier: "ORION", category: "Accesorios" });
    await seedVariant({ product: "Ajeno", supplier: "SECRETO", category: "Oculta", storeId: otra });

    expect(await names(f())).toEqual(["Mío"]);

    const facets = await getInventoryFacets(db, store);
    expect(facets.suppliers).toEqual(["ORION"]);
    expect(facets.categories).toEqual(["Accesorios"]);
  });
});

describe("getInventoryFacets", () => {
  it("devuelve valores únicos, ordenados y sin vacíos", async () => {
    await seedVariant({ product: "A", category: "Pokémon", supplier: "ORION", condition: "NM", language: "EN", setName: "Base" });
    await seedVariant({ product: "B", category: "Accesorios", supplier: "ORION", condition: "LP", language: "EN", setName: "Base" });
    await seedVariant({ product: "C", category: null, supplier: null, condition: "  ", language: null, setName: null });

    const facets = await getInventoryFacets(db, store);
    expect(facets.categories).toEqual(["Accesorios", "Pokémon"]);
    expect(facets.suppliers).toEqual(["ORION"]);       // sin duplicar
    expect(facets.conditions).toEqual(["LP", "NM"]);   // sin el string en blanco
    expect(facets.languages).toEqual(["EN"]);
    expect(facets.sets).toEqual(["Base"]);
  });
});
