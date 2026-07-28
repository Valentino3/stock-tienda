import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { products, productVariants, sales } from "@/db/schema";
import { openCashSession, closeCashSession } from "@/domain/cash";
import { createSale, voidSale } from "@/domain/sales";
import { createClient, listClientsWithBalance, getClientBalance, recordPayment, getClientLedger, getClientSummary } from "@/domain/clients";
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

// El detalle que explica de qué está hecha la deuda: cada movimiento con su
// venta, sus productos y el saldo que dejó.
describe("getClientLedger / getClientSummary", () => {
  it("un cliente sin movimientos devuelve historial vacío y totales en cero", async () => {
    expect(await getClientLedger(db, store, clientId)).toEqual([]);
    expect(await getClientSummary(db, store, clientId)).toMatchObject({
      charged: 0, paid: 0, purchases: 0, balance: 0, lastMovementAt: null,
    });
  });

  it("arma el detalle de la venta que originó cada cargo", async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    const sale = await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "cuenta", clientId,
      items: [{ variantId, quantity: 3 }], // 3 * 1000
    });

    const [entry] = await getClientLedger(db, store, clientId);
    expect(entry.type).toBe("cargo");
    expect(entry.amount).toBe(3000);
    expect(entry.balanceAfter).toBe(3000);
    expect(entry.sale?.id).toBe(sale.id);
    expect(entry.sale?.voided).toBe(false);
    expect(entry.sale?.sellerName).toBe("Test");
    expect(entry.sale?.items).toEqual([
      { productName: "Remera", variantName: "M", quantity: 3, unitPrice: 1000, discountAmount: 0 },
    ]);
  });

  it("devuelve del más nuevo al más viejo con el saldo corrido bien calculado", async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "cuenta", clientId,
      items: [{ variantId, quantity: 5 }], // 5000
    });
    await recordPayment(db, { storeId: store, clientId, amount: 2000, userId: "u1" });
    await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "cuenta", clientId,
      items: [{ variantId, quantity: 1 }], // 1000
    });

    const ledger = await getClientLedger(db, store, clientId);
    expect(ledger).toHaveLength(3);
    // Orden de lectura: el más reciente primero.
    expect(ledger.map((e) => e.amount)).toEqual([1000, 2000, 5000]);
    // El saldo corrido se calcula cronológicamente: 5000 -> 3000 -> 4000.
    expect(ledger.map((e) => e.balanceAfter)).toEqual([4000, 3000, 5000]);
    expect(ledger[0].balanceAfter).toBe(await getClientBalance(db, store, clientId));
  });

  it("los pagos aparecen sin venta asociada y con su medio", async () => {
    await recordPayment(db, {
      storeId: store, clientId, amount: 1500, method: "transferencia", note: "Alias", userId: "u1",
    });
    const [entry] = await getClientLedger(db, store, clientId);
    expect(entry.type).toBe("pago");
    expect(entry.sale).toBeNull();
    expect(entry.method).toBe("transferencia");
    expect(entry.note).toBe("Alias");
    expect(entry.balanceAfter).toBe(-1500);
  });

  it("marca la venta anulada, cuyo cargo sigue vigente", async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    const sale = await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "cuenta", clientId,
      items: [{ variantId, quantity: 2 }],
    });
    await voidSale(db, { saleId: sale.id, storeId: store, userId: "u1" });

    const [entry] = await getClientLedger(db, store, clientId);
    expect(entry.sale?.voided).toBe(true);
    // Documenta el comportamiento actual: anular repone stock pero NO revierte
    // el cargo, así que el saldo sigue en pie. La UI lo avisa.
    expect(entry.balanceAfter).toBe(2000);
    expect(await getClientBalance(db, store, clientId)).toBe(2000);
  });

  it("no filtra movimientos de otra tienda", async () => {
    const otra = await seedTestStore(db, "t2", "Otra");
    await seedTestUser(db, "u2", "owner", otra);
    const ajeno = await createClient(db, { storeId: otra, name: "Ajeno" });
    await recordPayment(db, { storeId: otra, clientId: ajeno.id, amount: 999, userId: "u2" });

    expect(await getClientLedger(db, store, ajeno.id)).toEqual([]);
    expect(await getClientSummary(db, store, ajeno.id)).toMatchObject({ charged: 0, paid: 0 });
  });

  it("los totales del encabezado separan comprado de pagado", async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "cuenta", clientId,
      items: [{ variantId, quantity: 4 }], // 4000
    });
    await recordPayment(db, { storeId: store, clientId, amount: 1000, userId: "u1" });

    const s = await getClientSummary(db, store, clientId);
    expect(s.charged).toBe(4000);
    expect(s.paid).toBe(1000);
    expect(s.balance).toBe(3000);
    expect(s.purchases).toBe(1); // el pago no cuenta como compra
    expect(s.lastMovementAt).toBeInstanceOf(Date);
  });
});
