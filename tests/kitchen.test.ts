import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedTestStore, seedTestUser } from "./helpers/db";
import { orderItems, products, productVariants } from "@/db/schema";
import { openCashSession } from "@/domain/cash";
import {
  abrirOrden, agregarItem, anularItem, cambiarNota, cancelarOrden, crearMesa, pagarOrden,
} from "@/domain/orders";
import {
  comandasPendientes, deshacerListo, estacionesDelMenu, mandarACocina, marcarAgotado,
  marcarCorreccionesVistas, marcarImpresas, marcarListo, platosParaAgotar, sinMandar,
  variantesAgotadas,
} from "@/domain/kitchen";

/**
 * Comandas de cocina.
 *
 * Lo que importa: mandar dos veces no puede duplicar la comanda, y nada que ya
 * se cobró puede seguir apareciendo para preparar.
 */

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;
let mesa: number;
let milanesa: number;  // estación cocina
let cerveza: number;   // estación barra
let flan: number;      // sin estación

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);
  mesa = (await crearMesa(db, { storeId: store, name: "1" })).id;

  const plato = async (nombre: string, precio: number, station: string | null) => {
    const [p] = await db.insert(products)
      .values({ storeId: store, name: nombre, basePrice: precio, tracksStock: false, station })
      .returning();
    const [v] = await db.insert(productVariants)
      .values({ storeId: store, productId: p.id, name: "", stock: 0 }).returning();
    return v.id;
  };

  milanesa = await plato("Milanesa", 8000, "cocina");
  cerveza = await plato("Cerveza", 4000, "barra");
  flan = await plato("Flan", 3000, null);

  await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
});

const nuevaOrden = () => abrirOrden(db, { storeId: store, userId: "u1", tableId: mesa });

describe("mandarACocina", () => {
  it("marca los ítems y dice cuántos salieron", async () => {
    const o = await nuevaOrden();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 2 });
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: cerveza, quantity: 1 });

    expect(await sinMandar(db, store, o.id)).toBe(2);
    expect(await mandarACocina(db, { storeId: store, orderId: o.id })).toBe(2);
    expect(await sinMandar(db, store, o.id)).toBe(0);
  });

  it("mandar de nuevo no vuelve a mandar lo mismo", async () => {
    const o = await nuevaOrden();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await mandarACocina(db, { storeId: store, orderId: o.id });

    expect(await mandarACocina(db, { storeId: store, orderId: o.id })).toBe(0);
    const comandas = await comandasPendientes(db, store);
    expect(comandas).toHaveLength(1);
    expect(comandas[0].lineas).toHaveLength(1);
  });

  it("lo agregado después se manda aparte, sin arrastrar lo anterior", async () => {
    const o = await nuevaOrden();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await mandarACocina(db, { storeId: store, orderId: o.id });

    // Llega el postre media hora después.
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: flan, quantity: 1 });
    expect(await sinMandar(db, store, o.id)).toBe(1);
    expect(await mandarACocina(db, { storeId: store, orderId: o.id })).toBe(1);
  });

  it("no manda nada de una orden cerrada", async () => {
    const o = await nuevaOrden();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await pagarOrden(db, { storeId: store, orderId: o.id, userId: "u1", paymentMethod: "efectivo" });

    await expect(
      mandarACocina(db, { storeId: store, orderId: o.id }),
    ).rejects.toThrow("ORDEN_CERRADA");
  });

  it("no cruza tiendas", async () => {
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    const o = await nuevaOrden();
    await expect(
      mandarACocina(db, { storeId: store2, orderId: o.id }),
    ).rejects.toThrow("ORDEN_NO_ENCONTRADA");
  });
});

