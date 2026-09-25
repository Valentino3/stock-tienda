import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { clientAccountMovements, products, productVariants } from "@/db/schema";
import { openCashSession, closeCashSession } from "@/domain/cash";
import { getCashSessionClose } from "@/domain/cash-close";
import { createSale, voidSale } from "@/domain/sales";
import {
  createClient, getClientBalance, getClientLedger, getClientSummary, listClientsWithBalance,
  motivoNoAnulable, recordAccountAdjustment, recordAccountMovement, voidAccountMovement,
} from "@/domain/clients";

/**
 * 🔴 CAMINO DE PLATA. Correcciones de la cuenta corriente: anular movimientos,
 * cargos manuales y ajustes.
 *
 * Lo que protege, en orden de gravedad:
 *   1. Que un movimiento anulado deje de contar EN TODOS LADOS a la vez: el
 *      saldo, la caja y la hoja de cierre. Si una sola suma se olvida del
 *      `voided`, dos pantallas dicen dos números y un arqueo no cuadra.
 *   2. Que una caja ya cerrada no cambie de número nunca.
 *   3. Que nada de lo que baja deuda sin plata toque la caja.
 */

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number, otra: number, clientId: number, variantId: number;

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  otra = await seedTestStore(db, "otra");
  await seedTestUser(db, "u1", "owner", store);
  await seedTestUser(db, "ana", "employee", store);
  await seedTestUser(db, "u2", "owner", otra);

  clientId = (await createClient(db, { storeId: store, name: "Juan" })).id;

  const [p] = await db.insert(products).values({ storeId: store, name: "Sobre", basePrice: 1000 }).returning();
  const [v] = await db.insert(productVariants)
    .values({ storeId: store, productId: p.id, name: "", stock: 100 }).returning();
  variantId = v.id;
});

/** Anula a mano, como lo dejaría `voidAccountMovement`. */
const marcarAnulado = (movementId: number) =>
  db.update(clientAccountMovements)
    .set({ voided: true, voidedAt: new Date(), voidedBy: "u1", voidedReason: "cargado de más" })
    .where(eq(clientAccountMovements.id, movementId));

const cobrar = (extra: Record<string, unknown> = {}) =>
  recordAccountMovement(db, {
    storeId: store, clientId, kind: "pago", amount: 3000, method: "efectivo", userId: "u1", ...extra,
  } as any);

describe("un movimiento anulado no cuenta en ningún lado", () => {
  it("sale del saldo por las tres vías, y el ledger lo muestra sin que aporte", async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "cuenta", clientId,
      items: [{ variantId, quantity: 10 }],
    });
    const { movementId } = await cobrar();
    await marcarAnulado(movementId);

    expect(await getClientBalance(db, store, clientId)).toBe(10000);
    const r = await getClientSummary(db, store, clientId);
    expect(r.balance).toBe(10000);
    expect(r.paid).toBe(0);

    const ledger = await getClientLedger(db, store, clientId);
    // El anulado sigue ahí —es lo que hace de esto un registro— pero su saldo
    // es el que dejó el anterior.
    expect(ledger[0]).toMatchObject({
      id: movementId, voided: true, voidedReason: "cargado de más", voidedByName: expect.any(String),
      balanceAfter: 10000,
    });
    expect(ledger[0].voidedAt).toBeInstanceOf(Date);
  });

  it("un cliente cuyos únicos movimientos están anulados sigue en la lista, con saldo 0", async () => {
    // La trampa del leftJoin: filtrar `voided` en el WHERE lo sacaría de la
    // lista, y el cliente desaparecería de /clientes y del mostrador.
    const { movementId } = await cobrar({ kind: "credito", method: "transferencia" });
    await marcarAnulado(movementId);

    const lista = await listClientsWithBalance(db, store);
    expect(lista).toEqual([expect.objectContaining({ id: clientId, balance: 0 })]);
  });

  it("un cobro en efectivo anulado no suma al esperado, ni en el cierre ni en la hoja", async () => {
    const caja = await openCashSession(db, { storeId: store, userId: "u1", openingCash: 1000 });
    const { movementId } = await cobrar();
    await cobrar({ amount: 500 });
    await marcarAnulado(movementId);

    // Antes de cerrar, la hoja provisoria ya lo excluye.
    const provisoria = (await getCashSessionClose(db, store, caja.id))!;
    expect(provisoria.cobrosCuenta.map((c) => c.amount)).toEqual([500]);
    expect(provisoria.efectivoEsperado).toBe(1500);

    const cerrada = await closeCashSession(db, { storeId: store, sessionId: caja.id, userId: "u1", countedCash: 1500 });
    expect(cerrada.expectedCash).toBe(1500);
    expect((await getCashSessionClose(db, store, caja.id))!.efectivoEsperado).toBe(cerrada.expectedCash);
  });

  it("el CHECK de la base rechaza una anulación sin motivo", async () => {
    const { movementId } = await cobrar({ method: "transferencia" });
    await expect(
      db.update(clientAccountMovements)
        .set({ voided: true, voidedAt: new Date(), voidedBy: "u1" })
        .where(eq(clientAccountMovements.id, movementId))
    ).rejects.toThrow();
  });
});

