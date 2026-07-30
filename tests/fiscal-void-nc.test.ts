import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, seedTestStore, seedTestUser } from "./helpers/db";
import { comprobantes, productVariants, products, sales, saleItems, cashSessions } from "@/db/schema";
import { createSale, voidSale } from "@/domain/sales";
import { saveFiscalConfig } from "@/domain/fiscal-config";
import {
  emitirFactura, emitirNotaCredito, getComprobantesBySale, getFacturaAutorizada,
  type ArcaClientPort,
} from "@/domain/fiscal-emision";
import { CBTE_NOTA_CREDITO_B } from "@/domain/fiscal-catalogs";
import type { FeCaeRequest, FeCaeResponse } from "@/lib/arca/types";

/**
 * El contrato central de la anulación: la venta NUNCA se bloquea por ARCA.
 *
 * El stock y la caja tienen que quedar bien de inmediato; una nota de crédito
 * faltante es un cabo suelto visible y reintentable, mientras que una anulación
 * bloqueada deja stock fantasma y arqueo mal.
 */

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;
let variantId: number;

beforeEach(async () => {
  vi.stubEnv("ARCA_MASTER_KEY", Buffer.alloc(32, 9).toString("base64"));
  vi.stubEnv("ARCA_ALLOW_PRODUCCION", "");
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);
  await saveFiscalConfig(db, {
    storeId: store, cuit: "30707429530", razonSocial: "Mi Comercio SRL",
    domicilio: "Av. Siempreviva 742", puntoVenta: 1, enabled: true,
  });

  const [p] = await db.insert(products).values({ storeId: store, name: "Remera", basePrice: 1000 }).returning();
  const [v] = await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "M", stock: 10 }).returning();
  variantId = v.id;
  await db.insert(cashSessions).values({ storeId: store, openedBy: "u1", openingCash: 0 });
});

afterEach(() => vi.unstubAllEnvs());

const aprobado = (req: FeCaeRequest): FeCaeResponse => ({
  resultado: "A", cae: "76123456789012", caeVto: "20260809",
  cbteDesde: req.FeDetReq[0].CbteDesde, observaciones: [], errores: [], raw: {},
});

function fakeArca(opts: { falla?: boolean } = {}) {
  const llamadas: FeCaeRequest[] = [];
  const port: ArcaClientPort = {
    async lastAuthorized() { return 0; },
    async authorize(req) {
      llamadas.push(req);
      if (opts.falla) throw new Error("ARCA caído");
      return aprobado(req);
    },
    async consult() { return null; },
  };
  return { port, llamadas };
}

async function ventaFacturada() {
  const venta = await createSale(db, {
    storeId: store, sellerId: "u1", paymentMethod: "efectivo",
    items: [{ variantId, quantity: 2 }],
  });
  const { port } = fakeArca();
  const factura = await emitirFactura(db, port, { storeId: store, saleId: venta.id, userId: "u1" });
  expect(factura.estado).toBe("autorizado");
  return { venta, factura };
}

