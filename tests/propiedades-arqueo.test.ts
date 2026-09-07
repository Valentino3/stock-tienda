import { describe, it, expect, beforeAll } from "vitest";
import fc from "fast-check";
import { sql as sqlRaw } from "drizzle-orm";
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
 *              + la PARTE en efectivo de las ventas NO anuladas
 *              + cobros de cuenta corriente en efectivo
 *              − gastos y egresos
 *
 * Desde el pago dividido una venta puede repartirse entre varios medios, así
 * que el modelo suma por bucket: lo que entra al cajón es la parte en efectivo,
 * no el total de la venta. Cada corrida verifica además que los pagos de toda
 * venta sumen su total — la invariante que sostiene que `sales.payment_method`
 * sea un dato denormalizado y no una segunda fuente de verdad.
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
  | { t: "venta"; medios: Metodo[]; pesos: number[]; cantidad: number; anular: boolean }
  | { t: "salida"; kind: "gasto" | "egreso"; monto: number }
  | { t: "cuenta"; kind: "pago" | "credito"; metodo: "efectivo" | "transferencia"; monto: number };

const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    t: fc.constant("venta" as const),
    // Uno a cuatro medios sobre la misma venta. `uniqueArray` porque el
    // dominio consolida los repetidos y el test no está probando eso acá.
    medios: fc.uniqueArray(
      fc.constantFrom<Metodo>("efectivo", "transferencia", "tarjeta", "cuenta"),
      { minLength: 1, maxLength: 4 },
    ),
    // Pesos con los que se reparte el total. Se generan pesos y no montos
    // sueltos para que la partición sume el total POR CONSTRUCCIÓN: con montos
    // libres, fast-check descartaría casi todo lo que genera.
    pesos: fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 4, maxLength: 4 }),
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

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Reparte un total entre varios medios. Escrito acá y no importado del
 * dominio: el modelo tiene que ser independiente de lo que verifica.
 *
 * La última parte es el RESTO y no un porcentaje redondeado: así la suma da el
 * total exacto por construcción, sin depender de que dos redondeos coincidan.
 */
function repartir(total: number, medios: Metodo[], pesos: number[]) {
  const w = pesos.slice(0, medios.length);
  const suma = w.reduce((a, b) => a + b, 0);
  const partes = w.map((peso) => round2((total * peso) / suma));
  partes[partes.length - 1] = round2(total - partes.slice(0, -1).reduce((a, b) => a + b, 0));
  return medios.map((method, i) => ({ method, amount: partes[i] }));
}

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
        // Un bucket por medio, porque una venta ya no cae entera en uno solo.
        const ventas: Record<Metodo, number> = {
          efectivo: 0, transferencia: 0, tarjeta: 0, cuenta: 0,
        };
        let cobrosEfectivo = 0, salidas = 0;

        for (const o of ops) {
          if (o.t === "venta") {
            const pagos = repartir(PRECIO * o.cantidad, o.medios, o.pesos);
            const venta = await createSale(db, {
              storeId: store, sellerId: "u1", pagos,
              clientId: pagos.some((p) => p.method === "cuenta") ? clientId : undefined,
              items: [{ variantId, quantity: o.cantidad }],
            });
            if (o.anular) {
              await voidSale(db, { saleId: venta.id, storeId: store, userId: "u1", reason: "prueba" });
            } else {
              for (const p of pagos) ventas[p.method] = round2(ventas[p.method] + p.amount);
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
            if (o.metodo === "efectivo") cobrosEfectivo += o.monto;
          }
        }

        const esperadoModelo = round2(inicial + ventas.efectivo + cobrosEfectivo - salidas);
        const cerrada = await closeCashSession(db, {
          storeId: store, sessionId: caja.id, userId: "u1", countedCash: esperadoModelo,
        });

        expect(cerrada.expectedCash).toBe(esperadoModelo);
        // Contar exactamente lo que el modelo dice tiene que cuadrar.
        expect(cerrada.difference).toBe(0);

        // Los otros dos buckets que el cierre persiste. Antes nadie los
        // pinchaba: con un solo medio por venta era casi imposible equivocarse,
        // y con pago dividido es justo donde se mete la parte equivocada.
        expect(cerrada.totalTransfer).toBe(round2(ventas.transferencia));
        expect(cerrada.totalCard).toBe(round2(ventas.tarjeta));

        // Y la hoja impresa no puede decir otra cosa que el sistema.
        const hoja = (await getCashSessionClose(db, store, caja.id))!;
        expect(hoja.efectivoEsperado).toBe(cerrada.expectedCash);
        // Ata la SEGUNDA agrupación al modelo COMPLETO, no solo a su tajada de
        // efectivo: es la que se rompe con pago dividido.
        for (const m of ["efectivo", "transferencia", "tarjeta", "cuenta"] as Metodo[]) {
          expect(hoja.porMedio.find((x) => x.method === m)?.total ?? 0).toBe(round2(ventas[m]));
        }

        // Ninguna venta puede quedar con pagos que no sumen su total, ni sin
        // pagos. Es lo que hace que `sales.payment_method` pueda ser un dato
        // denormalizado sin volverse una segunda fuente de verdad.
        const descuadres = await db.execute(sqlRaw`
          select s.id from sales s
          left join sale_payments p on p.sale_id = s.id
          group by s.id, s.total
          having coalesce(round(sum(p.amount), 2), -1) <> s.total`);
        const filas = Array.isArray(descuadres) ? descuadres : (descuadres as any).rows;
        expect(filas).toEqual([]);
      }),
      // Cada corrida abre, opera y cierra una caja real contra PGlite. 60 son
      // ~450 secuencias distintas de operaciones y la suite sigue siendo
      // corrible en cada push.
      { numRuns: 60 }
    );
  }, 120_000);
});
