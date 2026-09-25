import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { clientAccountMovements, products, productVariants } from "@/db/schema";
import { openCashSession, closeCashSession } from "@/domain/cash";
import { getCashSessionClose } from "@/domain/cash-close";
import { createSale } from "@/domain/sales";
import {
  createClient, getClientBalance, getClientLedger, getClientSummary, listClientsWithBalance,
  recordAccountMovement,
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
