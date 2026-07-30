import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createTestDb, seedTestStore, seedTestUser, seedTestSale } from "./helpers/db";
import { clients, comprobantes, sales } from "@/db/schema";
import { saveFiscalConfig } from "@/domain/fiscal-config";
import {
  emitirFactura, emitirNotaCredito, reconciliarComprobante,
  getComprobantesBySale, getFacturaAutorizada,
  type ArcaClientPort,
} from "@/domain/fiscal-emision";
import {
  CBTE_FACTURA_A, CBTE_FACTURA_B, CBTE_NOTA_CREDITO_B, DOC_CUIT,
  IVA_RESPONSABLE_INSCRIPTO, IVA_CONSUMIDOR_FINAL,
} from "@/domain/fiscal-catalogs";
import type { FeCaeRequest, FeCaeResponse, FeCompConsultarResponse } from "@/lib/arca/types";
import { ArcaError } from "@/lib/arca/errors";

const CUIT = "30707429530";
const CUIT_CLIENTE = "20111111112";

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;
let otraStore: number;

beforeEach(async () => {
  vi.stubEnv("ARCA_MASTER_KEY", Buffer.alloc(32, 3).toString("base64"));
  vi.stubEnv("ARCA_ALLOW_PRODUCCION", "");
  db = await createTestDb();
  store = await seedTestStore(db, "t1");
  otraStore = await seedTestStore(db, "t2");
  await seedTestUser(db, "u1", "owner", store);
  await saveFiscalConfig(db, {
    storeId: store, cuit: CUIT, razonSocial: "Mi Comercio SRL",
    domicilio: "Av. Siempreviva 742", puntoVenta: 1, enabled: true,
  });
});

afterEach(() => vi.unstubAllEnvs());

/**
 * Fake del puerto ARCA. Registra todo lo que recibe para poder afirmar que en
 * ciertos caminos NUNCA se llamó a ARCA.
 */
function fakeArca(opts: {
  ultimo?: number | ((t: number) => number);
  responder?: (req: FeCaeRequest, llamada: number) => FeCaeResponse | Promise<FeCaeResponse>;
  consultar?: (cbteTipo: number, numero: number) => FeCompConsultarResponse | null;
} = {}) {
  const llamadas: { autorizar: FeCaeRequest[]; ultimo: number[]; consultar: [number, number][] } =
    { autorizar: [], ultimo: [], consultar: [] };
  let n = 0;

  const port: ArcaClientPort = {
    async lastAuthorized(cbteTipo) {
      llamadas.ultimo.push(cbteTipo);
      return typeof opts.ultimo === "function" ? opts.ultimo(cbteTipo) : (opts.ultimo ?? 0);
    },
    async authorize(req) {
      llamadas.autorizar.push(req);
      n++;
      if (opts.responder) return opts.responder(req, n);
      return aprobado(req);
    },
    async consult(cbteTipo, numero) {
      llamadas.consultar.push([cbteTipo, numero]);
      return opts.consultar ? opts.consultar(cbteTipo, numero) : null;
    },
  };
  return { port, llamadas };
}

const aprobado = (req: FeCaeRequest, cae = "76123456789012"): FeCaeResponse => ({
  resultado: "A", cae, caeVto: "20260809",
  cbteDesde: req.FeDetReq[0].CbteDesde, observaciones: [], errores: [], raw: { ok: true },
});

const rechazado = (msg = "Fecha fuera de rango", code = 10016): FeCaeResponse => ({
  resultado: "R", cae: null, caeVto: null, cbteDesde: null,
  observaciones: [{ code, msg }], errores: [], raw: { ok: false },
});

