import { describe, it, expect, beforeEach } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createTestDb, seedTestStore, seedTestUser } from "./helpers/db";
import {
  cashSessions, clients, clientAccountMovements, diningTables, orderItems, orders,
  products, productVariants, sales, saleItems, stockMovements,
} from "@/db/schema";
import { closeCashSession, openCashSession } from "@/domain/cash";
import {
  abrirOrden, agregarItem, cambiarCantidad, cancelarOrden, crearMesa, getOrden,
  listarMesas, listarOrdenesAbiertas, pagarOrden,
} from "@/domain/orders";

/**
 * Órdenes del salón.
 *
 * La tesis de toda la vertical: `pagarOrden` llama al `createSale` de siempre
 * y desde ese instante la venta es indistinguible de una de mostrador. Si eso
 * es cierto, caja, reportes, cuenta corriente y ARCA funcionan sin tocar nada.
 * Estos tests son la prueba.
 */

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;
let mesa: number;
let milanesa: number;
let remera: number; // producto que SÍ lleva stock, para el camino mixto

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);

  const m = await crearMesa(db, { storeId: store, name: "1", capacity: 4 });
  mesa = m.id;

  const [pm] = await db.insert(products)
    .values({ storeId: store, name: "Milanesa", basePrice: 8000, tracksStock: false }).returning();
  milanesa = (await db.insert(productVariants)
    .values({ storeId: store, productId: pm.id, name: "", stock: 0 }).returning())[0].id;

  const [pr] = await db.insert(products)
    .values({ storeId: store, name: "Vino", basePrice: 5000, tracksStock: true }).returning();
  remera = (await db.insert(productVariants)
    .values({ storeId: store, productId: pr.id, name: "Malbec", stock: 6 }).returning())[0].id;

  await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
});

const abrir = (over: { tableId?: number | null; uid?: string } = {}) =>
  abrirOrden(db, { storeId: store, userId: "u1", tableId: mesa, ...over });

const cobrar = (orderId: number, over: Record<string, unknown> = {}) =>
  pagarOrden(db, {
    storeId: store, orderId, userId: "u1", paymentMethod: "efectivo", ...over,
  });

describe("abrirOrden", () => {
  it("abre una orden en una mesa", async () => {
    const o = await abrir();
    expect(o.status).toBe("abierta");
    expect(o.tableId).toBe(mesa);
    expect(o.total).toBe(0);
  });

  it("la misma mesa no puede tener dos órdenes vivas", async () => {
    await abrir();
    await expect(abrir()).rejects.toThrow("MESA_YA_OCUPADA");
  });

  it("el índice de la base atrapa la carrera, no solo el pre-chequeo", async () => {
    // Se saltea el chequeo de la aplicación insertando directo: lo que tiene
    // que rechazar la segunda es orders_una_abierta_por_mesa_idx.
    await abrir();
    await expect(
      db.insert(orders).values({ storeId: store, tableId: mesa, openedBy: "u1" }),
    ).rejects.toThrow();
  });

  it("liberada la mesa, se puede volver a abrir", async () => {
    const primera = await abrir();
    await agregarItem(db, { storeId: store, orderId: primera.id, variantId: milanesa, quantity: 1 });
    await cobrar(primera.id);

    const segunda = await abrir();
    expect(segunda.id).not.toBe(primera.id);
  });

  it("cancelar también libera la mesa", async () => {
    const primera = await abrir();
    await cancelarOrden(db, { storeId: store, orderId: primera.id });
    await expect(abrir()).resolves.toBeDefined();
  });

  it("varias órdenes de mostrador conviven: tableId null no choca consigo mismo", async () => {
    const a = await abrir({ tableId: null });
    const b = await abrir({ tableId: null });
    const c = await abrir({ tableId: null });
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
  });

  it("es idempotente por uid", async () => {
    const uid = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
    const a = await abrir({ uid });
    const b = await abrir({ uid });
    expect(b.id).toBe(a.id);
    expect(await db.select().from(orders).where(eq(orders.storeId, store))).toHaveLength(1);
  });

  it("rechaza una mesa de otra tienda", async () => {
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    const ajena = await crearMesa(db, { storeId: store2, name: "1" });
    await expect(
      abrirOrden(db, { storeId: store, userId: "u1", tableId: ajena.id }),
    ).rejects.toThrow("MESA_NO_ENCONTRADA");
  });
});

