import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { products, productVariants, sales, saleItems } from "@/db/schema";
import { openCashSession } from "@/domain/cash";
import { createSale } from "@/domain/sales";
import { replaySale } from "@/domain/sales-replay";
import { savePricingConfig } from "@/domain/pricing-config";
import { crearLoteRecalculo, confirmarLoteRecalculo } from "@/domain/pricing-recalc";
import { eq } from "drizzle-orm";

/**
 * Recalcular precios no reescribe plata ya cobrada.
 *
 * Es la garantía que hace desplegable esta feature en dos locales que venden
 * todos los días: el dueño puede mover el dólar sin miedo a que cambien los
 * totales de ayer, las comisiones de un período cerrado o un comprobante
 * emitido.
 */

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number, variantId: number, cashSessionId: number;

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);

  const [p] = await db.insert(products)
    .values({ storeId: store, name: "Sobre", basePrice: 10000, basePriceUsd: 10 }).returning();
  const [v] = await db.insert(productVariants)
    .values({ storeId: store, productId: p.id, name: "", stock: 100 }).returning();
  variantId = v.id;

  const caja = await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
  cashSessionId = caja.id;

  await savePricingConfig(db, { storeId: store, userId: "u1", usdRate: 1480 });
});

const recalcular = async () => {
  const lote = await crearLoteRecalculo(db, { storeId: store, userId: "u1" });
  await confirmarLoteRecalculo(db, store, lote.batchId);
};

const vender = () =>
  createSale(db, {
    storeId: store, sellerId: "u1", paymentMethod: "efectivo",
    items: [{ variantId, quantity: 1 }],
  });

describe("el pasado", () => {
  it("la venta de ayer conserva su precio y su total", async () => {
    const venta = await vender();
    expect(venta.total).toBe(10000);

    await recalcular();

    const [linea] = await db.select().from(saleItems).where(eq(saleItems.saleId, venta.id));
    expect(linea.unitPrice).toBe(10000);
    const [guardada] = await db.select().from(sales).where(eq(sales.id, venta.id));
    expect(guardada.total).toBe(10000);
  });

  it("la lista y la promo estampadas tampoco se tocan", async () => {
    const venta = await vender();
    await recalcular();

    const [linea] = await db.select().from(saleItems).where(eq(saleItems.saleId, venta.id));
    expect(linea.priceList).toBe("venta");
    expect(linea.isPromo).toBe(false);
  });
});

describe("el presente y lo que llega tarde", () => {
  it("la venta nueva cobra el precio nuevo", async () => {
    await recalcular();
    const venta = await vender();
    expect(venta.total).toBe(14800);
  });

  it("la venta sincronizada desde offline se registra al precio COBRADO, y avisa", async () => {
    await recalcular();

    const r = await replaySale(db, {
      storeId: store, sellerId: "u1",
      venta: {
        uid: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
        capturadoEn: new Date().toISOString(),
        cashSessionId,
        paymentMethod: "efectivo",
        // Se cobró en la feria antes del recálculo.
        items: [{ variantId, quantity: 1, unitPrice: 10000 }],
      },
    });

    const [sincronizada] = await db.select().from(sales).where(eq(sales.id, r.saleId!));
    // Recotizar plata ya cobrada seria peor que el problema: se registra lo que
    // el cliente pago y la diferencia se avisa.
    expect(sincronizada.total).toBe(10000);
    expect(r.avisos.some((a: string) => /precio distinto/i.test(a))).toBe(true);
  });
});
