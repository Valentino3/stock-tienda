import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { products, productVariants } from "@/db/schema";
import { closeCashSession, createCashMovement, openCashSession } from "@/domain/cash";
import { createSale, voidSale } from "@/domain/sales";
import { getCashSessionClose } from "@/domain/cash-close";
import { eq } from "drizzle-orm";

/**
 * El cierre de caja como documento.
 *
 * Lo que importa: que el total del paquete de remitos se pueda reconciliar
 * contra el arqueo que quedó guardado. Si no cierra, alguien pierde una hora
 * buscando una diferencia que no existe.
 */

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number, otraTienda: number;
let vId: number;
let sessionId: number;

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  otraTienda = await seedTestStore(db, "otra");
  await seedTestUser(db, "u1", "owner", store);

  const [p] = await db.insert(products).values({ storeId: store, name: "Sobre", basePrice: 1000 }).returning();
  const [v] = await db.insert(productVariants)
    .values({ storeId: store, productId: p.id, name: "", stock: 100 }).returning();
  vId = v.id;

  const caja = await openCashSession(db, { storeId: store, userId: "u1", openingCash: 5000 });
  sessionId = caja.id;
});

const vender = (qty: number, extra: any = {}) =>
  createSale(db, {
    storeId: store, sellerId: "u1", paymentMethod: "efectivo",
    items: [{ variantId: vId, quantity: qty }], ...extra,
  });

describe("getCashSessionClose", () => {
  it("devuelve null para una caja de otra tienda", async () => {
    expect(await getCashSessionClose(db, otraTienda, sessionId)).toBeNull();
  });

  it("el efectivo esperado que calcula coincide con el que guardó el cierre", async () => {
    await vender(2);                                              // 2000 efectivo
    await vender(1, { paymentMethod: "tarjeta" });                // 1000 tarjeta
    await createCashMovement(db, {
      storeId: store, sessionId, userId: "u1", kind: "gasto", amount: 300, description: "insumos",
    });

    const cerrada = await closeCashSession(db, {
      storeId: store, sessionId, userId: "u1", countedCash: 6700,
    });

    const c = (await getCashSessionClose(db, store, sessionId))!;
    // 5000 + 2000 − 300 = 6700. La hoja se auto-verifica contra el guardado.
    expect(c.efectivoEsperado).toBe(6700);
    expect(c.efectivoEsperado).toBe(cerrada.expectedCash);
    expect(c.totalSalidas).toBe(300);
    // La tarjeta no entra al efectivo pero sí figura por medio.
    expect(c.porMedio.find((m) => m.method === "tarjeta")?.total).toBe(1000);
  });

  it("incluye las anuladas en la lista pero fuera del total", async () => {
    const anulada = await vender(3);
    await vender(1);
    await voidSale(db, { saleId: anulada.id, storeId: store, userId: "u1", reason: "se arrepintió" });

    const c = (await getCashSessionClose(db, store, sessionId))!;

    expect(c.remitos).toHaveLength(2);
    const r = c.remitos.find((x) => x.saleId === anulada.id)!;
    expect(r.voided).toBe(true);
    expect(r.voidedReason).toBe("se arrepintió");

    // Fuera de los totales: es lo que hace que el paquete cuadre con el arqueo.
    expect(c.anuladas).toEqual({ count: 1, total: 3000 });
    expect(c.porMedio.find((m) => m.method === "efectivo")?.total).toBe(1000);
    expect(c.efectivoEsperado).toBe(6000); // 5000 + 1000
  });

  it("marca las ventas que entraron después del cierre", async () => {
    await vender(1);
    await closeCashSession(db, { storeId: store, sessionId, userId: "u1", countedCash: 6000 });

    // Una venta offline sincronizada tarde contra la caja ya cerrada.
    const { replaySale } = await import("@/domain/sales-replay");
    await replaySale(db, {
      storeId: store, sellerId: "u1",
      venta: {
        uid: "dddddddd-4444-4444-8444-dddddddddddd",
        capturadoEn: new Date().toISOString(),
        cashSessionId: sessionId,
        paymentMethod: "efectivo",
        items: [{ variantId: vId, quantity: 1, unitPrice: 1000 }],
      },
    });

    const c = (await getCashSessionClose(db, store, sessionId))!;
    expect(c.tardias.count).toBe(1);
    expect(c.tardias.total).toBe(1000);
    // Y el esperado recalculado ya NO coincide con el guardado: eso es
    // exactamente lo que el documento tiene que hacer visible.
    expect(c.efectivoEsperado).not.toBe(c.session.expectedCash);
  });

  it("trae las líneas de cada remito con su lista de precio", async () => {
    await db.update(productVariants).set({ priceWholesale: 700 }).where(eq(productVariants.id, vId));
    await vender(2, { items: [{ variantId: vId, quantity: 2, priceList: "mayorista" }] });

    const c = (await getCashSessionClose(db, store, sessionId))!;
    const linea = c.remitos[0].lineas[0];
    expect(linea.priceList).toBe("mayorista");
    expect(linea.unitPrice).toBe(700);
    expect(linea.neto).toBe(1400);
  });

  it("una caja sin ventas devuelve el documento igual, vacío", async () => {
    const c = (await getCashSessionClose(db, store, sessionId))!;
    expect(c.remitos).toEqual([]);
    expect(c.porMedio).toEqual([]);
    expect(c.efectivoEsperado).toBe(5000); // solo la apertura
  });
});