describe("agregarItem y cambiarCantidad", () => {
  it("suma ítems y recalcula el total en el servidor", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 2 });
    const conVino = await agregarItem(db, { storeId: store, orderId: o.id, variantId: remera, quantity: 1 });

    expect(conVino.total).toBe(21000); // 2×8000 + 1×5000
  });

  it("congela el nombre al pedir", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: remera, quantity: 1 });
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    expect(item.nameSnapshot).toBe("Vino — Malbec");
  });

  it("cambiar la cantidad recalcula", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));

    const actualizada = await cambiarCantidad(db, {
      storeId: store, orderId: o.id, itemId: item.id, quantity: 3,
    });
    expect(actualizada.total).toBe(24000);
  });

  it("cantidad 0 borra la línea", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));

    const vacia = await cambiarCantidad(db, { storeId: store, orderId: o.id, itemId: item.id, quantity: 0 });
    expect(vacia.total).toBe(0);
    expect(await db.select().from(orderItems).where(eq(orderItems.orderId, o.id))).toHaveLength(0);
  });

  it("agregar NO mueve stock: eso pasa recién al cobrar", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: remera, quantity: 2 });

    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, remera));
    expect(v.stock).toBe(6);
    expect(await db.select().from(stockMovements)).toHaveLength(0);
  });

  it("no se puede agregar a una orden ya cobrada", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await cobrar(o.id);

    await expect(
      agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 }),
    ).rejects.toThrow("ORDEN_CERRADA");
  });

  it("rechaza una orden de otra tienda", async () => {
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    await seedTestUser(db, "u2", "owner", store2);
    const ajena = await abrirOrden(db, { storeId: store2, userId: "u2", tableId: null });

    await expect(
      agregarItem(db, { storeId: store, orderId: ajena.id, variantId: milanesa, quantity: 1 }),
    ).rejects.toThrow("ORDEN_NO_ENCONTRADA");
  });
});

describe("pagarOrden — la venta resultante es una venta común", () => {
  it("crea UNA venta con el total de la orden y las deja vinculadas", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 2 });
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: remera, quantity: 1 });

    const r = await cobrar(o.id);

    expect(r.parcial).toBe(false);
    expect(r.sale.total).toBe(21000);
    expect(r.sale.orderId).toBe(o.id);
    expect(r.orden.status).toBe("pagada");
    expect(r.orden.closedAt).not.toBeNull();

    const ventas = await db.select().from(sales).where(eq(sales.storeId, store));
    expect(ventas).toHaveLength(1);
  });

  it("descuenta stock solo de lo que lleva control", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 2 });
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: remera, quantity: 2 });
    await cobrar(o.id);

    const [vino] = await db.select().from(productVariants).where(eq(productVariants.id, remera));
    const [mila] = await db.select().from(productVariants).where(eq(productVariants.id, milanesa));
    expect(vino.stock).toBe(4);
    expect(mila.stock).toBe(0);
    expect(await db.select().from(stockMovements)).toHaveLength(1);
  });

  it("agrupa por variante: dos pedidos del mismo plato son una línea de dos", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });

    const r = await cobrar(o.id);
    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, r.sale.id));
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
    expect(r.sale.total).toBe(16000);
  });

  it("estampa el saleId en los ítems cobrados", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    const r = await cobrar(o.id);

    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    expect(items.every((i) => i.saleId === r.sale.id)).toBe(true);
  });

  it("la venta entra en el cierre de caja como cualquier otra", async () => {
    const [caja] = await db.select().from(cashSessions).where(eq(cashSessions.storeId, store));
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 2 });
    await cobrar(o.id);

    const cerrada = await closeCashSession(db, {
      storeId: store, sessionId: caja.id, userId: "u1", countedCash: 16000,
    });
    expect(cerrada.expectedCash).toBe(16000);
    expect(cerrada.difference).toBe(0);
  });

  it("una venta a cuenta carga la deuda del cliente", async () => {
    const [c] = await db.insert(clients).values({ storeId: store, name: "Ana" }).returning();
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });

    await cobrar(o.id, { paymentMethod: "cuenta", clientId: c.id });

    const movs = await db.select().from(clientAccountMovements)
      .where(eq(clientAccountMovements.clientId, c.id));
    expect(movs).toHaveLength(1);
    expect(movs[0].amount).toBe(8000);
  });

  it("sin caja abierta NO cobra y la orden queda intacta", async () => {
    const [caja] = await db.select().from(cashSessions).where(eq(cashSessions.storeId, store));
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await closeCashSession(db, { storeId: store, sessionId: caja.id, userId: "u1", countedCash: 0 });

    await expect(cobrar(o.id)).rejects.toThrow("NO_OPEN_SESSION");

    // Rollback completo: ni venta, ni ítems estampados, ni orden cerrada.
    const [despues] = await db.select().from(orders).where(eq(orders.id, o.id));
    expect(despues.status).toBe("abierta");
    expect(despues.closedAt).toBeNull();
    expect(await db.select().from(sales).where(eq(sales.storeId, store))).toHaveLength(0);
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    expect(items.every((i) => i.saleId === null)).toBe(true);
  });

  it("una orden vacía no se cobra", async () => {
    const o = await abrir();
    await expect(cobrar(o.id)).rejects.toThrow("ORDEN_SIN_ITEMS");
  });

  it("avisa si el precio del menú cambió con la mesa abierta", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    // El dueño retoca la carta mientras la mesa consume.
    await db.update(products).set({ basePrice: 9000 }).where(eq(products.name, "Milanesa"));

    const r = await cobrar(o.id);

    // Se cobra lo que resuelve el servidor, que es la fuente de verdad...
    expect(r.sale.total).toBe(9000);
    // ...pero el cajero se entera de que el papel decía otra cosa.
    expect(r.avisoDePrecio).toEqual({ totalEnLaCuenta: 8000, totalCobrado: 9000 });
  });

  it("sin cambios de precio no hay aviso", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 2 });
    const r = await cobrar(o.id);
    expect(r.avisoDePrecio).toBeUndefined();
  });

  it("rechaza cobrar una orden de otra tienda", async () => {
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    await seedTestUser(db, "u2", "owner", store2);
    const ajena = await abrirOrden(db, { storeId: store2, userId: "u2", tableId: null });

    await expect(cobrar(ajena.id)).rejects.toThrow("ORDEN_NO_ENCONTRADA");
  });
});

