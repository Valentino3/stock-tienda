import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import {
  products, productVariants, sales, saleItems, stockMovements, clients,
  clientAccountMovements, notifications,
} from "@/db/schema";
import { closeCashSession, openCashSession } from "@/domain/cash";
import { createSale } from "@/domain/sales";
import { replayLote, replaySale, replayClientes, uidsYaSincronizados, type VentaOffline } from "@/domain/sales-replay";
import { and, eq } from "drizzle-orm";

/**
 * Replay de ventas cobradas sin conexión.
 *
 * El invariante que importa: reenviar un lote nunca puede duplicar plata ni
 * stock, y nada que salga raro puede pasar en silencio.
 */

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;
let vId: number, vId2: number;
let sessionId: number;

const UID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const UID2 = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const CLIENT_UID = "cccccccc-3333-4333-8333-cccccccccccc";

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);
  const [p] = await db.insert(products).values({ storeId: store, name: "Remera", basePrice: 1000 }).returning();
  const [v1] = await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "M", stock: 5 }).returning();
  const [v2] = await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "L", stock: 2, price: 1200 }).returning();
  vId = v1.id; vId2 = v2.id;
  const caja = await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
  sessionId = caja.id;
});

const ventaOffline = (over: Partial<VentaOffline> = {}): VentaOffline => ({
  uid: UID,
  capturadoEn: new Date().toISOString(),
  cashSessionId: sessionId,
  paymentMethod: "efectivo",
  items: [{ variantId: vId, quantity: 2, unitPrice: 1000 }],
  ...over,
});

const replay = (venta: VentaOffline) =>
  replaySale(db, { storeId: store, sellerId: "u1", venta });

