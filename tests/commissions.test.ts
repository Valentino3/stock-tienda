import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser } from "./helpers/db";
import { sales } from "@/db/schema";
import { createCommission, listCommissions } from "@/domain/commissions";
import { getSellerSalesSummary } from "@/domain/reports";
import { openCashSession } from "@/domain/cash";
import { commissionFromPercent } from "@/lib/commission";

let db: Awaited<ReturnType<typeof createTestDb>>;

beforeEach(async () => {
  db = await createTestDb();
  await seedTestUser(db, "owner", "owner");
  await seedTestUser(db, "emp1", "employee");
  await seedTestUser(db, "emp2", "employee");
});

describe("commissions", () => {
  it("crea y lista comisiones con el nombre del empleado", async () => {
    await createCommission(db, { employeeId: "emp1", amount: 1500, note: "julio", createdBy: "owner" });
    const list = await listCommissions(db, {});
    expect(list).toHaveLength(1);
    expect(list[0].commission.amount).toBe(1500);
    expect(list[0].employeeName).toBe("Test");
  });

  it("rechaza monto no positivo", async () => {
    await expect(
      createCommission(db, { employeeId: "emp1", amount: 0, createdBy: "owner" })
    ).rejects.toThrow("INVALID_AMOUNT");
  });
});

describe("commissionFromPercent", () => {
  it("calcula base × % / 100 redondeado a 2 decimales", () => {
    expect(commissionFromPercent(10000, 10)).toBe(1000);
    expect(commissionFromPercent(1500, 5)).toBe(75);
    expect(commissionFromPercent(999.99, 33)).toBe(330); // 329.9967 -> 330
  });

  it("devuelve 0 con base o porcentaje no positivos", () => {
    expect(commissionFromPercent(0, 10)).toBe(0);
    expect(commissionFromPercent(1000, 0)).toBe(0);
    expect(commissionFromPercent(-100, 10)).toBe(0);
    expect(commissionFromPercent(1000, -5)).toBe(0);
  });
});

describe("getSellerSalesSummary", () => {
  it("agrupa ventas no anuladas por vendedor", async () => {
    const s = await openCashSession(db, { userId: "owner", openingCash: 0 });
    await db.insert(sales).values([
      { sellerId: "emp1", cashSessionId: s.id, total: 1000, paymentMethod: "efectivo" },
      { sellerId: "emp1", cashSessionId: s.id, total: 500, paymentMethod: "tarjeta" },
      { sellerId: "emp2", cashSessionId: s.id, total: 2000, paymentMethod: "efectivo" },
      { sellerId: "emp2", cashSessionId: s.id, total: 999, paymentMethod: "efectivo", voided: true },
    ]);
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const summary = await getSellerSalesSummary(db, { from, to });

    const byId = Object.fromEntries(summary.map((r: any) => [r.sellerId, r]));
    expect(byId["emp1"].count).toBe(2);
    expect(byId["emp1"].total).toBe(1500);
    expect(byId["emp2"].count).toBe(1); // anulada excluida
    expect(byId["emp2"].total).toBe(2000);
  });
});
