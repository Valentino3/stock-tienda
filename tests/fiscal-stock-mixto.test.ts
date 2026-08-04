import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedTestStore, seedTestUser } from "./helpers/db";
import { comprobantes, products, productVariants } from "@/db/schema";
import { saveFiscalConfig } from "@/domain/fiscal-config";
import { openCashSession } from "@/domain/cash";
import { createSale } from "@/domain/sales";
import { emitirFactura, type ArcaClientPort } from "@/domain/fiscal-emision";
import type { FeCaeRequest, FeCaeResponse } from "@/lib/arca/types";

/**
 * Regresión fiscal para ventas que mezclan productos con y sin control de stock.
 *
 * Por qué existe: `cargarVenta` arma las líneas de la factura con un innerJoin
 * saleItems → productVariants → products. Si alguna vez alguien hace
 * `sale_items.variantId` nullable para modelar líneas "sueltas", ese innerJoin
 * empieza a DESCARTAR líneas y el comprobante deja de sumar el total de la
 * venta.
 *
 * Hoy no puede pasar —fiscal-importes valida `S - D === T` y rompe con
 * IMPORTES_INCONSISTENTES antes de pedirle número a ARCA— y este test es lo
 * que avisa el día que alguien toque ese modelo.
 */

const CUIT = "30707429530";

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;
let conStock: number;
let sinStock: number;

beforeEach(async () => {
  vi.stubEnv("ARCA_MASTER_KEY", Buffer.alloc(32, 3).toString("base64"));
  vi.stubEnv("ARCA_ALLOW_PRODUCCION", "");
  db = await createTestDb();
  store = await seedTestStore(db, "t1");
  await seedTestUser(db, "u1", "owner", store);
  await saveFiscalConfig(db, {
    storeId: store, cuit: CUIT, razonSocial: "Mi Comercio SRL",
    domicilio: "Av. Siempreviva 742", puntoVenta: 1, enabled: true,
  });

  const [remera] = await db.insert(products)
    .values({ storeId: store, name: "Remera", basePrice: 1000, tracksStock: true }).returning();
  conStock = (await db.insert(productVariants)
    .values({ storeId: store, productId: remera.id, name: "M", stock: 10 }).returning())[0].id;

  const [servicio] = await db.insert(products)
    .values({ storeId: store, name: "Servicio de armado", basePrice: 8000, tracksStock: false }).returning();
  sinStock = (await db.insert(productVariants)
    .values({ storeId: store, productId: servicio.id, name: "", stock: 0 }).returning())[0].id;

  await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
});

afterEach(() => vi.unstubAllEnvs());

function fakeArca() {
  const pedidos: FeCaeRequest[] = [];
  const port: ArcaClientPort = {
    async lastAuthorized() { return 0; },
    async authorize(req) {
      pedidos.push(req);
      return {
        resultado: "A", cae: "70000000000001", caeVto: "20260930",
        cbteDesde: req.FeDetReq[0].CbteDesde, observaciones: [], errores: [],
        raw: { ok: true },
      } satisfies FeCaeResponse;
    },
    async consult() { return null; },
  };
  return { port, pedidos };
}

describe("factura de una venta con y sin control de stock", () => {
  it("el ImpTotal del comprobante coincide con el total de la venta", async () => {
    const venta = await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "efectivo",
      items: [{ variantId: conStock, quantity: 2 }, { variantId: sinStock, quantity: 1 }],
    });
    expect(venta.total).toBe(10000);

    const { port, pedidos } = fakeArca();
    const cbte = await emitirFactura(db, port, { storeId: store, saleId: venta.id, userId: "u1" });

    expect(cbte.estado).toBe("autorizado");
    expect(pedidos[0].FeDetReq[0].ImpTotal).toBe(10000);

    const [guardado] = await db.select().from(comprobantes).where(eq(comprobantes.id, cbte.id));
    expect(guardado.impTotal).toBe(venta.total);
  });

  it("las dos líneas viajan en el comprobante, no solo la que mueve stock", async () => {
    const venta = await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "efectivo",
      items: [{ variantId: conStock, quantity: 2 }, { variantId: sinStock, quantity: 1 }],
    });

    const { port } = fakeArca();
    const cbte = await emitirFactura(db, port, { storeId: store, saleId: venta.id, userId: "u1" });

    const [guardado] = await db.select().from(comprobantes).where(eq(comprobantes.id, cbte.id));
    const lineas = guardado.lineas as { descripcion: string }[];
    expect(lineas).toHaveLength(2);
    expect(lineas.map((l) => l.descripcion).join(" ")).toMatch(/Servicio de armado/);
  });

  it("una venta SOLO de algo sin stock se factura igual", async () => {
    const venta = await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "efectivo",
      items: [{ variantId: sinStock, quantity: 3 }],
    });

    const { port, pedidos } = fakeArca();
    const cbte = await emitirFactura(db, port, { storeId: store, saleId: venta.id, userId: "u1" });

    expect(cbte.estado).toBe("autorizado");
    expect(pedidos[0].FeDetReq[0].ImpTotal).toBe(24000);
  });

  it("con descuento general los importes siguen cuadrando", async () => {
    const venta = await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "efectivo",
      items: [{ variantId: conStock, quantity: 2 }, { variantId: sinStock, quantity: 1 }],
      saleDiscount: { kind: "amount", value: 1000 },
    });
    expect(venta.total).toBe(9000);

    const { port, pedidos } = fakeArca();
    await emitirFactura(db, port, { storeId: store, saleId: venta.id, userId: "u1" });

    expect(pedidos[0].FeDetReq[0].ImpTotal).toBe(9000);
  });
});
