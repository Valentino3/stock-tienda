import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import fc from "fast-check";
import { createTestDb, seedTestStore, seedTestUser } from "./helpers/db";
import { compras } from "@/db/schema";
import { listarRubros, resumenPorRubro } from "@/domain/gastos";
import {
  anularCompra, anularPagoProveedor, aplicarPagos, crearProveedor, deudaPorProveedor, editarProveedor,
  estadoDeCuenta, registrarCompra, registrarPagoProveedor, sumarDias,
} from "@/domain/proveedores";

/**
 * Proveedores: lo que se les debe, qué venció, y que las compras cuenten como
 * gasto de su rubro una sola vez.
 */

let db: Awaited<ReturnType<typeof createTestDb>>;
let store: number;
let mercaderia: number;
let bebidas: number;

beforeEach(async () => {
  db = await createTestDb();
  store = await seedTestStore(db);
  await seedTestUser(db, "u1", "owner", store);
  const rubros = await listarRubros(db, store);
  mercaderia = rubros.find((r) => r.nombre === "Mercadería")!.id;
  bebidas = rubros.find((r) => r.nombre === "Bebidas")!.id;
});

const proveedor = (over: Record<string, unknown> = {}) =>
  crearProveedor(db, { storeId: store, nombre: "Distribuidora Sur", rubroId: mercaderia, plazoDias: 30, ...over });

const factura = (proveedorId: number, over: Record<string, unknown> = {}) =>
  registrarCompra(db, {
    storeId: store, userId: "u1", proveedorId, numero: "0001-00000123", fecha: "2026-10-01", total: 100000, ...over,
  });

describe("proveedores", () => {
  it("se crean con rubro y plazo, y el nombre no se repite", async () => {
    const p = await proveedor({ cuit: " 30-12345678-9 " });
    expect(p).toMatchObject({ nombre: "Distribuidora Sur", cuit: "30-12345678-9", plazoDias: 30 });
    await expect(proveedor()).rejects.toThrow("PROVEEDOR_DUPLICADO");
    await expect(proveedor({ nombre: "Otro", plazoDias: -1 })).rejects.toThrow("PLAZO_INVALIDO");
  });

  it("no se tocan proveedores de otra tienda", async () => {
    const store2 = await seedTestStore(db, "t2", "Tienda 2");
    const ajeno = await crearProveedor(db, { storeId: store2, nombre: "Ajeno" });
    await expect(editarProveedor(db, { storeId: store, proveedorId: ajeno.id, nombre: "X" }))
      .rejects.toThrow("PROVEEDOR_NO_ENCONTRADO");
    await expect(factura(ajeno.id)).rejects.toThrow("PROVEEDOR_NO_ENCONTRADO");
  });
});

describe("facturas de compra", () => {
  it("toman el rubro y el plazo del proveedor si no se indican", async () => {
    const p = await proveedor();
    const f = await factura(p.id);
    expect(f).toMatchObject({ rubroId: mercaderia, vencimiento: "2026-10-31", total: 100000 });

    const conRubro = await factura(p.id, { numero: "0001-00000124", rubroId: bebidas, vencimiento: "2026-10-10" });
    expect(conRubro).toMatchObject({ rubroId: bebidas, vencimiento: "2026-10-10" });
  });

  it("no se carga dos veces la misma factura; anulada, sí", async () => {
    const p = await proveedor();
    const f = await factura(p.id);
    await expect(factura(p.id)).rejects.toThrow("COMPRA_DUPLICADA");
    await anularCompra(db, { storeId: store, compraId: f.id, userId: "u1", motivo: "Monto equivocado" });
    await expect(factura(p.id, { total: 95000 })).resolves.toBeDefined();
  });

  it("valida número, fecha, monto, vencimiento y proveedor activo", async () => {
    const p = await proveedor();
    await expect(factura(p.id, { numero: " " })).rejects.toThrow("NUMERO_REQUERIDO");
    await expect(factura(p.id, { fecha: "1/10/2026" })).rejects.toThrow("FECHA_INVALIDA");
    await expect(factura(p.id, { total: 0 })).rejects.toThrow("INVALID_AMOUNT");
    await expect(factura(p.id, { vencimiento: "2026-09-01" })).rejects.toThrow("VENCE_ANTES");
    const sinRubro = await proveedor({ nombre: "Sin rubro", rubroId: null });
    await expect(factura(sinRubro.id)).rejects.toThrow("RUBRO_REQUERIDO");
    await editarProveedor(db, { storeId: store, proveedorId: p.id, nombre: p.nombre, activo: false });
    await expect(factura(p.id, { numero: "X" })).rejects.toThrow("PROVEEDOR_INACTIVO");
  });

  it("la base no acepta un vencimiento antes de la fecha ni un total negativo", async () => {
    const p = await proveedor();
    const f = await factura(p.id);
    await expect(db.update(compras).set({ vencimiento: "2026-01-01" }).where(eq(compras.id, f.id))).rejects.toThrow();
    await expect(db.update(compras).set({ total: -1 }).where(eq(compras.id, f.id))).rejects.toThrow();
  });
});

