import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import {
  products, productVariants, sales, saleItems, stockMovements, clients, clientAccountMovements,
} from "@/db/schema";
import { closeCashSession, openCashSession } from "@/domain/cash";
import { createSale } from "@/domain/sales";
import { eq } from "drizzle-orm";

/**
 * Idempotencia de la venta (sales.uid).
 *
 * El escenario real: se corta la red justo después del COMMIT. La venta entró
 * pero el vendedor ve un error, y reintenta. Sin uid, cobra dos veces.
 */

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;
let vId: number;
let sessionId: number;

const UID = "0f1e2d3c-4b5a-4998-8877-665544332211";
const OTRO_UID = "11223344-5566-4788-99aa-bbccddeeff00";

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);
  const [p] = await db.insert(products).values({ storeId: store, name: "Remera", basePrice: 1000 }).returning();
  const [v] = await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "M", stock: 10 }).returning();
  vId = v.id;
  const caja = await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
  sessionId = caja.id;
});

const venta = (uid?: string, quantity = 2) =>
  createSale(db, {
    storeId: store, sellerId: "u1", paymentMethod: "efectivo",
    items: [{ variantId: vId, quantity }], uid,
  });

describe("createSale idempotente por uid", () => {
  it("el mismo uid dos veces registra UNA sola venta", async () => {
    const primera = await venta(UID);
    const segunda = await venta(UID);

    expect(segunda.id).toBe(primera.id);
    expect(segunda.duplicada).toBe(true);
    expect(primera.duplicada).toBeUndefined();

    const filas = await db.select().from(sales).where(eq(sales.storeId, store));
    expect(filas).toHaveLength(1);
  });

  it("el reintento no descuenta stock de nuevo", async () => {
    await venta(UID);
    await venta(UID);

    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, vId));
    expect(v.stock).toBe(8); // 10 - 2, una sola vez

    const movs = await db.select().from(stockMovements).where(eq(stockMovements.variantId, vId));
    expect(movs).toHaveLength(1);
  });

  it("el reintento no duplica los items de la venta", async () => {
    const { id } = await venta(UID);
    await venta(UID);

    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, id));
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
  });

  it("el reintento de una venta a cuenta no duplica el cargo en la cuenta corriente", async () => {
    const [c] = await db.insert(clients).values({ storeId: store, name: "Ana" }).returning();
    const input = {
      storeId: store, sellerId: "u1", paymentMethod: "cuenta" as const,
      clientId: c.id, items: [{ variantId: vId, quantity: 3 }], uid: UID,
    };
    const primera = await createSale(db, input);
    const segunda = await createSale(db, input);

    expect(segunda.id).toBe(primera.id);
    const movs = await db.select().from(clientAccountMovements)
      .where(eq(clientAccountMovements.clientId, c.id));
    expect(movs).toHaveLength(1);
    expect(movs[0].amount).toBe(3000);
  });

  it("uids distintos registran ventas distintas", async () => {
    const a = await venta(UID);
    const b = await venta(OTRO_UID);

    expect(b.id).not.toBe(a.id);
    expect(b.duplicada).toBeUndefined();
    const filas = await db.select().from(sales).where(eq(sales.storeId, store));
    expect(filas).toHaveLength(2);
  });

  it("sin uid mantiene el comportamiento histórico: dos ventas", async () => {
    await venta(undefined);
    await venta(undefined);

    const filas = await db.select().from(sales).where(eq(sales.storeId, store));
    expect(filas).toHaveLength(2);
    expect(filas.every((f) => f.uid === null)).toBe(true);
  });

  it("el uid es por tienda: la misma clave en otra tienda es otra venta", async () => {
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    await seedTestUser(db, "u2", "owner", store2);
    await openCashSession(db, { storeId: store2, userId: "u2", openingCash: 0 });
    const [p2] = await db.insert(products).values({ storeId: store2, name: "Gorra", basePrice: 500 }).returning();
    const [v2] = await db.insert(productVariants).values({ storeId: store2, productId: p2.id, name: "U", stock: 5 }).returning();

    const a = await venta(UID);
    const b = await createSale(db, {
      storeId: store2, sellerId: "u2", paymentMethod: "efectivo",
      items: [{ variantId: v2.id, quantity: 1 }], uid: UID,
    });

    expect(b.id).not.toBe(a.id);
    expect(b.duplicada).toBeUndefined();
  });

  it("el reintento después de cerrar la caja devuelve la venta original en vez de NO_OPEN_SESSION", async () => {
    // Si el corte de red tapó la respuesta y la caja se cerró antes del
    // reintento, exigir caja abierta rechazaría una venta que YA está cobrada.
    const primera = await venta(UID);
    await closeCashSession(db, { storeId: store, sessionId, userId: "u1", countedCash: 0 });

    const segunda = await venta(UID);
    expect(segunda.id).toBe(primera.id);
    expect(segunda.duplicada).toBe(true);
  });

  it("una venta nueva sí falla con la caja cerrada", async () => {
    await closeCashSession(db, { storeId: store, sessionId, userId: "u1", countedCash: 0 });
    await expect(venta(OTRO_UID)).rejects.toThrow("NO_OPEN_SESSION");
  });

  it("un error de dominio no consume el uid: el reintento corregido entra", async () => {
    // Primer intento con más unidades que el stock: la transacción revierte
    // entera, así que el uid queda libre para el reintento con la cantidad ok.
    await expect(venta(UID, 999)).rejects.toThrow("INSUFFICIENT_STOCK");

    const ok = await venta(UID, 2);
    expect(ok.duplicada).toBeUndefined();
    expect(ok.uid).toBe(UID);
  });
});
