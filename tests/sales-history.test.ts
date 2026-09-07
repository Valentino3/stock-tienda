import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedTestUser, seedTestStore } from "./helpers/db";
import { products, productVariants, sales } from "@/db/schema";
import { openCashSession } from "@/domain/cash";
import { createSale } from "@/domain/sales";
import { getSalesHistory } from "@/domain/sales-history";

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;
let variantId: number;
let cashSessionId: number;

const OLD_DATE = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);
  const [p] = await db.insert(products).values({ storeId: store, name: "Remera", basePrice: 1000 }).returning();
  const [v] = await db.insert(productVariants).values({ storeId: store, productId: p.id, name: "M", stock: 100 }).returning();
  variantId = v.id;
  const session = await openCashSession(db, { storeId: store, userId: "u1", openingCash: 0 });
  cashSessionId = session.id;
});

describe("getSalesHistory", () => {
  it("defaults to the last 30 days when no from/to is given", async () => {
    // Insert a sale outside the 30-day window directly (bypassing createSale,
    // which always stamps createdAt via defaultNow()) so the default window
    // actually has something to exclude.
    await db.insert(sales).values({
      storeId: store,
      sellerId: "u1", registeredBy: "u1",
      cashSessionId,
      total: 1000,
      paymentMethod: "efectivo",
      createdAt: OLD_DATE,
    });
    await createSale(db, { storeId: store, sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId, quantity: 1 }] });

    const result = await getSalesHistory(db, { storeId: store, page: 1 });

    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].sale.createdAt.getTime()).not.toEqual(OLD_DATE.getTime());
  });

  it("paginates results (page size 50) and reports hasNextPage", async () => {
    for (let i = 0; i < 55; i++) {
      await createSale(db, { storeId: store, sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId, quantity: 1 }] });
    }
    const page1 = await getSalesHistory(db, { storeId: store, page: 1 });
    expect(page1.sales).toHaveLength(50);
    expect(page1.hasNextPage).toBe(true);

    const page2 = await getSalesHistory(db, { storeId: store, page: 2 });
    expect(page2.sales).toHaveLength(5);
    expect(page2.hasNextPage).toBe(false);
  });

  it("an explicit wide from/to range bypasses the 30-day default but still paginates", async () => {
    await db.insert(sales).values({
      storeId: store,
      sellerId: "u1", registeredBy: "u1",
      cashSessionId,
      total: 1000,
      paymentMethod: "efectivo",
      createdAt: OLD_DATE,
    });

    const result = await getSalesHistory(db, {
      storeId: store,
      from: new Date(0),
      to: new Date(Date.now() + 24 * 60 * 60 * 1000),
      page: 1,
    });

    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].sale.createdAt.getTime()).toEqual(OLD_DATE.getTime());
  });

  it("solo trae ventas de la tienda pedida", async () => {
    const store2 = await seedTestStore(db, "t2");
    await seedTestUser(db, "u2", "owner", store2);
    const s2 = await openCashSession(db, { storeId: store2, userId: "u2", openingCash: 0 });
    await db.insert(sales).values({ storeId: store2, sellerId: "u2", registeredBy: "u2", cashSessionId: s2.id, total: 999, paymentMethod: "efectivo" });
    await createSale(db, { storeId: store, sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId, quantity: 1 }] });

    const r1 = await getSalesHistory(db, { storeId: store, page: 1 });
    expect(r1.sales).toHaveLength(1);
    expect(r1.sales.every((row: { sale: { storeId: number } }) => row.sale.storeId === store)).toBe(true);
  });

  /**
   * Con vendedor elegible, "mis ventas" deja de ser una sola columna.
   *
   * Un empleado que anota la venta de un compañero ausente tiene que seguir
   * viéndola: es la venta que él cargó, sobre la que le van a preguntar, y la
   * que quizá haya que anular. Filtrar solo por `sellerId` la hace desaparecer
   * justo de la pantalla de quien la hizo.
   */
  describe("visibleParaUserId", () => {
    beforeEach(async () => {
      await seedTestUser(db, "ana", "employee", store);
      await seedTestUser(db, "beto", "employee", store);
    });

    const vender = (sellerId: string, registeredBy: string) =>
      createSale(db, {
        storeId: store, sellerId, registeredBy,
        paymentMethod: "efectivo", items: [{ variantId, quantity: 1 }],
      });

    it("el empleado ve la venta que anotó para otro", async () => {
      await vender("beto", "ana");
      const r = await getSalesHistory(db, { storeId: store, visibleParaUserId: "ana", page: 1 });
      expect(r.sales).toHaveLength(1);
      expect(r.sales[0].sale.sellerId).toBe("beto");
    });

    it("el empleado ve sus propias ventas", async () => {
      await vender("ana", "ana");
      const r = await getSalesHistory(db, { storeId: store, visibleParaUserId: "ana", page: 1 });
      expect(r.sales).toHaveLength(1);
    });

    it("el empleado NO ve una venta ajena que no anotó", async () => {
      await vender("beto", "beto");
      const r = await getSalesHistory(db, { storeId: store, visibleParaUserId: "ana", page: 1 });
      expect(r.sales).toHaveLength(0);
    });

    it("el dueño (sin recorte) las ve todas", async () => {
      await vender("beto", "beto");
      await vender("beto", "ana");
      const r = await getSalesHistory(db, { storeId: store, page: 1 });
      expect(r.sales).toHaveLength(2);
    });

    it("el filtro por vendedor se compone con el recorte, no lo reemplaza", async () => {
      await vender("beto", "ana");   // visible para ana, acreditada a beto
      await vender("ana", "ana");    // visible para ana, acreditada a ana
      const r = await getSalesHistory(db, {
        storeId: store, visibleParaUserId: "ana", sellerId: "beto", page: 1,
      });
      expect(r.sales).toHaveLength(1);
      expect(r.sales[0].sale.sellerId).toBe("beto");
    });
  });

  // El filtro va en la QUERY y no después de paginar: filtrar en memoria sobre
  // una página ya cortada daría páginas de tamaño distinto y saltearía ventas.
  describe("filtro de facturación", () => {
    async function seedConComprobante(estado: "pendiente" | "autorizado" | "rechazado", clase: "factura" | "nota_credito" = "factura") {
      const { comprobantes } = await import("@/db/schema");
      const venta = await createSale(db, {
        storeId: store, sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId, quantity: 1 }],
      });
      await db.insert(comprobantes).values({
        storeId: store, saleId: venta.id, clase, cbteTipo: clase === "factura" ? 6 : 8,
        ambiente: "homologacion", ptoVta: 1, numero: venta.id, estado,
        docTipo: 99, docNro: "0", condIvaReceptor: 5, receptorNombre: "Consumidor Final",
        impTotal: 1000, impNeto: 826.45, impIva: 173.55,
        ivaDesglose: [{ id: 5, baseImp: 826.45, importe: 173.55 }], lineas: [],
        cbteFch: "2026-07-30", cuitEmisor: "30707429530", createdBy: "u1",
      });
      return venta;
    }

    it("'sin' trae solo las ventas sin factura viva", async () => {
      const sinFactura = await createSale(db, {
        storeId: store, sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId, quantity: 1 }],
      });
      await seedConComprobante("autorizado");

      const r = await getSalesHistory(db, { storeId: store, page: 1, facturacion: "sin" });
      expect(r.sales).toHaveLength(1);
      expect(r.sales[0].sale.id).toBe(sinFactura.id);
    });

    it("'con' trae solo las facturadas", async () => {
      await createSale(db, {
        storeId: store, sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId, quantity: 1 }],
      });
      const facturada = await seedConComprobante("autorizado");

      const r = await getSalesHistory(db, { storeId: store, page: 1, facturacion: "con" });
      expect(r.sales).toHaveLength(1);
      expect(r.sales[0].sale.id).toBe(facturada.id);
    });

    // Una factura rechazada deja la venta sin facturar, que es exactamente lo
    // que el dueño quiere ver a fin de mes.
    it("una factura RECHAZADA deja la venta en 'sin facturar'", async () => {
      const rechazada = await seedConComprobante("rechazado");
      const r = await getSalesHistory(db, { storeId: store, page: 1, facturacion: "sin" });
      expect(r.sales.map((s: any) => s.sale.id)).toContain(rechazada.id);
    });

    it("una emisión en curso cuenta como facturada, para no emitir dos veces", async () => {
      const pendiente = await seedConComprobante("pendiente");
      const r = await getSalesHistory(db, { storeId: store, page: 1, facturacion: "con" });
      expect(r.sales.map((s: any) => s.sale.id)).toContain(pendiente.id);
    });

    // Una nota de crédito no es una factura: la venta no pasa a "facturada" por
    // tener una NC.
    it("una nota de crédito sola no cuenta como factura", async () => {
      const soloNC = await seedConComprobante("autorizado", "nota_credito");
      const r = await getSalesHistory(db, { storeId: store, page: 1, facturacion: "sin" });
      expect(r.sales.map((s: any) => s.sale.id)).toContain(soloNC.id);
    });

    it("sin filtro, trae todas", async () => {
      await createSale(db, {
        storeId: store, sellerId: "u1", paymentMethod: "efectivo", items: [{ variantId, quantity: 1 }],
      });
      await seedConComprobante("autorizado");
      const r = await getSalesHistory(db, { storeId: store, page: 1 });
      expect(r.sales).toHaveLength(2);
    });
  });
});