describe("comandasPendientes", () => {
  it("no muestra lo que todavía no se mandó", async () => {
    const o = await nuevaOrden();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    expect(await comandasPendientes(db, store)).toHaveLength(0);
  });

  it("agrupa por orden y trae la mesa", async () => {
    const o = await nuevaOrden();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 2 });
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: cerveza, quantity: 1 });
    await mandarACocina(db, { storeId: store, orderId: o.id });

    const [c] = await comandasPendientes(db, store);
    expect(c.mesa).toBe("1");
    expect(c.lineas).toHaveLength(2);
    expect(c.lineas.find((l) => l.nombre === "Milanesa")?.quantity).toBe(2);
  });

  it("filtra por estación", async () => {
    const o = await nuevaOrden();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: cerveza, quantity: 1 });
    await mandarACocina(db, { storeId: store, orderId: o.id });

    const [barra] = await comandasPendientes(db, store, { estacion: "barra" });
    expect(barra.lineas.map((l) => l.nombre)).toEqual(["Cerveza"]);

    const [cocina] = await comandasPendientes(db, store, { estacion: "cocina" });
    expect(cocina.lineas.map((l) => l.nombre)).toEqual(["Milanesa"]);
  });

  it("lo que no tiene estación no va a ninguna pantalla y sale listo al mandarlo", async () => {
    const o = await nuevaOrden();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: flan, quantity: 1 });
    expect(await mandarACocina(db, { storeId: store, orderId: o.id })).toBe(1);

    expect(await comandasPendientes(db, store)).toHaveLength(0);
    expect(await comandasPendientes(db, store, { estacion: "cocina" })).toHaveLength(0);
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    expect(item.sentAt).not.toBeNull();
    expect(item.readyAt).toEqual(item.sentAt);
  });

  it("cobrar una parte de la mesa no saca de la cocina lo que todavía no salió", async () => {
    const o = await nuevaOrden();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: cerveza, quantity: 1 });
    await mandarACocina(db, { storeId: store, orderId: o.id });

    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    await pagarOrden(db, {
      storeId: store, orderId: o.id, userId: "u1",
      paymentMethod: "efectivo", itemIds: [items[0].id],
    });

    const [c] = await comandasPendientes(db, store);
    expect(c.lineas.map((l) => l.nombre).sort()).toEqual(["Cerveza", "Milanesa"]);
  });

  it("una mesa cobrada entera desaparece", async () => {
    const o = await nuevaOrden();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await mandarACocina(db, { storeId: store, orderId: o.id });
    await pagarOrden(db, { storeId: store, orderId: o.id, userId: "u1", paymentMethod: "efectivo" });

    expect(await comandasPendientes(db, store)).toHaveLength(0);
  });

  it("un pedido para llevar ya cobrado sigue en la cocina hasta que sale", async () => {
    const o = await abrirOrden(db, { storeId: store, userId: "u1", tableId: null });
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await mandarACocina(db, { storeId: store, orderId: o.id });
    const r = await pagarOrden(db, { storeId: store, orderId: o.id, userId: "u1", paymentMethod: "efectivo" });
    expect(r.orden.status).toBe("pagada");

    const [c] = await comandasPendientes(db, store);
    expect(c.lineas[0].nombre).toBe("Milanesa");

    await marcarListo(db, { storeId: store, itemIds: [c.lineas[0].itemId] });
    expect(await comandasPendientes(db, store)).toHaveLength(0);
  });

  it("las más viejas primero", async () => {
    const a = await abrirOrden(db, { storeId: store, userId: "u1", tableId: null });
    await agregarItem(db, { storeId: store, orderId: a.id, variantId: milanesa, quantity: 1 });
    await mandarACocina(db, { storeId: store, orderId: a.id });

    const b = await abrirOrden(db, { storeId: store, userId: "u1", tableId: mesa });
    await agregarItem(db, { storeId: store, orderId: b.id, variantId: cerveza, quantity: 1 });
    await mandarACocina(db, { storeId: store, orderId: b.id });

    const comandas = await comandasPendientes(db, store);
    expect(comandas.map((c) => c.orderId)).toEqual([a.id, b.id]);
  });

  it("no cruza tiendas", async () => {
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    const o = await nuevaOrden();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await mandarACocina(db, { storeId: store, orderId: o.id });
    expect(await comandasPendientes(db, store2)).toHaveLength(0);
  });
});