describe("emitirFactura", () => {
  it("camino feliz: autoriza, guarda CAE y arranca en 1", async () => {
    const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });
    const { port, llamadas } = fakeArca();

    const cbte = await emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1" });

    expect(cbte.estado).toBe("autorizado");
    expect(cbte.cae).toBe("76123456789012");
    expect(cbte.caeVto).toBe("2026-08-09");
    expect(cbte.numero).toBe(1);
    expect(cbte.cbteTipo).toBe(CBTE_FACTURA_B);
    expect(cbte.impTotal).toBe(1000);
    expect(cbte.impNeto).toBe(826.45);
    expect(llamadas.autorizar).toHaveLength(1);
  });

  // La tienda puede haber facturado antes desde otro sistema: arrancar en 1
  // sería rechazo garantizado.
  it("siembra la numeración desde ARCA: si el último es 57, el nuestro es 58", async () => {
    const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });
    const { port, llamadas } = fakeArca({ ultimo: 57 });

    const cbte = await emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1" });
    expect(cbte.numero).toBe(58);
    expect(llamadas.ultimo).toEqual([CBTE_FACTURA_B]);
  });

  it("la segunda emisión no vuelve a preguntarle a ARCA: incrementa local", async () => {
    const a = await seedTestSale(db, { storeId: store, total: 1000 });
    const b = await seedTestSale(db, { storeId: store, total: 500 });
    const { port, llamadas } = fakeArca({ ultimo: 57 });

    expect((await emitirFactura(db, port, { storeId: store, saleId: a.sale.id, userId: "u1" })).numero).toBe(58);
    expect((await emitirFactura(db, port, { storeId: store, saleId: b.sale.id, userId: "u1" })).numero).toBe(59);
    expect(llamadas.ultimo).toHaveLength(1);
  });

  it("guarda el request con Token/Sign redactados y el detalle de líneas congelado", async () => {
    const { sale } = await seedTestSale(db, { storeId: store, total: 1000, quantity: 2, unitPrice: 500 });
    const { port } = fakeArca();

    const cbte = await emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1" });
    expect(JSON.stringify(cbte.requestJson)).not.toContain("TOKEN");
    expect(cbte.lineas).toHaveLength(1);
    expect(cbte.lineas[0].descripcion).toBe("Producto test");
    expect(cbte.lineas[0].cantidad).toBe(2);
  });

  it("Factura A cuando el cliente es Responsable Inscripto con CUIT", async () => {
    const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });
    const [cli] = await db.insert(clients).values({
      storeId: store, name: "Cliente RI", docTipo: DOC_CUIT, docNro: CUIT_CLIENTE,
      condicionIva: IVA_RESPONSABLE_INSCRIPTO, razonSocial: "Cliente RI SA",
    }).returning();
    const { port } = fakeArca();

    const cbte = await emitirFactura(db, port, {
      storeId: store, saleId: sale.id, userId: "u1", clientId: cli.id,
    });
    expect(cbte.cbteTipo).toBe(CBTE_FACTURA_A);
    expect(cbte.docTipo).toBe(DOC_CUIT);
    expect(cbte.docNro).toBe(CUIT_CLIENTE);
    expect(cbte.receptorNombre).toBe("Cliente RI SA");
    expect(cbte.clientId).toBe(cli.id);
  });

  // ⚠️ sales.clientId significa "cliente de cuenta corriente": escribirla en una
  // venta en efectivo inyectaría una compra fantasma en el ledger del cliente.
  it("REGRESIÓN: adjuntar un cliente al facturar NO toca sales.client_id", async () => {
    const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });
    const [cli] = await db.insert(clients).values({
      storeId: store, name: "Cliente", condicionIva: IVA_CONSUMIDOR_FINAL, docNro: "30111222", docTipo: 96,
    }).returning();
    const { port } = fakeArca();

    const cbte = await emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1", clientId: cli.id });
    expect(cbte.clientId).toBe(cli.id);
    const [ventaDespues] = await db.select().from(sales).where(eq(sales.id, sale.id));
    expect(ventaDespues.clientId).toBeNull();
  });

  // A y B son secuencias SEPARADAS en ARCA.
  it("A y B numeran por separado", async () => {
    const a = await seedTestSale(db, { storeId: store, total: 1000 });
    const b = await seedTestSale(db, { storeId: store, total: 1000 });
    const [cli] = await db.insert(clients).values({
      storeId: store, name: "RI", docTipo: DOC_CUIT, docNro: CUIT_CLIENTE, condicionIva: IVA_RESPONSABLE_INSCRIPTO,
    }).returning();
    const { port } = fakeArca();

    const fb = await emitirFactura(db, port, { storeId: store, saleId: a.sale.id, userId: "u1" });
    const fa = await emitirFactura(db, port, { storeId: store, saleId: b.sale.id, userId: "u1", clientId: cli.id });
    expect(fb.cbteTipo).toBe(CBTE_FACTURA_B);
    expect(fb.numero).toBe(1);
    expect(fa.cbteTipo).toBe(CBTE_FACTURA_A);
    expect(fa.numero).toBe(1);
  });

  it("es idempotente: si ya está autorizada devuelve la misma, sin llamar a ARCA", async () => {
    const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });
    const { port, llamadas } = fakeArca();

    const primera = await emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1" });
    const segunda = await emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1" });

    expect(segunda.id).toBe(primera.id);
    expect(segunda.cae).toBe(primera.cae);
    expect(llamadas.autorizar).toHaveLength(1);
  });

  it("doble clic simultáneo deja UNA sola factura viva", async () => {
    const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });
    const { port } = fakeArca();

    // PGlite serializa las transacciones, así que esto valida la lógica de
    // guarda, no la carrera real de Postgres. La carrera real la cubren el
    // advisory lock y los índices parciales de 0015 (tests/schema.test.ts).
    const res = await Promise.allSettled([
      emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1" }),
      emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1" }),
    ]);
    const vivas = await db.select().from(comprobantes).where(and(
      eq(comprobantes.saleId, sale.id), eq(comprobantes.estado, "autorizado"),
    ));
    expect(vivas).toHaveLength(1);
    expect(res.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
  });

  describe("caminos que NO deben llegar a ARCA", () => {
    it("venta anulada", async () => {
      const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });
      await db.update(sales).set({ voided: true }).where(eq(sales.id, sale.id));
      const { port, llamadas } = fakeArca();

      await expect(emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1" }))
        .rejects.toThrow("VENTA_ANULADA");
      expect(llamadas.autorizar).toHaveLength(0);
    });

    it("tienda sin config fiscal", async () => {
      const { sale } = await seedTestSale(db, { storeId: otraStore, total: 1000, userId: "u1" });
      const { port, llamadas } = fakeArca();

      await expect(emitirFactura(db, port, { storeId: otraStore, saleId: sale.id, userId: "u1" }))
        .rejects.toThrow("FISCAL_NO_CONFIGURADO");
      expect(llamadas.autorizar).toHaveLength(0);
    });

    // Aislamiento entre tiendas: pedir la venta de otra tienda por id debe fallar.
    it("REGRESIÓN: venta de otra tienda", async () => {
      const { sale } = await seedTestSale(db, { storeId: otraStore, total: 1000, userId: "u1" });
      const { port, llamadas } = fakeArca();

      await expect(emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1" }))
        .rejects.toThrow("VENTA_NO_ENCONTRADA");
      expect(llamadas.autorizar).toHaveLength(0);
    });

    it("venta de $0", async () => {
      const { sale } = await seedTestSale(db, { storeId: store, total: 0, unitPrice: 0 });
      const { port, llamadas } = fakeArca();

      await expect(emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1" }))
        .rejects.toThrow("IMPORTE_CERO");
      expect(llamadas.autorizar).toHaveLength(0);
    });

    it("cliente RI sin CUIT válido", async () => {
      const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });
      const [cli] = await db.insert(clients).values({
        storeId: store, name: "Mal cargado", docTipo: DOC_CUIT, docNro: "20111111113",
        condicionIva: IVA_RESPONSABLE_INSCRIPTO,
      }).returning();
      const { port, llamadas } = fakeArca();

      await expect(emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1", clientId: cli.id }))
        .rejects.toThrow("CUIT_INVALIDO");
      expect(llamadas.autorizar).toHaveLength(0);
    });
  });
});