describe("voidAccountMovement", () => {
  const anular = (movementId: number, extra: Record<string, unknown> = {}) =>
    voidAccountMovement(db, { storeId: store, movementId, userId: "ana", reason: "se cargó dos veces", ...extra } as any);

  it("anula un cobro por transferencia: queda con quién, cuándo y por qué, y el saldo vuelve", async () => {
    const { movementId } = await cobrar({ kind: "credito", method: "transferencia", amount: 5000 });
    expect(await getClientBalance(db, store, clientId)).toBe(-5000);

    const res = await anular(movementId);
    expect(res).toEqual({ clientId, balance: 0 });

    const [mov] = await db.select().from(clientAccountMovements).where(eq(clientAccountMovements.id, movementId));
    expect(mov).toMatchObject({ voided: true, voidedBy: "ana", voidedReason: "se cargó dos veces" });
    expect(mov.voidedAt).toBeInstanceOf(Date);
  });

  it("exige motivo, recortado", async () => {
    const { movementId } = await cobrar({ method: "transferencia" });
    await expect(anular(movementId, { reason: "  a " })).rejects.toThrow("VOID_REASON_REQUIRED");
  });

  it("no encuentra un movimiento de otra tienda", async () => {
    const { movementId } = await cobrar({ method: "transferencia" });
    await expect(
      voidAccountMovement(db, { storeId: otra, movementId, userId: "u2", reason: "de otra tienda" })
    ).rejects.toThrow("MOVEMENT_NOT_FOUND");
  });

  it("no anula dos veces, ni aunque las dos corran a la vez", async () => {
    const { movementId } = await cobrar({ method: "transferencia" });
    const r = await Promise.allSettled([anular(movementId), anular(movementId)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    await expect(anular(movementId)).rejects.toThrow("ALREADY_VOIDED");
    expect(await getClientBalance(db, store, clientId)).toBe(0);
  });

  it("el cargo de una venta no se anula suelto, ni la reversión automática de una venta anulada", async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    const venta = await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "cuenta", clientId,
      items: [{ variantId, quantity: 2 }],
    });
    const [cargo] = await db.select().from(clientAccountMovements).where(eq(clientAccountMovements.saleId, venta.id));
    await expect(anular(cargo.id)).rejects.toThrow("SALE_CHARGE_NOT_VOIDABLE");

    await voidSale(db, { saleId: venta.id, storeId: store, userId: "u1", reason: "devolución" });
    const [reversion] = await db.select().from(clientAccountMovements)
      .where(and(eq(clientAccountMovements.saleId, venta.id), eq(clientAccountMovements.type, "anulacion")));
    await expect(anular(reversion.id)).rejects.toThrow("ANULACION_NOT_VOIDABLE");
    expect(await getClientBalance(db, store, clientId)).toBe(0);
  });

  it("un cobro en efectivo se anula con la caja abierta y baja el esperado", async () => {
    const caja = await openCashSession(db, { storeId: store, userId: "u1", openingCash: 1000 });
    const { movementId } = await cobrar();
    await anular(movementId);

    const cerrada = await closeCashSession(db, { storeId: store, sessionId: caja.id, userId: "u1", countedCash: 1000 });
    expect(cerrada.expectedCash).toBe(1000);
    expect(cerrada.difference).toBe(0);
  });

  it("un cobro en efectivo de una caja ya cerrada no se anula: el arqueo firmado no cambia", async () => {
    const caja = await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    const { movementId } = await cobrar();
    const cerrada = await closeCashSession(db, { storeId: store, sessionId: caja.id, userId: "u1", countedCash: 3000 });

    await expect(anular(movementId)).rejects.toThrow("CASH_SESSION_CLOSED");
    expect((await getCashSessionClose(db, store, caja.id))!.efectivoEsperado).toBe(cerrada.expectedCash);
  });

  it("una transferencia se anula aunque la caja de ese día ya esté cerrada: nunca estuvo en el cajón", async () => {
    const caja = await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    const { movementId } = await cobrar({ method: "transferencia" });
    await closeCashSession(db, { storeId: store, sessionId: caja.id, userId: "u1", countedCash: 0 });
    await expect(anular(movementId)).resolves.toMatchObject({ clientId });
  });

  it("el ledger ofrece anular solo lo que el dominio acepta", async () => {
    const caja = await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "cuenta", clientId,
      items: [{ variantId, quantity: 1 }],
    });
    const efectivo = await cobrar({ amount: 100 });
    const transferencia = await cobrar({ amount: 200, method: "transferencia" });
    await closeCashSession(db, { storeId: store, sessionId: caja.id, userId: "u1", countedCash: 100 });

    const porId = new Map((await getClientLedger(db, store, clientId)).map((e) => [e.id, e]));
    expect(porId.get(efectivo.movementId)!.anulable).toBe(false);      // caja cerrada
    expect(porId.get(transferencia.movementId)!.anulable).toBe(true);
    const cargo = [...porId.values()].find((e) => e.type === "cargo")!;
    expect(cargo.anulable).toBe(false);                                  // es de una venta
  });
});

