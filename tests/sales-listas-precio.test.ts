import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { products, productVariants, sales, saleItems, stockMovements } from "@/db/schema";
import { openCashSession } from "@/domain/cash";
import { createSale, resolverPrecio } from "@/domain/sales";
import { eq } from "drizzle-orm";

/**
 * Cobrar por lista de precios (venta / efectivo menor / mayorista) y el
 * snapshot de "estaba en promo".
 *
 * Lo que estos tests protegen, en orden de importancia:
 *  1. Que una venta SIN lista dé exactamente lo mismo que antes de la feature.
 *  2. Que $0 sea un precio válido y no caiga al precio de lista.
 *  3. Que una lista sin cargar rebote entera, sin dejar media venta.
 */

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;
let normal: number, conListas: number, enPromo: number, gratis: number;

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);

  // Sin listas alternativas cargadas: es el caso de la enorme mayoría del
  // catálogo, y el que tiene que seguir andando igual que siempre.
  const [p1] = await db.insert(products).values({ storeId: store, name: "Sobre", basePrice: 1000 }).returning();
  const [v1] = await db.insert(productVariants)
    .values({ storeId: store, productId: p1.id, name: "", stock: 50 }).returning();
  normal = v1.id;

  const [p2] = await db.insert(products).values({ storeId: store, name: "Caja", basePrice: 10000 }).returning();
  const [v2] = await db.insert(productVariants).values({
    storeId: store, productId: p2.id, name: "", stock: 50,
    price: 12000, priceCash: 11000, priceWholesale: 9000,
  }).returning();
  conListas = v2.id;

  const [p3] = await db.insert(products)
    .values({ storeId: store, name: "Promo del mes", basePrice: 500, isPromo: true }).returning();
  const [v3] = await db.insert(productVariants)
    .values({ storeId: store, productId: p3.id, name: "", stock: 50, priceCash: 400 }).returning();
  enPromo = v3.id;

  // priceCash = 0. Es el caso que rompe cualquier implementación que use `||`.
  const [p4] = await db.insert(products).values({ storeId: store, name: "Regalo", basePrice: 3000 }).returning();
  const [v4] = await db.insert(productVariants)
    .values({ storeId: store, productId: p4.id, name: "", stock: 50, priceCash: 0 }).returning();
  gratis = v4.id;
});

const vender = (items: any[], extra: any = {}) =>
  createSale(db, { storeId: store, sellerId: "u1", paymentMethod: "efectivo", items, ...extra });

describe("resolverPrecio", () => {
  it("sin lista devuelve el precio de venta, y el de la variante le gana al base", () => {
    expect(resolverPrecio({ price: null, basePrice: 1000 })).toBe(1000);
    expect(resolverPrecio({ price: 1200, basePrice: 1000 })).toBe(1200);
  });

  it("cobra 0 cuando la lista dice 0, en vez de caer al precio de venta", () => {
    expect(resolverPrecio({ price: 3000, basePrice: 3000, priceCash: 0 }, "efectivo")).toBe(0);
  });

  it("tira si la lista pedida no está cargada, en vez de cobrar de más", () => {
    expect(() => resolverPrecio({ price: 1000, basePrice: 1000 }, "efectivo")).toThrow("PRICE_LIST_NOT_SET");
    expect(() => resolverPrecio({ price: 1000, basePrice: 1000 }, "mayorista")).toThrow("PRICE_LIST_NOT_SET");
  });
});

