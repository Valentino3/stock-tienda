import { describe, it, expect } from "vitest";
import {
  calcularImportes, fechaArca, fechaArcaIso, isoDesdeArca, aMoneda,
  type LineaFiscal,
} from "@/domain/fiscal-importes";
import { ALICUOTAS } from "@/domain/fiscal-catalogs";

const linea = (over: Partial<LineaFiscal> = {}): LineaFiscal => ({
  descripcion: "Producto", cantidad: 1, precioUnitario: 1000, descuentoLinea: 0, ivaId: 5, ...over,
});

describe("calcularImportes", () => {
  it("una línea al 21%: 1000 bruto => 826,45 neto + 173,55 de IVA", () => {
    const r = calcularImportes({ lineas: [linea()], descuentoGeneral: 0, totalEsperado: 1000 });
    expect(r.impTotal).toBe(1000);
    expect(r.impNeto).toBe(826.45);
    expect(r.impIva).toBe(173.55);
    expect(r.iva).toEqual([{ id: 5, baseImp: 826.45, importe: 173.55 }]);
  });

  it("el caso limpio no se corre: 121 => 100 + 21", () => {
    const r = calcularImportes({
      lineas: [linea({ precioUnitario: 121 })], descuentoGeneral: 0, totalEsperado: 121,
    });
    expect(r.impNeto).toBe(100);
    expect(r.impIva).toBe(21);
  });

  it("varias líneas: el neto se descompone sobre el bucket, no línea por línea", () => {
    const lineas = [
      linea({ precioUnitario: 333.33, cantidad: 3 }),
      linea({ precioUnitario: 111.11, cantidad: 1 }),
    ];
    const total = 333.33 * 3 + 111.11;
    const r = calcularImportes({ lineas, descuentoGeneral: 0, totalEsperado: total });
    expect(r.impNeto + r.impIva).toBeCloseTo(r.impTotal, 2);
    expect(r.iva[0].baseImp).toBe(r.impNeto);
    expect(r.iva[0].importe).toBe(r.impIva);
  });

  it("descuento general que no divide parejo: Σ de lo asignado da el descuento exacto", () => {
    // 3 líneas de 100, descuento de 10.01 => 1001 centavos entre 3.
    const lineas = [linea({ precioUnitario: 100 }), linea({ precioUnitario: 100 }), linea({ precioUnitario: 100 })];
    const r = calcularImportes({ lineas, descuentoGeneral: 10.01, totalEsperado: 289.99 });
    const sumaNetos = r.lineas.reduce((a, l) => a + Math.round(l.netoAsignado * 100), 0);
    expect(sumaNetos).toBe(Math.round(289.99 * 100));
    expect(r.impTotal).toBe(289.99);
  });

  it("descuento por línea: espeja lo que guardó createSale", () => {
    const r = calcularImportes({
      lineas: [linea({ cantidad: 2, precioUnitario: 500, descuentoLinea: 150 })],
      descuentoGeneral: 0, totalEsperado: 850,
    });
    expect(r.impTotal).toBe(850);
    expect(r.lineas[0].netoAsignado).toBe(850);
  });

  it("línea 100% bonificada: no aporta al bucket pero sigue en el detalle impreso", () => {
    const lineas = [
      linea({ precioUnitario: 1000 }),
      linea({ descripcion: "Regalo", precioUnitario: 500, descuentoLinea: 500 }),
    ];
    const r = calcularImportes({ lineas, descuentoGeneral: 0, totalEsperado: 1000 });
    expect(r.impTotal).toBe(1000);
    expect(r.lineas).toHaveLength(2);
    expect(r.lineas[1].netoAsignado).toBe(0);
    expect(r.lineas[1].importeIva).toBe(0);
    expect(r.iva).toHaveLength(1);
  });

  it("alícuota 0%: base = bruto, IVA = 0, sin caso especial", () => {
    const r = calcularImportes({
      lineas: [linea({ ivaId: 3, precioUnitario: 1000 })], descuentoGeneral: 0, totalEsperado: 1000,
    });
    expect(r.impNeto).toBe(1000);
    expect(r.impIva).toBe(0);
    expect(r.iva).toEqual([{ id: 3, baseImp: 1000, importe: 0 }]);
  });

  it("multi-alícuota: un bucket por tasa, cada uno reconcilia", () => {
    const lineas = [
      linea({ ivaId: 5, precioUnitario: 1210 }),
      linea({ ivaId: 4, precioUnitario: 1105 }),
    ];
    const r = calcularImportes({ lineas, descuentoGeneral: 0, totalEsperado: 2315 });
    expect(r.iva).toHaveLength(2);
    expect(r.iva.find((b) => b.id === 5)).toEqual({ id: 5, baseImp: 1000, importe: 210 });
    expect(r.iva.find((b) => b.id === 4)).toEqual({ id: 4, baseImp: 1000, importe: 105 });
    expect(r.impNeto).toBe(2000);
    expect(r.impIva).toBe(315);
  });

  // ⚠️ ARCA rechaza alícuotas con BaseImp = 0. Causa clásica de rechazo.
  it("un bucket que suma 0 se DESCARTA de Iva[]", () => {
    const lineas = [
      linea({ ivaId: 5, precioUnitario: 1210 }),
      linea({ ivaId: 4, precioUnitario: 500, descuentoLinea: 500 }),
    ];
    const r = calcularImportes({ lineas, descuentoGeneral: 0, totalEsperado: 1210 });
    expect(r.iva).toHaveLength(1);
    expect(r.iva[0].id).toBe(5);
  });

  it("total en 0 => IMPORTE_CERO", () => {
    expect(() => calcularImportes({
      lineas: [linea({ precioUnitario: 100, descuentoLinea: 100 })],
      descuentoGeneral: 0, totalEsperado: 0,
    })).toThrow("IMPORTE_CERO");
  });

  it("total guardado que no cierra con las líneas => IMPORTES_INCONSISTENTES", () => {
    expect(() => calcularImportes({
      lineas: [linea({ precioUnitario: 1000 })], descuentoGeneral: 0, totalEsperado: 999,
    })).toThrow("IMPORTES_INCONSISTENTES");
  });

  it("alícuota desconocida => ALICUOTA_DESCONOCIDA", () => {
    expect(() => calcularImportes({
      lineas: [linea({ ivaId: 77 })], descuentoGeneral: 0, totalEsperado: 1000,
    })).toThrow("ALICUOTA_DESCONOCIDA");
  });

  it("sin líneas => SIN_LINEAS", () => {
    expect(() => calcularImportes({ lineas: [], descuentoGeneral: 0, totalEsperado: 0 }))
      .toThrow("SIN_LINEAS");
  });
});

