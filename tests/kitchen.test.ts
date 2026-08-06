import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedTestStore, seedTestUser } from "./helpers/db";
import { orderItems, products, productVariants } from "@/db/schema";
import { openCashSession } from "@/domain/cash";
import { abrirOrden, agregarItem, crearMesa, pagarOrden } from "@/domain/orders";
import {
  comandasPendientes, estacionesDelMenu, mandarACocina, marcarImpresas, sinMandar,
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

  it("lo que no tiene estación aparece sin filtro pero no en una estación", async () => {
    const o = await nuevaOrden();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: flan, quantity: 1 });
    await mandarACocina(db, { storeId: store, orderId: o.id });

    expect(await comandasPendientes(db, store)).toHaveLength(1);
    expect(await comandasPendientes(db, store, { estacion: "cocina" })).toHaveLength(0);
  });

  it("una línea ya cobrada desaparece de cocina", async () => {
    const o = await nuevaOrden();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: flan, quantity: 1 });
    await mandarACocina(db, { storeId: store, orderId: o.id });

    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    await pagarOrden(db, {
      storeId: store, orderId: o.id, userId: "u1",
      paymentMethod: "efectivo", itemIds: [items[0].id],
    });

    const [c] = await comandasPendientes(db, store);
    expect(c.lineas).toHaveLength(1);
    expect(c.lineas[0].nombre).toBe("Flan");
  });

  it("una orden cobrada entera desaparece", async () => {
    const o = await nuevaOrden();
    await agregarItem(db, { storeId: store, orderId: o.id, variantId: milanesa, quantity: 1 });
    await mandarACocina(db, { storeId: store, orderId: o.id });
    await pagarOrden(db, { storeId: store, orderId: o.id, userId: "u1", paymentMethod: "efectivo" });

    expect(await comandasPendientes(db, store)).toHaveLength(0);
  });

  it("las más viejas primero", async () => {
    const a = await abrirOrden(db, { storeId: store, userId: "u1", tableId: null });
    await agregarItem(db, { storeId: store, orderId: a.id, variantId: milanesa, quantity: 1 });
    await mandarACocina(db, { storeId: store, orderId: a.id });

    const b = await abrirOrden(db, { storeId: store, userId: "u1", tableId: mesa });
    await agregarItem(db, { storeId: store, orderId: b.id, variantId: flan, quantity: 1 });
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