describe("anulación con nota de crédito", () => {
  it("anular una venta facturada permite emitir la NC, con el tipo y el vínculo correctos", async () => {
    const { venta, factura } = await ventaFacturada();
    await voidSale(db, { saleId: venta.id, storeId: store, userId: "u1" });

    const { port } = fakeArca();
    const nc = await emitirNotaCredito(db, port, { storeId: store, saleId: venta.id, userId: "u1" });

    expect(nc.estado).toBe("autorizado");
    expect(nc.cbteTipo).toBe(CBTE_NOTA_CREDITO_B);
    expect(nc.cbteAsocId).toBe(factura.id);
    expect(nc.impTotal).toBe(factura.impTotal);
  });

  // ⚠️ El contrato que no se puede romper.
  it("REGRESIÓN: con ARCA caído, la anulación igual se completa", async () => {
    const { venta } = await ventaFacturada();

    await voidSale(db, { saleId: venta.id, storeId: store, userId: "u1" });

    // La venta quedó anulada y el stock volvió, sin depender de ARCA.
    const [despues] = await db.select().from(sales).where(eq(sales.id, venta.id));
    expect(despues.voided).toBe(true);
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, variantId));
    expect(v.stock).toBe(10);

    // La NC falla, pero queda registrada como cabo suelto reintentable.
    const { port } = fakeArca({ falla: true });
    const nc = await emitirNotaCredito(db, port, { storeId: store, saleId: venta.id, userId: "u1" });
    expect(nc.estado).toBe("error");

    const todos = await getComprobantesBySale(db, store, venta.id);
    expect(todos.some((c) => c.clase === "nota_credito" && c.estado === "error")).toBe(true);
  });

  it("anular una venta SIN factura no toca ARCA ni crea comprobantes", async () => {
    const venta = await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "efectivo",
      items: [{ variantId, quantity: 1 }],
    });
    await voidSale(db, { saleId: venta.id, storeId: store, userId: "u1" });

    expect(await getFacturaAutorizada(db, store, venta.id)).toBeNull();
    const { port, llamadas } = fakeArca();
    await expect(emitirNotaCredito(db, port, { storeId: store, saleId: venta.id, userId: "u1" }))
      .rejects.toThrow("SIN_FACTURA_PARA_ANULAR");
    expect(llamadas).toHaveLength(0);
  });

  it("la doble anulación sigue fallando y no emite dos notas de crédito", async () => {
    const { venta } = await ventaFacturada();
    await voidSale(db, { saleId: venta.id, storeId: store, userId: "u1" });
    await expect(voidSale(db, { saleId: venta.id, storeId: store, userId: "u1" }))
      .rejects.toThrow("ALREADY_VOIDED");

    const { port } = fakeArca();
    const a = await emitirNotaCredito(db, port, { storeId: store, saleId: venta.id, userId: "u1" });
    const b = await emitirNotaCredito(db, port, { storeId: store, saleId: venta.id, userId: "u1" });
    expect(b.id).toBe(a.id);

    const notas = await db.select().from(comprobantes).where(eq(comprobantes.clase, "nota_credito"));
    expect(notas).toHaveLength(1);
  });

  it("una venta a cuenta anulada revierte el cargo Y se le puede emitir la NC", async () => {
    const { clients, clientAccountMovements } = await import("@/db/schema");
    const [cli] = await db.insert(clients).values({ storeId: store, name: "Cliente" }).returning();

    const venta = await createSale(db, {
      storeId: store, sellerId: "u1", paymentMethod: "cuenta", clientId: cli.id,
      items: [{ variantId, quantity: 1 }],
    });
    const { port } = fakeArca();
    await emitirFactura(db, port, { storeId: store, saleId: venta.id, userId: "u1" });

    await voidSale(db, { saleId: venta.id, storeId: store, userId: "u1" });

    const movimientos = await db.select().from(clientAccountMovements)
      .where(eq(clientAccountMovements.saleId, venta.id));
    expect(movimientos.map((m) => m.type).sort()).toEqual(["anulacion", "cargo"]);

    const nc = await emitirNotaCredito(db, port, { storeId: store, saleId: venta.id, userId: "u1" });
    expect(nc.estado).toBe("autorizado");
  });

  it("el detalle de la NC se congela desde la factura, no desde la venta", async () => {
    const { venta, factura } = await ventaFacturada();
    await voidSale(db, { saleId: venta.id, storeId: store, userId: "u1" });

    // Después de anular se toca el producto: la NC no tiene que enterarse.
    await db.update(products).set({ name: "Nombre cambiado" }).where(eq(products.storeId, store));
    await db.delete(saleItems).where(eq(saleItems.saleId, venta.id));

    const { port } = fakeArca();
    const nc = await emitirNotaCredito(db, port, { storeId: store, saleId: venta.id, userId: "u1" });
    expect(nc.lineas).toEqual(factura.lineas);
    expect(nc.lineas[0].descripcion).toContain("Remera");
  });
});