describe("replaySale", () => {
  it("registra la venta con el precio capturado y descuenta stock", async () => {
    const r = await replay(ventaOffline());

    expect(r.estado).toBe("aplicada");
    expect(r.total).toBe(2000);
    expect(r.avisos).toEqual([]);

    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, vId));
    expect(v.stock).toBe(3);
    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, r.saleId!));
    expect(items[0].unitPrice).toBe(1000);
  });

  it("usa la fecha capturada, no la de sincronización", async () => {
    const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const r = await replay(ventaOffline({ capturadoEn: ayer.toISOString() }));

    const [s] = await db.select().from(sales).where(eq(sales.id, r.saleId!));
    expect(Math.abs(s.createdAt.getTime() - ayer.getTime())).toBeLessThan(2000);
  });

  it("acota una fecha absurda del dispositivo y avisa", async () => {
    const r = await replay(ventaOffline({ capturadoEn: "1999-01-01T10:00:00.000Z" }));

    expect(r.estado).toBe("aplicada");
    expect(r.avisos.some((a) => /atrasado/.test(a))).toBe(true);
    const [s] = await db.select().from(sales).where(eq(sales.id, r.saleId!));
    expect(s.createdAt.getFullYear()).toBeGreaterThan(2020);
  });

  it("acota un reloj adelantado", async () => {
    const dentroDeUnAnio = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const r = await replay(ventaOffline({ capturadoEn: dentroDeUnAnio.toISOString() }));

    expect(r.avisos.some((a) => /adelantado/.test(a))).toBe(true);
    const [s] = await db.select().from(sales).where(eq(sales.id, r.saleId!));
    expect(s.createdAt.getTime()).toBeLessThan(Date.now() + 60_000);
  });

  it("reenviar el mismo uid no duplica nada", async () => {
    const primera = await replay(ventaOffline());
    const segunda = await replay(ventaOffline());

    expect(segunda.estado).toBe("duplicada");
    expect(segunda.saleId).toBe(primera.saleId);

    const filas = await db.select().from(sales).where(eq(sales.storeId, store));
    expect(filas).toHaveLength(1);
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, vId));
    expect(v.stock).toBe(3); // descontado una sola vez
  });

  it("una venta con stock insuficiente ENTRA y deja el stock negativo con aviso", async () => {
    // La mercadería ya salió del local y ya se cobró: rechazarla no devuelve
    // las unidades, solo pierde el registro.
    const r = await replay(ventaOffline({ items: [{ variantId: vId, quantity: 8, unitPrice: 1000 }] }));

    expect(r.estado).toBe("aplicada");
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, vId));
    expect(v.stock).toBe(-3);
    expect(r.avisos.some((a) => /Stock negativo/.test(a))).toBe(true);

    const avisos = await db.select().from(notifications).where(eq(notifications.storeId, store));
    expect(avisos).toHaveLength(1);
    expect(avisos[0].type).toBe("stock_negativo");
    expect(avisos[0].status).toBe("open");
  });

  it("avisa cuando el precio capturado difiere del actual, pero cobra el capturado", async () => {
    await db.update(productVariants).set({ price: 1500 }).where(eq(productVariants.id, vId));
    const r = await replay(ventaOffline());

    expect(r.total).toBe(2000); // 2 × 1000 capturado, no 1500
    expect(r.avisos.some((a) => /Precio distinto/.test(a))).toBe(true);
  });

  it("entra en la caja donde se vendió aunque ya esté cerrada, y avisa", async () => {
    await closeCashSession(db, { storeId: store, sessionId, userId: "u1", countedCash: 0 });
    const r = await replay(ventaOffline());

    expect(r.estado).toBe("aplicada");
    const [s] = await db.select().from(sales).where(eq(sales.id, r.saleId!));
    expect(s.cashSessionId).toBe(sessionId);
    expect(r.avisos.some((a) => /ya estaba cerrada/.test(a))).toBe(true);

    const avisos = await db.select().from(notifications)
      .where(and(eq(notifications.storeId, store), eq(notifications.type, "venta_post_cierre")));
    expect(avisos).toHaveLength(1);
  });

  it("rechaza una caja de otra tienda", async () => {
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    await seedTestUser(db, "u2", "owner", store2);
    const ajena = await openCashSession(db, { storeId: store2, userId: "u2", openingCash: 0 });

    const r = await replay(ventaOffline({ cashSessionId: ajena.id }));
    expect(r.estado).toBe("error");
    expect(r.error).toBe("CASH_SESSION_NOT_FOUND");
  });

  it("rechaza una variante de otra tienda", async () => {
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    const [p2] = await db.insert(products).values({ storeId: store2, name: "Ajeno", basePrice: 10 }).returning();
    const [v2] = await db.insert(productVariants).values({ storeId: store2, productId: p2.id, name: "U", stock: 9 }).returning();

    const r = await replay(ventaOffline({ items: [{ variantId: v2.id, quantity: 1, unitPrice: 10 }] }));
    expect(r.estado).toBe("error");
    expect(r.error).toBe("VARIANT_NOT_FOUND");

    const [sinTocar] = await db.select().from(productVariants).where(eq(productVariants.id, v2.id));
    expect(sinTocar.stock).toBe(9);
  });

  it("una venta con error no deja rastro parcial", async () => {
    await replay(ventaOffline({ items: [{ variantId: 99999, quantity: 1, unitPrice: 10 }] }));

    const filas = await db.select().from(sales).where(eq(sales.storeId, store));
    expect(filas).toHaveLength(0);
    const movs = await db.select().from(stockMovements);
    expect(movs).toHaveLength(0);
  });

  it("aplica descuentos de línea y generales igual que el camino online", async () => {
    // Mismo carrito por los dos caminos: los totales tienen que coincidir.
    const online = await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "efectivo",
      items: [{ variantId: vId, quantity: 2, discount: { kind: "percent", value: 10 } }],
      saleDiscount: { kind: "amount", value: 100 },
    });
    const offline = await replay(ventaOffline({
      uid: UID2,
      items: [{ variantId: vId, quantity: 2, unitPrice: 1000, discount: { kind: "percent", value: 10 } }],
      saleDiscount: { kind: "amount", value: 100 },
    }));

    expect(offline.total).toBe(online.total);
  });
});

