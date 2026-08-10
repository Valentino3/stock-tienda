import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { products, productVariants, sales, saleItems, stockMovements } from "@/db/schema";
import { openCashSession } from "@/domain/cash";
import { createSale, voidSale } from "@/domain/sales";
import { eq } from "drizzle-orm";

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;
let vId: number, vId2: number;

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);
  const [p] = await db.insert(products).values({ storeId: store, name: "Remera", basePrice: 1000 }).returning();
  const [v1] = await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "M", stock: 5 }).returning();
  const [v2] = await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "L", stock: 2, price: 1200 }).returning();
  vId = v1.id; vId2 = v2.id;
});

describe("createSale", () => {
  it("fails without open cash session", async () => {
    await expect(
      createSale(db, { storeId: store, sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId: vId, quantity: 1 }] })
    ).rejects.toThrow("NO_OPEN_SESSION");
  });

  it("creates sale, decrements stock, snapshots prices (variant override wins)", async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    const sale = await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "efectivo",
      items: [{ variantId: vId, quantity: 2 }, { variantId: vId2, quantity: 1 }],
    });
    expect(sale.total).toBe(3200); // 2*1000 + 1*1200
    const items = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    expect(items.map((i) => i.unitPrice).sort()).toEqual([1000, 1200]);
    const [v1] = await db.select().from(productVariants).where(eq(productVariants.id, vId));
    expect(v1.stock).toBe(3);
  });

  it("rolls back everything on insufficient stock", async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    await expect(
      createSale(db, {
        storeId: store, sellerId: "u1", paymentMethod: "efectivo",
        items: [{ variantId: vId, quantity: 1 }, { variantId: vId2, quantity: 99 }],
      })
    ).rejects.toThrow("INSUFFICIENT_STOCK");
    expect(await db.select().from(sales)).toHaveLength(0);
    const [v1] = await db.select().from(productVariants).where(eq(productVariants.id, vId));
    expect(v1.stock).toBe(5); // rollback del primer item
  });

  it("rejects empty sale", async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    await expect(createSale(db, { storeId: store, sellerId: "u1", paymentMethod: "efectivo", items: [] })).rejects.toThrow("EMPTY_SALE");
  });

  it("rejects fractional quantity", async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    await expect(
      createSale(db, { storeId: store, sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId: vId, quantity: 1.5 }] })
    ).rejects.toThrow("INVALID_QUANTITY");
  });
});

describe("createSale con descuentos", () => {
  it("aplica descuento por línea (monto fijo) y guarda el descuento en el ítem", async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    const sale = await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "efectivo",
      items: [{ variantId: vId, quantity: 2, discount: { kind: "amount", value: 300 } }], // 2*1000 - 300
    });
    expect(sale.total).toBe(1700);
    const [item] = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id));
    expect(item.discountAmount).toBe(300);
  });

  it("aplica descuento por línea en porcentaje", async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    const sale = await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "efectivo",
      items: [{ variantId: vId, quantity: 1, discount: { kind: "percent", value: 10 } }], // 1000 - 10%
    });
    expect(sale.total).toBe(900);
  });

  it("aplica descuento general sobre el subtotal ya neto", async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    const sale = await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "efectivo",
      items: [{ variantId: vId, quantity: 1 }, { variantId: vId2, quantity: 1 }], // 1000 + 1200 = 2200
      saleDiscount: { kind: "percent", value: 50 },
    });
    expect(sale.total).toBe(1100);
    expect(sale.discountAmount).toBe(1100);
  });

  it("acota el descuento para no dejar la línea negativa", async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    const sale = await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "efectivo",
      items: [{ variantId: vId, quantity: 1, discount: { kind: "amount", value: 99999 } }],
    });
    expect(sale.total).toBe(0);
  });
});

describe("voidSale", () => {
  it("restores stock and marks voided", async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    const sale = await createSale(db, { storeId: store, sellerId: "u1", paymentMethod: "tarjeta", items: [{ variantId: vId, quantity: 2 }] });
    await voidSale(db, { saleId: sale.id, storeId: store, userId: "u1" , reason: "prueba" });
    const [v1] = await db.select().from(productVariants).where(eq(productVariants.id, vId));
    expect(v1.stock).toBe(5);
    const [s] = await db.select().from(sales).where(eq(sales.id, sale.id));
    expect(s.voided).toBe(true);
    const movs = await db.select().from(stockMovements).where(eq(stockMovements.type, "anulacion"));
    expect(movs).toHaveLength(1);
    expect(movs[0].quantity).toBe(2);
  });

  it("guarda el motivo y exige uno de verdad", async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    const sale = await createSale(db, { storeId: store, sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId: vId, quantity: 1 }] });

    // Vacío, espacios y una sola letra no son un motivo. La guarda vive en el
    // dominio y no solo en el diálogo: si no, la server action sería un bypass.
    for (const reason of ["", "   ", "x"]) {
      await expect(
        voidSale(db, { saleId: sale.id, storeId: store, userId: "u1", reason }),
      ).rejects.toThrow("VOID_REASON_REQUIRED");
    }
    // Y no anuló nada en el intento.
    const [antes] = await db.select().from(sales).where(eq(sales.id, sale.id));
    expect(antes.voided).toBe(false);

    await voidSale(db, { saleId: sale.id, storeId: store, userId: "u1", reason: "  Devolución del cliente  " });
    const [s] = await db.select().from(sales).where(eq(sales.id, sale.id));
    expect(s.voidedReason).toBe("Devolución del cliente"); // recortado
  });

  it("rejects double void", async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    const sale = await createSale(db, { storeId: store, sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId: vId, quantity: 1 }] });
    await voidSale(db, { saleId: sale.id, storeId: store, userId: "u1" , reason: "prueba" });
    await expect(voidSale(db, { saleId: sale.id, storeId: store, userId: "u1" , reason: "prueba" })).rejects.toThrow("ALREADY_VOIDED");
  });

  // NOTE: PGlite serializes db.transaction() calls on its single connection,
  // so these two voids do not truly overlap here — this asserts logical
  // correctness (exactly-once outcome), not the concurrent race itself. The
  // race protection lives in the conditional `UPDATE ... WHERE voided=false`
  // in voidSale and only holds under a real multi-connection Postgres.
  it("concurrent double void is safe: exactly one succeeds, stock restored exactly once", async () => {
    await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
    const sale = await createSale(db, { storeId: store, sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId: vId, quantity: 2 }] });
    const results = await Promise.allSettled([
      voidSale(db, { saleId: sale.id, storeId: store, userId: "u1" , reason: "prueba" }),
      voidSale(db, { saleId: sale.id, storeId: store, userId: "u1" , reason: "prueba" }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toBe("ALREADY_VOIDED");
    const [v1] = await db.select().from(productVariants).where(eq(productVariants.id, vId));
    expect(v1.stock).toBe(5); // restored exactly once, not twice
    const movs = await db.select().from(stockMovements).where(eq(stockMovements.type, "anulacion"));
    expect(movs).toHaveLength(1); // exactly one anulacion movement
  });
});
