import { describe, it, expect, beforeEach } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import { createTestDb, seedTestStore, seedTestUser } from "./helpers/db";
import {
  cashSessions, clients, clientAccountMovements, diningTables, orderItems, orders,
  notifications, products, productVariants, salePayments, sales, saleItems, stockMovements,
} from "@/db/schema";
import { closeCashSession, openCashSession } from "@/domain/cash";
import {
  abrirOrden, agregarItem, anularItem, cambiarCantidad, cambiarComensales, cambiarNota, cancelarOrden,
  crearMesa, dividirItem, faltaStock, getOrden,
  listarMesas, listarOrdenesAbiertas, pagarOrden, resumenDeCuenta, ventasDeOrden,
} from "@/domain/orders";
import { voidSale } from "@/domain/sales";
import { comandasPendientes, mandarACocina, sinMandar } from "@/domain/kitchen";

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
    .values({ storeId: store, name: "Milanesa", basePrice: 8000, tracksStock: false, station: "cocina" }).returning();
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
    await cancelarOrden(db, { storeId: store, userId: "u1", orderId: primera.id });
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

    await expect(cancelarOrden(db, { storeId: store, userId: "u1", orderId: o.id })).rejects.toThrow("ORDEN_CON_PAGOS");
  });
});

describe("notas de cocina y comensales", () => {
  it("guarda y borra la nota de una línea", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));

    await cambiarNota(db, { storeId: store, orderId: o.id, itemId: item.id, notes: "  sin sal  " });
    const [conNota] = await db.select().from(orderItems).where(eq(orderItems.id, item.id));
    expect(conNota.notes).toBe("sin sal");

    await cambiarNota(db, { storeId: store, orderId: o.id, itemId: item.id, notes: "   " });
    const [sinNota] = await db.select().from(orderItems).where(eq(orderItems.id, item.id));
    expect(sinNota.notes).toBeNull();
  });

  it("la nota se puede poner al agregar", async () => {
    const o = await abrir();
    await agregarItem(db, {
      storeId: store, orderId: o.id, variantId: milanesa, quantity: 1, notes: "a punto",
    });
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    expect(item.notes).toBe("a punto");
  });

  it("no se puede anotar un ítem ya cobrado", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    await cobrar(o.id);

    await expect(
      cambiarNota(db, { storeId: store, orderId: o.id, itemId: item.id, notes: "tarde" }),
    ).rejects.toThrow("ORDEN_CERRADA");
  });

  it("guarda los comensales", async () => {
    const o = await abrir();
    const actualizada = await cambiarComensales(db, { storeId: store, orderId: o.id, guests: 4 });
    expect(actualizada.guests).toBe(4);

    const vaciada = await cambiarComensales(db, { storeId: store, orderId: o.id, guests: null });
    expect(vaciada.guests).toBeNull();
  });

  it("rechaza una cantidad de comensales absurda", async () => {
    const o = await abrir();
    await expect(
      cambiarComensales(db, { storeId: store, orderId: o.id, guests: 0 }),
    ).rejects.toThrow("INVALID_QUANTITY");
    await expect(
      cambiarComensales(db, { storeId: store, orderId: o.id, guests: 2.5 }),
    ).rejects.toThrow("INVALID_QUANTITY");
  });

  it("no cruza tiendas", async () => {
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    const o = await abrir();
    await expect(
      cambiarComensales(db, { storeId: store2, orderId: o.id, guests: 2 }),
    ).rejects.toThrow("ORDEN_NO_ENCONTRADA");
  });
});

describe("descuento al cobrar", () => {
  it("el descuento general se aplica sobre la venta", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 2 });

    const r = await cobrar(o.id, { saleDiscount: { kind: "amount", value: 1000 } });
    expect(r.sale.total).toBe(15000);
    expect(r.sale.discountAmount).toBe(1000);
  });

  it("un descuento no dispara el aviso de cambio de precio", async () => {
    // El aviso compara contra la cuenta YA descontada: un descuento
    // intencional no es una divergencia de catálogo.
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 2 });

    const r = await cobrar(o.id, { saleDiscount: { kind: "percent", value: 10 } });
    expect(r.sale.total).toBe(14400);
    expect(r.avisoDePrecio).toBeUndefined();
  });
});

