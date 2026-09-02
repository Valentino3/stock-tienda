import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { calcularTotales, type Discount } from "@/domain/sales";

/**
 * Propiedades de la aritmética de la venta.
 *
 * `calcularTotales` es el único lugar donde se decide cuánto paga el cliente, y
 * lo comparten el camino online y el replay de las ventas offline. Un error acá
 * no es un test rojo: es plata mal cobrada en dos locales.
 *
 * Las propiedades atacan cosas que un ejemplo no puede: que NINGÚN descuento
 * deje un total negativo, que reordenar el carrito no cambie el precio, y que
 * los dos caminos —precio resuelto del catálogo y precio capturado al cobrar—
 * den exactamente el mismo número.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

type Item = { quantity: number; precio: number; discount?: Discount };

const descuento: fc.Arbitrary<Discount | undefined> = fc.oneof(
  fc.constant(undefined),
  fc.record({
    kind: fc.constantFrom("amount" as const, "percent" as const),
    // A propósito se generan valores ABSURDOS (un descuento mayor al total, un
    // 300%): la app tiene que acotarlos, y eso es justo lo que se prueba.
    value: fc.integer({ min: -1000, max: 300_000 }).map((c) => c / 100),
  })
);

const item: fc.Arbitrary<Item> = fc.record({
  quantity: fc.integer({ min: 1, max: 50 }),
  precio: fc.integer({ min: 0, max: 1_000_000 }).map((c) => c / 100),
  discount: descuento,
});

const carrito = fc.array(item, { minLength: 1, maxLength: 10 });
const precioDe = (i: Item) => i.precio;

describe("calcularTotales", () => {
  it("el total nunca es negativo, con cualquier descuento", () => {
    fc.assert(fc.property(carrito, descuento, (items, d) => {
      expect(calcularTotales(items, precioDe, d).total).toBeGreaterThanOrEqual(0);
    }));
  });

  it("nunca se cobra más que la suma de los brutos", () => {
    fc.assert(fc.property(carrito, descuento, (items, d) => {
      const bruto = items.reduce((a, i) => a + round2(i.precio * i.quantity), 0);
      expect(calcularTotales(items, precioDe, d).total).toBeLessThanOrEqual(round2(bruto));
    }));
  });

  it("ningún descuento supera la base sobre la que se aplica", () => {
    fc.assert(fc.property(carrito, descuento, (items, d) => {
      const r = calcularTotales(items, precioDe, d);
      expect(r.saleDiscount).toBeLessThanOrEqual(r.subtotal);
      for (const l of r.lines) {
        expect(l.lineDiscount).toBeLessThanOrEqual(round2(l.unitPrice * l.quantity));
        expect(l.net).toBeGreaterThanOrEqual(0);
      }
    }));
  });

  it("reordenar el carrito no cambia el total", () => {
    // El vendedor agrega los productos en el orden en que los saca de la
    // vitrina. Si el total dependiera de ese orden, el mismo carrito costaría
    // distinto según cómo se armó.
    fc.assert(fc.property(carrito, descuento, (items, d) => {
      const directo = calcularTotales(items, precioDe, d).total;
      const alReves = calcularTotales([...items].reverse(), precioDe, d).total;
      expect(alReves).toBe(directo);
    }));
  });

  it("sin descuentos, el total es la suma de los brutos", () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        quantity: fc.integer({ min: 1, max: 50 }),
        precio: fc.integer({ min: 0, max: 1_000_000 }).map((c) => c / 100),
      }), { minLength: 1, maxLength: 10 }),
      (items) => {
        const esperado = round2(items.reduce((a, i) => a + round2(i.precio * i.quantity), 0));
        expect(calcularTotales(items, precioDe).total).toBe(esperado);
      }
    ));
  });

  it("100% de descuento general deja el total en cero", () => {
    fc.assert(fc.property(carrito, (items) => {
      expect(calcularTotales(items, precioDe, { kind: "percent", value: 100 }).total).toBe(0);
    }));
  });

  it("un descuento mayor al total se acota, no deja saldo a devolver", () => {
    fc.assert(fc.property(carrito, fc.integer({ min: 1, max: 100_000 }), (items, exceso) => {
      const sin = calcularTotales(items, precioDe).total;
      const conExceso = calcularTotales(items, precioDe, {
        kind: "amount", value: sin + exceso / 100,
      });
      expect(conExceso.total).toBe(0);
    }));
  });

  it("online y replay dan exactamente el mismo total", () => {
    // El invariante que hace desplegable el modo offline: online el precio lo
    // resuelve el servidor contra el catálogo, en el replay es el que se
    // capturó al cobrar. Con el mismo precio efectivo, el total tiene que ser
    // idéntico al centavo — si no, una venta de feria se registra por otro
    // monto del que se cobró.
    fc.assert(fc.property(carrito, descuento, (items, d) => {
      const online = calcularTotales(items, precioDe, d);
      const capturado = items.map((i) => ({ ...i, unitPrice: i.precio }));
      const replay = calcularTotales(capturado, (i) => i.unitPrice, d);
      expect(replay.total).toBe(online.total);
      expect(replay.lines.map((l) => l.net)).toEqual(online.lines.map((l) => l.net));
    }));
  });

  it("agregar una línea nunca baja el subtotal", () => {
    fc.assert(fc.property(carrito, item, (items, extra) => {
      const antes = calcularTotales(items, precioDe).subtotal;
      const despues = calcularTotales([...items, extra], precioDe).subtotal;
      expect(despues).toBeGreaterThanOrEqual(antes);
    }));
  });
});
