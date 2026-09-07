import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  MAX_UNIDADES,
  sanitizarCantidad,
  cantidadTipeada,
} from "@/app/(app)/vender/cantidad";

/**
 * 🔴 La cantidad tipeada, contra cualquier secuencia de teclas.
 *
 * La cantidad multiplica al precio: un dígito de más es un cobro de más. Y el
 * campo lo maneja una persona apurada, con el cliente enfrente, a veces
 * pegando texto desde una planilla. Por eso las entradas se generan en vez de
 * enumerarse: lo que hay que saber no es que "3" funciona, es que NINGUNA
 * cadena puede producir una cantidad que no sea un entero positivo dentro del
 * tope.
 */

describe("cantidadTipeada", () => {
  it("nunca devuelve algo que no sea un entero en [1, tope]", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.integer({ min: 1, max: MAX_UNIDADES }),
        (raw, tope) => {
          const n = cantidadTipeada(raw, tope);
          if (n === null) return true;
          return Number.isInteger(n) && n >= 1 && n <= tope;
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("clampea al tope y respeta el número tipeado por debajo", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX_UNIDADES }),
        fc.integer({ min: 1, max: MAX_UNIDADES }),
        (k, tope) => {
          expect(cantidadTipeada(String(k), tope)).toBe(Math.min(k, tope));
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe("sanitizarCantidad", () => {
  it("siempre deja solo dígitos y nunca más largo que el tope", () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const s = sanitizarCantidad(raw);
        return /^\d*$/.test(s) && s.length <= String(MAX_UNIDADES).length;
      }),
      { numRuns: 2000 },
    );
  });

  it("nunca agranda el número al descartar un carácter que no entiende", () => {
    // La propiedad que importa: truncar, no filtrar. Filtrando, "1.5" daría
    // "15" y se cobraría diez veces de más.
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const s = sanitizarCantidad(raw);
        const filtrado = raw.replace(/\D/g, "");
        return s.length <= filtrado.length;
      }),
      { numRuns: 2000 },
    );
  });
});

describe("los casos donde el caso importa más que la forma", () => {
  it("un decimal pegado no multiplica el cobro", () => {
    expect(sanitizarCantidad("1.5")).toBe("1");
    expect(sanitizarCantidad("1,5")).toBe("1");
    expect(cantidadTipeada("1.5", 100)).toBe(1);
  });

  it("un campo vacío o sin números no comitea nada", () => {
    expect(cantidadTipeada("", 100)).toBe(null);
    expect(cantidadTipeada("abc", 100)).toBe(null);
    expect(cantidadTipeada("   ", 100)).toBe(null);
  });

  it("cero no es una cantidad: deja la anterior en su lugar", () => {
    expect(cantidadTipeada("0", 100)).toBe(null);
    expect(cantidadTipeada("00", 100)).toBe(null);
  });

  it("los ceros a la izquierda no molestan", () => {
    expect(cantidadTipeada("007", 100)).toBe(7);
  });

  it("no se puede tipear más allá del tope", () => {
    expect(cantidadTipeada("99", 10)).toBe(10);
    expect(sanitizarCantidad("99999")).toBe("9999");
  });
});
