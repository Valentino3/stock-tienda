import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { clientAccountMovements, products, productVariants } from "@/db/schema";
import { openCashSession, closeCashSession, createCashMovement } from "@/domain/cash";
import { getCashSessionClose } from "@/domain/cash-close";
import { createClient, recordAccountMovement, getClientBalance, getClientLedger, getClientSummary } from "@/domain/clients";
import { createSale } from "@/domain/sales";
import { eq } from "drizzle-orm";

/**
 * 🔴 CAMINO DE PLATA. Saldo a favor y su impacto en el arqueo.
 *
 * Lo que protege, en orden de gravedad:
 *   1. Que el efectivo de una cuenta corriente sume al esperado. Si no, el
 *      cajón tiene plata que el cierre no explica.
 *   2. Que cobrar en efectivo sin caja abierta NO registre nada. El peor
 *      resultado posible es cobrar sin registrar, o registrar sin cobrar.
 *   3. Que las dos fórmulas del esperado —la de `closeCashSession` y la de la
 *      hoja impresa— no puedan divergir.
 */

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number, otra: number, clientId: number, variantId: number;

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  otra = await seedTestStore(db, "otra");
  await seedTestUser(db, "u1", "owner", store);

  const c = await createClient(db, { storeId: store, name: "Jugador Torneo" });
  clientId = c.id;

  const [p] = await db.insert(products)
    .values({ storeId: store, name: "Sobre", basePrice: 2000 }).returning();
  const [v] = await db.insert(productVariants)
    .values({ storeId: store, productId: p.id, name: "", stock: 100 }).returning();
  variantId = v.id;
});

const abrir = (openingCash = 0) =>
  openCashSession(db, { storeId: store, userId: "u1", openingCash });

const cerrar = (sessionId: number, countedCash: number) =>
  closeCashSession(db, { storeId: store, sessionId, userId: "u1", countedCash });

const cargar = (extra: Record<string, unknown> = {}) =>
  recordAccountMovement(db, {
    storeId: store, clientId, kind: "credito", amount: 20000,
    method: "efectivo", userId: "u1", ...extra,
  } as any);

describe("el efectivo de la cuenta corriente entra al arqueo", () => {
  it("un crédito en efectivo suma al esperado", async () => {
    const caja = await abrir(1000);
    await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "efectivo",
      items: [{ variantId, quantity: 1 }],
    });
    await cargar();

    const cerrada = await cerrar(caja.id, 23000);
    expect(cerrada.expectedCash).toBe(23000);
    expect(cerrada.difference).toBe(0);
  });

  it("un crédito por transferencia NO suma, y no se ata a ninguna caja", async () => {
    const caja = await abrir(1000);
    const { movementId } = await cargar({ method: "transferencia" });

    const [mov] = await db.select().from(clientAccountMovements)
      .where(eq(clientAccountMovements.id, movementId));
    expect(mov.cashSessionId).toBeNull();

    expect((await cerrar(caja.id, 1000)).expectedCash).toBe(1000);
  });

  it("un pago de fiado en efectivo también suma — antes era una diferencia fantasma", async () => {
    const caja = await abrir(0);
    await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "cuenta", clientId,
      items: [{ variantId, quantity: 1 }],
    });
    await cargar({ kind: "pago", amount: 2000 });

    // La venta fue a cuenta (no entró efectivo) y el pago sí. El cajón tiene
    // 2000 y ahora el esperado lo dice.
    const cerrada = await cerrar(caja.id, 2000);
    expect(cerrada.expectedCash).toBe(2000);
    expect(cerrada.difference).toBe(0);
  });

  it("los gastos siguen restando igual", async () => {
    const caja = await abrir(1000);
    await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "efectivo",
      items: [{ variantId, quantity: 1 }],
    });
    await cargar({ amount: 5000 });
    await createCashMovement(db, {
      storeId: store, sessionId: caja.id, kind: "gasto", amount: 300,
      description: "café", userId: "u1",
    });

    // 1000 + 2000 + 5000 − 300
    expect((await cerrar(caja.id, 7700)).expectedCash).toBe(7700);
  });

  it("no cuenta el efectivo de otra tienda", async () => {
    await seedTestUser(db, "u2", "owner", otra);
    const ajeno = await createClient(db, { storeId: otra, name: "De la otra" });
    await openCashSession(db, { storeId: otra, userId: "u2", openingCash: 0 });
    await recordAccountMovement(db, {
      storeId: otra, clientId: ajeno.id, kind: "credito", amount: 9999,
      method: "efectivo", userId: "u2",
    });

    const caja = await abrir(0);
    expect((await cerrar(caja.id, 0)).expectedCash).toBe(0);
  });
});