describe("cuenta del proveedor", () => {
  it("los pagos cubren primero lo que vence antes; lo que queda impago y vencido se ve", async () => {
    const p = await proveedor();
    await factura(p.id, { numero: "A", fecha: "2026-09-01", vencimiento: "2026-09-30", total: 50000 });
    await factura(p.id, { numero: "B", fecha: "2026-10-01", vencimiento: "2026-10-31", total: 80000 });
    await factura(p.id, { numero: "C", fecha: "2026-10-20", vencimiento: "2026-11-19", total: 30000 });
    await registrarPagoProveedor(db, {
      storeId: store, userId: "u1", proveedorId: p.id, fecha: "2026-10-05", monto: 70000, medio: "transferencia",
    });

    const e = await estadoDeCuenta(db, store, p.id, "2026-11-02");
    expect(e.saldo).toBe(90000);
    expect(e.facturas.map((f) => [f.numero, f.pendiente, f.vencida])).toEqual([
      ["A", 0, false],
      ["B", 60000, true],
      ["C", 30000, false],
    ]);
    expect(e.vencido).toBe(60000);
    expect(e.proximoVencimiento).toBe("2026-11-19");

    const [d] = await deudaPorProveedor(db, store, { hoy: "2026-11-02" });
    expect(d).toMatchObject({ saldo: 90000, vencido: 60000, proximoVencimiento: "2026-11-19", rubro: "Mercadería" });
  });

  it("lo anulado no cuenta, ni facturas ni pagos", async () => {
    const p = await proveedor();
    const f = await factura(p.id, { total: 40000 });
    const pago = await registrarPagoProveedor(db, {
      storeId: store, userId: "u1", proveedorId: p.id, fecha: "2026-10-05", monto: 40000, medio: "cheque",
    });
    expect((await estadoDeCuenta(db, store, p.id)).saldo).toBe(0);

    await anularPagoProveedor(db, { storeId: store, pagoId: pago.id, userId: "u1", motivo: "Cheque rechazado" });
    expect((await estadoDeCuenta(db, store, p.id)).saldo).toBe(40000);

    await anularCompra(db, { storeId: store, compraId: f.id, userId: "u1", motivo: "Mal cargada" });
    const e = await estadoDeCuenta(db, store, p.id);
    expect(e.saldo).toBe(0);
    // Siguen en el historial.
    expect(e.facturas).toHaveLength(1);
    expect(e.pagos).toHaveLength(1);
  });

  it("un pago de más queda a favor del local", async () => {
    const p = await proveedor();
    await factura(p.id, { total: 10000 });
    await registrarPagoProveedor(db, {
      storeId: store, userId: "u1", proveedorId: p.id, fecha: "2026-10-05", monto: 15000, medio: "transferencia",
    });
    const e = await estadoDeCuenta(db, store, p.id);
    expect(e.saldo).toBe(-5000);
    expect(e.vencido).toBe(0);
  });

  it("propiedad: lo pendiente de las facturas suma el saldo (nunca más que lo facturado)", () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        total: fc.integer({ min: 1, max: 1_000_000 }).map((n) => n / 100),
        dias: fc.integer({ min: 0, max: 120 }),
      }), { minLength: 1, maxLength: 20 }),
      fc.integer({ min: 0, max: 30_000_000 }).map((n) => n / 100),
      (filas, pagado) => {
        const facturas = filas.map((f, i) => ({
          id: i + 1, total: f.total, fecha: "2026-01-01", vencimiento: sumarDias("2026-01-01", f.dias),
        }));
        const aplicadas = aplicarPagos(facturas, pagado, "2026-03-01");
        const facturado = facturas.reduce((a, f) => a + f.total, 0);
        const pendiente = aplicadas.reduce((a, f) => a + f.pendiente, 0);
        const esperado = Math.max(0, facturado - pagado);
        expect(Math.abs(pendiente - esperado)).toBeLessThan(0.005 * facturas.length + 0.001);
        for (const f of aplicadas) expect(f.pendiente).toBeGreaterThanOrEqual(0);
      },
    ));
  });
});

describe("las compras en el resumen de gastos", () => {
  it("suman en su rubro por la fecha de la factura; los pagos no se cuentan otra vez", async () => {
    const p = await proveedor();
    await factura(p.id, { total: 100000, fecha: "2026-10-01" });
    await factura(p.id, { numero: "2", total: 20000, fecha: "2026-10-02", rubroId: bebidas });
    await factura(p.id, { numero: "3", total: 999, fecha: "2026-11-01" }); // fuera del período
    await registrarPagoProveedor(db, {
      storeId: store, userId: "u1", proveedorId: p.id, fecha: "2026-10-15", monto: 120000, medio: "transferencia",
    });

    const r = await resumenPorRubro(db, store, { desde: "2026-10-01", hasta: "2026-10-31" });
    expect(r.total).toBe(120000);
    expect(r.rubros.map((f) => [f.nombre, f.compras, f.total])).toEqual([
      ["Mercadería", 100000, 100000],
      ["Bebidas", 20000, 20000],
    ]);
  });
});