describe("pagos parciales — la base de dividir la cuenta", () => {
  it("cobrar una parte deja la orden viva y el resto impago", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: remera, quantity: 1 });
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));

    const r1 = await cobrar(o.id, { itemIds: [items[0].id] });

    expect(r1.parcial).toBe(true);
    expect(r1.sale.total).toBe(8000);
    expect(r1.orden.status).toBe("a_cobrar");

    const despues = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    expect(despues.filter((i) => i.saleId != null)).toHaveLength(1);
  });

  it("el segundo pago cierra la orden, con dos ventas distintas", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: remera, quantity: 1 });
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));

    const r1 = await cobrar(o.id, { itemIds: [items[0].id] });
    const r2 = await cobrar(o.id, { itemIds: [items[1].id], paymentMethod: "tarjeta" });

    expect(r2.parcial).toBe(false);
    expect(r2.orden.status).toBe("pagada");
    expect(r2.sale.id).not.toBe(r1.sale.id);

    const ventas = await db.select().from(sales).where(eq(sales.orderId, o.id));
    expect(ventas).toHaveLength(2);
    expect(ventas.reduce((a, v) => a + v.total, 0)).toBe(13000);
  });

  it("no se puede cambiar un ítem ya cobrado", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: remera, quantity: 1 });
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    await cobrar(o.id, { itemIds: [items[0].id] });

    await expect(
      cambiarCantidad(db, { storeId: store, orderId: o.id, itemId: items[0].id, quantity: 5 }),
    ).rejects.toThrow("ITEM_YA_COBRADO");
  });

  it("una orden con pagos parciales no se puede cancelar", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: remera, quantity: 1 });
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    await cobrar(o.id, { itemIds: [items[0].id] });

    await expect(cancelarOrden(db, { storeId: store, orderId: o.id })).rejects.toThrow("ORDEN_CON_PAGOS");
  });
});

describe("cancelarOrden", () => {
  it("no deja venta ni movimiento de stock", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: remera, quantity: 2 });
    await cancelarOrden(db, { storeId: store, orderId: o.id });

    const [despues] = await db.select().from(orders).where(eq(orders.id, o.id));
    expect(despues.status).toBe("cancelada");
    expect(await db.select().from(sales).where(eq(sales.storeId, store))).toHaveLength(0);
    expect(await db.select().from(stockMovements)).toHaveLength(0);
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, remera));
    expect(v.stock).toBe(6);
  });
});

describe("lecturas del salón", () => {
  it("listarOrdenesAbiertas trae las vivas con su mesa", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });

    const abiertas = await listarOrdenesAbiertas(db, store);
    expect(abiertas).toHaveLength(1);
    expect(abiertas[0].tableName).toBe("1");
    expect(abiertas[0].total).toBe(8000);
  });

  it("no trae las cerradas", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await cobrar(o.id);
    expect(await listarOrdenesAbiertas(db, store)).toHaveLength(0);
  });

  it("listarMesas dice cuál está ocupada", async () => {
    await crearMesa(db, { storeId: store, name: "2" });
    const o = await abrir();

    const mesas = await listarMesas(db, store);
    expect(mesas).toHaveLength(2);
    const ocupada = mesas.find((m) => m.mesa.id === mesa);
    const libre = mesas.find((m) => m.mesa.name === "2");
    expect(ocupada?.orden?.id).toBe(o.id);
    expect(libre?.orden).toBeNull();
  });

  it("getOrden trae ítems y mesa", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });

    const detalle = await getOrden(db, store, o.id);
    expect(detalle?.items).toHaveLength(1);
    expect(detalle?.mesa?.name).toBe("1");
  });

  it("getOrden no cruza tiendas", async () => {
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    const o = await abrir();
    expect(await getOrden(db, store2, o.id)).toBeNull();
  });

  it("no se pueden repetir nombres de mesa en el mismo sector", async () => {
    await expect(crearMesa(db, { storeId: store, name: "1" })).rejects.toThrow("MESA_DUPLICADA");
  });

  it("el mismo nombre en otro sector sí se puede", async () => {
    await expect(crearMesa(db, { storeId: store, name: "1", sector: "Terraza" })).resolves.toBeDefined();
  });
});
