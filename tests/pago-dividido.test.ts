import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { eq } from "drizzle-orm";
import { createTestDb, seedTestStore, seedTestUser } from "./helpers/db";
import { products, productVariants, salePayments, clientAccountMovements, sales } from "@/db/schema";
import { openCashSession } from "@/domain/cash";
import { createSale, voidSale } from "@/domain/sales";
import { createClient, getClientBalance } from "@/domain/clients";
import { normalizarPagos, medioPrincipal, sumaPagos, type Pago } from "@/domain/pagos";

/**
 * Pago dividido: una venta cobrada con varios medios.
 *
 * Lo que se protege acá es la parte que rompe plata: que los pagos sumen el
 * total, y que si una parte quedó fiada el cliente deba ESA parte y no el
 * total. Cargarle el total a alguien que pagó la mitad en efectivo es cobrarle
 * dos veces, y no se descubre hasta que reclama.
 */

const PRECIO = 1000;

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number, variantId: number, clientId: number;

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);
  const [p] = await db.insert(products)
    .values({ storeId: store, name: "Sobre", basePrice: PRECIO }).returning();
  const [v] = await db.insert(productVariants)
    .values({ storeId: store, productId: p.id, name: "", stock: 10_000 }).returning();
  variantId = v.id;
  clientId = (await createClient(db, { storeId: store, name: "Cliente" })).id;
  await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
});

const vender = (pagos: Pago[], cantidad = 10, extra: Record<string, unknown> = {}) =>
  createSale(db, {
    storeId: store, sellerId: "u1", pagos,
    clientId: pagos.some((p) => p.method === "cuenta") ? clientId : undefined,
    items: [{ variantId, quantity: cantidad }],
    ...extra,
  });

const pagosDe = (saleId: number) =>
  db.select().from(salePayments).where(eq(salePayments.saleId, saleId));

describe("createSale con pagos", () => {
  it("guarda una fila por medio y suma el total", async () => {
    // 10 x 1000 = 10.000, repartidos en tres medios.
    const venta = await vender([
      { method: "efectivo", amount: 5000 },
      { method: "tarjeta", amount: 3000 },
      { method: "cuenta", amount: 2000 },
    ]);
    const filas = await pagosDe(venta.id);
    expect(filas).toHaveLength(3);
    expect(sumaPagos(filas.map((f) => ({ method: f.method, amount: f.amount })))).toBe(10000);
  });

  it("fía SOLO la parte a cuenta, no el total", async () => {
    // Es la línea de una palabra que, si se olvida, le cobra dos veces al
    // cliente lo que ya pagó en efectivo.
    const venta = await vender([
      { method: "efectivo", amount: 8000 },
      { method: "cuenta", amount: 2000 },
    ]);
    const [cargo] = await db.select().from(clientAccountMovements)
      .where(eq(clientAccountMovements.saleId, venta.id));
    expect(cargo.type).toBe("cargo");
    expect(cargo.amount).toBe(2000);
    expect(await getClientBalance(db, store, clientId)).toBe(2000);
  });

  it("anular una venta mixta deja el saldo como si no hubiera existido", async () => {
    const venta = await vender([
      { method: "efectivo", amount: 8000 },
      { method: "cuenta", amount: 2000 },
    ]);
    await voidSale(db, { saleId: venta.id, storeId: store, userId: "u1", reason: "prueba" });
    expect(await getClientBalance(db, store, clientId)).toBe(0);
  });

  it("guarda el medio predominante en la venta", async () => {
    const venta = await vender([
      { method: "tarjeta", amount: 7000 },
      { method: "efectivo", amount: 3000 },
    ]);
    const [fila] = await db.select().from(sales).where(eq(sales.id, venta.id));
    expect(fila.paymentMethod).toBe("tarjeta");
  });

  it("rechaza pagos que no suman el total, sin dejar la venta a medias", async () => {
    await expect(vender([
      { method: "efectivo", amount: 5000 },
      { method: "tarjeta", amount: 3000 },
    ])).rejects.toThrow("PAYMENT_TOTAL_MISMATCH");
    expect(await db.select().from(sales)).toHaveLength(0);
  });

  it("rechaza montos no positivos y medios inventados", async () => {
    await expect(vender([{ method: "efectivo", amount: 0 }])).rejects.toThrow("INVALID_PAYMENT_AMOUNT");
    await expect(vender([{ method: "efectivo", amount: -1 }])).rejects.toThrow("INVALID_PAYMENT_AMOUNT");
    await expect(vender([{ method: "bitcoin" as never, amount: 10000 }]))
      .rejects.toThrow("INVALID_PAYMENT_METHOD");
  });

  it("exige cliente si alguna parte va a cuenta", async () => {
    await expect(createSale(db, {
      storeId: store, sellerId: "u1",
      pagos: [{ method: "efectivo", amount: 5000 }, { method: "cuenta", amount: 5000 }],
      items: [{ variantId, quantity: 10 }],
    })).rejects.toThrow("CLIENT_REQUIRED");
  });

  it("consolida dos pagos del mismo medio en una fila", async () => {
    // Dos líneas de tarjeta son indistinguibles: sumarlas no pierde nada, y
    // deja un pago por medio, que es lo que hace legible el arqueo.
    const venta = await vender([
      { method: "tarjeta", amount: 6000 },
      { method: "tarjeta", amount: 4000 },
    ]);
    const filas = await pagosDe(venta.id);
    expect(filas).toHaveLength(1);
    expect(filas[0].amount).toBe(10000);
  });

  it("no acepta las dos formas de pago a la vez ni ninguna", async () => {
    await expect(createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "efectivo",
      pagos: [{ method: "efectivo", amount: 10000 }],
      items: [{ variantId, quantity: 10 }],
    })).rejects.toThrow("PAYMENT_INPUT_INVALID");

    await expect(createSale(db, {
      storeId: store, sellerId: "u1", items: [{ variantId, quantity: 10 }],
    })).rejects.toThrow("PAYMENT_INPUT_INVALID");
  });

  it("una venta con un solo medio guarda su fila igual", async () => {
    // La no-regresión: es como entran gastronomía, el replay offline y los
    // seeds, y sin fila de pago esas ventas desaparecerían del arqueo.
    const venta = await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "transferencia",
      items: [{ variantId, quantity: 10 }],
    });
    const filas = await pagosDe(venta.id);
    expect(filas).toHaveLength(1);
    expect(filas[0].method).toBe("transferencia");
    expect(filas[0].amount).toBe(10000);
  });
});