describe("rechazos y reintentos", () => {
  // ARCA no avanza su numeración al rechazar: el número tiene que reusarse, o
  // quedaría un agujero fiscal.
  it("REGRESIÓN: un rechazo LIBERA el número y el reintento reusa el mismo", async () => {
    const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });
    const { port } = fakeArca({
      ultimo: 57,
      responder: (req, n) => (n === 1 ? rechazado() : aprobado(req)),
    });

    const primera = await emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1" });
    expect(primera.estado).toBe("rechazado");
    expect(primera.numero).toBe(58);
    expect(primera.errorMsg).toContain("Fecha fuera de rango");

    const segunda = await emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1" });
    expect(segunda.estado).toBe("autorizado");
    expect(segunda.numero).toBe(58); // el MISMO número, no 59
  });

  it("un rechazo no lanza: devuelve la fila para que la UI muestre el motivo", async () => {
    const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });
    const { port } = fakeArca({ responder: () => rechazado("Falta CondicionIVAReceptorId", 10242) });

    const cbte = await emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1" });
    expect(cbte.estado).toBe("rechazado");
    expect(cbte.observaciones).toEqual([{ code: 10242, msg: "Falta CondicionIVAReceptorId" }]);
  });

  it("un aprobado CON observaciones sigue siendo autorizado y guarda las observaciones", async () => {
    const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });
    const { port } = fakeArca({
      responder: (req) => ({ ...aprobado(req), observaciones: [{ code: 10063, msg: "RG 1361" }] }),
    });

    const cbte = await emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1" });
    expect(cbte.estado).toBe("autorizado");
    expect(cbte.cae).toBeTruthy();
    expect(cbte.observaciones).toEqual([{ code: 10063, msg: "RG 1361" }]);
  });

  // No sabemos si ARCA consumió el número: retenerlo es lo único seguro.
  it("un fallo de transporte deja la fila en error y RETIENE el número", async () => {
    const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });
    const { port } = fakeArca({ responder: () => { throw new Error("fetch failed"); } });

    const cbte = await emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1" });
    expect(cbte.estado).toBe("error");
    expect(cbte.numero).toBe(1);
    // El mensaje guardado no filtra el error crudo del proveedor.
    expect(cbte.errorMsg).not.toContain("fetch failed");
  });

  it("con una fila en error, reintentar exige reconciliar primero", async () => {
    const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });
    const falla = fakeArca({ responder: () => { throw new Error("boom"); } });
    await emitirFactura(db, falla.port, { storeId: store, saleId: sale.id, userId: "u1" });

    // ARCA no sabe nada del comprobante y consultar tampoco funciona.
    const roto = fakeArca({ consultar: () => { throw new Error("sigue caído"); } });
    await expect(emitirFactura(db, roto.port, { storeId: store, saleId: sale.id, userId: "u1" }))
      .rejects.toThrow("RECONCILIACION_PENDIENTE");
  });
});

