import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import {
  cashSessions, notifications, products, productVariants, saleItems, stockMovements,
} from "@/db/schema";
import { openCashSession } from "@/domain/cash";
import { createSale, voidSale } from "@/domain/sales";
import { replaySale } from "@/domain/sales-replay";
import { getLowStock } from "@/domain/reports";
import { listInventory, EMPTY_FILTERS } from "@/domain/inventory";
import { eq } from "drizzle-orm";

/**
 * Productos que no llevan control de stock (`products.tracksStock = false`).
 *
 * Es lo que permite vender un plato, un servicio o un recargo. El invariante
 * que importa: las guardas de venta y de anulación tienen que ser SIMÉTRICAS.
 * Si al vender no se descuenta pero al anular se devuelve, se inventa stock de
 * la nada, en silencio y para siempre.
 */

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;
let conStock: number;   // variante de un producto que sí lleva stock
let sinStock: number;   // variante de un producto que no

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);

  const [remera] = await db.insert(products)
    .values({ storeId: store, name: "Remera", basePrice: 1000, tracksStock: true }).returning();
  const [v1] = await db.insert(productVariants)
    .values({ storeId: store, productId: remera.id, name: "M", stock: 5 }).returning();
  conStock = v1.id;

  const [milanesa] = await db.insert(products)
    .values({ storeId: store, name: "Milanesa", basePrice: 8000, tracksStock: false }).returning();
  const [v2] = await db.insert(productVariants)
    .values({ storeId: store, productId: milanesa.id, name: "", stock: 0 }).returning();
  sinStock = v2.id;

  await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
});

const vender = (variantId: number, quantity = 1) =>
  createSale(db, {
    storeId: store, sellerId: "u1", paymentMethod: "efectivo",
    items: [{ variantId, quantity }],
  });

describe("createSale", () => {
  it("vende un producto sin stock trackeado aunque las existencias estén en 0", async () => {
    const venta = await vender(sinStock, 3);

    expect(venta.total).toBe(24000);
    const movs = await db.select().from(stockMovements).where(eq(stockMovements.variantId, sinStock));
    expect(movs).toHaveLength(0);
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, sinStock));
    expect(v.stock).toBe(0); // intacto, nadie lo tocó
  });

  it("el producto que sí lleva stock sigue descontando", async () => {
    await vender(conStock, 2);
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, conStock));
    expect(v.stock).toBe(3);
    expect(await db.select().from(stockMovements).where(eq(stockMovements.variantId, conStock))).toHaveLength(1);
  });

  it("y sigue rechazando si no alcanza", async () => {
    await expect(vender(conStock, 99)).rejects.toThrow("INSUFFICIENT_STOCK");
  });

  it("carrito mixto: descuenta solo lo que corresponde y el total es correcto", async () => {
    const venta = await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "efectivo",
      items: [{ variantId: conStock, quantity: 2 }, { variantId: sinStock, quantity: 1 }],
    });

    expect(venta.total).toBe(10000); // 2×1000 + 1×8000
    const [conS] = await db.select().from(productVariants).where(eq(productVariants.id, conStock));
    const [sinS] = await db.select().from(productVariants).where(eq(productVariants.id, sinStock));
    expect(conS.stock).toBe(3);
    expect(sinS.stock).toBe(0);
    expect(await db.select().from(stockMovements)).toHaveLength(1);
    // Las DOS líneas quedan registradas: la factura las necesita.
    expect(await db.select().from(saleItems).where(eq(saleItems.saleId, venta.id))).toHaveLength(2);
  });
});

describe("voidSale — la guarda simétrica", () => {
  it("anular una venta sin stock trackeado NO crea stock fantasma", async () => {
    // Es el bug peligroso: si vender no descontó, anular no puede devolver.
    const venta = await vender(sinStock, 3);
    await voidSale(db, { saleId: venta.id, storeId: store, userId: "u1" });

    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, sinStock));
    expect(v.stock).toBe(0);
    expect(await db.select().from(stockMovements).where(eq(stockMovements.variantId, sinStock))).toHaveLength(0);
  });

  it("anular una venta con stock trackeado sí devuelve las unidades", async () => {
    const venta = await vender(conStock, 2);
    await voidSale(db, { saleId: venta.id, storeId: store, userId: "u1" });

    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, conStock));
    expect(v.stock).toBe(5);
  });

  it("en un carrito mixto devuelve solo lo trackeado", async () => {
    const venta = await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "efectivo",
      items: [{ variantId: conStock, quantity: 2 }, { variantId: sinStock, quantity: 1 }],
    });
    await voidSale(db, { saleId: venta.id, storeId: store, userId: "u1" });

    const [conS] = await db.select().from(productVariants).where(eq(productVariants.id, conStock));
    const [sinS] = await db.select().from(productVariants).where(eq(productVariants.id, sinStock));
    expect(conS.stock).toBe(5);
    expect(sinS.stock).toBe(0);
  });
});

describe("replaySale", () => {
  it("una venta offline de un plato no deja stock negativo ni levanta aviso", async () => {
    const [caja] = await db.select().from(cashSessions);
    const r = await replaySale(db, {
      storeId: store, sellerId: "u1",
      venta: {
        uid: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
        capturadoEn: new Date().toISOString(),
        cashSessionId: caja.id,
        paymentMethod: "efectivo",
        items: [{ variantId: sinStock, quantity: 4, unitPrice: 8000 }],
      },
    });

    expect(r.estado).toBe("aplicada");
    expect(r.avisos).toEqual([]);
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, sinStock));
    expect(v.stock).toBe(0);
    expect(await db.select().from(notifications)).toHaveLength(0);
  });
});

describe("reportes e inventario", () => {
  it("getLowStock ignora lo que no lleva stock", async () => {
    // La milanesa tiene stock 0 y umbral 3: sin la guarda, saldría en rojo.
    const filas = await getLowStock(db, store);
    expect(filas.map((f: { productName: string }) => f.productName)).not.toContain("Milanesa");
  });

  it("getLowStock sigue mostrando lo trackeado que está bajo", async () => {
    await db.update(productVariants).set({ stock: 1 }).where(eq(productVariants.id, conStock));
    const filas = await getLowStock(db, store);
    expect(filas.map((f: { productName: string }) => f.productName)).toContain("Remera");
  });

  it("filtrar por «sin stock» no devuelve la carta entera", async () => {
    const { rows } = await listInventory(db, store, { ...EMPTY_FILTERS, stockState: "out" });
    expect(rows.map((r) => r.productName)).not.toContain("Milanesa");
  });

  it("sin filtro de stock, lo no trackeado sí aparece en el inventario", async () => {
    const { rows } = await listInventory(db, store, EMPTY_FILTERS);
    const milanesa = rows.find((r) => r.productName === "Milanesa");
    expect(milanesa).toBeDefined();
    expect(milanesa?.tracksStock).toBe(false);
  });
});

describe("compatibilidad con lo que ya está en producción", () => {
  it("un producto creado sin especificar tracksStock descuenta stock", async () => {
    // Las filas anteriores a la columna toman el default true. Los dos locales
    // de cartas no pueden cambiar de comportamiento por esta migración.
    const [p] = await db.insert(products)
      .values({ storeId: store, name: "Sin especificar", basePrice: 500 }).returning();
    const [v] = await db.insert(productVariants)
      .values({ storeId: store, productId: p.id, name: "", stock: 4 }).returning();

    expect(p.tracksStock).toBe(true);
    await vender(v.id, 1);
    const [despues] = await db.select().from(productVariants).where(eq(productVariants.id, v.id));
    expect(despues.stock).toBe(3);
  });
});
