import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { products, productVariants } from "@/db/schema";
import { openCashSession } from "@/domain/cash";
import { createSale, voidSale } from "@/domain/sales";
import { getSellerSalesSummary } from "@/domain/reports";
import { eq } from "drizzle-orm";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Base de comisiones partida entre promo y no promo.
 *
 * El invariante que protege esta suite: `normal + promo === total`, SIEMPRE.
 * La tabla "Ventas por empleado" muestra `total` justo arriba de las dos
 * bases en la misma pantalla, así que un centavo de diferencia se reporta
 * como bug — y con razón, porque es plata que se le paga a alguien.
 */

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;
let normalV: number, promoV: number;

const RANGO = { from: new Date(Date.now() - 86400000), to: new Date(Date.now() + 86400000) };

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);

  const [p1] = await db.insert(products).values({ storeId: store, name: "Normal", basePrice: 1000 }).returning();
  const [v1] = await db.insert(productVariants)
    .values({ storeId: store, productId: p1.id, name: "", stock: 100 }).returning();
  normalV = v1.id;

  const [p2] = await db.insert(products)
    .values({ storeId: store, name: "En promo", basePrice: 300, isPromo: true }).returning();
  const [v2] = await db.insert(productVariants)
    .values({ storeId: store, productId: p2.id, name: "", stock: 100 }).returning();
  promoV = v2.id;

  await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
});

const vender = (items: any[], extra: any = {}) =>
  createSale(db, { storeId: store, sellerId: "u1", paymentMethod: "efectivo", items, ...extra });

const resumen = async () => (await getSellerSalesSummary(db, store, RANGO))[0];

describe("getSellerSalesSummary con promo", () => {
  it("separa lo vendido en promo de lo demás", async () => {
    await vender([{ variantId: normalV, quantity: 2 }, { variantId: promoV, quantity: 1 }]);

    const r = await resumen();
    expect(r.total).toBe(2300);
    expect(r.normal).toBe(2000);
    expect(r.promo).toBe(300);
  });

  it("normal + promo da exactamente el total, aun con descuento general", async () => {
    // 2000 + 300 = 2300, menos 7% = 2139. El descuento vive en la cabecera y
    // no se puede atribuir a una línea: se reparte, y `normal` es el resto.
    await vender(
      [{ variantId: normalV, quantity: 2 }, { variantId: promoV, quantity: 1 }],
      { saleDiscount: { kind: "percent", value: 7 } },
    );

    const r = await resumen();
    expect(r.normal + r.promo).toBe(r.total);
    expect(r.total).toBe(2139);
  });

  it("el invariante aguanta con importes que no dividen redondo", async () => {
    for (const pct of [3, 11, 33]) {
      await vender(
        [{ variantId: normalV, quantity: 3 }, { variantId: promoV, quantity: 7 }],
        { saleDiscount: { kind: "percent", value: pct } },
      );
    }
    const r = await resumen();
    expect(r.normal + r.promo).toBe(r.total);
  });

  it("una venta sin nada en promo deja promo en cero", async () => {
    await vender([{ variantId: normalV, quantity: 1 }]);
    const r = await resumen();
    expect(r.promo).toBe(0);
    expect(r.normal).toBe(r.total);
  });

  it("apagar la promo después NO mueve la base de un período ya vendido", async () => {
    await vender([{ variantId: promoV, quantity: 1 }]);
    const antes = await resumen();

    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, promoV));
    await db.update(products).set({ isPromo: false }).where(eq(products.id, v.productId));

    const despues = await resumen();
    expect(despues.promo).toBe(antes.promo);
    expect(despues.promo).toBe(300);
  });

  it("las anuladas no cuentan en ninguna de las bases", async () => {
    const venta = await vender([{ variantId: promoV, quantity: 1 }]);
    await vender([{ variantId: normalV, quantity: 1 }]);
    await voidSale(db, { saleId: venta.id, storeId: store, userId: "u1", reason: "prueba" });

    const r = await resumen();
    expect(r.count).toBe(1);
    expect(r.promo).toBe(0);
    expect(r.total).toBe(1000);
  });

  it("lo vendido a cuenta se informa aparte y NO se resta del total", async () => {
    const [cliente] = await db.insert((await import("@/db/schema")).clients)
      .values({ storeId: store, name: "Fiado" }).returning();

    await vender([{ variantId: normalV, quantity: 1 }]);
    await vender([{ variantId: normalV, quantity: 2 }], {
      paymentMethod: "cuenta", clientId: cliente.id,
    });

    const r = await resumen();
    expect(r.total).toBe(3000);
    expect(r.aCuenta).toBe(2000);
    // El total las incluye: quién comisiona por un fiado es decisión del
    // comercio, y el sistema no la toma por él.
    expect(r.normal + r.promo).toBe(3000);
  });
});