describe("reconciliación", () => {
  async function conFilaEnError() {
    const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });
    const falla = fakeArca({ responder: () => { throw new Error("timeout"); } });
    const cbte = await emitirFactura(db, falla.port, { storeId: store, saleId: sale.id, userId: "u1" });
    expect(cbte.estado).toBe("error");
    return { sale, cbte };
  }

  // El escenario que justifica todo el estado `error`.
  it("ARCA SÍ tenía el CAE y el importe coincide: se adopta", async () => {
    const { cbte } = await conFilaEnError();
    const { port } = fakeArca({
      consultar: (cbteTipo, numero) => ({
        cbteTipo, ptoVta: 1, cbteDesde: numero, cae: "76999888777666", caeVto: "20260815",
        cbteFch: "20260730", impTotal: 1000, docTipo: 99, docNro: "0",
        resultado: "A", observaciones: [], raw: {},
      }),
    });

    const act = await reconciliarComprobante(db, port, { storeId: store, comprobanteId: cbte.id });
    expect(act.estado).toBe("autorizado");
    expect(act.cae).toBe("76999888777666");
    expect(act.caeVto).toBe("2026-08-15");
  });

  it("ARCA no lo tiene: el número queda LIBRE y el reintento lo reusa", async () => {
    const { sale, cbte } = await conFilaEnError();
    const { port } = fakeArca({ consultar: () => null });

    const act = await reconciliarComprobante(db, port, { storeId: store, comprobanteId: cbte.id });
    expect(act.estado).toBe("rechazado");

    const ok = fakeArca();
    const reintento = await emitirFactura(db, ok.port, { storeId: store, saleId: sale.id, userId: "u1" });
    expect(reintento.estado).toBe("autorizado");
    expect(reintento.numero).toBe(cbte.numero);
  });

  // ⚠️ Adoptar un comprobante ajeno sería atribuirnos un documento fiscal de
  // otro. Nunca se adopta en silencio.
  it("REGRESIÓN DE SEGURIDAD: importe distinto => sigue en error, NUNCA adopta", async () => {
    const { cbte } = await conFilaEnError();
    const { port } = fakeArca({
      consultar: (cbteTipo, numero) => ({
        cbteTipo, ptoVta: 1, cbteDesde: numero, cae: "76000000000000", caeVto: "20260815",
        cbteFch: "20260730", impTotal: 5555, docTipo: 99, docNro: "0",
        resultado: "A", observaciones: [], raw: {},
      }),
    });

    const act = await reconciliarComprobante(db, port, { storeId: store, comprobanteId: cbte.id });
    expect(act.estado).toBe("error");
    expect(act.cae).toBeNull();
    expect(act.errorMsg).toContain("Contactá a tu contador");
  });

  it("si ARCA no responde, la fila queda como estaba para reintentar", async () => {
    const { cbte } = await conFilaEnError();
    const { port } = fakeArca({ consultar: () => { throw new Error("sigue caído"); } });

    const act = await reconciliarComprobante(db, port, { storeId: store, comprobanteId: cbte.id });
    expect(act.estado).toBe("error");
  });

  it("reconciliar algo ya autorizado es un no-op", async () => {
    const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });
    const ok = fakeArca();
    const cbte = await emitirFactura(db, ok.port, { storeId: store, saleId: sale.id, userId: "u1" });

    const { port, llamadas } = fakeArca();
    const act = await reconciliarComprobante(db, port, { storeId: store, comprobanteId: cbte.id });
    expect(act.estado).toBe("autorizado");
    expect(llamadas.consultar).toHaveLength(0);
  });

  it("no se puede reconciliar un comprobante de otra tienda", async () => {
    const { cbte } = await conFilaEnError();
    const { port } = fakeArca();
    await expect(reconciliarComprobante(db, port, { storeId: otraStore, comprobanteId: cbte.id }))
      .rejects.toThrow("VENTA_NO_ENCONTRADA");
  });
});

