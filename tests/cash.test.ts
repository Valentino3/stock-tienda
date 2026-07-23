import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { cashSessions, sales, type CashSession } from "@/db/schema";
import { openCashSession, closeCashSession, getOpenSession, createCashMovement, getSessionCashMovements } from "@/domain/cash";

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);
});

describe("cash sessions", () => {
  it("opens a session and finds it", async () => {
    const s = await openCashSession(db, { storeId: store, userId: "u1", openingCash: 5000 });
    expect((await getOpenSession(db, store))?.id).toBe(s.id);
  });

  it("rejects opening when one is already open", async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 5000 });
    await expect(openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 })).rejects.toThrow("SESSION_ALREADY_OPEN");
  });

  it("closes computing expected cash and difference, ignoring voided sales", async () => {
    const s = await openCashSession(db, { storeId: store, userId: "u1", openingCash: 1000 });
    await db.insert(sales).values([
      { storeId: store, sellerId: "u1", cashSessionId: s.id, total: 2000, paymentMethod: "efectivo" },
      { storeId: store, sellerId: "u1", cashSessionId: s.id, total: 3000, paymentMethod: "tarjeta" },
      { storeId: store, sellerId: "u1", cashSessionId: s.id, total: 500, paymentMethod: "efectivo", voided: true },
    ]);
    const closed = await closeCashSession(db, { storeId: store, sessionId: s.id, userId: "u1", countedCash: 2900 });
    expect(closed.expectedCash).toBe(3000); // 1000 + 2000
    expect(closed.totalCard).toBe(3000);
    expect(closed.difference).toBe(-100);
    expect(await getOpenSession(db, store)).toBeNull();
  });

  it("registra gastos/egresos y los resta del efectivo esperado al cerrar", async () => {
    const s = await openCashSession(db, { storeId: store, userId: "u1", openingCash: 1000 });
    await db.insert(sales).values([
      { storeId: store, sellerId: "u1", cashSessionId: s.id, total: 2000, paymentMethod: "efectivo" },
    ]);
    await createCashMovement(db, { storeId: store, sessionId: s.id, kind: "gasto", amount: 300, description: "insumos", userId: "u1" });
    await createCashMovement(db, { storeId: store, sessionId: s.id, kind: "egreso", amount: 200, description: "retiro", userId: "u1" });

    const movements = await getSessionCashMovements(db, s.id);
    expect(movements).toHaveLength(2);

    const closed = await closeCashSession(db, { storeId: store, sessionId: s.id, userId: "u1", countedCash: 2500 });
    expect(closed.expectedCash).toBe(2500); // 1000 + 2000 − 300 − 200
    expect(closed.difference).toBe(0);
  });

  it("rechaza gasto sin caja abierta y con monto inválido", async () => {
    await expect(
      createCashMovement(db, { storeId: store, sessionId: 1, kind: "gasto", amount: 100, description: "x", userId: "u1" })
    ).rejects.toThrow("NO_OPEN_SESSION");
    const s = await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    await expect(
      createCashMovement(db, { storeId: store, sessionId: s.id, kind: "gasto", amount: 0, description: "x", userId: "u1" })
    ).rejects.toThrow("INVALID_AMOUNT");
  });

  it("rejects closing an already closed session", async () => {
    const s = await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    await closeCashSession(db, { storeId: store, sessionId: s.id, userId: "u1", countedCash: 0 });
    await expect(closeCashSession(db, { storeId: store, sessionId: s.id, userId: "u1", countedCash: 0 })).rejects.toThrow("SESSION_NOT_OPEN");
  });

  it("closes the concurrent-close race: exactly one close wins, its countedCash sticks", async () => {
    const s = await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    const results = await Promise.allSettled([
      closeCashSession(db, { storeId: store, sessionId: s.id, userId: "u1", countedCash: 111 }),
      closeCashSession(db, { storeId: store, sessionId: s.id, userId: "u1", countedCash: 222 }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<CashSession>[];
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toBe("SESSION_NOT_OPEN");

    const [stored] = await db.select().from(cashSessions).where(eq(cashSessions.id, s.id));
    expect(stored.countedCash).toBe(fulfilled[0].value.countedCash);
  });

  it("rejects closing a session id that does not exist", async () => {
    await expect(closeCashSession(db, { storeId: store, sessionId: 999999, userId: "u1", countedCash: 0 })).rejects.toThrow("SESSION_NOT_OPEN");
  });

  it("enforces at most one open session PER STORE via the partial unique index", async () => {
    await db.insert(cashSessions).values({ storeId: store, openedBy: "u1", openingCash: 0 });
    await expect(db.insert(cashSessions).values({ storeId: store, openedBy: "u1", openingCash: 0 })).rejects.toThrow();
  });

  it("allows a second store to have its own open session simultaneously", async () => {
    const store2 = await seedTestStore(db, "t2");
    await seedTestUser(db, "u2", "owner", store2);
    const a = await openCashSession(db, { storeId: store, userId: "u1", openingCash: 100 });
    const b = await openCashSession(db, { storeId: store2, userId: "u2", openingCash: 200 });
    expect(a.id).not.toBe(b.id);
    // Cada tienda ve solo su propia caja abierta.
    expect((await getOpenSession(db, store))?.id).toBe(a.id);
    expect((await getOpenSession(db, store2))?.id).toBe(b.id);
  });

  it("openCashSession's pre-check throws SESSION_ALREADY_OPEN when a row was inserted directly beforehand", async () => {
    await db.insert(cashSessions).values({ storeId: store, openedBy: "u1", openingCash: 0 });
    await expect(openCashSession(db, { storeId: store, userId: "u1", openingCash: 100 })).rejects.toThrow("SESSION_ALREADY_OPEN");
  });

  it("closes the check-then-insert race: concurrent opens yield exactly one session", async () => {
    const results = await Promise.allSettled([
      openCashSession(db, { storeId: store, userId: "u1", openingCash: 100 }),
      openCashSession(db, { storeId: store, userId: "u1", openingCash: 200 }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toBe("SESSION_ALREADY_OPEN");
    expect(await db.select().from(cashSessions)).toHaveLength(1);
  });
});
