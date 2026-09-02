import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  PASOS_REDONDEO, precioDesdeUsd, precioDeLista, type ReglaRedondeo,
} from "@/domain/pricing-usd";

/**
 * Propiedades del cálculo de precios contra el dólar.
 *
 * Un test de ejemplo dice "58,90 × 1480 da 87.200". Una propiedad dice "el
 * resultado SIEMPRE es múltiplo del paso", y fast-check busca solo el
 * contraejemplo. Cuando lo encuentra lo reduce al mínimo, así que el reporte
 * no es un caso raro de siete decimales sino el más chico que falla.
 *
 * Lo que se ataca acá es la aritmética de coma flotante, que es donde estas
 * funciones se rompen y donde enumerar casos a mano no alcanza: nadie escribe
 * a mano el usd que hace que `x/step` caiga justo en un binario inexacto.
 */

/** Importes con dos decimales, generados desde centavos para no inventar 1e-17. */
const usd = fc.integer({ min: 0, max: 2_000_000 }).map((c) => c / 100);
const cotizacion = fc.integer({ min: 1, max: 1_000_000 }).map((c) => c / 100);
const paso = fc.constantFrom(...PASOS_REDONDEO);
const modo = fc.constantFrom("nearest" as const, "up" as const);
const regla: fc.Arbitrary<ReglaRedondeo> = fc.record({ mode: modo, step: paso });

describe("precioDesdeUsd", () => {
  it("el resultado siempre es múltiplo del paso", () => {
    fc.assert(fc.property(usd, cotizacion, regla, (u, c, r) => {
      expect(precioDesdeUsd(u, c, r) % r.step).toBe(0);
    }));
  });

  it("nunca devuelve un precio negativo", () => {
    fc.assert(fc.property(usd, cotizacion, regla, (u, c, r) => {
      expect(precioDesdeUsd(u, c, r)).toBeGreaterThanOrEqual(0);
    }));
  });

  it("recalcular no mueve el precio", () => {
    // La propiedad del producto: apretar el botón dos veces con la misma
    // cotización no puede cambiar un peso. Sale de que la entrada es siempre
    // (usd, cotización) y nunca el precio anterior.
    fc.assert(fc.property(usd, cotizacion, regla, (u, c, r) => {
      const uno = precioDesdeUsd(u, c, r);
      expect(precioDesdeUsd(u, c, r)).toBe(uno);
      expect(precioDesdeUsd(u, c, r)).toBe(uno);
    }));
  });

  it("«para arriba» nunca queda por debajo de «al más cercano»", () => {
    fc.assert(fc.property(usd, cotizacion, paso, (u, c, step) => {
      expect(precioDesdeUsd(u, c, { mode: "up", step }))
        .toBeGreaterThanOrEqual(precioDesdeUsd(u, c, { mode: "nearest", step }));
    }));
  });

  it("«para arriba» sobre un resultado ya redondeado no salta otro escalón", () => {
    // El bug clásico de Math.ceil(x/step + eps): se nota recién a la tercera
    // corrida, cuando el precio subió tres escalones sin que nadie tocara nada.
    fc.assert(fc.property(usd, cotizacion, paso, (u, c, step) => {
      const r: ReglaRedondeo = { mode: "up", step };
      const uno = precioDesdeUsd(u, c, r);
      // Volver a entrar con el precio ya redondeado y cotización 1 tiene que
      // devolverlo idéntico: ya es múltiplo del paso.
      expect(precioDesdeUsd(uno, 1, r)).toBe(uno);
    }));
  });

  it("subir el dólar nunca baja un precio", () => {
    fc.assert(fc.property(usd, cotizacion, cotizacion, (u, a, b) => {
      const [menor, mayor] = a <= b ? [a, b] : [b, a];
      expect(precioDesdeUsd(u, mayor, { mode: "nearest", step: 1 }))
        .toBeGreaterThanOrEqual(precioDesdeUsd(u, menor, { mode: "nearest", step: 1 }));
    }));
  });

  it("rechaza toda cotización que no sea positiva", () => {
    fc.assert(fc.property(usd, fc.integer({ min: -100_000, max: 0 }), regla, (u, c, r) => {
      expect(() => precioDesdeUsd(u, c, r)).toThrow("INVALID_USD_RATE");
    }));
  });
});

describe("precioDeLista", () => {
  const pct = fc.integer({ min: 0, max: 9_999 }).map((c) => c / 100);

  it("una lista con descuento nunca sale más cara que el precio de venta", () => {
    fc.assert(fc.property(usd, cotizacion, pct, regla, (u, c, p, r) => {
      expect(precioDeLista(u, c, p, r)!).toBeLessThanOrEqual(
        precioDesdeUsd(u, c, { mode: "up", step: r.step })
      );
    }));
  });

  it("0% de descuento da exactamente el precio de venta", () => {
    fc.assert(fc.property(usd, cotizacion, regla, (u, c, r) => {
      expect(precioDeLista(u, c, 0, r)).toBe(precioDesdeUsd(u, c, r));
    }));
  });

  it("sin porcentaje devuelve null para cualquier entrada", () => {
    // `null` es la señal de "no tocar la lista". Que sea null SIEMPRE es lo que
    // impide que el recálculo inaugure una lista que la variante no tenía.
    fc.assert(fc.property(usd, cotizacion, regla, (u, c, r) => {
      expect(precioDeLista(u, c, null, r)).toBeNull();
    }));
  });

  it("más descuento nunca da un precio más alto", () => {
    fc.assert(fc.property(usd, cotizacion, pct, pct, (u, c, a, b) => {
      const [chico, grande] = a <= b ? [a, b] : [b, a];
      const r: ReglaRedondeo = { mode: "nearest", step: 1 };
      expect(precioDeLista(u, c, grande, r)!).toBeLessThanOrEqual(precioDeLista(u, c, chico, r)!);
    }));
  });
});