/**
 * 🔴 La atribución, contra cualquier reparto de vendedor y registrador.
 *
 * El mostrador ahora deja elegir a quién se le acredita una venta, y sobre esa
 * columna se liquidan comisiones. El riesgo no es que el número esté un poco
 * mal: es que el resumen agrupe por la columna equivocada y le pague a quien
 * apretó el botón en vez de a quien vendió, o que se pierda plata al agrupar.
 *
 * Se genera el reparto en vez de enumerar casos porque lo que hay que saber no
 * es que un caso anda, sino que ninguna combinación de (vendedor, registrador)
 * puede mover plata de un empleado a otro ni hacerla desaparecer.
 */
describe("atribución por vendedor", () => {
  const EMPLEADOS = ["ana", "beto", "caro"] as const;

  beforeEach(async () => {
    for (const e of EMPLEADOS) await seedTestUser(db, e, "employee", store);
  });

  it("no pierde ni inventa plata para ningún reparto de vendedor/registrador", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            vendedor: fc.constantFrom(...EMPLEADOS),
            registrador: fc.constantFrom(...EMPLEADOS),
            cantidad: fc.integer({ min: 1, max: 3 }),
            promo: fc.boolean(),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        async (ventas) => {
          // Base propia por corrida: la propiedad se afirma sobre lo que ella
          // misma vendió, no sobre lo que dejó la corrida anterior.
          db = await createTestDb();
          store = await seedTestStore(db);
          await seedTestUser(db, "u1", "owner", store);
          for (const e of EMPLEADOS) await seedTestUser(db, e, "employee", store);
          const [p1] = await db.insert(products)
            .values({ storeId: store, name: "Normal", basePrice: 1000 }).returning();
          const [v1] = await db.insert(productVariants)
            .values({ storeId: store, productId: p1.id, name: "", stock: 1000 }).returning();
          const [p2] = await db.insert(products)
            .values({ storeId: store, name: "En promo", basePrice: 300, isPromo: true }).returning();
          const [v2] = await db.insert(productVariants)
            .values({ storeId: store, productId: p2.id, name: "", stock: 1000 }).returning();
          await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });

          // El modelo: la suma esperada por vendedor, escrita acá y sin mirar
          // el dominio.
          const esperado = new Map<string, number>();
          for (const v of ventas) {
            const venta = await createSale(db, {
              storeId: store,
              sellerId: v.vendedor,
              registeredBy: v.registrador,
              paymentMethod: "efectivo",
              items: [{ variantId: v.promo ? v2.id : v1.id, quantity: v.cantidad }],
            });
            esperado.set(v.vendedor, round2((esperado.get(v.vendedor) ?? 0) + venta.total));
          }

          const filas = await getSellerSalesSummary(db, store, RANGO);
          const porId = new Map(filas.map((f) => [f.sellerId, f]));

          // 1. Cada vendedor recibe exactamente lo suyo. Si el resumen agrupara
          //    por el registrador, esto falla en cuanto los dos difieren.
          for (const [sellerId, total] of esperado) {
            expect(porId.get(sellerId)?.total).toBe(total);
          }

          // 2. Nadie que solo registró aparece como vendedor: es la forma que
          //    toma un bug de agrupación por la columna equivocada.
          for (const f of filas) expect(esperado.has(f.sellerId)).toBe(true);

          // 3. No se pierde ni se inventa plata en el agrupamiento.
          const totalSistema = round2(filas.reduce((a, f) => a + f.total, 0));
          const totalModelo = round2([...esperado.values()].reduce((a, b) => a + b, 0));
          expect(totalSistema).toBe(totalModelo);

          // 4. El invariante de siempre sigue valiendo con registrador distinto.
          for (const f of filas) expect(round2(f.normal + f.promo)).toBe(f.total);
        },
      ),
      // Cada corrida arma una base entera contra PGlite: 25 alcanzan para
      // recorrer los repartios que importan sin volver la suite incorrible.
      { numRuns: 25 },
    );
  }, 120_000);
});