describe("createSale con listas de precio", () => {
  beforeEach(async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
  });

  it("sin priceList da el mismo resultado que antes de la feature", async () => {
    const venta = await vender([{ variantId: normal, quantity: 2 }, { variantId: conListas, quantity: 1 }]);
    // 2*1000 + 1*12000 — el precio de la variante, no priceCash ni mayorista.
    expect(venta.total).toBe(14000);
    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, venta.id));
    expect(items.every((i) => i.priceList === "venta")).toBe(true);
  });

  it("cobra el efectivo menor y deja registrada la lista", async () => {
    const venta = await vender([{ variantId: conListas, quantity: 2, priceList: "efectivo" }]);
    expect(venta.total).toBe(22000);
    const [item] = await db.select().from(saleItems).where(eq(saleItems.saleId, venta.id));
    expect(item.unitPrice).toBe(11000);
    expect(item.priceList).toBe("efectivo");
  });

  it("cobra el mayorista", async () => {
    const venta = await vender([{ variantId: conListas, quantity: 3, priceList: "mayorista" }]);
    expect(venta.total).toBe(27000);
    const [item] = await db.select().from(saleItems).where(eq(saleItems.saleId, venta.id));
    expect(item.priceList).toBe("mayorista");
  });

  it("mezcla listas en una misma venta", async () => {
    const venta = await vender([
      { variantId: conListas, quantity: 1, priceList: "mayorista" }, // 9000
      { variantId: normal, quantity: 1 },                            // 1000
    ]);
    expect(venta.total).toBe(10000);
    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, venta.id));
    expect(items.map((i) => i.priceList).sort()).toEqual(["mayorista", "venta"]);
  });

  it("cobra 0 si la lista dice 0 — no cae al precio de venta", async () => {
    const venta = await vender([{ variantId: gratis, quantity: 1, priceList: "efectivo" }]);
    expect(venta.total).toBe(0);
    const [item] = await db.select().from(saleItems).where(eq(saleItems.saleId, venta.id));
    expect(item.unitPrice).toBe(0);
  });

  it("rechaza la venta ENTERA si falta la lista, sin dejar rastro", async () => {
    await expect(
      vender([
        { variantId: conListas, quantity: 1 },
        { variantId: normal, quantity: 1, priceList: "mayorista" }, // no tiene
      ]),
    ).rejects.toThrow("PRICE_LIST_NOT_SET");

    // Rollback total: ni venta, ni líneas, ni movimiento de stock.
    expect(await db.select().from(sales)).toHaveLength(0);
    expect(await db.select().from(saleItems)).toHaveLength(0);
    expect(await db.select().from(stockMovements)).toHaveLength(0);
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, normal));
    expect(v.stock).toBe(50);
  });

  it("rechaza una lista que no existe", async () => {
    await expect(
      vender([{ variantId: normal, quantity: 1, priceList: "regalada" as any }]),
    ).rejects.toThrow("INVALID_PRICE_LIST");
  });

  it("el descuento de línea se resuelve sobre la base de la lista, no del precio de venta", async () => {
    const venta = await vender([{
      variantId: conListas, quantity: 1, priceList: "mayorista",
      discount: { kind: "percent", value: 10 },
    }]);
    // 10% sobre 9000, no sobre 12000.
    expect(venta.total).toBe(8100);
    const [item] = await db.select().from(saleItems).where(eq(saleItems.saleId, venta.id));
    expect(item.discountAmount).toBe(900);
  });

  it("el reintento con el mismo uid no recobra aunque cambie la lista", async () => {
    const primera = await vender([{ variantId: conListas, quantity: 1 }], { uid: "abc" });
    const segunda = await vender(
      [{ variantId: conListas, quantity: 1, priceList: "mayorista" }],
      { uid: "abc" },
    );
    expect(segunda.id).toBe(primera.id);
    expect(segunda.total).toBe(primera.total);
    expect((segunda as any).duplicada).toBe(true);
    expect(await db.select().from(sales)).toHaveLength(1);
  });
});

describe("snapshot de promo", () => {
  beforeEach(async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
  });

  it("estampa isPromo en la línea al vender", async () => {
    const venta = await vender([{ variantId: enPromo, quantity: 1 }, { variantId: normal, quantity: 1 }]);
    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, venta.id));
    const porVariante = new Map(items.map((i) => [i.variantId, i.isPromo]));
    expect(porVariante.get(enPromo)).toBe(true);
    expect(porVariante.get(normal)).toBe(false);
  });

  it("apagar la promo DESPUÉS no reescribe las ventas ya hechas", async () => {
    const venta = await vender([{ variantId: enPromo, quantity: 1 }]);

    // La promo termina y alguien limpia el flag.
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, enPromo));
    await db.update(products).set({ isPromo: false }).where(eq(products.id, v.productId));

    const [item] = await db.select().from(saleItems).where(eq(saleItems.saleId, venta.id));
    // Si esto diera false, la comisión de un período cerrado cambiaría sola.
    expect(item.isPromo).toBe(true);
  });
});
