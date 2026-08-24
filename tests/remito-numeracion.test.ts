import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { products, productVariants, sales, stores } from "@/db/schema";
import { openCashSession } from "@/domain/cash";
import { createSale, voidSale } from "@/domain/sales";
import { getRemito } from "@/domain/cash-close";
import { replaySale } from "@/domain/sales-replay";
import { eq } from "drizzle-orm";

/**
 * Numeración del remito.
 *
 * Lo que protege esta suite: que dos remitos nunca lleven el mismo número.
 * Es el peor resultado posible de la feature — dos papeles distintos con el
 * mismo `NRO` circulando por el local.
 */

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number, otra: number;
let vId: number;

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  otra = await seedTestStore(db, "otra");
  await seedTestUser(db, "u1", "owner", store);

  const [p] = await db.insert(products).values({ storeId: store, name: "Sobre", basePrice: 1000 }).returning();
  const [v] = await db.insert(productVariants)
    .values({ storeId: store, productId: p.id, name: "", sku: "SOBRE-1", stock: 100 }).returning();
  vId = v.id;

  await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
});

const vender = (extra: any = {}) =>
  createSale(db, {
    storeId: store, sellerId: "u1", paymentMethod: "efectivo",
    items: [{ variantId: vId, quantity: 1 }], ...extra,
  });

describe("numeración de remitos", () => {
  it("arranca en 1 y avanza de a uno", async () => {
    const a = await vender();
    const b = await vender();
    const c = await vender();

    expect(a.remitoNumero).toBe(1);
    expect(b.remitoNumero).toBe(2);
    expect(c.remitoNumero).toBe(3);
  });

  it("cada tienda lleva su propia serie", async () => {
    await seedTestUser(db, "u2", "owner", otra);
    const [p2] = await db.insert(products).values({ storeId: otra, name: "Otro", basePrice: 500 }).returning();
    const [v2] = await db.insert(productVariants)
      .values({ storeId: otra, productId: p2.id, name: "", stock: 10 }).returning();
    await openCashSession(db, { storeId: otra, userId: "u2", openingCash: 0 });

    await vender();
    await vender();
    const deLaOtra = await createSale(db, {
      storeId: otra, sellerId: "u2", paymentMethod: "efectivo",
      items: [{ variantId: v2.id, quantity: 1 }],
    });

    // La tercera venta del sistema es el remito #1 de SU tienda.
    expect(deLaOtra.remitoNumero).toBe(1);
    const [s] = await db.select().from(stores).where(eq(stores.id, store));
    expect(s.remitoUltimoNumero).toBe(2);
  });

  it("el reintento con el mismo uid NO consume un número nuevo", async () => {
    const primera = await vender({ uid: "abc" });
    const reintento = await vender({ uid: "abc" });

    expect(reintento.id).toBe(primera.id);
    expect(reintento.remitoNumero).toBe(primera.remitoNumero);
    // El contador no se movió: si lo hiciera, un corte de red dejaría huecos
    // en la serie por cada reintento.
    const [s] = await db.select().from(stores).where(eq(stores.id, store));
    expect(s.remitoUltimoNumero).toBe(1);
  });

  it("una venta rechazada no quema el número", async () => {
    await vender();
    // Sin stock: la transacción entera hace rollback, contador incluido.
    await expect(
      createSale(db, {
        storeId: store, sellerId: "u1", paymentMethod: "efectivo",
        items: [{ variantId: vId, quantity: 9999 }],
      }),
    ).rejects.toThrow("INSUFFICIENT_STOCK");

    const siguiente = await vender();
    expect(siguiente.remitoNumero).toBe(2);
  });

  it("la venta sincronizada desde offline también recibe número", async () => {
    const online = await vender();
    const r = await replaySale(db, {
      storeId: store, sellerId: "u1",
      venta: {
        uid: "eeeeeeee-5555-4555-8555-eeeeeeeeeeee",
        capturadoEn: new Date().toISOString(),
        cashSessionId: online.cashSessionId,
        paymentMethod: "efectivo",
        items: [{ variantId: vId, quantity: 1, unitPrice: 1000 }],
      },
    });

    const [sincronizada] = await db.select().from(sales).where(eq(sales.id, r.saleId!));
    expect(sincronizada.remitoNumero).toBe(2);
  });

  it("anular no libera el número: el papel se entregó igual", async () => {
    const venta = await vender();
    await voidSale(db, { saleId: venta.id, storeId: store, userId: "u1", reason: "devolución" });

    const remito = (await getRemito(db, store, venta.id))!;
    expect(remito.numero).toBe(1);
    expect(remito.voided).toBe(true);

    const siguiente = await vender();
    expect(siguiente.remitoNumero).toBe(2);
  });
});

describe("getRemito", () => {
  it("trae el código del ítem y el número", async () => {
    const venta = await vender();
    const r = (await getRemito(db, store, venta.id))!;

    expect(r.numero).toBe(1);
    expect(r.lineas[0].sku).toBe("SOBRE-1");
    expect(r.lineas[0].variantId).toBe(vId);
  });

  it("no deja imprimir el remito de otra tienda", async () => {
    const venta = await vender();
    expect(await getRemito(db, otra, venta.id)).toBeNull();
  });

  it("un empleado no puede imprimir la venta de otro vendedor", async () => {
    await seedTestUser(db, "empleado", "employee", store);
    const venta = await vender(); // la vendió u1

    expect(await getRemito(db, store, venta.id, { sellerId: "empleado" })).toBeNull();
    expect(await getRemito(db, store, venta.id, { sellerId: "u1" })).not.toBeNull();
  });
});
