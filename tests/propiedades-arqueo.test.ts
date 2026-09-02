import { describe, it, expect, beforeAll } from "vitest";
import fc from "fast-check";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { products, productVariants } from "@/db/schema";
import { openCashSession, closeCashSession, createCashMovement, getOpenSession } from "@/domain/cash";
import { getCashSessionClose } from "@/domain/cash-close";
import { createSale, voidSale } from "@/domain/sales";
import { createClient, recordAccountMovement } from "@/domain/clients";

/**
 * 🔴 El arqueo, contra un modelo independiente.
 *
 * Esta es la prueba que más cerca está de lo que se verifica a mano vendiendo
 * de verdad: arma un turno con una secuencia CUALQUIERA de operaciones —ventas
 * por los cuatro medios, anulaciones, gastos, egresos, cobros y créditos de
 * cuenta corriente— y después compara el esperado que calculó el sistema
 * contra el que calcula una suma escrita acá, en el test, sin mirar el dominio.
 *
 *     esperado = inicial
 *              + ventas en efectivo NO anuladas
 *              + cobros de cuenta corriente en efectivo
 *              − gastos y egresos
 *
 * Un test de ejemplo prueba una secuencia. Éste prueba las que a nadie se le
 * ocurren: anular la única venta en efectivo del turno, un crédito por
 * transferencia entre dos gastos, cobrar fiado y después anular la venta que lo
 * originó. Son justo las que rompen un arqueo en un local real.
 *
 * De paso verifica, en cada corrida, que las DOS fórmulas del esperado —la de
 * `closeCashSession` y la de la hoja impresa— den lo mismo. Viven en archivos
 * distintos y nada más que esto las ata.
 */

const PRECIO = 1000;

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number, variantId: number, clientId: number;

beforeAll(async () => {
  // Una sola base para todas las corridas: rearmarla por corrida costaría
  // ~1,2 s cada vez y esto tiene que poder correr en CI sin dolor.
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);

  const [p] = await db.insert(products)
    .values({ storeId: store, name: "Sobre", basePrice: PRECIO }).returning();
  const [v] = await db.insert(productVariants)
    .values({ storeId: store, productId: p.id, name: "", stock: 1_000_000 }).returning();
  variantId = v.id;

  clientId = (await createClient(db, { storeId: store, name: "Cliente" })).id;
});

type Metodo = "efectivo" | "transferencia" | "tarjeta" | "cuenta";

type Op =
  | { t: "venta"; metodo: Metodo; cantidad: number; anular: boolean }
  | { t: "salida"; kind: "gasto" | "egreso"; monto: number }
  | { t: "cuenta"; kind: "pago" | "credito"; metodo: "efectivo" | "transferencia"; monto: number };

const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    t: fc.constant("venta" as const),
    metodo: fc.constantFrom<Metodo>("efectivo", "transferencia", "tarjeta", "cuenta"),
    cantidad: fc.integer({ min: 1, max: 5 }),
    anular: fc.boolean(),
  }),
  fc.record({
    t: fc.constant("salida" as const),
    kind: fc.constantFrom("gasto" as const, "egreso" as const),
    monto: fc.integer({ min: 1, max: 200_000 }).map((c) => c / 100),
  }),
  fc.record({
    t: fc.constant("cuenta" as const),
    kind: fc.constantFrom("pago" as const, "credito" as const),
    metodo: fc.constantFrom("efectivo" as const, "transferencia" as const),
    monto: fc.integer({ min: 1, max: 500_000 }).map((c) => c / 100),
  })
);

const turno = fc.record({
  inicial: fc.integer({ min: 0, max: 500_000 }).map((c) => c / 100),
  ops: fc.array(op, { minLength: 0, maxLength: 8 }),
});

describe("el esperado de la caja", () => {
  it("coincide con el modelo para cualquier secuencia de operaciones", async () => {
    await fc.assert(
      fc.asyncProperty(turno, async ({ inicial, ops }) => {
        // Una corrida anterior que falló pudo dejar la caja abierta.
        const colgada = await getOpenSession(db, store);
        if (colgada) {
          await closeCashSession(db, { storeId: store, sessionId: colgada.id, userId: "u1", countedCash: 0 });
        }

        const caja = await openCashSession(db, { storeId: store, userId: "u1", openingCash: inicial });

        // El modelo: la misma suma, escrita a mano y sin mirar el dominio.
        let efectivo = 0, salidas = 0;

        for (const o of ops) {
          if (o.t === "venta") {
            const venta = await createSale(db, {
              storeId: store, sellerId: "u1", paymentMethod: o.metodo,
              clientId: o.metodo === "cuenta" ? clientId : undefined,
              items: [{ variantId, quantity: o.cantidad }],
            });
            if (o.anular) {
              await voidSale(db, { saleId: venta.id, storeId: store, userId: "u1", reason: "prueba" });
            } else if (o.metodo === "efectivo") {
              efectivo += venta.total;
            }
          } else if (o.t === "salida") {
            await createCashMovement(db, {
              storeId: store, sessionId: caja.id, kind: o.kind,
              amount: o.monto, description: "prueba", userId: "u1",
            });
            salidas += o.monto;
          } else {
            await recordAccountMovement(db, {
              storeId: store, clientId, kind: o.kind, amount: o.monto,
              method: o.metodo, userId: "u1",
            });
            if (o.metodo === "efectivo") efectivo += o.monto;
          }
        }

        const esperadoModelo = Math.round((inicial + efectivo - salidas) * 100) / 100;
        const cerrada = await closeCashSession(db, {
          storeId: store, sessionId: caja.id, userId: "u1", countedCash: esperadoModelo,
        });

        expect(cerrada.expectedCash).toBe(esperadoModelo);
        // Contar exactamente lo que el modelo dice tiene que cuadrar.
        expect(cerrada.difference).toBe(0);

        // Y la hoja impresa no puede decir otra cosa que el sistema.
        const hoja = (await getCashSessionClose(db, store, caja.id))!;
        expect(hoja.efectivoEsperado).toBe(cerrada.expectedCash);
      }),
      // Cada corrida abre, opera y cierra una caja real contra PGlite. 60 son
      // ~450 secuencias distintas de operaciones y la suite sigue siendo
      // corrible en cada push.
      { numRuns: 60 }
    );
  }, 120_000);
});
