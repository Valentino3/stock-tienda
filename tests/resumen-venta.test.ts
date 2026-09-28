import { describe, it, expect } from "vitest";
import { montosPorMedio, resumirLineas, totalesDelListado } from "@/domain/resumen-venta";
import type { LineaRemito, Remito } from "@/domain/cash-close";

/**
 * Cómo se resume una venta en una fila. Es lo que el cajero lee para saber
 * "con qué se pagó cada cosa", así que un resumen que junte mal o que pierda
 * un medio es exactamente la queja que esto viene a resolver.
 */

const linea = (productName: string, quantity: number, variantName: string | null = null): LineaRemito => ({
  variantId: 1, sku: null, productName, variantName, quantity,
  unitPrice: 100, discountAmount: 0, priceList: "venta", neto: quantity * 100,
});

const remito = (total: number, voided = false): Remito => ({
  saleId: 1, numero: null, clientDoc: null, createdAt: new Date(), sellerName: "ana",
  paymentMethod: "efectivo", pagos: [{ method: "efectivo", amount: total }], clientName: null,
  voided, voidedReason: null, discountAmount: 0, total, posteriorAlCierre: false, lineas: [],
});

describe("resumirLineas", () => {
  it("junta las variantes de un mismo producto y respeta el orden de la venta", () => {
    const r = resumirLineas([
      linea("Remera", 1, "M"),
      linea("Gorra", 1),
      linea("Remera", 1, "L"),
    ]);
    expect(r).toEqual({ texto: "2× Remera, 1× Gorra", resto: 0 });
  });

  it("corta en el máximo y dice cuántos productos quedaron afuera", () => {
    const r = resumirLineas([linea("A", 1), linea("B", 2), linea("C", 1), linea("D", 1)], 2);
    expect(r).toEqual({ texto: "1× A, 2× B", resto: 2 });
  });

  it("sin líneas no inventa nada", () => {
    expect(resumirLineas([])).toEqual({ texto: "", resto: 0 });
  });
});

describe("montosPorMedio", () => {
  it("pone cada parte de un pago dividido en su columna y deja vacío lo que no se usó", () => {
    expect(montosPorMedio([{ method: "efectivo", amount: 5000 }, { method: "tarjeta", amount: 7000 }]))
      .toEqual({ efectivo: 5000, transferencia: null, tarjeta: 7000, cuenta: null });
  });

  it("un solo medio va entero en su columna", () => {
    expect(montosPorMedio([{ method: "cuenta", amount: 1234.5 }]))
      .toEqual({ efectivo: null, transferencia: null, tarjeta: null, cuenta: 1234.5 });
  });
});

describe("totalesDelListado", () => {
  it("deja las anuladas fuera del total, contadas aparte", () => {
    expect(totalesDelListado([remito(1000), remito(2500.5), remito(300, true)])).toEqual({
      ventas: 2, total: 3500.5, anuladas: { count: 1, total: 300 },
    });
  });
});