/**
 * 🔴 La partición, contra cualquier reparto.
 *
 * La invariante es la que sostiene que `sales.payment_method` pueda ser un dato
 * denormalizado: si los pagos no suman el total, hay plata cobrada que no está
 * imputada a ningún medio y el arqueo de esa caja no puede cuadrar.
 */
describe("propiedades de la partición", () => {
  it("los pagos guardados suman siempre el total, y lo fiado es lo que se carga", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(
          fc.constantFrom<Pago["method"]>("efectivo", "transferencia", "tarjeta", "cuenta"),
          { minLength: 1, maxLength: 4 },
        ),
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 4, maxLength: 4 }),
        fc.integer({ min: 1, max: 20 }),
        async (medios, pesos, cantidad) => {
          const total = PRECIO * cantidad;
          const w = pesos.slice(0, medios.length);
          const suma = w.reduce((a, b) => a + b, 0);
          const partes = w.map((p) => Math.round((total * p * 100) / suma) / 100);
          // La última es el resto: la suma da el total exacto por construcción.
          partes[partes.length - 1] =
            Math.round((total - partes.slice(0, -1).reduce((a, b) => a + b, 0)) * 100) / 100;
          const pagos = medios.map((method, i) => ({ method, amount: partes[i] }));

          const venta = await vender(pagos, cantidad);
          const filas = await pagosDe(venta.id);

          expect(sumaPagos(filas.map((f) => ({ method: f.method, amount: f.amount })))).toBe(total);
          expect(venta.total).toBe(total);

          const fiado = pagos.filter((p) => p.method === "cuenta")
            .reduce((a, p) => a + p.amount, 0);
          const cargos = await db.select().from(clientAccountMovements)
            .where(eq(clientAccountMovements.saleId, venta.id));
          if (fiado > 0) {
            expect(cargos).toHaveLength(1);
            expect(cargos[0].amount).toBe(Math.round(fiado * 100) / 100);
          } else {
            expect(cargos).toHaveLength(0);
          }
        },
      ),
      { numRuns: 50 },
    );
  }, 120_000);
});

describe("helpers puros", () => {
  it("normalizar preserva la suma y deja un pago por medio", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            method: fc.constantFrom<Pago["method"]>("efectivo", "transferencia", "tarjeta", "cuenta"),
            amount: fc.integer({ min: 1, max: 100_000 }).map((c) => c / 100),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        (pagos) => {
          const n = normalizarPagos(pagos);
          expect(sumaPagos(n)).toBe(sumaPagos(pagos));
          expect(new Set(n.map((p) => p.method)).size).toBe(n.length);
          // El principal siempre es un medio realmente presente.
          expect(n.map((p) => p.method)).toContain(medioPrincipal(n));
        },
      ),
      { numRuns: 500 },
    );
  });

  it("el desempate del principal es determinista", () => {
    const a = medioPrincipal([{ method: "tarjeta", amount: 500 }, { method: "efectivo", amount: 500 }]);
    const b = medioPrincipal([{ method: "efectivo", amount: 500 }, { method: "tarjeta", amount: 500 }]);
    expect(a).toBe(b);
  });
});
