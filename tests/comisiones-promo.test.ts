import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { products, productVariants } from "@/db/schema";
import { openCashSession } from "@/domain/cash";
import { createSale, voidSale } from "@/domain/sales";
import { getSellerSalesSummary } from "@/domain/reports";
import { eq } from "drizzle-orm";

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
