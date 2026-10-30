import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestStore, seedTestUser } from "./helpers/db";
import { cashSessions, sales } from "@/db/schema";
import { getSalesReport } from "@/domain/reports";
import { finDelDiaAR, haceDiasAR, hoyAR, inicioDelDiaAR, rangoAR } from "@/lib/dates";

/**
 * Los días de los filtros y reportes son días de Argentina.
 *
 * El servidor y la base corren en UTC. Tomar un `YYYY-MM-DD` como medianoche
 * UTC corría todo tres horas: lo vendido después de las 21 caía en el día
 * siguiente, que en un restaurante es el servicio entero de la noche.
 */

describe("días de Argentina", () => {
  it("hoy cambia a la medianoche argentina, no a la de UTC", () => {
    // 23:30 del 29 en Argentina = 02:30 del 30 en UTC.
    expect(hoyAR(new Date("2026-10-30T02:30:00Z"))).toBe("2026-10-29");
    expect(hoyAR(new Date("2026-10-30T03:00:00Z"))).toBe("2026-10-30");
    expect(haceDiasAR(7, new Date("2026-10-30T02:30:00Z"))).toBe("2026-10-22");
  });

  it("un día va de 00:00 a 00:00 de Argentina", () => {
    expect(inicioDelDiaAR("2026-10-29").toISOString()).toBe("2026-10-29T03:00:00.000Z");
    expect(finDelDiaAR("2026-10-29").toISOString()).toBe("2026-10-30T03:00:00.000Z");
  });

  it("el rango incluye los dos extremos, y sin filtro son los últimos 30 días", () => {
    const r = rangoAR({ from: "2026-10-01", to: "2026-10-29" });
    expect(r.from.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-30T02:59:59.999Z");

    const porDefecto = rangoAR({}, 30, new Date("2026-10-30T02:30:00Z"));
    expect(porDefecto).toMatchObject({ fromValue: "2026-09-29", toValue: "2026-10-29" });
  });
});

describe("ventas por día", () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let store: number;

  beforeEach(async () => {
    db = await createTestDb();
    store = await seedTestStore(db);
    await seedTestUser(db, "u1", "owner", store);
  });

  it("una venta de las 23:30 de Argentina cuenta en su día, no en el siguiente", async () => {
    const [caja] = await db.insert(cashSessions)
      .values({ storeId: store, openedBy: "u1", openingCash: 0 }).returning();
    const venta = (createdAt: string, total: number) => db.insert(sales).values({
      storeId: store, sellerId: "u1", registeredBy: "u1", cashSessionId: caja.id,
      total, paymentMethod: "efectivo", createdAt: new Date(createdAt),
    });
    await venta("2026-10-29T23:00:00Z", 1000); // 20:00 del 29
    await venta("2026-10-30T02:30:00Z", 2000); // 23:30 del 29
    await venta("2026-10-30T13:00:00Z", 4000); // 10:00 del 30

    const r = await getSalesReport(db, store, rangoAR({ from: "2026-10-29", to: "2026-10-30" }));
    expect(r.byDay.map((d: { day: string; total: number }) => [d.day, d.total])).toEqual([
      ["2026-10-29", 3000],
      ["2026-10-30", 4000],
    ]);
  });
});
