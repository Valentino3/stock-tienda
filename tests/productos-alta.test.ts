import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { products, productVariants, stockMovements } from "@/db/schema";
import { crearProducto, crearVariante } from "@/domain/products";
import { searchVariants } from "@/domain/catalog";
import { eq } from "drizzle-orm";

/**
 * Alta manual de productos.
 *
 * Lo que protege esta suite: que un producto cargado a mano se pueda vender.
 * Antes nacía con stock 0 y sin SKU, y el carrito lo rechazaba con "Sin
 * stock" — el dueño cargaba mercadería y no la podía cobrar.
 */

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number, otra: number;

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  otra = await seedTestStore(db, "otra");
  await seedTestUser(db, "u1", "owner", store);
});

const base = {
  userId: "u1",
  name: "Sobre Booster",
  basePrice: 9500,
  lowStockThreshold: 3,
  tracksStock: true,
};

const alta = (extra: Record<string, unknown> = {}) =>
  crearProducto(db, { storeId: store, ...base, ...extra } as any);

const movimientosDe = (variantId: number) =>
  db.select().from(stockMovements).where(eq(stockMovements.variantId, variantId));

describe("crearProducto", () => {
  it("el stock inicial queda en la variante y deja su movimiento", async () => {
    const { variantId, stock } = await alta({ stockInicial: 5 });

    expect(stock).toBe(5);
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
    expect(v.stock).toBe(5);

    // El movimiento es lo que hace que el historial y los reportes puedan
    // reconstruir de dónde salieron esas unidades.
    const movs = await movimientosDe(variantId);
    expect(movs).toHaveLength(1);
    expect(movs[0].type).toBe("ajuste");
    expect(movs[0].quantity).toBe(5);
    expect(movs[0].reason).toBe("alta manual");
    expect(movs[0].userId).toBe("u1");
  });

  it("sin stock inicial no escribe ningún movimiento", async () => {
    const { variantId, stock } = await alta({ stockInicial: 0 });
    expect(stock).toBe(0);
    expect(await movimientosDe(variantId)).toHaveLength(0);
  });

  it("un producto que no lleva stock ignora el stock inicial en silencio", async () => {
    // Gastronomía: un plato no se cuenta por unidades. El número puede venir
    // de un campo que el dueño tipeó antes de destildar el checkbox, y eso no
    // puede abortar el alta.
    const { variantId, stock } = await alta({ tracksStock: false, stockInicial: 7 });

    expect(stock).toBe(0);
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
    expect(v.stock).toBe(0);
    expect(await movimientosDe(variantId)).toHaveLength(0);
  });

  it("el SKU va a la variante default y se puede buscar por él", async () => {
    await alta({ sku: "SOBRE-1", stockInicial: 2 });
    const encontrados = await searchVariants(db, store, "SOBRE-1");
    expect(encontrados.map((r) => r.sku)).toEqual(["SOBRE-1"]);
  });

  it("un SKU repetido en la tienda falla sin dejar producto huérfano", async () => {
    await alta({ sku: "REPE" });

    await expect(alta({ name: "Otro", sku: "REPE" })).rejects.toThrow();

    // Éste es el corazón del test: antes eran dos INSERT sueltos, así que un
    // fallo en el segundo dejaba un producto sin variante — invisible en
    // Vender y en Productos, e imposible de borrar desde la UI.
    const todos = await db.select().from(products).where(eq(products.storeId, store));
    expect(todos).toHaveLength(1);
    expect(todos[0].name).toBe("Sobre Booster");
  });

  it("el mismo SKU en otra tienda se crea sin problema", async () => {
    await seedTestUser(db, "u2", "owner", otra);
    await alta({ sku: "REPE" });
    const { stock } = await crearProducto(db, {
      storeId: otra, ...base, userId: "u2", sku: "REPE", stockInicial: 1,
    });
    expect(stock).toBe(1);
  });
});

describe("crearVariante", () => {
  it("hereda el tracksStock del producto padre para el stock inicial", async () => {
    const { productId } = await alta({ stockInicial: 1 });
    const creada = await crearVariante(db, {
      storeId: store, userId: "u1", productId,
      values: { name: "Foil", sku: "SOBRE-FOIL" }, stockInicial: 4,
    });

    expect(creada?.stock).toBe(4);
    const movs = await movimientosDe(creada!.variantId);
    expect(movs).toHaveLength(1);
    expect(movs[0].reason).toBe("alta manual");
  });

  it("un padre que no lleva stock ignora el stock inicial", async () => {
    const { productId } = await alta({ tracksStock: false });
    const creada = await crearVariante(db, {
      storeId: store, userId: "u1", productId,
      values: { name: "Grande" }, stockInicial: 9,
    });

    expect(creada?.stock).toBe(0);
    expect(await movimientosDe(creada!.variantId)).toHaveLength(0);
  });

  it("no ata una variante a un producto de otra tienda", async () => {
    await seedTestUser(db, "u2", "owner", otra);
    const { productId } = await crearProducto(db, { storeId: otra, ...base, userId: "u2" });

    // La guarda vive adentro de la transacción: devuelve null y no inserta.
    expect(await crearVariante(db, {
      storeId: store, userId: "u1", productId, values: { name: "Robada" },
    })).toBeNull();

    const variantes = await db.select().from(productVariants)
      .where(eq(productVariants.productId, productId));
    expect(variantes).toHaveLength(1);
  });
});