describe("marcarImpresas", () => {
  it("saca las líneas de la cola de impresión pero no de la pantalla", async () => {
    const o = await nuevaOrden();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await mandarACocina(db, { storeId: store, orderId: o.id });

    const [c] = await comandasPendientes(db, store, { soloSinImprimir: true });
    expect(await marcarImpresas(db, { storeId: store, itemIds: c.lineas.map((l) => l.itemId) })).toBe(1);

    // Ya no se reimprime...
    expect(await comandasPendientes(db, store, { soloSinImprimir: true })).toHaveLength(0);
    // ...pero el cocinero sigue viendo lo que está preparando.
    expect(await comandasPendientes(db, store)).toHaveLength(1);
  });

  it("marcar dos veces no cuenta dos veces", async () => {
    const o = await nuevaOrden();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await mandarACocina(db, { storeId: store, orderId: o.id });
    const [c] = await comandasPendientes(db, store);
    const ids = c.lineas.map((l) => l.itemId);

    expect(await marcarImpresas(db, { storeId: store, itemIds: ids })).toBe(1);
    expect(await marcarImpresas(db, { storeId: store, itemIds: ids })).toBe(0);
  });

  it("no marca ítems de otra tienda", async () => {
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    const o = await nuevaOrden();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await mandarACocina(db, { storeId: store, orderId: o.id });
    const [c] = await comandasPendientes(db, store);

    expect(await marcarImpresas(db, { storeId: store2, itemIds: c.lineas.map((l) => l.itemId) })).toBe(0);
  });

  it("la lista vacía no hace nada", async () => {
    expect(await marcarImpresas(db, { storeId: store, itemIds: [] })).toBe(0);
  });
});

describe("estacionesDelMenu", () => {
  it("lista las que usa el menú, ordenadas y sin repetir", async () => {
    expect(await estacionesDelMenu(db, store)).toEqual(["barra", "cocina"]);
  });

  it("una tienda sin estaciones devuelve vacío", async () => {
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    expect(await estacionesDelMenu(db, store2)).toEqual([]);
  });
});