// Los tres bugs que encontró la revisión de código. Cada uno perdía o duplicaba
// un comprobante fiscal real, así que van con nombre propio.
describe("regresiones de numeración y reconciliación", () => {
  it("REGRESIÓN: un CAE otorgado se guarda aunque la fila ya no esté 'pendiente'", async () => {
    const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });

    // La emisión arranca y, mientras ARCA responde, alguien toca la fila y la
    // deja 'rechazado'. Antes, el UPDATE guardado por `estado = 'pendiente'` no
    // matcheaba y el CAE se perdía: autorizado en ARCA, sin registro acá.
    const { port } = fakeArca({
      responder: async (req) => {
        await db.update(comprobantes).set({ estado: "rechazado" })
          .where(eq(comprobantes.saleId, sale.id));
        return aprobado(req, "76555444333222");
      },
    });

    const cbte = await emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1" });
    expect(cbte.estado).toBe("autorizado");
    expect(cbte.cae).toBe("76555444333222");
  });

  it("un comprobante ya autorizado no se pisa con otra respuesta", async () => {
    const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });
    const { port } = fakeArca();
    const original = await emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1" });

    const { asentarResultado } = await import("@/domain/fiscal-emision");
    const otro = fakeArca();
    const despues = await asentarResultado(db, otro.port, original.id, {
      resultado: "A", cae: "70000000000000", caeVto: "20260901", cbteDesde: 1,
      observaciones: [], errores: [], raw: {},
    });
    expect(despues.cae).toBe(original.cae);
  });

  // Sin re-siembra tras un rechazo, el sistema propone el mismo número para
  // siempre. Pasa cada vez que la numeración de ARCA avanzó por afuera.
  it("REGRESIÓN: tras un rechazo se vuelve a preguntar el último autorizado a ARCA", async () => {
    const a = await seedTestSale(db, { storeId: store, total: 1000 });
    const b = await seedTestSale(db, { storeId: store, total: 1000 });

    // Primera factura OK: queda el número 1 autorizado localmente.
    await emitirFactura(db, fakeArca().port, { storeId: store, saleId: a.sale.id, userId: "u1" });

    // Mientras tanto el contador emitió del 2 al 5 desde el portal de ARCA.
    let ultimoEnArca = 5;
    const { port, llamadas } = fakeArca({
      ultimo: () => ultimoEnArca,
      responder: (req, n) => (n === 1 ? rechazado("El numero de comprobante no es correlativo", 10016) : aprobado(req)),
    });

    const primerIntento = await emitirFactura(db, port, { storeId: store, saleId: b.sale.id, userId: "u1" });
    expect(primerIntento.estado).toBe("rechazado");
    expect(primerIntento.numero).toBe(2); // desfasado, como esperábamos

    // El reintento tiene que re-sembrar desde ARCA y proponer 6, no 2 otra vez.
    const segundoIntento = await emitirFactura(db, port, { storeId: store, saleId: b.sale.id, userId: "u1" });
    expect(segundoIntento.estado).toBe("autorizado");
    expect(segundoIntento.numero).toBe(6);
    // Exactamente una consulta: el primer intento no tenía motivo para
    // sospechar desfase, el reintento sí. No se le pregunta a ARCA de más.
    expect(llamadas.ultimo).toHaveLength(1);
  });

  // Un `pendiente` recién creado puede tener una llamada a ARCA en vuelo AHORA.
  it("REGRESIÓN: reconciliar no toca una emisión en curso", async () => {
    const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });
    const [fila] = await db.insert(comprobantes).values({
      storeId: store, saleId: sale.id, clase: "factura", cbteTipo: CBTE_FACTURA_B,
      ambiente: "homologacion", ptoVta: 1, numero: 1, estado: "pendiente",
      docTipo: 99, docNro: "0", condIvaReceptor: IVA_CONSUMIDOR_FINAL,
      receptorNombre: "Consumidor Final", impTotal: 1000, impNeto: 826.45, impIva: 173.55,
      ivaDesglose: [{ id: 5, baseImp: 826.45, importe: 173.55 }], lineas: [],
      cbteFch: "2026-07-30", cuitEmisor: CUIT, createdBy: "u1",
    }).returning();

    const { port, llamadas } = fakeArca({ consultar: () => null });
    const act = await reconciliarComprobante(db, port, { storeId: store, comprobanteId: fila.id });

    expect(act.estado).toBe("pendiente");
    expect(llamadas.consultar).toHaveLength(0);
  });

  it("un pendiente viejo sí se reconcilia", async () => {
    const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });
    const [fila] = await db.insert(comprobantes).values({
      storeId: store, saleId: sale.id, clase: "factura", cbteTipo: CBTE_FACTURA_B,
      ambiente: "homologacion", ptoVta: 1, numero: 1, estado: "pendiente",
      docTipo: 99, docNro: "0", condIvaReceptor: IVA_CONSUMIDOR_FINAL,
      receptorNombre: "Consumidor Final", impTotal: 1000, impNeto: 826.45, impIva: 173.55,
      ivaDesglose: [{ id: 5, baseImp: 826.45, importe: 173.55 }], lineas: [],
      cbteFch: "2026-07-30", cuitEmisor: CUIT, createdBy: "u1",
    }).returning();

    // Se envejece la fila EN SQL. Escribir un `new Date()` de hace 10 minutos no
    // sirve: la columna es `timestamp` sin zona y el valor entraría desplazado
    // respecto del `now()` contra el que se compara.
    await db.execute(sql`UPDATE comprobantes SET updated_at = now() - interval '10 minutes' WHERE id = ${fila.id}`);

    const { port } = fakeArca({ consultar: () => null });
    const act = await reconciliarComprobante(db, port, { storeId: store, comprobanteId: fila.id });
    expect(act.estado).toBe("rechazado");
  });

  // Liberar un número por un error de sesión reasignaría a otra venta un número
  // que ARCA sí tiene autorizado.
  it("REGRESIÓN: un error de ARCA que no es 'no existe' NO libera el número", async () => {
    const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });
    const falla = fakeArca({ responder: () => { throw new Error("timeout"); } });
    const cbte = await emitirFactura(db, falla.port, { storeId: store, saleId: sale.id, userId: "u1" });
    expect(cbte.estado).toBe("error");

    // ARCA responde un error de sesión, no un 602.
    const { port } = fakeArca({
      consultar: () => { throw new ArcaError("ARCA_SOAP_FAULT", "Token invalido"); },
    });
    const act = await reconciliarComprobante(db, port, { storeId: store, comprobanteId: cbte.id });
    expect(act.estado).toBe("error");
  });
});

