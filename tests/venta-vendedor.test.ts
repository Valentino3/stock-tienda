import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedTestStore, seedTestUser } from "./helpers/db";
import {
  products, productVariants, sales, stockMovements, clientAccountMovements, user,
} from "@/db/schema";
import { openCashSession } from "@/domain/cash";
import { createSale } from "@/domain/sales";
import { createClient } from "@/domain/clients";

/**
 * A quién se le acredita una venta, y quién la anotó.
 *
 * `sellerId` es el eje comercial: `getSellerSalesSummary` agrupa por ahí y
 * sobre eso se liquidan las comisiones. Como el mostrador ahora deja elegirlo,
 * el id llega del navegador — y ahí se paga plata. `registeredBy` es el eje
 * operativo y sale siempre de la sesión.
 *
 * Lo que estos tests fijan es el reparto: qué columna recibe cuál de los dos.
 * Confundirlas no rompe nada de forma visible, y por eso hay que pincharlas.
 */

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number, variantId: number;

const PRECIO = 1000;

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "duenio", "owner", store);
  await seedTestUser(db, "ana", "employee", store);
  await seedTestUser(db, "beto", "employee", store);

  const [p] = await db.insert(products)
    .values({ storeId: store, name: "Sobre", basePrice: PRECIO }).returning();
  const [v] = await db.insert(productVariants)
    .values({ storeId: store, productId: p.id, name: "", stock: 100 }).returning();
  variantId = v.id;

  await openCashSession(db, { storeId: store, userId: "ana", openingCash: 0 });
});

const vender = (extra: Record<string, unknown> = {}) =>
  createSale(db, {
    storeId: store,
    sellerId: "beto",
    registeredBy: "ana",
    paymentMethod: "efectivo",
    items: [{ variantId, quantity: 1 }],
    ...extra,
  });

describe("vendedor acreditado y quien anota", () => {
  it("acredita al vendedor elegido y deja registrado quién lo anotó", async () => {
    const venta = await vender();
    const [fila] = await db.select().from(sales).where(eq(sales.id, venta.id));
    expect(fila.sellerId).toBe("beto");
    expect(fila.registeredBy).toBe("ana");
  });

  it("sin registeredBy, el vendedor se anotó la venta él mismo", async () => {
    // La propiedad de no-regresión: es lo único que podía pasar antes de esta
    // feature, y es por donde entran gastronomía, el replay offline y los seeds.
    const venta = await createSale(db, {
      storeId: store, sellerId: "beto", paymentMethod: "efectivo",
      items: [{ variantId, quantity: 1 }],
    });
    const [fila] = await db.select().from(sales).where(eq(sales.id, venta.id));
    expect(fila.sellerId).toBe("beto");
    expect(fila.registeredBy).toBe("beto");
  });

  it("el movimiento de stock queda a nombre de quien operó, no del acreditado", async () => {
    // Es la misma columna que escriben los ajustes y las reposiciones, y la
    // única pregunta que se le hace es cuando falta stock. Atribuir el egreso a
    // un compañero ausente convierte el libro de stock en una coartada.
    const venta = await vender();
    const [mov] = await db.select().from(stockMovements)
      .where(eq(stockMovements.saleId, venta.id));
    expect(mov.userId).toBe("ana");
  });

  it("el cargo en cuenta corriente queda a nombre de quien lo asentó", async () => {
    const clientId = (await createClient(db, { storeId: store, name: "Cliente" })).id;
    const venta = await vender({ paymentMethod: "cuenta", clientId });
    const [cargo] = await db.select().from(clientAccountMovements)
      .where(eq(clientAccountMovements.saleId, venta.id));
    expect(cargo.type).toBe("cargo");
    expect(cargo.createdBy).toBe("ana");
  });
});

describe("el vendedor elegido se valida contra la tienda", () => {
  it("rechaza un vendedor de otra tienda y no deja la venta a medias", async () => {
    // Sin esta guarda, un POST a mano acredita una venta al empleado de otro
    // comercio: es una fuga entre tiendas, no solo una comisión mal puesta.
    const otra = await seedTestStore(db, "t2", "Otra");
    await seedTestUser(db, "ajeno", "employee", otra);

    await expect(vender({ sellerId: "ajeno" })).rejects.toThrow("SELLER_NOT_IN_STORE");
    expect(await db.select().from(sales)).toHaveLength(0);
  });

  it("rechaza un vendedor desactivado", async () => {
    await db.update(user).set({ banned: true }).where(eq(user.id, "beto"));
    await expect(vender()).rejects.toThrow("SELLER_INACTIVE");
  });

  it("rechaza un vendedor que no existe", async () => {
    await expect(vender({ sellerId: "fantasma" })).rejects.toThrow("SELLER_NOT_IN_STORE");
  });
});

describe("idempotencia", () => {
  const uid = "11111111-2222-3333-4444-555555555555";

  it("el vendedor no es parte de la clave: el reintento devuelve la venta original", async () => {
    const primera = await vender({ uid });
    const reintento = await vender({ uid, sellerId: "duenio" });

    expect(reintento.id).toBe(primera.id);
    expect(reintento.duplicada).toBe(true);
    // Y NO se reatribuyó: la venta ya está cobrada y su comisión ya es de beto.
    expect(reintento.sellerId).toBe("beto");
  });

  it("un reintento entra aunque el vendedor haya quedado desactivado en el medio", async () => {
    // La guarda va después del corto-circuito por uid a propósito: esa venta ya
    // está cobrada, y rechazar el reintento haría cobrar dos veces.
    await vender({ uid });
    await db.update(user).set({ banned: true }).where(eq(user.id, "beto"));

    const reintento = await vender({ uid });
    expect(reintento.duplicada).toBe(true);
  });
});
