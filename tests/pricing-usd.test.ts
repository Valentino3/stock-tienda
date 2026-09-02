import { describe, it, expect } from "vitest";
import {
  PASOS_REDONDEO, precioDeLista, precioDesdeUsd, usdEfectivo,
  esCotizacionValida, esPasoValido, esPorcentajeValido,
} from "@/domain/pricing-usd";

/**
 * El cálculo, sin base de por medio.
 *
 * Lo que protege: que recalcular dos veces con la misma cotización no mueva un
 * peso. Es la propiedad que el dueño va a probar sin darse cuenta, apretando el
 * botón dos veces.
 */

const nearest100 = { mode: "nearest" as const, step: 100 };
const up100 = { mode: "up" as const, step: 100 };

describe("precioDesdeUsd", () => {
  it("multiplica y redondea al múltiplo", () => {
    // 58,90 × 1480 = 87.172 → 87.200
    expect(precioDesdeUsd(58.9, 1480, nearest100)).toBe(87200);
  });

  it("el resultado siempre es múltiplo del paso", () => {
    const casos = [3.33, 58.9, 110, 0.75, 1234.56];
    for (const step of PASOS_REDONDEO) {
      for (const usd of casos) {
        for (const mode of ["nearest", "up"] as const) {
          const r = precioDesdeUsd(usd, 1487, { mode, step });
          expect(r % step, `usd ${usd} step ${step} modo ${mode}`).toBe(0);
        }
      }
    }
  });

  it("«para arriba» sobre un valor que ya es múltiplo no salta al siguiente", () => {
    // El bug clásico de Math.ceil(x/step + eps). 87200 ya es múltiplo de 100.
    const exacto = 87200 / 1480;
    expect(precioDesdeUsd(exacto, 1480, up100)).toBe(87200);
    expect(precioDesdeUsd(100, 10, up100)).toBe(1000);
  });

  it("los empates suben", () => {
    // 0,75 × 100 = 75, que está justo en el medio entre 50 y 100.
    expect(precioDesdeUsd(0.75, 100, { mode: "nearest", step: 50 })).toBe(100);
  });

  it("no arrastra ruido de coma flotante", () => {
    // (0.1 + 0.2) × 100 da 30,000000000000004 sin el round2 previo.
    expect(precioDesdeUsd(0.1 + 0.2, 100, { mode: "nearest", step: 10 })).toBe(30);
  });

  it("rechaza una cotización que pondría el catálogo en cero", () => {
    expect(() => precioDesdeUsd(58.9, 0, nearest100)).toThrow("INVALID_USD_RATE");
    expect(() => precioDesdeUsd(58.9, -1480, nearest100)).toThrow("INVALID_USD_RATE");
  });

  it("rechaza un precio en dólares negativo y un paso inventado", () => {
    expect(() => precioDesdeUsd(-1, 1480, nearest100)).toThrow("INVALID_USD_PRICE");
    expect(() => precioDesdeUsd(10, 1480, { mode: "nearest", step: 37 })).toThrow("INVALID_ROUNDING_STEP");
  });

  it("es idempotente por construcción: la entrada nunca es el precio anterior", () => {
    const uno = precioDesdeUsd(58.9, 1480, up100);
    const dos = precioDesdeUsd(58.9, 1480, up100);
    const tres = precioDesdeUsd(58.9, 1480, up100);
    expect([dos, tres]).toEqual([uno, uno]);
  });
});

describe("precioDeLista", () => {
  it("aplica el descuento antes de redondear", () => {
    // 58,90 × 1480 × 0,85 = 74.096,20 → 74.100
    expect(precioDeLista(58.9, 1480, 15, nearest100)).toBe(74100);
  });

  it("sin porcentaje devuelve null, que significa «no tocar la lista»", () => {
    expect(precioDeLista(58.9, 1480, null, nearest100)).toBeNull();
  });

  it("rechaza porcentajes fuera de rango", () => {
    expect(() => precioDeLista(10, 1000, 100, nearest100)).toThrow("INVALID_PCT");
    expect(() => precioDeLista(10, 1000, -5, nearest100)).toThrow("INVALID_PCT");
  });
});

describe("usdEfectivo", () => {
  it("el de la variante pisa al del producto", () => {
    expect(usdEfectivo({ priceUsd: 12 }, { basePriceUsd: 10 })).toBe(12);
  });

  it("sin propio, hereda el del producto", () => {
    expect(usdEfectivo({ priceUsd: null }, { basePriceUsd: 10 })).toBe(10);
  });

  it("un cero propio NO cae al del producto", () => {
    // Con `||` en vez de `!= null`, un artículo de regalo heredaría el precio
    // del padre y se cobraría.
    expect(usdEfectivo({ priceUsd: 0 }, { basePriceUsd: 10 })).toBe(0);
  });

  it("sin dólar en ningún nivel devuelve null: el recálculo no lo toca", () => {
    expect(usdEfectivo({ priceUsd: null }, { basePriceUsd: null })).toBeNull();
  });
});

describe("validadores", () => {
  it("aceptan lo válido y rechazan lo demás", () => {
    expect(esCotizacionValida(1480)).toBe(true);
    expect(esCotizacionValida(0)).toBe(false);
    expect(esCotizacionValida(Number.NaN)).toBe(false);
    expect(esPasoValido(100)).toBe(true);
    expect(esPasoValido(37)).toBe(false);
    expect(esPorcentajeValido(0)).toBe(true);
    expect(esPorcentajeValido(99.99)).toBe(true);
    expect(esPorcentajeValido(100)).toBe(false);
  });
});
