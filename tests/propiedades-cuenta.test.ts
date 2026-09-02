import { describe, it, expect, beforeAll } from "vitest";
import fc from "fast-check";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { products, productVariants } from "@/db/schema";
import { openCashSession } from "@/domain/cash";
import { createSale, voidSale } from "@/domain/sales";
import {
  createClient, recordAccountMovement, getClientBalance, getClientLedger, getClientSummary,
} from "@/domain/clients";

/**
 * El saldo de un cliente, calculado de tres formas que no pueden diferir.
 *
 * El saldo se calcula en tres lugares distintos y con tres implementaciones
 * distintas:
 *
 *   1. `balanceExpr`, en SQL, un CASE agregado  → lo usa /clientes
 *   2. `getClientSummary.balance`, en JS, restando totales → lo usa /clientes/[id]
 *   3. `balanceAfter` del último asiento del ledger, un acumulado
 *
 * Si divergen, dos pantallas muestran dos números para el mismo cliente y no
 * hay forma de saber cuál creerle. Ese bug ya apareció una vez —al agregar el
 * tipo `credito`, la cuenta en JS no lo contemplaba— y lo agarró un test de
 * ejemplo por casualidad. Esta propiedad lo agarra siempre, sobre secuencias
 * arbitrarias de movimientos.
 */

const PRECIO = 1000;

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number, variantId: number;

beforeAll(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);

  const [p] = await db.insert(products)
    .values({ storeId: store, name: "Sobre", basePrice: PRECIO }).returning();
  const [v] = await db.insert(productVariants)
    .values({ storeId: store, productId: p.id, name: "", stock: 1_000_000 }).returning();
  variantId = v.id;

  await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
});

type Mov =
  | { t: "compra"; cantidad: number; anular: boolean }
  | { t: "movimiento"; kind: "pago" | "credito"; monto: number };

const mov: fc.Arbitrary<Mov> = fc.oneof(
  fc.record({
    t: fc.constant("compra" as const),
    cantidad: fc.integer({ min: 1, max: 5 }),
    anular: fc.boolean(),
  }),
  fc.record({
    t: fc.constant("movimiento" as const),
    kind: fc.constantFrom("pago" as const, "credito" as const),
    monto: fc.integer({ min: 1, max: 500_000 }).map((c) => c / 100),
  })
);

describe("el saldo del cliente", () => {
  it("da lo mismo por las tres vías, con cualquier historia de movimientos", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(mov, { minLength: 1, maxLength: 8 }), async (movs) => {
        // Cliente nuevo por corrida: la historia tiene que ser independiente.
        const { id: clientId } = await createClient(db, { storeId: store, name: `C${Math.random()}` });

        for (const m of movs) {
          if (m.t === "compra") {
            const venta = await createSale(db, {
              storeId: store, sellerId: "u1", paymentMethod: "cuenta", clientId,
              items: [{ variantId, quantity: m.cantidad }],
            });
            if (m.anular) {
              await voidSale(db, { saleId: venta.id, storeId: store, userId: "u1", reason: "prueba" });
            }
          } else {
            await recordAccountMovement(db, {
              storeId: store, clientId, kind: m.kind, amount: m.monto,
              // Transferencia para no arrastrar la caja a este test: acá lo que
              // se prueba es el saldo, no el arqueo.
              method: "transferencia", userId: "u1",
            });
          }
        }

        const enSql = await getClientBalance(db, store, clientId);
        const enJs = (await getClientSummary(db, store, clientId)).balance;
        const ledger = await getClientLedger(db, store, clientId);
        // El ledger vuelve del más nuevo al más viejo.
        const acumulado = ledger[0].balanceAfter;

        expect(enJs).toBe(enSql);
        expect(acumulado).toBe(enSql);
      }),
      { numRuns: 40 }
    );
  }, 120_000);

  it("una compra anulada deja el saldo como si no hubiera existido", async () => {
    // La anulación inserta un movimiento propio en vez de borrar el cargo, para
    // que el historial muestre qué pasó. El saldo tiene que volver igual.
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (cantidad) => {
        const { id: clientId } = await createClient(db, { storeId: store, name: `A${Math.random()}` });
        const antes = await getClientBalance(db, store, clientId);

        const venta = await createSale(db, {
          storeId: store, sellerId: "u1", paymentMethod: "cuenta", clientId,
          items: [{ variantId, quantity: cantidad }],
        });
        await voidSale(db, { saleId: venta.id, storeId: store, userId: "u1", reason: "prueba" });

        expect(await getClientBalance(db, store, clientId)).toBe(antes);
      }),
      { numRuns: 15 }
    );
  }, 60_000);

  it("cargar crédito nunca cuenta como pago de una deuda", async () => {
    // Es la razón entera por la que `credito` es un tipo propio y no un `pago`:
    // "Total pagado" no puede incluir plata que no canceló nada.
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 500_000 }).map((c) => c / 100), { minLength: 1, maxLength: 5 }),
        async (montos) => {
          const { id: clientId } = await createClient(db, { storeId: store, name: `K${Math.random()}` });
          for (const monto of montos) {
            await recordAccountMovement(db, {
              storeId: store, clientId, kind: "credito", amount: monto,
              method: "transferencia", userId: "u1",
            });
          }
          const r = await getClientSummary(db, store, clientId);
          const total = Math.round(montos.reduce((a, b) => a + b, 0) * 100) / 100;

          expect(r.paid).toBe(0);
          expect(r.credited).toBe(total);
          expect(r.balance).toBe(-total);
        }
      ),
      { numRuns: 20 }
    );
  }, 60_000);
});