describe("replayLote", () => {
  it("crea el cliente offline y le imputa la venta a cuenta", async () => {
    const r = await replayLote(db, {
      storeId: store, sellerId: "u1",
      clientes: [{ uid: CLIENT_UID, name: "Ana Feria", phone: "11" }],
      ventas: [ventaOffline({ paymentMethod: "cuenta", clientUid: CLIENT_UID })],
    });

    expect(r.clientes[0].estado).toBe("aplicado");
    expect(r.ventas[0].estado).toBe("aplicada");

    const clientId = r.clientes[0].clientId!;
    const movs = await db.select().from(clientAccountMovements).where(eq(clientAccountMovements.clientId, clientId));
    expect(movs).toHaveLength(1);
    expect(movs[0].amount).toBe(2000);
  });

  it("reenviar el lote entero es inocuo", async () => {
    const lote = {
      storeId: store, sellerId: "u1",
      clientes: [{ uid: CLIENT_UID, name: "Ana Feria" }],
      ventas: [
        ventaOffline({ paymentMethod: "cuenta", clientUid: CLIENT_UID }),
        ventaOffline({ uid: UID2, items: [{ variantId: vId2, quantity: 1, unitPrice: 1200 }] }),
      ],
    };
    const primera = await replayLote(db, lote);
    const segunda = await replayLote(db, lote);

    expect(primera.resumen).toEqual({ aplicadas: 2, duplicadas: 0, errores: 0, conAvisos: 0, productosCreados: 0 });
    expect(segunda.resumen).toEqual({ aplicadas: 0, duplicadas: 2, errores: 0, conAvisos: 0, productosCreados: 0 });
    expect(segunda.clientes[0].estado).toBe("duplicado");
    expect(segunda.clientes[0].clientId).toBe(primera.clientes[0].clientId);

    const filas = await db.select().from(sales).where(eq(sales.storeId, store));
    expect(filas).toHaveLength(2);
    const cli = await db.select().from(clients).where(eq(clients.storeId, store));
    expect(cli).toHaveLength(1);
    const movs = await db.select().from(clientAccountMovements).where(eq(clientAccountMovements.storeId, store));
    expect(movs).toHaveLength(1);
  });

  it("una venta rota no frena a las demás", async () => {
    const r = await replayLote(db, {
      storeId: store, sellerId: "u1",
      ventas: [
        ventaOffline({ items: [{ variantId: 99999, quantity: 1, unitPrice: 10 }] }),
        ventaOffline({ uid: UID2 }),
      ],
    });

    expect(r.resumen.errores).toBe(1);
    expect(r.resumen.aplicadas).toBe(1);
    expect(r.ventas[1].estado).toBe("aplicada");
  });

  it("una venta a cuenta con un cliente que falló no se registra a medias", async () => {
    const r = await replayLote(db, {
      storeId: store, sellerId: "u1",
      clientes: [{ uid: CLIENT_UID, name: "   " }], // nombre vacío: falla
      ventas: [ventaOffline({ paymentMethod: "cuenta", clientUid: CLIENT_UID })],
    });

    expect(r.clientes[0].estado).toBe("error");
    expect(r.ventas[0].estado).toBe("error");
    expect(r.ventas[0].error).toBe("CLIENT_NOT_FOUND");
    const filas = await db.select().from(sales).where(eq(sales.storeId, store));
    expect(filas).toHaveLength(0);
  });

  it("cuenta las ventas que entraron con avisos", async () => {
    const r = await replayLote(db, {
      storeId: store, sellerId: "u1",
      ventas: [ventaOffline({ items: [{ variantId: vId, quantity: 99, unitPrice: 1000 }] })],
    });
    expect(r.resumen).toEqual({ aplicadas: 1, duplicadas: 0, errores: 0, conAvisos: 1, productosCreados: 0 });
  });
});