describe("caja abierta como precondición", () => {
  it("en efectivo sin caja abierta no cobra Y no registra nada", async () => {
    // El peor bug posible de esta feature sería dejar el movimiento a medias.
    await expect(cargar()).rejects.toThrow("NO_OPEN_SESSION");

    expect(await getClientBalance(db, store, clientId)).toBe(0);
    expect(await getClientLedger(db, store, clientId)).toHaveLength(0);
  });

  it("por transferencia sin caja abierta sí funciona", async () => {
    // Una transferencia puede entrar a las once de la noche. La asimetría es
    // deliberada.
    const { balance } = await cargar({ method: "transferencia" });
    expect(balance).toBe(-20000);
  });

  it("después de cerrar la caja tampoco deja cobrar en efectivo", async () => {
    const caja = await abrir(0);
    await cerrar(caja.id, 0);
    await expect(cargar()).rejects.toThrow("NO_OPEN_SESSION");
  });

  it("el cliente inexistente gana sobre la caja cerrada", async () => {
    // Sin este orden, el error menos informativo taparía al más informativo.
    await expect(recordAccountMovement(db, {
      storeId: store, clientId: 99999, kind: "credito", amount: 100,
      method: "efectivo", userId: "u1",
    })).rejects.toThrow("CLIENT_NOT_FOUND");
  });
});

describe("la hoja impresa no puede contradecir al sistema", () => {
  it("efectivoEsperado coincide con el expectedCash guardado", async () => {
    const caja = await abrir(500);
    await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "efectivo",
      items: [{ variantId, quantity: 2 }],
    });
    await cargar({ amount: 7500 });
    const cerrada = await cerrar(caja.id, 12000);

    const hoja = (await getCashSessionClose(db, store, caja.id))!;
    // Dos fórmulas, dos archivos. Si divergen, el papel dice una cosa y la
    // pantalla otra, y alguien pierde una hora buscando la diferencia.
    expect(hoja.efectivoEsperado).toBe(cerrada.expectedCash);
  });

  it("la hoja detalla el cobro con el nombre del cliente", async () => {
    const caja = await abrir(0);
    await cargar({ amount: 20000, note: "Inscripción torneo" });
    await cerrar(caja.id, 20000);

    const hoja = (await getCashSessionClose(db, store, caja.id))!;
    expect(hoja.efectivoCuenta).toBe(20000);
    expect(hoja.cobrosCuenta).toHaveLength(1);
    expect(hoja.cobrosCuenta[0].clientName).toBe("Jugador Torneo");
    expect(hoja.cobrosCuenta[0].type).toBe("credito");
  });

  it("los créditos no se cuelan en el total de salidas", async () => {
    const caja = await abrir(0);
    await cargar({ amount: 20000 });
    await createCashMovement(db, {
      storeId: store, sessionId: caja.id, kind: "egreso", amount: 500,
      description: "retiro", userId: "u1",
    });
    await cerrar(caja.id, 19500);

    const hoja = (await getCashSessionClose(db, store, caja.id))!;
    expect(hoja.totalSalidas).toBe(500);
  });
});

describe("saldo a favor", () => {
  it("un crédito deja el saldo negativo", async () => {
    await abrir(0);
    const { balance } = await cargar();
    expect(balance).toBe(-20000);
    expect(await getClientBalance(db, store, clientId)).toBe(-20000);
  });

  it("no cuenta como pago ni como compra", async () => {
    await abrir(0);
    await cargar();

    const resumen = await getClientSummary(db, store, clientId);
    expect(resumen.paid).toBe(0);
    expect(resumen.credited).toBe(20000);
    expect(resumen.purchases).toBe(0);
  });

  it("el resumen y el listado dan el MISMO saldo con la mezcla completa", async () => {
    // Son dos cuentas distintas —una en SQL, otra en JS— y si divergen,
    // /clientes y /clientes/[id] muestran dos números para el mismo cliente.
    await abrir(0);
    await cargar({ amount: 20000 });
    await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "cuenta", clientId,
      items: [{ variantId, quantity: 3 }],
    });
    await cargar({ kind: "pago", amount: 1000 });

    const resumen = await getClientSummary(db, store, clientId);
    expect(resumen.balance).toBe(await getClientBalance(db, store, clientId));
    // −20000 + 6000 − 1000
    expect(resumen.balance).toBe(-15000);
  });

  it("la venta a cuenta consume el crédito sola", async () => {
    await abrir(0);
    await cargar({ amount: 20000 });

    await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "cuenta", clientId,
      items: [{ variantId, quantity: 2 }],
    });
    expect(await getClientBalance(db, store, clientId)).toBe(-16000);

    // Y cuando se pasa, vuelve a deber.
    await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "cuenta", clientId,
      items: [{ variantId, quantity: 10 }],
    });
    expect(await getClientBalance(db, store, clientId)).toBe(4000);
  });

  it("el cargo de una venta nunca se ata a una caja", async () => {
    // La invariante de la columna: solo la completa el efectivo que entró
    // físicamente por cuenta corriente.
    await abrir(0);
    const venta = await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "cuenta", clientId,
      items: [{ variantId, quantity: 1 }],
    });

    const [cargo] = await db.select().from(clientAccountMovements)
      .where(eq(clientAccountMovements.saleId, venta.id));
    expect(cargo.type).toBe("cargo");
    expect(cargo.cashSessionId).toBeNull();
  });

  it("rechaza montos que no son plata", async () => {
    await abrir(0);
    await expect(cargar({ amount: 0 })).rejects.toThrow("INVALID_AMOUNT");
    await expect(cargar({ amount: -5 })).rejects.toThrow("INVALID_AMOUNT");
  });
});