describe("dividirItem", () => {
  it("parte una línea en dos sin cambiar el total", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 3 });
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));

    const orden = await dividirItem(db, {
      storeId: store, orderId: o.id, itemId: item.id, cantidad: 1,
    });

    expect(orden.total).toBe(24000); // 3 × 8000, la misma plata
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.quantity).sort()).toEqual([1, 2]);
  });

  it("la línea nueva hereda precio, nombre y nota", async () => {
    const o = await abrir();
    await agregarItem(db, {
      storeId: store, orderId: o.id, variantId: milanesa, quantity: 2, notes: "sin sal",
    });
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    await dividirItem(db, { storeId: store, orderId: o.id, itemId: item.id, cantidad: 1 });

    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    expect(items.every((i) => i.notes === "sin sal")).toBe(true);
    expect(items.every((i) => i.unitPrice === 8000)).toBe(true);
    expect(items.every((i) => i.nameSnapshot === "Milanesa")).toBe(true);
  });

  it("partir algo que ya está en cocina no lo vuelve a mandar", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 2 });
    await mandarACocina(db, { storeId: store, orderId: o.id });
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));

    await dividirItem(db, { storeId: store, orderId: o.id, itemId: item.id, cantidad: 1 });

    // Si la línea nueva naciera sin sentAt, la cocina recibiría otra milanesa.
    expect(await sinMandar(db, store, o.id)).toBe(0);
    const [comanda] = await comandasPendientes(db, store);
    expect(comanda.lineas.reduce((a, l) => a + l.quantity, 0)).toBe(2);
  });

  it("no se puede partir por todo ni por más de lo que hay", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 2 });
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));

    for (const cantidad of [2, 5]) {
      await expect(
        dividirItem(db, { storeId: store, orderId: o.id, itemId: item.id, cantidad }),
      ).rejects.toThrow("CANTIDAD_NO_DIVISIBLE");
    }
    await expect(
      dividirItem(db, { storeId: store, orderId: o.id, itemId: item.id, cantidad: 0 }),
    ).rejects.toThrow("INVALID_QUANTITY");
  });

  it("no se puede partir algo ya cobrado", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 2 });
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: remera, quantity: 1 });
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    await cobrar(o.id, { itemIds: [items[0].id] });

    await expect(
      dividirItem(db, { storeId: store, orderId: o.id, itemId: items[0].id, cantidad: 1 }),
    ).rejects.toThrow("ITEM_YA_COBRADO");
  });

  it("partido, cada mitad se cobra por separado", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 2 });
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    await dividirItem(db, { storeId: store, orderId: o.id, itemId: item.id, cantidad: 1 });

    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    const uno = await cobrar(o.id, { itemIds: [items[0].id] });
    expect(uno.parcial).toBe(true);
    expect(uno.sale.total).toBe(8000);

    const dos = await cobrar(o.id, { itemIds: [items[1].id], paymentMethod: "tarjeta" });
    expect(dos.parcial).toBe(false);
    expect(dos.sale.total).toBe(8000);
  });

  it("no cruza tiendas", async () => {
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 2 });
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));

    await expect(
      dividirItem(db, { storeId: store2, orderId: o.id, itemId: item.id, cantidad: 1 }),
    ).rejects.toThrow("ORDEN_NO_ENCONTRADA");
  });
});

describe("resumenDeCuenta", () => {
  it("con la mesa entera impaga, todo es pendiente", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 2 });

    const r = (await resumenDeCuenta(db, store, o.id))!;
    expect(r.total).toBe(16000);
    expect(r.cobrado).toBe(0);
    expect(r.pendiente).toBe(16000);
    expect(r.pagos).toEqual([]);
  });

  it("después de tres tandas con métodos distintos, cierra", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: remera, quantity: 1 });
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));

    await cobrar(o.id, { itemIds: [items[0].id] });
    await cobrar(o.id, { itemIds: [items[1].id], paymentMethod: "tarjeta" });
    await cobrar(o.id, { itemIds: [items[2].id], paymentMethod: "transferencia" });

    const r = (await resumenDeCuenta(db, store, o.id))!;
    expect(r.total).toBe(21000); // 8000 + 5000 + 8000
    expect(r.cobrado).toBe(21000);
    expect(r.pendiente).toBe(0);
    expect(r.pagos).toHaveLength(3);
    expect(r.pagos.map((p) => p.paymentMethod)).toEqual(["efectivo", "tarjeta", "transferencia"]);
  });

  it("lo cobrado sale de las ventas, así que refleja el descuento", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 2 });
    await cobrar(o.id, { saleDiscount: { kind: "amount", value: 1000 } });

    const r = (await resumenDeCuenta(db, store, o.id))!;
    // El consumo fue 16000 pero entraron 15000: la diferencia es el descuento,
    // y el resumen no puede decir que se cobraron 16000.
    expect(r.total).toBe(16000);
    expect(r.cobrado).toBe(15000);
    expect(r.pendiente).toBe(0);
  });

  it("una orden de otra tienda no existe", async () => {
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    const o = await abrir();
    expect(await resumenDeCuenta(db, store2, o.id)).toBeNull();
  });
});