// Este test es lo que realmente previene rechazos en producción: recorre el
// espacio de ventas posibles y verifica los cuatro invariantes que valida ARCA.
describe("propiedades sobre ventas seudoaleatorias", () => {
  // mulberry32: PRNG determinista de 4 líneas, para no sumar una dependencia.
  function mulberry32(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const IDS = [3, 4, 5, 6, 8, 9];

  it("500 ventas al azar cumplen los 4 invariantes de ARCA", () => {
    const rand = mulberry32(20260730);
    let evaluadas = 0;

    for (let caso = 0; caso < 500; caso++) {
      const nLineas = 1 + Math.floor(rand() * 6);
      const multiAlicuota = rand() < 0.3;
      const lineas: LineaFiscal[] = [];

      for (let i = 0; i < nLineas; i++) {
        const cantidad = 1 + Math.floor(rand() * 5);
        const precioUnitario = round2(1 + rand() * 5000);
        const bruto = round2(cantidad * precioUnitario);
        // Descuento de línea de hasta el 100% del bruto.
        const descuentoLinea = rand() < 0.35 ? round2(bruto * rand()) : 0;
        lineas.push({
          descripcion: `L${i}`, cantidad, precioUnitario, descuentoLinea,
          ivaId: multiAlicuota ? IDS[Math.floor(rand() * IDS.length)] : 5,
        });
      }

      // Espejo exacto de la aritmética de createSale (src/domain/sales.ts).
      const brutos = lineas.map((l) => round2(round2(l.cantidad * l.precioUnitario) - l.descuentoLinea));
      const subtotal = round2(brutos.reduce((a, b) => a + b, 0));
      const descuentoGeneral = rand() < 0.4 ? round2(subtotal * rand() * 0.5) : 0;
      const total = round2(subtotal - descuentoGeneral);
      if (total <= 0) continue;

      const r = calcularImportes({ lineas, descuentoGeneral, totalEsperado: total });
      evaluadas++;

      const c = (n: number) => Math.round(n * 100);
      // 1. La ecuación de cabecera cierra al centavo.
      expect(c(r.impNeto) + c(r.impIva) + c(r.impTotConc) + c(r.impOpEx) + c(r.impTrib)).toBe(c(r.impTotal));
      // 2 y 3. Los buckets suman exactamente la cabecera.
      expect(r.iva.reduce((a, b) => a + c(b.baseImp), 0)).toBe(c(r.impNeto));
      expect(r.iva.reduce((a, b) => a + c(b.importe), 0)).toBe(c(r.impIva));
      // 4. Cada bucket respeta su alícuota dentro de 1 centavo.
      for (const b of r.iva) {
        expect(b.baseImp).toBeGreaterThan(0); // ningún bucket vacío
        expect(Math.abs(c(b.importe) - c(b.baseImp) * ALICUOTAS[b.id])).toBeLessThanOrEqual(1);
      }
      // 5. El total declarado es el que pagó el cliente.
      expect(r.impTotal).toBe(total);
      // 6. El detalle impreso suma el total.
      expect(r.lineas.reduce((a, l) => a + c(l.netoAsignado), 0)).toBe(c(r.impTotal));
    }

    expect(evaluadas).toBeGreaterThan(400);
  });
});

describe("fechas", () => {
  // El bug que este test existe para prevenir: el server corre en UTC y a las
  // 22:00 de Buenos Aires ya es el día siguiente en UTC.
  it("fechaArca usa la fecha de Argentina, no la de UTC", () => {
    expect(fechaArca(new Date("2026-07-30T01:00:00Z"))).toBe("20260729");
    expect(fechaArcaIso(new Date("2026-07-30T01:00:00Z"))).toBe("2026-07-29");
  });

  it("después de las 03:00 UTC ya es el mismo día en Argentina", () => {
    expect(fechaArca(new Date("2026-07-30T04:00:00Z"))).toBe("20260730");
  });

  it("medianoche exacta de Argentina", () => {
    expect(fechaArca(new Date("2026-03-06T03:00:00Z"))).toBe("20260306");
    expect(fechaArca(new Date("2026-03-06T02:59:59Z"))).toBe("20260305");
  });

  it("isoDesdeArca convierte lo que devuelve CAEFchVto", () => {
    expect(isoDesdeArca("20260809")).toBe("2026-08-09");
    expect(() => isoDesdeArca("2026")).toThrow("FECHA_ARCA_INVALIDA");
  });
});

describe("aMoneda", () => {
  it("no emite ruido de punto flotante", () => {
    expect(aMoneda(826.45)).toBe("826.45");
    expect(aMoneda(1000)).toBe("1000.00");
    expect(aMoneda(0)).toBe("0.00");
    expect(aMoneda(0.1 + 0.2)).toBe("0.30");
  });
});
