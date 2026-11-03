import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedTestStore, seedTestUser } from "./helpers/db";
import { cashMovements, cashSessions, gastos, sales } from "@/db/schema";
import { closeCashSession, createCashMovement, openCashSession } from "@/domain/cash";
import {
  anularGasto, crearRubro, editarRubro, listarGastos, listarRubros, registrarGasto, resumenPorRubro,
} from "@/domain/gastos";
import { RUBROS_INICIALES } from "@/domain/gastos-medios";

/**
 * Gastos por rubro: los que salen de la caja y los que no, juntos, contra lo
 * vendido en el mismo período. De acá sale el índice de sueldos sobre ventas.
 */

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);
});

const rubroLlamado = async (nombre: string) =>
  (await listarRubros(db, store)).find((r) => r.nombre === nombre)!;

describe("rubros", () => {
  it("un local arranca con los rubros iniciales, una sola vez", async () => {
    const primera = await listarRubros(db, store);
    expect(primera.map((r) => r.nombre).sort()).toEqual([...RUBROS_INICIALES].sort());
    expect(await listarRubros(db, store)).toHaveLength(RUBROS_INICIALES.length);
  });

  it("se crean, se renombran y se desactivan; el nombre no se repite", async () => {
    await listarRubros(db, store);
    const propio = await crearRubro(db, { storeId: store, nombre: " Publicidad " });
    expect(propio.nombre).toBe("Publicidad");
    await expect(crearRubro(db, { storeId: store, nombre: "Publicidad" })).rejects.toThrow("RUBRO_DUPLICADO");

    await editarRubro(db, { storeId: store, rubroId: propio.id, nombre: "Marketing" });
    await editarRubro(db, { storeId: store, rubroId: propio.id, activo: false });
    expect((await listarRubros(db, store)).map((r) => r.nombre)).not.toContain("Marketing");
    expect((await listarRubros(db, store, { incluirInactivos: true })).map((r) => r.nombre)).toContain("Marketing");
  });

  it("no se tocan rubros de otra tienda", async () => {
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    const [ajeno] = await listarRubros(db, store2);
    await expect(editarRubro(db, { storeId: store, rubroId: ajeno.id, nombre: "X" }))
      .rejects.toThrow("RUBRO_NO_ENCONTRADO");
  });
});

describe("gastos fuera de caja", () => {
  it("se registran con rubro, fecha y medio, y no tocan el arqueo", async () => {
    const caja = await openCashSession(db, { storeId: store, userId: "u1", openingCash: 1000 });
    const sueldos = await rubroLlamado("Sueldos y jornales");
    await registrarGasto(db, {
      storeId: store, userId: "u1", rubroId: sueldos.id, fecha: "2026-10-31",
      monto: 450000, medio: "transferencia", detalle: "Sueldo octubre — Juan",
    });

    const cerrada = await closeCashSession(db, { storeId: store, sessionId: caja.id, userId: "u1", countedCash: 1000 });
    expect(cerrada.expectedCash).toBe(1000);

    const [g] = await listarGastos(db, store, { desde: "2026-10-01", hasta: "2026-10-31" });
    expect(g).toMatchObject({ rubro: "Sueldos y jornales", monto: 450000, medio: "transferencia" });
  });

  it("valida monto, fecha, medio y rubro", async () => {
    const r = await rubroLlamado("Alquiler");
    const base = { storeId: store, userId: "u1", rubroId: r.id, fecha: "2026-10-01", monto: 100, medio: "transferencia" as const };
    await expect(registrarGasto(db, { ...base, monto: 0 })).rejects.toThrow("INVALID_AMOUNT");
    await expect(registrarGasto(db, { ...base, fecha: "1/10/2026" })).rejects.toThrow("FECHA_INVALIDA");
    await expect(registrarGasto(db, { ...base, medio: "cheque" as never })).rejects.toThrow("MEDIO_INVALIDO");

    await editarRubro(db, { storeId: store, rubroId: r.id, activo: false });
    await expect(registrarGasto(db, base)).rejects.toThrow("RUBRO_INACTIVO");
  });

  it("un gasto mal cargado se anula con motivo y deja de sumar", async () => {
    const r = await rubroLlamado("Servicios");
    const g = await registrarGasto(db, {
      storeId: store, userId: "u1", rubroId: r.id, fecha: "2026-10-10", monto: 30000, medio: "debito_automatico",
    });
    await expect(anularGasto(db, { storeId: store, gastoId: g.id, userId: "u1", motivo: "x" }))
      .rejects.toThrow("MOTIVO_REQUERIDO");
    await anularGasto(db, { storeId: store, gastoId: g.id, userId: "u1", motivo: "Cargado dos veces" });
    await expect(anularGasto(db, { storeId: store, gastoId: g.id, userId: "u1", motivo: "Otra vez" }))
      .rejects.toThrow("YA_ANULADO");

    const resumen = await resumenPorRubro(db, store, { desde: "2026-10-01", hasta: "2026-10-31" });
    expect(resumen.total).toBe(0);
    // Sigue en el historial, marcado.
    const [fila] = await listarGastos(db, store, { desde: "2026-10-01", hasta: "2026-10-31" });
    expect(fila.voidReason).toBe("Cargado dos veces");
  });

  it("la base no acepta un monto negativo ni una anulación a medias", async () => {
    const r = await rubroLlamado("Otros");
    const g = await registrarGasto(db, {
      storeId: store, userId: "u1", rubroId: r.id, fecha: "2026-10-10", monto: 10, medio: "otro",
    });
    await expect(db.update(gastos).set({ monto: -5 }).where(eq(gastos.id, g.id))).rejects.toThrow();
    await expect(db.update(gastos).set({ voidedAt: new Date() }).where(eq(gastos.id, g.id))).rejects.toThrow();
  });
});