describe("correcciones después de mandar", () => {
  const mandadaConMilanesa = async (quantity = 1) => {
    const o = await nuevaOrden();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity });
    await mandarACocina(db, { storeId: store, orderId: o.id });
    const [item] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    return { o, item };
  };

  it("lo anulado llega como ANULADO, con motivo, hasta que la cocina lo ve", async () => {
    const { o, item } = await mandadaConMilanesa();
    await marcarImpresas(db, { storeId: store, itemIds: [item.id] });
    await anularItem(db, {
      storeId: store, orderId: o.id, itemId: item.id, userId: "u1", motivo: "Cliente cambió",
    });

    const [c] = await comandasPendientes(db, store);
    expect(c.lineas).toHaveLength(1);
    expect(c.lineas[0]).toMatchObject({ anulada: true, motivoAnulacion: "Cliente cambió", porImprimir: true });

    expect(await marcarCorreccionesVistas(db, { storeId: store, itemIds: [item.id] })).toBe(1);
    expect(await comandasPendientes(db, store)).toEqual([]);
  });

  it("imprimir la corrección también es verla", async () => {
    const { o, item } = await mandadaConMilanesa();
    await marcarImpresas(db, { storeId: store, itemIds: [item.id] });
    await anularItem(db, {
      storeId: store, orderId: o.id, itemId: item.id, userId: "u1", motivo: "Error de carga",
    });

    const [paraImprimir] = await comandasPendientes(db, store, { soloSinImprimir: true });
    expect(paraImprimir.lineas.map((l) => l.itemId)).toEqual([item.id]);

    expect(await marcarImpresas(db, { storeId: store, itemIds: [item.id] })).toBe(1);
    expect(await comandasPendientes(db, store, { soloSinImprimir: true })).toEqual([]);
  });

  it("una anulación parcial deja la parte viva y avisa la anulada", async () => {
    const { o, item } = await mandadaConMilanesa(3);
    await anularItem(db, {
      storeId: store, orderId: o.id, itemId: item.id, userId: "u1", cantidad: 1, motivo: "Demora",
    });
    const [c] = await comandasPendientes(db, store);
    const viva = c.lineas.find((l) => !l.anulada)!;
    const anulada = c.lineas.find((l) => l.anulada)!;
    expect(viva.quantity).toBe(2);
    expect(anulada.quantity).toBe(1);
  });

  it("una mesa cancelada con cosas en cocina llega como cancelada", async () => {
    const { o, item } = await mandadaConMilanesa();
    await cancelarOrden(db, { storeId: store, userId: "u1", orderId: o.id, motivo: "Se fueron" });

    const [c] = await comandasPendientes(db, store);
    expect(c.cancelada).toBe(true);
    expect(c.lineas[0]).toMatchObject({ itemId: item.id, anulada: true });

    await marcarCorreccionesVistas(db, { storeId: store, itemIds: [item.id] });
    expect(await comandasPendientes(db, store)).toEqual([]);
  });

  it("una nota cambiada después de imprimir vuelve a salir como MODIF", async () => {
    const { o, item } = await mandadaConMilanesa();
    await marcarImpresas(db, { storeId: store, itemIds: [item.id] });
    expect(await comandasPendientes(db, store, { soloSinImprimir: true })).toEqual([]);

    await cambiarNota(db, { storeId: store, orderId: o.id, itemId: item.id, notes: "bien cocida" });
    const [c] = await comandasPendientes(db, store, { soloSinImprimir: true });
    expect(c.lineas[0]).toMatchObject({ modificada: true, notes: "bien cocida", porImprimir: true });

    await marcarImpresas(db, { storeId: store, itemIds: [item.id] });
    const [despues] = await comandasPendientes(db, store);
    expect(despues.lineas[0]).toMatchObject({ modificada: false, porImprimir: false });
  });

  it("lo anulado y ya visto no vuelve a aparecer aunque la mesa siga abierta", async () => {
    const { o, item } = await mandadaConMilanesa();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: cerveza, quantity: 1 });
    await mandarACocina(db, { storeId: store, orderId: o.id });
    await anularItem(db, {
      storeId: store, orderId: o.id, itemId: item.id, userId: "u1", motivo: "Error de carga",
    });
    await marcarCorreccionesVistas(db, { storeId: store, itemIds: [item.id] });

    const [c] = await comandasPendientes(db, store);
    expect(c.lineas.map((l) => l.nombre)).toEqual(["Cerveza"]);
  });

  it("no marca correcciones de otra tienda", async () => {
    const { o, item } = await mandadaConMilanesa();
    await anularItem(db, {
      storeId: store, orderId: o.id, itemId: item.id, userId: "u1", motivo: "Error de carga",
    });
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    expect(await marcarCorreccionesVistas(db, { storeId: store2, itemIds: [item.id] })).toBe(0);
  });
});

