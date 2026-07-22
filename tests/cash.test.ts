import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedTestUser } from "./helpers/db";
import { cashSessions, sales, type CashSession } from "@/db/schema";
import { openCashSession, closeCashSession, getOpenSession, createCashMovement, getSessionCashMovements } from "@/domain/cash";

let db: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  db = await createTestDb();
  await seedTestUser(db, "u1");
});

describe("cash sessions", () => {
  it("opens a session and finds it", async () => {
    const s = await openCashSession(db, { userId: "u1", openingCash: 5000 });
    expect((await getOpenSession(db))?.id).toBe(s.id);
  });

  it("rejects opening when one is already open", async () => {
    await openCashSession(db, { userId: "u1", openingCash: 5000 });
    await expect(openCashSession(db, { userId: "u1", openingCash: 0 })).rejects.toThrow("SESSION_ALREADY_OPEN");
  });

  it("closes computing expected cash and difference, ignoring voided sales", async () => {
    const s = await openCashSession(db, { userId: "u1", openingCash: 1000 });
    await db.insert(sales).values([
      { sellerId: "u1", cashSessionId: s.id, total: 2000, paymentMethod: "efectivo" },
      { sellerId: "u1", cashSessionId: s.id, total: 3000, paymentMethod: "tarjeta" },
      { sellerId: "u1", cashSessionId: s.id, total: 500, paymentMethod: "efectivo", voided: true },
    ]);
    const closed = await closeCashSession(db, { sessionId: s.id, userId: "u1", countedCash: 2900 });
    expect(closed.expectedCash).toBe(3000); // 1000 + 2000
    expect(closed.totalCard).toBe(3000);
    expect(closed.difference).toBe(-100);
    expect(await getOpenSession(db)).toBeNull();
  });

  it("registra gastos/egresos y los resta del efectivo esperado al cerrar", async () => {
    const s = await openCashSession(db, { userId: "u1", openingCash: 1000 });
    await db.insert(sales).values([
      { sellerId: "u1", cashSessionId: s.id, total: 2000, paymentMethod: "efectivo" },
    ]);
    await createCashMovement(db, { sessionId: s.id, kind: "gasto", amount: 300, description: "insumos", userId: "u1" });
    await createCashMovement(db, { sessionId: s.id, kind: "egreso", amount: 200, description: "retiro", userId: "u1" });

    const movements = await getSessionCashMovements(db, s.id);
    expect(movements).toHaveLength(2);

    const closed = await closeCashSession(db, { sessionId: s.id, userId: "u1", countedCash: 2500 });
    expect(closed.expectedCash).toBe(2500); // 1000 + 2000 − 300 − 200
    expect(closed.difference).toBe(0);
  });

  it("rechaza gasto sin caja abierta y con monto inválido", async () => {
    await expect(
      createCashMovement(db, { sessionId: 1, kind: "gasto", amount: 100, description: "x", userId: "u1" })
    ).rejects.toThrow("NO_OPEN_SESSION");
    const s = await openCashSession(db, { userId: "u1", openingCash: 0 });
    await expect(
      createCashMovement(db, { sessionId: s.id, kind: "gasto", amount: 0, description: "x", userId: "u1" })
    ).rejects.toThrow("INVALID_AMOUNT");
  });

  it("rejects closing an already closed session", async () => {
    const s = await openCashSession(db, { userId: "u1", openingCash: 0 });
    await closeCashSession(db, { sessionId: s.id, userId: "u1", countedCash: 0 });
    await expect(closeCashSession(db, { sessionId: s.id, userId: "u1", countedCash: 0 })).rejects.toThrow("SESSION_NOT_OPEN");
  });

  it("closes the concurrent-close race: exactly one close wins, its countedCash sticks", async () => {
    // PGlite serializes transactions (single connection, no real concurrent
    // execution), so this doesn't exercise true DB-level concurrency the way
    // Postgres would under load. It does still exercise the real code path:
    // both calls run the same transaction with the same FOR UPDATE + guarded
    // final UPDATE, and the test asserts the logical exactly-once outcome
    // (one winner, one SESSION_NOT_OPEN loser, no lost update).
    const s = await openCashSession(db, { userId: "u1", openingCash: 0 });
    const results = await Promise.allSettled([
      closeCashSession(db, { sessionId: s.id, userId: "u1", countedCash: 111 }),
      closeCashSession(db, { sessionId: s.id, userId: "u1", countedCash: 222 }),
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
    await expect(closeCashSession(db, { sessionId: 999999, userId: "u1", countedCash: 0 })).rejects.toThrow("SESSION_NOT_OPEN");
  });

  it("enforces at most one open session at the DB level via the partial unique index", async () => {
    await db.insert(cashSessions).values({ openedBy: "u1", openingCash: 0 });
    await expect(db.insert(cashSessions).values({ openedBy: "u1", openingCash: 0 })).rejects.toThrow();
  });

  it("openCashSession's pre-check throws SESSION_ALREADY_OPEN when a row was inserted directly beforehand", async () => {
    await db.insert(cashSessions).values({ openedBy: "u1", openingCash: 0 });
    await expect(openCashSession(db, { userId: "u1", openingCash: 100 })).rejects.toThrow("SESSION_ALREADY_OPEN");
  });

  it("closes the check-then-insert race: concurrent opens yield exactly one session", async () => {
    // Both calls start before either resolves its pre-check, so both see no
    // open session and both attempt to insert. Only the DB-level unique
    // index (and the catch block in openCashSession that translates its
    // violation) prevents two open sessions from being created here — the
    // pre-check alone cannot, since it already raced past.
    const results = await Promise.allSettled([
      openCashSession(db, { userId: "u1", openingCash: 100 }),
      openCashSession(db, { userId: "u1", openingCash: 200 }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toBe("SESSION_ALREADY_OPEN");
    expect(await db.select().from(cashSessions)).toHaveLength(1);
  });
});