describe("resumen por rubro e índice sobre ventas", () => {
  it("junta caja y fuera de caja por rubro y calcula el porcentaje sobre lo vendido", async () => {
    const sueldos = await rubroLlamado("Sueldos y jornales");
    const mercaderia = await rubroLlamado("Mercadería");

    // Ventas del período: 1.000.000, en días de Argentina.
    const [caja] = await db.insert(cashSessions).values({ storeId: store, openedBy: "u1", openingCash: 0 }).returning();
    const venta = (createdAt: string, total: number, voided = false) => db.insert(sales).values({
      storeId: store, sellerId: "u1", registeredBy: "u1", cashSessionId: caja.id,
      total, paymentMethod: "efectivo", createdAt: new Date(createdAt), voided,
    });
    await venta("2026-10-15T15:00:00Z", 600000);
    await venta("2026-11-01T02:30:00Z", 400000); // 23:30 del 31 de octubre en Argentina
    await venta("2026-10-20T15:00:00Z", 999999, true); // anulada: no cuenta
    await venta("2026-11-01T12:00:00Z", 5000000); // fuera del período

    await registrarGasto(db, {
      storeId: store, userId: "u1", rubroId: sueldos.id, fecha: "2026-10-31", monto: 250000, medio: "transferencia",
    });
    // Un gasto de mercadería pagado desde la caja, con rubro.
    await db.insert(cashMovements).values({
      cashSessionId: caja.id, kind: "gasto", amount: 80000, description: "Verdulería",
      rubroId: mercaderia.id, createdBy: "u1", createdAt: new Date("2026-10-05T14:00:00Z"),
    });
    // Un egreso (el dueño se lleva efectivo) NO es un gasto del local.
    await db.insert(cashMovements).values({
      cashSessionId: caja.id, kind: "egreso", amount: 50000, description: "Retiro",
      createdBy: "u1", createdAt: new Date("2026-10-05T14:00:00Z"),
    });
    // Un gasto de caja viejo, sin rubro.
    await db.insert(cashMovements).values({
      cashSessionId: caja.id, kind: "gasto", amount: 20000, description: "Hielo",
      createdBy: "u1", createdAt: new Date("2026-10-06T14:00:00Z"),
    });

    const r = await resumenPorRubro(db, store, { desde: "2026-10-01", hasta: "2026-10-31" });
    expect(r.ventas).toBe(1000000);
    expect(r.total).toBe(350000);
    expect(r.rubros.map((f) => [f.nombre, f.fueraDeCaja, f.enCaja, f.total, f.sobreVentas])).toEqual([
      ["Sueldos y jornales", 250000, 0, 250000, 25],
      ["Mercadería", 0, 80000, 80000, 8],
      ["Sin rubro", 0, 20000, 20000, 2],
    ]);
  });

  it("sin ventas en el período, el porcentaje queda vacío", async () => {
    const r1 = await rubroLlamado("Alquiler");
    await registrarGasto(db, {
      storeId: store, userId: "u1", rubroId: r1.id, fecha: "2026-10-01", monto: 100, medio: "transferencia",
    });
    const r = await resumenPorRubro(db, store, { desde: "2026-10-01", hasta: "2026-10-01" });
    expect(r.rubros[0].sobreVentas).toBeNull();
  });

  it("un gasto de caja guarda su rubro, y un egreso nunca lo lleva", async () => {
    const caja = await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    const limpieza = await rubroLlamado("Limpieza");
    const g = await createCashMovement(db, {
      storeId: store, sessionId: caja.id, kind: "gasto", amount: 5000, description: "Lavandina", userId: "u1",
      rubroId: limpieza.id,
    });
    expect(g.rubroId).toBe(limpieza.id);
    const e = await createCashMovement(db, {
      storeId: store, sessionId: caja.id, kind: "egreso", amount: 5000, description: "Retiro", userId: "u1",
      rubroId: limpieza.id,
    });
    expect(e.rubroId).toBeNull();

    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    const [ajeno] = await listarRubros(db, store2);
    await expect(createCashMovement(db, {
      storeId: store, sessionId: caja.id, kind: "gasto", amount: 1, description: "X", userId: "u1", rubroId: ajeno.id,
    })).rejects.toThrow("RUBRO_NO_ENCONTRADO");
  });
});