describe("cancelarOrden", () => {
  it("no deja venta ni movimiento de stock", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: remera, quantity: 2 });
    await cancelarOrden(db, { storeId: store, userId: "u1", orderId: o.id });

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

describe("anular lo que ya está en la cocina", () => {
  const anular = (orderId: number, itemId: number, over: Record<string, unknown> = {}) =>
    anularItem(db, {
      storeId: store, orderId, itemId, userId: "u1", motivo: "Error de carga", ...over,
    });

  const conItemEnviado = async (quantity = 1) => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity });
    await mandarACocina(db, { storeId: store, orderId: o.id });
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    return { o, item };
  };

  const sinMandarDe = async (orderId: number) =>
    (await db.select().from(orderItems)
      .where(and(eq(orderItems.orderId, orderId), isNull(orderItems.sentAt))))[0];

  it("lo enviado no se borra ni se cambia la cantidad en el lugar", async () => {
    const { o, item } = await conItemEnviado(2);
    for (const quantity of [0, 1, 3]) {
      await expect(cambiarCantidad(db, { storeId: store, orderId: o.id, itemId: item.id, quantity }))
        .rejects.toThrow("ITEM_ENVIADO");
    }
    const [sigue] = await db.select().from(orderItems).where(eq(orderItems.id, item.id));
    expect(sigue.quantity).toBe(2);
  });

  it("anular entero deja la línea con quién y por qué, y fuera de la cuenta", async () => {
    const { o, item } = await conItemEnviado(1);
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: remera, quantity: 1 });

    const orden = await anular(o.id, item.id, { wasted: true });
    expect(orden.total).toBe(5000);

    const [anulada] = await db.select().from(orderItems).where(eq(orderItems.id, item.id));
    expect(anulada.voidedAt).not.toBeNull();
    expect(anulada.voidedBy).toBe("u1");
    expect(anulada.voidReason).toBe("Error de carga");
    expect(anulada.wasted).toBe(true);

    // Al cobrar, lo anulado no entra en la venta.
    const r = await cobrar(o.id);
    expect(r.sale.total).toBe(5000);
    expect(r.orden.status).toBe("pagada");
    const [sigueAnulada] = await db.select().from(orderItems).where(eq(orderItems.id, item.id));
    expect(sigueAnulada.saleId).toBeNull();
  });

  it("anular una parte parte la línea y anula solo esa parte", async () => {
    const { o, item } = await conItemEnviado(3);
    const orden = await anular(o.id, item.id, { cantidad: 1 });
    expect(orden.total).toBe(16000);

    const lineas = await db.select().from(orderItems)
      .where(eq(orderItems.orderId, o.id)).orderBy(orderItems.id);
    expect(lineas).toHaveLength(2);
    // La original conserva id y estado de cocina; la anulada es la nueva.
    expect(lineas[0]).toMatchObject({ id: item.id, quantity: 2, voidedAt: null });
    expect(lineas[0].sentAt).not.toBeNull();
    expect(lineas[1].quantity).toBe(1);
    expect(lineas[1].voidedAt).not.toBeNull();
    expect(lineas[1].sentAt).toEqual(lineas[0].sentAt);
  });

  it("rechaza lo que no corresponde", async () => {
    const { o, item } = await conItemEnviado(2);
    await expect(anular(o.id, item.id, { motivo: "  x " })).rejects.toThrow("MOTIVO_REQUERIDO");
    await expect(anular(o.id, item.id, { cantidad: 3 })).rejects.toThrow("INVALID_QUANTITY");
    await expect(anular(o.id, item.id, { cantidad: 0 })).rejects.toThrow("INVALID_QUANTITY");

    await agregarItem(db, { storeId: store, orderId: o.id, variantId: remera, quantity: 1 });
    const nuevo = await sinMandarDe(o.id);
    await expect(anular(o.id, nuevo.id)).rejects.toThrow("ITEM_NO_ENVIADO");

    await anular(o.id, item.id);
    await expect(anular(o.id, item.id)).rejects.toThrow("ITEM_ANULADO");
    await expect(cambiarNota(db, { storeId: store, orderId: o.id, itemId: item.id, notes: "x" }))
      .rejects.toThrow("ITEM_ANULADO");
    await expect(dividirItem(db, { storeId: store, orderId: o.id, itemId: item.id, cantidad: 1 }))
      .rejects.toThrow("ITEM_ANULADO");
  });

  it("no se anula lo que ya se cobró", async () => {
    const { o, item } = await conItemEnviado(1);
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: remera, quantity: 1 });
    await cobrar(o.id, { itemIds: [item.id] });
    await expect(anular(o.id, item.id)).rejects.toThrow("ITEM_YA_COBRADO");
  });

  it("una mesa con todo anulado no se cobra", async () => {
    const { o, item } = await conItemEnviado(1);
    await anular(o.id, item.id);
    await expect(cobrar(o.id)).rejects.toThrow("ORDEN_SIN_ITEMS");
  });

  it("el resumen de la cuenta no cuenta lo anulado", async () => {
    const { o, item } = await conItemEnviado(2);
    await anular(o.id, item.id, { cantidad: 1 });
    const r = await resumenDeCuenta(db, store, o.id);
    expect(r).toMatchObject({ total: 8000, pendiente: 8000, cobrado: 0 });
  });

  it("cambiar la nota de algo enviado queda marcado para la cocina", async () => {
    const { o, item } = await conItemEnviado(1);
    await cambiarNota(db, { storeId: store, orderId: o.id, itemId: item.id, notes: "bien cocida" });
    const [enviado] = await db.select().from(orderItems).where(eq(orderItems.id, item.id));
    expect(enviado.modifiedAt).not.toBeNull();

    await agregarItem(db, { storeId: store, orderId: o.id, variantId: remera, quantity: 1 });
    const nuevo = await sinMandarDe(o.id);
    await cambiarNota(db, { storeId: store, orderId: o.id, itemId: nuevo.id, notes: "fría" });
    const [noEnviado] = await db.select().from(orderItems).where(eq(orderItems.id, nuevo.id));
    expect(noEnviado.modifiedAt).toBeNull();
  });

  it("la base no acepta una anulación a medias", async () => {
    const { item } = await conItemEnviado(1);
    await expect(
      db.update(orderItems).set({ voidedAt: new Date() }).where(eq(orderItems.id, item.id)),
    ).rejects.toThrow();
  });
});