describe("motivoNoAnulable", () => {
  const base = { type: "pago" as const, saleId: null, cashSessionId: null, voided: false };
  it("un cobro sin caja siempre se puede", () => {
    expect(motivoNoAnulable(base, true)).toBeNull();
  });
  it("el orden de los motivos: primero lo ya anulado", () => {
    expect(motivoNoAnulable({ ...base, voided: true, cashSessionId: 1 }, true)).toBe("ALREADY_VOIDED");
  });
  it("un cargo manual se puede; el de una venta no", () => {
    expect(motivoNoAnulable({ ...base, type: "cargo" }, false)).toBeNull();
    expect(motivoNoAnulable({ ...base, type: "cargo", saleId: 7 }, false)).toBe("SALE_CHARGE_NOT_VOIDABLE");
  });
  it("atado a una caja: depende de si está cerrada", () => {
    expect(motivoNoAnulable({ ...base, cashSessionId: 1 }, false)).toBeNull();
    expect(motivoNoAnulable({ ...base, cashSessionId: 1 }, true)).toBe("CASH_SESSION_CLOSED");
  });
});

describe("recordAccountAdjustment: sumar y restar deuda sin plata", () => {
  const ajustar = (kind: "cargo" | "ajuste", amount: number, extra: Record<string, unknown> = {}) =>
    recordAccountAdjustment(db, {
      storeId: store, clientId, kind, amount, reason: "libreta de papel", userId: "ana", ...extra,
    } as any);

  it("un cargo manual suma y un ajuste resta, sin medio, sin caja y con el motivo como nota", async () => {
    // Sin caja abierta a propósito: no la necesitan porque no mueven plata.
    expect((await ajustar("cargo", 10000)).balance).toBe(10000);
    expect((await ajustar("ajuste", 2500, { reason: "  descuento acordado  " })).balance).toBe(7500);

    const filas = await db.select().from(clientAccountMovements).where(eq(clientAccountMovements.clientId, clientId));
    for (const f of filas) {
      expect(f).toMatchObject({ saleId: null, method: null, cashSessionId: null, createdBy: "ana" });
    }
    expect(filas.find((f: any) => f.type === "ajuste")!.note).toBe("descuento acordado");
  });

  it("exige motivo", async () => {
    await expect(ajustar("cargo", 100, { reason: " " })).rejects.toThrow("MOTIVO_REQUIRED");
    await expect(ajustar("ajuste", 100, { reason: "ok" })).rejects.toThrow("MOTIVO_REQUIRED");
  });

  it("rechaza montos no positivos, tipos que no son de ajuste y clientes de otra tienda", async () => {
    await expect(ajustar("cargo", 0)).rejects.toThrow("INVALID_AMOUNT");
    await expect(ajustar("pago" as any, 100)).rejects.toThrow("INVALID_KIND");
    await expect(
      recordAccountAdjustment(db, { storeId: otra, clientId, kind: "cargo", amount: 100, reason: "de otra", userId: "u2" })
    ).rejects.toThrow("CLIENT_NOT_FOUND");
  });

  it("un ajuste mayor que la deuda deja saldo a favor: sin tope, por decisión del comercio", async () => {
    await ajustar("cargo", 1000);
    expect((await ajustar("ajuste", 1500)).balance).toBe(-500);
  });

  it("no toca la caja: el esperado sigue siendo solo la apertura", async () => {
    const caja = await openCashSession(db, { storeId: store, userId: "u1", openingCash: 700 });
    await ajustar("cargo", 5000);
    await ajustar("ajuste", 2000);
    const cerrada = await closeCashSession(db, { storeId: store, sessionId: caja.id, userId: "u1", countedCash: 700 });
    expect(cerrada.expectedCash).toBe(700);
  });

  it("el resumen separa los cargos manuales de lo comprado y los ajustes de lo pagado", async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "cuenta", clientId,
      items: [{ variantId, quantity: 3 }],
    });
    await ajustar("cargo", 800);
    await ajustar("ajuste", 300);
    await cobrar({ amount: 1000, method: "transferencia" });

    expect(await getClientSummary(db, store, clientId)).toMatchObject({
      charged: 3000, manualCharged: 800, adjusted: 300, paid: 1000, purchases: 1,
      balance: 2500,
    });
    expect(await getClientBalance(db, store, clientId)).toBe(2500);
  });

  it("un cargo manual o un ajuste se pueden anular", async () => {
    const { movementId } = await ajustar("ajuste", 400);
    await voidAccountMovement(db, { storeId: store, movementId, userId: "u1", reason: "era a otro cliente" });
    expect(await getClientBalance(db, store, clientId)).toBe(0);
  });
});

describe("recordAccountMovement valida el medio", () => {
  it("rechaza 'cuenta' y medios inventados", async () => {
    await expect(cobrar({ method: "cuenta" })).rejects.toThrow("INVALID_METHOD");
    await expect(cobrar({ method: "bitcoin" })).rejects.toThrow("INVALID_METHOD");
  });
});
