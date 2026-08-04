import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { products, productVariants, sales, saleItems, stockMovements } from "@/db/schema";
import { openCashSession } from "@/domain/cash";
import { replayLote, replayProductos, type ProductoOffline } from "@/domain/sales-replay";
import { and, eq } from "drizzle-orm";

/**
 * Productos cargados en una feria, sin conexión.
 *
 * El riesgo específico de este camino: el dispositivo no puede conocer el id que
 * va a asignar la secuencia, así que la venta referencia la variante por uid. Si
 * esa resolución falla, la venta tiene que NO entrar — nunca colgarse de una
 * variante equivocada.
 */

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;
let sessionId: number;

const P_UID = "11111111-1111-4111-8111-111111111111";
const V_UID = "22222222-2222-4222-8222-222222222222";
const VENTA_UID = "33333333-3333-4333-8333-333333333333";

const producto = (over: Partial<ProductoOffline> = {}): ProductoOffline => ({
  uid: P_UID, variantUid: V_UID, name: "Llavero de feria", basePrice: 500, stock: 3, ...over,
});

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);
  const caja = await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
  sessionId = caja.id;
});

describe("replayProductos", () => {
  it("crea el producto con su variante y el stock declarado", async () => {
    const [r] = await replayProductos(db, { storeId: store, productos: [producto()] });

    expect(r.estado).toBe("aplicado");
    const [p] = await db.select().from(products).where(eq(products.storeId, store));
    expect(p.name).toBe("Llavero de feria");
    expect(p.basePrice).toBe(500);
    expect(p.uid).toBe(P_UID);

    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, r.variantId!));
    expect(v.stock).toBe(3);
    expect(v.uid).toBe(V_UID);
    expect(v.productId).toBe(p.id);
  });

  it("reenviar el lote no crea el producto dos veces", async () => {
    const primero = await replayProductos(db, { storeId: store, productos: [producto()] });
    const segundo = await replayProductos(db, { storeId: store, productos: [producto()] });

    expect(segundo[0].estado).toBe("duplicado");
    expect(segundo[0].variantId).toBe(primero[0].variantId);
    expect(await db.select().from(products).where(eq(products.storeId, store))).toHaveLength(1);
  });

  it("un SKU que ya existe no pierde el producto: se crea sin SKU y avisa", async () => {
    const [p] = await db.insert(products).values({ storeId: store, name: "Viejo", basePrice: 10 }).returning();
    await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "", sku: "DUP-1", stock: 1 });

    const [r] = await replayProductos(db, { storeId: store, productos: [producto({ sku: "DUP-1" })] });

    expect(r.estado).toBe("aplicado");
    expect(r.avisos.some((a) => /ya existía/.test(a))).toBe(true);
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, r.variantId!));
    expect(v.sku).toBeNull();
  });

  it("un SKU libre se guarda", async () => {
    const [r] = await replayProductos(db, { storeId: store, productos: [producto({ sku: "NUEVO-1" })] });
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, r.variantId!));
    expect(v.sku).toBe("NUEVO-1");
  });

  it("el uid es por tienda", async () => {
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    await replayProductos(db, { storeId: store, productos: [producto()] });
    const [r] = await replayProductos(db, { storeId: store2, productos: [producto()] });
    expect(r.estado).toBe("aplicado");
  });

  it("rechaza datos inválidos sin dejar el producto a medias", async () => {
    const casos: [string, ProductoOffline][] = [
      ["EMPTY_NAME", producto({ name: "   " })],
      ["INVALID_PRICE", producto({ basePrice: -1 })],
      ["INVALID_QUANTITY", producto({ stock: -2 })],
      ["INVALID_QUANTITY", producto({ stock: 1.5 })],
      ["UID_REQUERIDO", producto({ variantUid: "" })],
    ];
    for (const [esperado, p] of casos) {
      const [r] = await replayProductos(db, { storeId: store, productos: [p] });
      expect(r.estado).toBe("error");
      expect(r.error).toBe(esperado);
    }
    expect(await db.select().from(products).where(eq(products.storeId, store))).toHaveLength(0);
  });
});