describe("notas de crédito", () => {
  async function conFacturaAutorizada(total = 1000) {
    const { sale } = await seedTestSale(db, { storeId: store, total });
    const { port } = fakeArca();
    const factura = await emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1" });
    return { sale, factura };
  }

  it("emite NC B con los mismos importes y apuntando a la factura", async () => {
    const { sale, factura } = await conFacturaAutorizada();
    const { port, llamadas } = fakeArca();

    const nc = await emitirNotaCredito(db, port, { storeId: store, saleId: sale.id, userId: "u1" });
    expect(nc.estado).toBe("autorizado");
    expect(nc.clase).toBe("nota_credito");
    expect(nc.cbteTipo).toBe(CBTE_NOTA_CREDITO_B);
    expect(nc.impTotal).toBe(factura.impTotal);
    expect(nc.impNeto).toBe(factura.impNeto);
    expect(nc.cbteAsocId).toBe(factura.id);
    expect(llamadas.autorizar[0].FeDetReq[0].CbtesAsoc?.[0].Nro).toBe(factura.numero);
  });

  it("la NC numera en su propia secuencia, independiente de la factura", async () => {
    const { sale } = await conFacturaAutorizada();
    const { port } = fakeArca({ ultimo: (t) => (t === CBTE_NOTA_CREDITO_B ? 12 : 0) });

    const nc = await emitirNotaCredito(db, port, { storeId: store, saleId: sale.id, userId: "u1" });
    expect(nc.numero).toBe(13);
  });

  it("sin factura autorizada no corresponde NC, y no se llama a ARCA", async () => {
    const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });
    const { port, llamadas } = fakeArca();

    await expect(emitirNotaCredito(db, port, { storeId: store, saleId: sale.id, userId: "u1" }))
      .rejects.toThrow("SIN_FACTURA_PARA_ANULAR");
    expect(llamadas.autorizar).toHaveLength(0);
  });

  it("es idempotente: no emite dos NC para la misma venta", async () => {
    const { sale } = await conFacturaAutorizada();
    const { port, llamadas } = fakeArca();

    const a = await emitirNotaCredito(db, port, { storeId: store, saleId: sale.id, userId: "u1" });
    const b = await emitirNotaCredito(db, port, { storeId: store, saleId: sale.id, userId: "u1" });
    expect(b.id).toBe(a.id);
    expect(llamadas.autorizar).toHaveLength(1);
  });

  it("factura y NC conviven en la misma venta", async () => {
    const { sale } = await conFacturaAutorizada();
    const { port } = fakeArca();
    await emitirNotaCredito(db, port, { storeId: store, saleId: sale.id, userId: "u1" });

    const todos = await getComprobantesBySale(db, store, sale.id);
    expect(todos).toHaveLength(2);
    expect(todos.map((c) => c.clase).sort()).toEqual(["factura", "nota_credito"]);
    expect(await getFacturaAutorizada(db, store, sale.id)).not.toBeNull();
  });
});

