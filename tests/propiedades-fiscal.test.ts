import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { aMoneda, calcularImportes, type LineaFiscal } from "@/domain/fiscal-importes";

/**
 * Propiedades de la aritmética de un comprobante.
 *
 * Es el mejor candidato del repo para esto, por dos razones: las invariantes
 * están escritas arriba del módulo —ARCA valida al centavo y rechaza si no
 * cierran— y son verdades algebraicas, no ejemplos.
 *
 *   ImpNeto + ImpIVA + ImpTotConc + ImpOpEx + ImpTrib === ImpTotal
 *   Σ Iva[].BaseImp === ImpNeto
 *   Σ Iva[].Importe === ImpIVA
 *   Σ netoAsignado  === ImpTotal      (el prorrateo del descuento general)
 *
 * El prorrateo usa largest-remainder para repartir centavos indivisibles. Ese
 * algoritmo es exactamente el tipo de código donde un caso escrito a mano pasa
 * y el reparto real falla: hace falta la combinación de líneas y descuento que
 * deja un resto que no divide. Enumerarla a mano no es realista.
 */

const cents = (n: number) => Math.round(n * 100);

/** Alícuotas que ARCA reconoce. Ver ALICUOTAS en fiscal-catalogs. */
const IVA_IDS = [3, 4, 5, 6, 8, 9];

const linea = fc
  .record({
    cantidad: fc.integer({ min: 1, max: 20 }),
    precioCent: fc.integer({ min: 1, max: 500_000 }),
    // El descuento como porcentaje del bruto, para que nunca lo supere.
    descPct: fc.integer({ min: 0, max: 100 }),
    ivaId: fc.constantFrom(...IVA_IDS),
  })
  .map(({ cantidad, precioCent, descPct, ivaId }): LineaFiscal => {
    const brutoCent = cantidad * precioCent;
    return {
      descripcion: "linea",
      cantidad,
      precioUnitario: precioCent / 100,
      descuentoLinea: Math.floor((brutoCent * descPct) / 100) / 100,
      ivaId,
    };
  });

/** Una venta completa, con el total ya consistente: es lo que exige el dominio. */
const venta = fc.array(linea, { minLength: 1, maxLength: 8 }).chain((lineas) => {
  const S = lineas.reduce(
    (a, l) => a + cents(l.cantidad * l.precioUnitario) - cents(l.descuentoLinea),
    0
  );
  return fc.integer({ min: 0, max: Math.max(S - 1, 0) }).map((D) => ({
    lineas,
    descuentoGeneral: D / 100,
    totalEsperado: (S - D) / 100,
    S,
    D,
  }));
});

describe("calcularImportes", () => {
  it("los importes cierran contra el total, al centavo", () => {
    fc.assert(fc.property(venta, (v) => {
      fc.pre(v.S - v.D > 0);
      const r = calcularImportes(v);

      expect(cents(r.impTotal)).toBe(cents(v.totalEsperado));
      // La ecuación que ARCA valida. En centavos y no en pesos: comparar floats
      // acá sería testear el redondeo del test, no el del dominio.
      expect(cents(r.impNeto) + cents(r.impIva) + cents(r.impTotConc) + cents(r.impOpEx) + cents(r.impTrib))
        .toBe(cents(r.impTotal));
    }));
  });

  it("los buckets de IVA suman exactamente el neto y el IVA", () => {
    fc.assert(fc.property(venta, (v) => {
      fc.pre(v.S - v.D > 0);
      const r = calcularImportes(v);

      const base = r.iva.reduce((a, b) => a + cents(b.baseImp), 0);
      const imp = r.iva.reduce((a, b) => a + cents(b.importe), 0);
      expect(base).toBe(cents(r.impNeto));
      expect(imp).toBe(cents(r.impIva));
    }));
  });

  it("el descuento general se reparte sin perder ni inventar un centavo", () => {
    // Σ netoAsignado === S − D. Es la post-condición del largest-remainder, y
    // la única forma de estar seguro es probarla sobre repartos arbitrarios.
    fc.assert(fc.property(venta, (v) => {
      fc.pre(v.S - v.D > 0);
      const r = calcularImportes(v);

      const repartido = r.lineas.reduce((a, l) => a + cents(l.netoAsignado), 0);
      expect(repartido).toBe(v.S - v.D);
    }));
  });

  it("ninguna línea queda con neto negativo", () => {
    // Un neto negativo pasa la suma total y rompe el comprobante línea por
    // línea: ARCA lo rechaza y el error no dice cuál.
    fc.assert(fc.property(venta, (v) => {
      fc.pre(v.S - v.D > 0);
      for (const l of calcularImportes(v).lineas) {
        expect(l.netoAsignado).toBeGreaterThanOrEqual(0);
      }
    }));
  });

  it("una alícuota sola concentra todo el neto en un solo bucket", () => {
    const unaSola = fc.array(linea, { minLength: 1, maxLength: 6 })
      .map((ls) => ls.map((l) => ({ ...l, ivaId: 5 })));
    fc.assert(fc.property(unaSola, (lineas) => {
      const S = lineas.reduce((a, l) => a + cents(l.cantidad * l.precioUnitario) - cents(l.descuentoLinea), 0);
      fc.pre(S > 0);
      const r = calcularImportes({ lineas, descuentoGeneral: 0, totalEsperado: S / 100 });
      expect(r.iva).toHaveLength(1);
      expect(cents(r.iva[0].baseImp)).toBe(cents(r.impNeto));
    }));
  });

  it("un total que no coincide con las líneas se rechaza, nunca se acomoda", () => {
    // Acomodar un total inconsistente seria emitir un comprobante que no
    // representa la venta. Tiene que fallar ruidoso.
    fc.assert(fc.property(venta, fc.integer({ min: 1, max: 100_000 }), (v, ruido) => {
      fc.pre(v.S - v.D > 0);
      expect(() => calcularImportes({ ...v, totalEsperado: v.totalEsperado + ruido / 100 }))
        .toThrow("IMPORTES_INCONSISTENTES");
    }));
  });
});

describe("aMoneda", () => {
  it("siempre serializa con exactamente dos decimales", () => {
    // `String(n)` daba "826.4500000000001" y ARCA rechaza el XML entero.
    fc.assert(fc.property(fc.integer({ min: 0, max: 100_000_000 }), (c) => {
      expect(aMoneda(c / 100)).toMatch(/^\d+\.\d{2}$/);
    }));
  });
});
