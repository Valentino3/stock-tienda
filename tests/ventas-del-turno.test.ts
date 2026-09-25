import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestStore, seedTestUser } from "./helpers/db";
import { products, productVariants } from "@/db/schema";
import { closeCashSession, openCashSession } from "@/domain/cash";
import { createSale, voidSale } from "@/domain/sales";
import { getVentasDelTurno } from "@/domain/cash-close";

/**
 * La lista de ventas del turno que muestra `/caja`.
 *
 * Lo delicado es la visibilidad: la pantalla la abren los empleados, y un
 * empleado no ve las ventas de otro (misma regla que /ventas y el remito). Lo
 * que ve es lo que vendió O lo que anotó. Los tres casos de abajo cubren los
 * dos lados de ese OR y el caso en que no le toca ninguno.
 */

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number, otraTienda: number;
let variantId: number, sessionId: number;

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  otraTienda = await seedTestStore(db, "otra");
  await seedTestUser(db, "duenio", "owner", store);
  await seedTestUser(db, "ana", "employee", store);
  await seedTestUser(db, "beto", "employee", store);

  const [p] = await db.insert(products).values({ storeId: store, name: "Sobre", basePrice: 1000 }).returning();
  const [v] = await db.insert(productVariants)
    .values({ storeId: store, productId: p.id, name: "", stock: 100 }).returning();
  variantId = v.id;

  sessionId = (await openCashSession(db, { storeId: store, userId: "duenio", openingCash: 0 })).id;
});

const vender = (sellerId: string, registeredBy: string, extra: Record<string, unknown> = {}) =>
  createSale(db, {
    storeId: store, sellerId, registeredBy, paymentMethod: "efectivo",
    items: [{ variantId, quantity: 1 }], ...extra,
  });

const ids = (r: { saleId: number }[] | null) => (r ?? []).map((x) => x.saleId).sort((a, b) => a - b);

describe("getVentasDelTurno", () => {
  it("el empleado ve lo que vendió o anotó; el dueño ve todo", async () => {
    const a = await vender("ana", "duenio");  // vendió ana
    const b = await vender("beto", "ana");    // anotó ana
    const c = await vender("beto", "beto");   // ni una cosa ni la otra para ana

    expect(ids(await getVentasDelTurno(db, store, sessionId, { visibleParaUserId: "ana" })))
      .toEqual([a.id, b.id]);
    expect(ids(await getVentasDelTurno(db, store, sessionId, { visibleParaUserId: "beto" })))
      .toEqual([b.id, c.id]);
    expect(ids(await getVentasDelTurno(db, store, sessionId))).toEqual([a.id, b.id, c.id]);
  });

  it("una venta con pago dividido trae cada medio con su monto", async () => {
    await vender("ana", "ana", {
      paymentMethod: undefined,
      items: [{ variantId, quantity: 12 }],
      pagos: [{ method: "efectivo", amount: 5000 }, { method: "tarjeta", amount: 7000 }],
    });

    const [r] = (await getVentasDelTurno(db, store, sessionId))!;
    expect(r.total).toBe(12000);
    expect(r.pagos).toEqual(expect.arrayContaining([
      { method: "efectivo", amount: 5000 },
      { method: "tarjeta", amount: 7000 },
    ]));
    expect(r.pagos).toHaveLength(2);
    // El predominante sigue siendo solo para mostrar.
    expect(r.paymentMethod).toBe("tarjeta");
    expect(r.lineas[0]).toMatchObject({ productName: "Sobre", quantity: 12 });
  });

  it("incluye las anuladas, marcadas y con el motivo", async () => {
    const v = await vender("ana", "ana");
    await voidSale(db, { saleId: v.id, storeId: store, userId: "duenio", reason: "se arrepintió" });

    const [r] = (await getVentasDelTurno(db, store, sessionId))!;
    expect(r).toMatchObject({ saleId: v.id, voided: true, voidedReason: "se arrepintió" });
  });

  it("no mezcla ventas de otra caja", async () => {
    const vieja = await vender("ana", "ana");
    await closeCashSession(db, { storeId: store, sessionId, userId: "duenio", countedCash: 1000 });
    const nueva = (await openCashSession(db, { storeId: store, userId: "duenio", openingCash: 0 })).id;
    const actual = await vender("ana", "ana");

    expect(ids(await getVentasDelTurno(db, store, sessionId))).toEqual([vieja.id]);
    expect(ids(await getVentasDelTurno(db, store, nueva))).toEqual([actual.id]);
  });

  it("la caja de otra tienda no existe", async () => {
    await vender("ana", "ana");
    // Scope por tienda: los ids de caja son secuenciales.
    expect(await getVentasDelTurno(db, otraTienda, sessionId)).toBeNull();
  });
});