describe("cancelar una mesa con cosas en la cocina", () => {
  it("sin motivo no se cancela", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await mandarACocina(db, { storeId: store, orderId: o.id });
    await expect(cancelarOrden(db, { storeId: store, userId: "u1", orderId: o.id }))
      .rejects.toThrow("MOTIVO_REQUERIDO");
    const [sigue] = await db.select().from(orders).where(eq(orders.id, o.id));
    expect(sigue.status).toBe("abierta");
  });

  it("con motivo anula lo enviado, deja lo no enviado como estaba y registra quién", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await mandarACocina(db, { storeId: store, orderId: o.id });
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: remera, quantity: 1 });

    await cancelarOrden(db, {
      storeId: store, userId: "u1", orderId: o.id, motivo: "Se fueron", wasted: true,
    });

    const [orden] = await db.select().from(orders).where(eq(orders.id, o.id));
    expect(orden).toMatchObject({ status: "cancelada", cancelledBy: "u1", cancelReason: "Se fueron" });

    const lineas = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    const enviada = lineas.find((l) => l.sentAt != null)!;
    const noEnviada = lineas.find((l) => l.sentAt == null)!;
    expect(enviada).toMatchObject({ voidReason: "Se fueron", wasted: true });
    expect(noEnviada.voidedAt).toBeNull();
  });

  it("una mesa sin nada enviado se cancela sin motivo", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await cancelarOrden(db, { storeId: store, userId: "u1", orderId: o.id });
    const [orden] = await db.select().from(orders).where(eq(orders.id, o.id));
    expect(orden.status).toBe("cancelada");
  });
});