describe("replayLote con productos nuevos", () => {
  const ventaConUid = {
    uid: VENTA_UID,
    capturadoEn: new Date().toISOString(),
    cashSessionId: 0, // se completa en cada test
    paymentMethod: "efectivo" as const,
    items: [{ variantUid: V_UID, quantity: 2, unitPrice: 500 }],
  };

  it("crea el producto y le imputa la venta que lo referencia por uid", async () => {
    const r = await replayLote(db, {
      storeId: store, sellerId: "u1",
      productos: [producto()],
      ventas: [{ ...ventaConUid, cashSessionId: sessionId }],
    });

    expect(r.resumen.productosCreados).toBe(1);
    expect(r.ventas[0].estado).toBe("aplicada");
    expect(r.ventas[0].total).toBe(1000);

    const variantId = r.productos[0].variantId!;
    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, r.ventas[0].saleId!));
    expect(items[0].variantId).toBe(variantId);

    // Stock declarado 3, vendidas 2.
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
    expect(v.stock).toBe(1);
  });

  it("vender más de lo declarado deja stock negativo y avisa, no pierde la venta", async () => {
    const r = await replayLote(db, {
      storeId: store, sellerId: "u1",
      productos: [producto({ stock: 0 })],
      ventas: [{ ...ventaConUid, cashSessionId: sessionId }],
    });

    expect(r.ventas[0].estado).toBe("aplicada");
    expect(r.ventas[0].avisos.some((a) => /Stock negativo/.test(a))).toBe(true);
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, r.productos[0].variantId!));
    expect(v.stock).toBe(-2);
  });

  it("si el producto no se pudo crear, la venta NO entra", async () => {
    const r = await replayLote(db, {
      storeId: store, sellerId: "u1",
      productos: [producto({ name: "  " })],
      ventas: [{ ...ventaConUid, cashSessionId: sessionId }],
    });

    expect(r.productos[0].estado).toBe("error");
    expect(r.ventas[0].estado).toBe("error");
    expect(r.ventas[0].error).toBe("VARIANT_NOT_FOUND");
    expect(await db.select().from(sales).where(eq(sales.storeId, store))).toHaveLength(0);
    expect(await db.select().from(stockMovements)).toHaveLength(0);
  });

  it("una venta con variantUid desconocido se rechaza", async () => {
    const r = await replayLote(db, {
      storeId: store, sellerId: "u1",
      ventas: [{ ...ventaConUid, cashSessionId: sessionId }],
    });
    expect(r.ventas[0].estado).toBe("error");
    expect(r.ventas[0].error).toBe("VARIANT_NOT_FOUND");
  });

  it("reenviar el lote entero es inocuo", async () => {
    const lote = {
      storeId: store, sellerId: "u1",
      productos: [producto()],
      ventas: [{ ...ventaConUid, cashSessionId: sessionId }],
    };
    await replayLote(db, lote);
    const segundo = await replayLote(db, lote);

    expect(segundo.productos[0].estado).toBe("duplicado");
    expect(segundo.ventas[0].estado).toBe("duplicada");
    expect(await db.select().from(products).where(eq(products.storeId, store))).toHaveLength(1);
    expect(await db.select().from(sales).where(eq(sales.storeId, store))).toHaveLength(1);

    const [v] = await db.select().from(productVariants).where(eq(productVariants.storeId, store));
    expect(v.stock).toBe(1); // descontado una sola vez
  });

  it("una venta puede mezclar productos del catálogo y cargados sin conexión", async () => {
    const [p] = await db.insert(products).values({ storeId: store, name: "Del catálogo", basePrice: 200 }).returning();
    const [v] = await db.insert(productVariants)
      .values({ storeId: store, productId: p.id, name: "", stock: 10 }).returning();

    const r = await replayLote(db, {
      storeId: store, sellerId: "u1",
      productos: [producto()],
      ventas: [{
        ...ventaConUid, cashSessionId: sessionId,
        items: [
          { variantId: v.id, quantity: 1, unitPrice: 200 },
          { variantUid: V_UID, quantity: 1, unitPrice: 500 },
        ],
      }],
    });

    expect(r.ventas[0].estado).toBe("aplicada");
    expect(r.ventas[0].total).toBe(700);
    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, r.ventas[0].saleId!));
    expect(items).toHaveLength(2);
    const [existente] = await db.select().from(productVariants).where(eq(productVariants.id, v.id));
    expect(existente.stock).toBe(9);
  });

  it("el producto nuevo queda buscable en el catálogo de la tienda", async () => {
    await replayLote(db, { storeId: store, sellerId: "u1", productos: [producto()], ventas: [] });
    const filas = await db.select().from(products)
      .where(and(eq(products.storeId, store), eq(products.active, true)));
    expect(filas.map((f) => f.name)).toContain("Llavero de feria");
  });
});
