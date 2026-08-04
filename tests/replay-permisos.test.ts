import { describe, it, expect } from "vitest";
import { puedeSincronizar } from "@/domain/sales-replay";

/**
 * Quién puede sincronizar qué.
 *
 * El agujero que cierra: `saveProduct` exige dueño, pero /ventas/replay acepta
 * `productos` y usaba `requireStore`. Un empleado tenía por ahí una puerta
 * lateral para crear catálogo.
 *
 * La guarda tiene que ser por CONTENIDO. Exigir dueño para todo el endpoint
 * dejaría las ventas offline de los empleados sin poder entrar, que es plata
 * cobrada que no se registra — peor que el problema original.
 */
describe("puedeSincronizar", () => {
  it("el empleado sincroniza ventas y clientes", () => {
    expect(puedeSincronizar({ esDueno: false, cantidadProductos: 0 })).toEqual({ ok: true });
  });

  it("el empleado NO puede dar de alta productos", () => {
    const r = puedeSincronizar({ esDueno: false, cantidadProductos: 1 });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/due/i);
  });

  it("el dueño puede todo", () => {
    expect(puedeSincronizar({ esDueno: true, cantidadProductos: 0 })).toEqual({ ok: true });
    expect(puedeSincronizar({ esDueno: true, cantidadProductos: 5 })).toEqual({ ok: true });
  });

  it("el mensaje dice qué hacer, no solo que no se puede", () => {
    const r = puedeSincronizar({ esDueno: false, cantidadProductos: 1 });
    expect(r.ok === false && r.error).toMatch(/Productos|sincronice/);
  });
});
