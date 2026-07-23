import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { products, productVariants, sales } from "@/db/schema";
import { openCashSession, closeCashSession } from "@/domain/cash";
import { createSale } from "@/domain/sales";
import { createClient, listClientsWithBalance, getClientBalance, recordPayment } from "@/domain/clients";
import { eq } from "drizzle-orm";

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;
let variantId: number;
let clientId: number;

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);
  const [p] = await db.insert(products).values({ storeId: store, name: "Remera", basePrice: 1000 }).returning();
  const [v] = await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "M", stock: 100 }).returning();
  variantId = v.id;
  const c = await createClient(db, { storeId: store, name: "Juan" });
  clientId = c.id;
});

describe("fiado / cuenta corriente", () => {
  it("cliente nuevo arranca con saldo 0", async () => {
    const [row] = await listClientsWithBalance(db, store);
    expect(row.balance).toBe(0);
  });

  it("venta a cuenta genera un cargo = total y sube el saldo del cliente", async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    const sale = await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "cuenta", clientId,
      items: [{ variantId, quantity: 3 }], // 3 * 1000
    });
    expect(sale.clientId).toBe(clientId);
    expect(await getClientBalance(db, store, clientId)).toBe(3000);
  });

  it("venta a cuenta sin cliente falla", async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    await expect(
      createSale(db, { storeId: store, sellerId: "u1", paymentMethod: "cuenta", items: [{ variantId, quantity: 1 }] })
    ).rejects.toThrow("CLIENT_REQUIRED");
  });

  it("un pago baja el saldo", async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    await createSale(db, { storeId: store, sellerId: "u1", paymentMethod: "cuenta", clientId, items: [{ variantId, quantity: 5 }] });
    await recordPayment(db, { storeId: store, clientId, amount: 2000, method: "efectivo", userId: "u1" });
    expect(await getClientBalance(db, store, clientId)).toBe(3000); // 5000 − 2000
  });

  it("la venta a cuenta NO entra al efectivo esperado de la caja", async () => {
    const s = await openCashSession(db, { storeId: store, userId: "u1", openingCash: 1000 });
    await db.insert(sales).values({ storeId: store, sellerId: "u1", cashSessionId: s.id, total: 2000, paymentMethod: "efectivo" });
    await createSale(db, { storeId: store, sellerId: "u1", paymentMethod: "cuenta", clientId, items: [{ variantId, quantity: 4 }] });
    const closed = await closeCashSession(db, { storeId: store, sessionId: s.id, userId: "u1", countedCash: 3000 });
    // 1000 apertura + 2000 efectivo; la venta a cuenta (4000) NO cuenta.
    expect(closed.expectedCash).toBe(3000);
    expect(closed.difference).toBe(0);
  });

  it("no ve/paga clientes de otra tienda", async () => {
    const store2 = await seedTestStore(db, "t2");
    const list2 = await listClientsWithBalance(db, store2);
    expect(list2).toHaveLength(0);
    await expect(
      recordPayment(db, { storeId: store2, clientId, amount: 100, userId: "u1" })
    ).rejects.toThrow("CLIENT_NOT_FOUND");
  });
});