// El link público del comprobante — el que se le manda al cliente por WhatsApp
// o por mail. La credencial es el token, así que sus garantías son de seguridad.
describe("link público del comprobante", () => {
  it("cada comprobante nace con su propio token, largo y al azar", async () => {
    const a = await seedTestSale(db, { storeId: store, total: 1000 });
    const b = await seedTestSale(db, { storeId: store, total: 500 });
    const { port } = fakeArca();

    const f1 = await emitirFactura(db, port, { storeId: store, saleId: a.sale.id, userId: "u1" });
    const f2 = await emitirFactura(db, port, { storeId: store, saleId: b.sale.id, userId: "u1" });

    expect(f1.publicToken).toBeTruthy();
    expect(f1.publicToken!.length).toBeGreaterThanOrEqual(40);
    expect(f2.publicToken).not.toBe(f1.publicToken);
  });

  it("la nota de crédito tiene su propio link, distinto del de la factura", async () => {
    const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });
    const { port } = fakeArca();
    const factura = await emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1" });
    const nc = await emitirNotaCredito(db, port, { storeId: store, saleId: sale.id, userId: "u1" });

    expect(nc.publicToken).toBeTruthy();
    expect(nc.publicToken).not.toBe(factura.publicToken);
  });

  it("el token abre el comprobante sin pasar por la sesión", async () => {
    const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });
    const { port } = fakeArca();
    const factura = await emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1" });

    const { getComprobanteViewPorToken } = await import("@/domain/comprobante-view");
    const view = await getComprobanteViewPorToken(db, factura.publicToken!);
    expect(view).not.toBeNull();
    expect(view!.comprobante.id).toBe(factura.id);
    expect(view!.qrUrl).toContain("afip.gob.ar/fe/qr");
  });

  // Mandarle al cliente un link a algo que ARCA no aprobó sería prometerle un
  // documento que puede terminar rechazado.
  it("REGRESIÓN: un comprobante NO autorizado no se sirve por el link público", async () => {
    const { sale } = await seedTestSale(db, { storeId: store, total: 1000 });
    const { port } = fakeArca({ responder: () => rechazado() });
    const rechazada = await emitirFactura(db, port, { storeId: store, saleId: sale.id, userId: "u1" });
    expect(rechazada.estado).toBe("rechazado");

    const { getComprobanteViewPorToken } = await import("@/domain/comprobante-view");
    expect(await getComprobanteViewPorToken(db, rechazada.publicToken!)).toBeNull();
  });

  it("un token inventado, vacío o corto no devuelve nada", async () => {
    const { getComprobanteViewPorToken } = await import("@/domain/comprobante-view");
    expect(await getComprobanteViewPorToken(db, "")).toBeNull();
    expect(await getComprobanteViewPorToken(db, "corto")).toBeNull();
    expect(await getComprobanteViewPorToken(db, "a".repeat(43))).toBeNull();
  });

  it("el link de una tienda no filtra el emisor de otra", async () => {
    await saveFiscalConfig(db, {
      storeId: otraStore, cuit: "20111111112", razonSocial: "Otro Comercio",
      domicilio: "Otra calle 1", puntoVenta: 1, enabled: true,
    });
    await seedTestUser(db, "u2", "owner", otraStore);
    const propia = await seedTestSale(db, { storeId: store, total: 1000 });
    const ajena = await seedTestSale(db, { storeId: otraStore, total: 777, userId: "u2" });

    const { port } = fakeArca();
    const f1 = await emitirFactura(db, port, { storeId: store, saleId: propia.sale.id, userId: "u1" });
    const f2 = await emitirFactura(db, port, { storeId: otraStore, saleId: ajena.sale.id, userId: "u2" });

    const { getComprobanteViewPorToken } = await import("@/domain/comprobante-view");
    const v1 = await getComprobanteViewPorToken(db, f1.publicToken!);
    const v2 = await getComprobanteViewPorToken(db, f2.publicToken!);

    expect(v1!.emisor.razonSocial).toBe("Mi Comercio SRL");
    expect(v2!.emisor.razonSocial).toBe("Otro Comercio");
    expect(v2!.comprobante.impTotal).toBe(777);
  });
});