describe("cobro de mesa: varios medios, reintentos y anulaciones", () => {
  const conDosMilanesas = async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 2 });
    return o;
  };

  it("cobra con dos medios en la misma tanda", async () => {
    const o = await conDosMilanesas();
    const r = await pagarOrden(db, {
      storeId: store, orderId: o.id, userId: "u1",
      pagos: [{ method: "efectivo", amount: 6000 }, { method: "tarjeta", amount: 10000 }],
    });
    expect(r.sale.total).toBe(16000);
    expect(r.orden.status).toBe("pagada");
    const pagos = await db.select().from(salePayments).where(eq(salePayments.saleId, r.sale.id));
    expect(pagos.map((p) => [p.method, p.amount]).sort()).toEqual([["efectivo", 6000], ["tarjeta", 10000]]);
  });

  it("si los pagos no suman el total no cobra nada y la mesa queda igual", async () => {
    const o = await conDosMilanesas();
    await expect(pagarOrden(db, {
      storeId: store, orderId: o.id, userId: "u1",
      pagos: [{ method: "efectivo", amount: 6000 }, { method: "tarjeta", amount: 9000 }],
    })).rejects.toThrow("PAYMENT_TOTAL_MISMATCH");
    const [orden] = await db.select().from(orders).where(eq(orders.id, o.id));
    expect(orden.status).toBe("abierta");
    expect(await db.select().from(sales)).toHaveLength(0);
  });

  it("reintentar con el mismo uid devuelve el mismo cobro, no otro", async () => {
    const o = await conDosMilanesas();
    const uid = "9b2f6c1e-1d2a-4c3b-8e4f-5a6b7c8d9e0f";
    const a = await cobrar(o.id, { uid });
    const b = await cobrar(o.id, { uid });
    expect(b.sale.id).toBe(a.sale.id);
    expect(b.parcial).toBe(false);
    expect(await db.select().from(sales)).toHaveLength(1);
  });

  it("dos cobros de la misma mesa a la vez dan una sola venta", async () => {
    const o = await conDosMilanesas();
    const resultados = await Promise.allSettled([cobrar(o.id), cobrar(o.id)]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(sales)).toHaveLength(1);
  });

  it("lo servido se cobra aunque el stock cargado no alcance, y avisa al dueño", async () => {
    const o = await abrir();
    // Hay 6 botellas cargadas y la mesa tomó 8.
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: remera, quantity: 8 });
    const r = await cobrar(o.id);
    expect(r.sale.total).toBe(40000);

    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, remera));
    expect(v.stock).toBe(-2);
    const avisos = await db.select().from(notifications).where(eq(notifications.type, "stock_negativo"));
    expect(avisos).toHaveLength(1);
    expect(avisos[0].stockAtCreate).toBe(-2);
  });

  it("avisa al cargar si lo pedido supera el stock, sin bloquear", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: remera, quantity: 5 });
    expect(await faltaStock(db, { storeId: store, orderId: o.id, variantId: remera })).toBeNull();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: remera, quantity: 2 });
    expect(await faltaStock(db, { storeId: store, orderId: o.id, variantId: remera }))
      .toEqual({ disponible: 6, pedido: 7 });
    // Un plato no lleva stock: nunca avisa.
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 50 });
    expect(await faltaStock(db, { storeId: store, orderId: o.id, variantId: milanesa })).toBeNull();
  });

  it("anular una tanda devuelve sus ítems a la mesa y se pueden volver a cobrar", async () => {
    const o = await abrir();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: remera, quantity: 1 });
    const [mila] = await db.select().from(orderItems)
      .where(and(eq(orderItems.orderId, o.id), eq(orderItems.variantId, milanesa)));

    const tanda = await cobrar(o.id, { itemIds: [mila.id], paymentMethod: "tarjeta" });
    await cobrar(o.id);
    const [cerrada] = await db.select().from(orders).where(eq(orders.id, o.id));
    expect(cerrada.status).toBe("pagada");

    await voidSale(db, { storeId: store, saleId: tanda.sale.id, userId: "u1", reason: "Era efectivo" });

    const [reabierta] = await db.select().from(orders).where(eq(orders.id, o.id));
    expect(reabierta.status).toBe("a_cobrar");
    expect(reabierta.closedAt).toBeNull();
    const [liberada] = await db.select().from(orderItems).where(eq(orderItems.id, mila.id));
    expect(liberada.saleId).toBeNull();

    // La venta anulada no cuenta como cobrada.
    expect(await ventasDeOrden(db, store, o.id)).toHaveLength(1);
    const resumen = await resumenDeCuenta(db, store, o.id);
    expect(resumen).toMatchObject({ cobrado: 5000, pendiente: 8000 });

    const otra = await cobrar(o.id, { paymentMethod: "efectivo" });
    expect(otra.orden.status).toBe("pagada");
  });

  it("si la mesa ya está ocupada, la orden reabierta vuelve sin mesa", async () => {
    const o = await conDosMilanesas();
    const r = await cobrar(o.id);
    const nueva = await abrir();

    await voidSale(db, { storeId: store, saleId: r.sale.id, userId: "u1", reason: "Error de cobro" });

    const [vieja] = await db.select().from(orders).where(eq(orders.id, o.id));
    expect(vieja).toMatchObject({ status: "abierta", tableId: null });
    const [actual] = await db.select().from(orders).where(eq(orders.id, nueva.id));
    expect(actual.tableId).toBe(mesa);
  });
});
