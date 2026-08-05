import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedTestStore, seedTestUser } from "./helpers/db";
import { comprobantes, orderItems, products, productVariants, sales } from "@/db/schema";
import { saveFiscalConfig } from "@/domain/fiscal-config";
import { openCashSession } from "@/domain/cash";
import { abrirOrden, agregarItem, crearMesa, pagarOrden } from "@/domain/orders";
import { emitirFactura, type ArcaClientPort } from "@/domain/fiscal-emision";
import type { FeCaeRequest, FeCaeResponse } from "@/lib/arca/types";

/**
 * Punta a punta: mesa → pedido → cobro → factura con CAE.
 *
 * Es LA prueba de la fase. Si una venta nacida de una mesa se factura por el
 * mismo camino que una de mostrador, sin una sola rama nueva en fiscal-*,
 * entonces la decisión de que la orden sea una tabla aparte que produce una
 * venta era la correcta, y todo lo que sigue es interfaz.
 */

const CUIT = "30707429530";

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;
let mesa: number;
let milanesa: number;
let vino: number;

beforeEach(async () => {
  vi.stubEnv("ARCA_MASTER_KEY", Buffer.alloc(32, 3).toString("base64"));
  vi.stubEnv("ARCA_ALLOW_PRODUCCION", "");
  db = await createTestDb();
  store = await seedTestStore(db, "t1");
  await seedTestUser(db, "u1", "owner", store);
  await saveFiscalConfig(db, {
    storeId: store, cuit: CUIT, razonSocial: "La Parrilla SRL",
    domicilio: "Av. Siempreviva 742", puntoVenta: 1, enabled: true,
  });

  mesa = (await crearMesa(db, { storeId: store, name: "1" })).id;

  const [pm] = await db.insert(products)
    .values({ storeId: store, name: "Milanesa napolitana", basePrice: 8000, tracksStock: false }).returning();
  milanesa = (await db.insert(productVariants)
    .values({ storeId: store, productId: pm.id, name: "", stock: 0 }).returning())[0].id;

  const [pv] = await db.insert(products)
    .values({ storeId: store, name: "Vino", basePrice: 5000, tracksStock: true }).returning();
  vino = (await db.insert(productVariants)
    .values({ storeId: store, productId: pv.id, name: "Malbec", stock: 10 }).returning())[0].id;

  await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
});

afterEach(() => vi.unstubAllEnvs());

function fakeArca() {
  const pedidos: FeCaeRequest[] = [];
  let numero = 0;
  const port: ArcaClientPort = {
    async lastAuthorized() { return numero; },
    async authorize(req) {
      pedidos.push(req);
      numero = req.FeDetReq[0].CbteDesde;
      return {
        resultado: "A", cae: `7000000000000${numero}`, caeVto: "20260930",
        cbteDesde: numero, observaciones: [], errores: [], raw: { ok: true },
      } satisfies FeCaeResponse;
    },
    async consult() { return null; },
  };
  return { port, pedidos };
}

describe("una mesa se factura como cualquier venta", () => {
  it("orden → cobro → CAE, con el total coincidiendo", async () => {
    const orden = await abrirOrden(db, { storeId: store, userId: "u1", tableId: mesa, guests: 2 });
    await agregarItem(db, { storeId: store, orderId: orden.id, variantId: milanesa, quantity: 2 });
    await agregarItem(db, { storeId: store, orderId: orden.id, variantId: vino, quantity: 1 });

    const { sale } = await pagarOrden(db, {
      storeId: store, orderId: orden.id, userId: "u1", paymentMethod: "tarjeta",
    });
    expect(sale.total).toBe(21000);

    const { port, pedidos } = fakeArca();
    const cbte = await emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1" });

    expect(cbte.estado).toBe("autorizado");
    expect(cbte.cae).toBeTruthy();
    expect(pedidos[0].FeDetReq[0].ImpTotal).toBe(21000);

    const [guardado] = await db.select().from(comprobantes).where(eq(comprobantes.id, cbte.id));
    expect(guardado.impTotal).toBe(sale.total);

    // Las dos líneas viajan, incluida la que no mueve stock.
    const lineas = guardado.lineas as { descripcion: string }[];
    expect(lineas).toHaveLength(2);
    expect(lineas.map((l) => l.descripcion).join(" ")).toMatch(/Milanesa napolitana/);
  });

  it("la venta queda vinculada a la orden y se puede rastrear", async () => {
    const orden = await abrirOrden(db, { storeId: store, userId: "u1", tableId: mesa });
    await agregarItem(db, { storeId: store, orderId: orden.id, variantId: milanesa, quantity: 1 });
    const { sale } = await pagarOrden(db, {
      storeId: store, orderId: orden.id, userId: "u1", paymentMethod: "efectivo",
    });

    const { port } = fakeArca();
    await emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1" });

    const [guardada] = await db.select().from(sales).where(eq(sales.id, sale.id));
    expect(guardada.orderId).toBe(orden.id);
  });

  it("cuenta dividida: cada pago saca su propio comprobante", async () => {
    const orden = await abrirOrden(db, { storeId: store, userId: "u1", tableId: mesa, guests: 2 });
    await agregarItem(db, { storeId: store, orderId: orden.id, variantId: milanesa, quantity: 1 });
    await agregarItem(db, { storeId: store, orderId: orden.id, variantId: vino, quantity: 1 });
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orden.id));

    const uno = await pagarOrden(db, {
      storeId: store, orderId: orden.id, userId: "u1",
      paymentMethod: "efectivo", itemIds: [items[0].id],
    });
    const dos = await pagarOrden(db, {
      storeId: store, orderId: orden.id, userId: "u1",
      paymentMethod: "tarjeta", itemIds: [items[1].id],
    });

    const { port, pedidos } = fakeArca();
    const cbteUno = await emitirFactura(db, port, { storeId: store, saleId: uno.sale.id, userId: "u1" });
    const cbteDos = await emitirFactura(db, port, { storeId: store, saleId: dos.sale.id, userId: "u1" });

    // Dos comprobantes, numeración consecutiva, cada uno por su parte.
    expect(cbteUno.numero).toBe(1);
    expect(cbteDos.numero).toBe(2);
    expect(pedidos[0].FeDetReq[0].ImpTotal).toBe(8000);
    expect(pedidos[1].FeDetReq[0].ImpTotal).toBe(5000);
  });
});