describe("listo y rondas", () => {
  it("lo marcado listo sale de la pantalla; deshacer lo devuelve", async () => {
    const o = await nuevaOrden();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: cerveza, quantity: 1 });
    await mandarACocina(db, { storeId: store, orderId: o.id });
    const [c] = await comandasPendientes(db, store);
    const mila = c.lineas.find((l) => l.nombre === "Milanesa")!;

    expect(await marcarListo(db, { storeId: store, itemIds: [mila.itemId] })).toBe(1);
    const [despues] = await comandasPendientes(db, store);
    expect(despues.lineas.map((l) => l.nombre)).toEqual(["Cerveza"]);

    // Marcar dos veces no cuenta dos veces.
    expect(await marcarListo(db, { storeId: store, itemIds: [mila.itemId] })).toBe(0);

    expect(await deshacerListo(db, { storeId: store, itemIds: [mila.itemId] })).toBe(1);
    const [devuelta] = await comandasPendientes(db, store);
    expect(devuelta.lineas).toHaveLength(2);
  });

  it("no marca lo que no se mandó, lo anulado ni lo de otra tienda", async () => {
    const o = await nuevaOrden();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    const [sinMandarItem] = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    expect(await marcarListo(db, { storeId: store, itemIds: [sinMandarItem.id] })).toBe(0);

    await mandarACocina(db, { storeId: store, orderId: o.id });
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    expect(await marcarListo(db, { storeId: store2, itemIds: [sinMandarItem.id] })).toBe(0);

    await anularItem(db, {
      storeId: store, orderId: o.id, itemId: sinMandarItem.id, userId: "u1", motivo: "Error de carga",
    });
    expect(await marcarListo(db, { storeId: store, itemIds: [sinMandarItem.id] })).toBe(0);
  });

  it("cada envío es una comanda aparte, con su propia espera", async () => {
    const o = await nuevaOrden();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await mandarACocina(db, { storeId: store, orderId: o.id });
    await new Promise((r) => setTimeout(r, 5));
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: cerveza, quantity: 1 });
    await mandarACocina(db, { storeId: store, orderId: o.id });

    const comandas = await comandasPendientes(db, store);
    expect(comandas).toHaveLength(2);
    expect(comandas.map((c) => c.orderId)).toEqual([o.id, o.id]);
    expect(comandas[0].clave).not.toBe(comandas[1].clave);
    expect(comandas.map((c) => c.lineas.map((l) => l.nombre))).toEqual([["Milanesa"], ["Cerveza"]]);
    expect(comandas[1].mandadaEn.getTime()).toBeGreaterThan(comandas[0].mandadaEn.getTime());
  });
});

describe("agotado", () => {
  const HOY = "2026-10-29";

  it("la cocina marca agotado por el día y lo desmarca", async () => {
    const [p] = await db.select({ id: products.id }).from(products).where(eq(products.name, "Milanesa"));
    await marcarAgotado(db, { storeId: store, productId: p.id, agotado: true, hoy: HOY });

    const carta = await platosParaAgotar(db, store, { hoy: HOY });
    expect(carta.find((x) => x.nombre === "Milanesa")?.agotado).toBe(true);
    expect(carta.find((x) => x.nombre === "Cerveza")?.agotado).toBe(false);
    expect(await variantesAgotadas(db, store, [milanesa, cerveza], HOY)).toEqual(new Set([milanesa]));

    await marcarAgotado(db, { storeId: store, productId: p.id, agotado: false, hoy: HOY });
    expect(await variantesAgotadas(db, store, [milanesa], HOY)).toEqual(new Set());
  });

  it("al día siguiente vuelve solo", async () => {
    const [p] = await db.select({ id: products.id }).from(products).where(eq(products.name, "Milanesa"));
    await marcarAgotado(db, { storeId: store, productId: p.id, agotado: true, hoy: HOY });
    expect(await variantesAgotadas(db, store, [milanesa], "2026-10-30")).toEqual(new Set());
    const carta = await platosParaAgotar(db, store, { hoy: "2026-10-30" });
    expect(carta.find((x) => x.nombre === "Milanesa")?.agotado).toBe(false);
  });

  it("filtra por estación y no cruza tiendas", async () => {
    const barra = await platosParaAgotar(db, store, { estacion: "barra", hoy: HOY });
    expect(barra.map((x) => x.nombre)).toEqual(["Cerveza"]);

    const [p] = await db.select({ id: products.id }).from(products).where(eq(products.name, "Milanesa"));
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    await expect(marcarAgotado(db, { storeId: store2, productId: p.id, agotado: true, hoy: HOY }))
      .rejects.toThrow("PRODUCTO_NO_ENCONTRADO");
  });

  it("no se puede agregar a una mesa algo agotado hoy", async () => {
    const [p] = await db.select({ id: products.id }).from(products).where(eq(products.name, "Milanesa"));
    await marcarAgotado(db, { storeId: store, productId: p.id, agotado: true });
    const o = await nuevaOrden();
    await expect(agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 }))
      .rejects.toThrow("PRODUCTO_AGOTADO");
    await expect(agregarItem(db, { storeId: store, orderId: o.id, variantId: cerveza, quantity: 1 }))
      .resolves.toBeDefined();
  });
});
