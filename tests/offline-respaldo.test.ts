import { describe, it, expect } from "vitest";
import {
  armarRespaldo, nombreDeArchivo, validarRespaldo, ventasAFaltantes, VERSION_RESPALDO,
} from "@/lib/offline/respaldo";
import type { VentaEnCola } from "@/lib/offline/db";

const UID_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const UID_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

const venta = (uid: string): VentaEnCola => ({
  uid,
  capturadoEn: "2026-08-03T18:00:00.000Z",
  cashSessionId: 7,
  paymentMethod: "efectivo",
  items: [{ variantId: 1, quantity: 2, unitPrice: 1000, productName: "Remera", variantName: "M" }],
  total: 2000,
  intentos: 0,
});

const texto = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ ...armarRespaldo({ storeId: 1, ventas: [venta(UID_A)], clientesNuevos: [] }), ...over });

describe("armarRespaldo", () => {
  it("marca versión y tienda", () => {
    const r = armarRespaldo({ storeId: 3, ventas: [venta(UID_A)], clientesNuevos: [] });
    expect(r.version).toBe(VERSION_RESPALDO);
    expect(r.storeId).toBe(3);
    expect(r.ventas).toHaveLength(1);
  });

  it("el nombre del archivo no lleva caracteres inválidos para un filesystem", () => {
    const nombre = nombreDeArchivo(armarRespaldo({ storeId: 1, ventas: [], clientesNuevos: [] }));
    expect(nombre).toMatch(/^ventas-pendientes-[\d-]+\.json$/);
    expect(nombre).not.toContain(":");
  });
});

describe("validarRespaldo", () => {
  it("acepta un respaldo bien formado", () => {
    const res = validarRespaldo(texto(), 1);
    expect(res.ok).toBe(true);
  });

  it("rechaza un archivo que no es JSON", () => {
    const res = validarRespaldo("no soy json");
    expect(res).toEqual({ ok: false, error: expect.stringContaining("no es un respaldo válido") });
  });

  it("rechaza otra versión de respaldo", () => {
    const res = validarRespaldo(texto({ version: 99 }));
    expect(res.ok).toBe(false);
  });

  it("rechaza el respaldo de OTRA tienda", () => {
    // Restaurarlo metería ventas con ids de variantes y de caja que no existen
    // acá: todas fallarían, pero después de ensuciar la cola.
    const res = validarRespaldo(texto({ storeId: 2 }), 1);
    expect(res).toEqual({ ok: false, error: expect.stringContaining("otra tienda") });
  });

  it("sin tienda esperada no compara (restaurar en un dispositivo virgen)", () => {
    expect(validarRespaldo(texto({ storeId: 2 })).ok).toBe(true);
  });

  it("rechaza el lote entero si UNA venta está mal", () => {
    const mala = { ...venta(UID_B), total: "mucho" };
    const res = validarRespaldo(texto({ ventas: [venta(UID_A), mala] }), 1);
    expect(res.ok).toBe(false);
  });

  it("rechaza una venta sin items", () => {
    expect(validarRespaldo(texto({ ventas: [{ ...venta(UID_A), items: [] }] }), 1).ok).toBe(false);
  });

  it("rechaza cantidades y precios inválidos", () => {
    const conCantidadCero = { ...venta(UID_A), items: [{ variantId: 1, quantity: 0, unitPrice: 10 }] };
    const conPrecioNegativo = { ...venta(UID_A), items: [{ variantId: 1, quantity: 1, unitPrice: -5 }] };
    expect(validarRespaldo(texto({ ventas: [conCantidadCero] }), 1).ok).toBe(false);
    expect(validarRespaldo(texto({ ventas: [conPrecioNegativo] }), 1).ok).toBe(false);
  });

  it("rechaza un uid que no es uuid", () => {
    expect(validarRespaldo(texto({ ventas: [{ ...venta(UID_A), uid: "pepe" }] }), 1).ok).toBe(false);
  });

  it("rechaza una fecha ilegible", () => {
    expect(validarRespaldo(texto({ ventas: [{ ...venta(UID_A), capturadoEn: "ayer" }] }), 1).ok).toBe(false);
  });

  it("rechaza un cliente sin nombre", () => {
    const res = validarRespaldo(texto({ clientesNuevos: [{ uid: UID_B, name: "  " }] }), 1);
    expect(res.ok).toBe(false);
  });
});

describe("ventasAFaltantes", () => {
  it("no vuelve a agregar lo que ya está en la cola", () => {
    const respaldo = armarRespaldo({
      storeId: 1, ventas: [venta(UID_A), venta(UID_B)], clientesNuevos: [],
    });
    const r = ventasAFaltantes(respaldo, [UID_A]);
    expect(r.ventas.map((v) => v.uid)).toEqual([UID_B]);
    expect(r.yaEstaban).toBe(1);
  });

  it("con la cola vacía restaura todo", () => {
    const respaldo = armarRespaldo({ storeId: 1, ventas: [venta(UID_A)], clientesNuevos: [] });
    expect(ventasAFaltantes(respaldo, []).ventas).toHaveLength(1);
  });

  it("si ya estaban todas no hay nada que escribir", () => {
    const respaldo = armarRespaldo({ storeId: 1, ventas: [venta(UID_A)], clientesNuevos: [] });
    const r = ventasAFaltantes(respaldo, [UID_A]);
    expect(r.ventas).toHaveLength(0);
    expect(r.yaEstaban).toBe(1);
  });
});
