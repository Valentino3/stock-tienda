import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser } from "./helpers/db";
import { cashSessions, sales } from "@/db/schema";
import { openCashSession, closeCashSession, getOpenSession } from "@/domain/cash";

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

  it("rejects closing an already closed session", async () => {
    const s = await openCashSession(db, { userId: "u1", openingCash: 0 });
    await closeCashSession(db, { sessionId: s.id, userId: "u1", countedCash: 0 });
    await expect(closeCashSession(db, { sessionId: s.id, userId: "u1", countedCash: 0 })).rejects.toThrow("SESSION_NOT_OPEN");
  });

  it("rejects closing a session id that does not exist", async () => {
    await expect(closeCashSession(db, { sessionId: 999999, userId: "u1", countedCash: 0 })).rejects.toThrow("SESSION_NOT_OPEN");
  });

  it("enforces at most one open session at the DB level via the partial unique index", async () => {
    await db.insert(cashSessions).values({ openedBy: "u1", openingCash: 0 });
    await expect(db.insert(cashSessions).values({ openedBy: "u1", openingCash: 0 })).rejects.toThrow();
  });

  it("openCashSession surfaces SESSION_ALREADY_OPEN when a row was inserted directly (bypassing the pre-check)", async () => {
    await db.insert(cashSessions).values({ openedBy: "u1", openingCash: 0 });
    await expect(openCashSession(db, { userId: "u1", openingCash: 100 })).rejects.toThrow("SESSION_ALREADY_OPEN");
  });
});