describe("replayClientes", () => {
  it("es idempotente por uid y no pisa los datos del existente", async () => {
    await replayClientes(db, { storeId: store, clientes: [{ uid: CLIENT_UID, name: "Ana" }] });
    const r = await replayClientes(db, { storeId: store, clientes: [{ uid: CLIENT_UID, name: "Otra" }] });

    expect(r[0].estado).toBe("duplicado");
    const cli = await db.select().from(clients).where(eq(clients.storeId, store));
    expect(cli).toHaveLength(1);
    expect(cli[0].name).toBe("Ana");
  });

  it("el uid es por tienda", async () => {
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    await replayClientes(db, { storeId: store, clientes: [{ uid: CLIENT_UID, name: "Ana" }] });
    const r = await replayClientes(db, { storeId: store2, clientes: [{ uid: CLIENT_UID, name: "Ana de otra tienda" }] });

    expect(r[0].estado).toBe("aplicado");
  });
});

describe("uidsYaSincronizados", () => {
  it("devuelve solo los que ya están en esta tienda", async () => {
    await replay(ventaOffline());

    const encontrados = await uidsYaSincronizados(db, store, [UID, UID2]);
    expect(encontrados).toEqual([UID]);
  });

  it("no filtra uids de otra tienda", async () => {
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    await replay(ventaOffline());

    expect(await uidsYaSincronizados(db, store2, [UID])).toEqual([]);
  });

  it("tolera la lista vacía", async () => {
    expect(await uidsYaSincronizados(db, store, [])).toEqual([]);
  });
});

describe("replaySale con listas de precio", () => {
  it("guarda la lista y respeta el precio capturado, sin recotizar", async () => {
    await db.update(productVariants).set({ priceWholesale: 700 })
      .where(eq(productVariants.id, vId));

    const r = await replay(ventaOffline({
      items: [{ variantId: vId, quantity: 2, unitPrice: 700, priceList: "mayorista" }],
    }));

    expect(r.estado).toBe("aplicada");
    expect(r.total).toBe(1400); // el capturado, no 2×1000
    const [item] = await db.select().from(saleItems).where(eq(saleItems.saleId, r.saleId!));
    expect(item.priceList).toBe("mayorista");
    expect(item.unitPrice).toBe(700);
  });

  it("NO avisa deriva cuando el capturado coincide con su lista", async () => {
    // Es la trampa: comparando contra el precio de venta (1000) este caso
    // avisaría, y una feria entera de ventas mayoristas llenaría la bandeja
    // de avisos falsos, que es como se deja de mirarla.
    await db.update(productVariants).set({ priceWholesale: 700 })
      .where(eq(productVariants.id, vId));

    const r = await replay(ventaOffline({
      items: [{ variantId: vId, quantity: 1, unitPrice: 700, priceList: "mayorista" }],
    }));
    expect(r.avisos).toEqual([]);
  });

  it("sí avisa cuando la lista cambió de precio mientras tanto", async () => {
    await db.update(productVariants).set({ priceWholesale: 800 })
      .where(eq(productVariants.id, vId));

    const r = await replay(ventaOffline({
      items: [{ variantId: vId, quantity: 1, unitPrice: 700, priceList: "mayorista" }],
    }));
    expect(r.avisos.some((a) => /Precio distinto/.test(a))).toBe(true);
  });

  it("avisa distinto si la lista ya no está cargada", async () => {
    const r = await replay(ventaOffline({
      items: [{ variantId: vId, quantity: 1, unitPrice: 700, priceList: "mayorista" }],
    }));
    expect(r.estado).toBe("aplicada"); // la venta entra igual: ya se cobró
    expect(r.avisos.some((a) => /ya no está cargada/.test(a))).toBe(true);
  });

  it("una venta de la cola vieja, sin lista, entra como venta", async () => {
    const r = await replay(ventaOffline());
    const [item] = await db.select().from(saleItems).where(eq(saleItems.saleId, r.saleId!));
    expect(item.priceList).toBe("venta");
  });

  it("rechaza una lista inventada sin abortar el lote con un error de Postgres", async () => {
    const r = await replay(ventaOffline({
      items: [{ variantId: vId, quantity: 1, unitPrice: 700, priceList: "regalada" as any }],
    }));
    expect(r.estado).toBe("error");
    expect(r.error).toBe("INVALID_PRICE_LIST");
  });
});
