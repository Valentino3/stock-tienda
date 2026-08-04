import { describe, it, expect } from "vitest";
import {
  partirEnLotes, planificarLimpieza, resumirSincronizacion, mensajeDeRechazo,
} from "@/lib/offline/sincronizacion";

describe("partirEnLotes", () => {
  it("parte respetando el tamaño", () => {
    expect(partirEnLotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("una lista vacía no produce lotes", () => {
    expect(partirEnLotes([], 10)).toEqual([]);
  });

  it("una lista más chica que el lote va entera", () => {
    expect(partirEnLotes([1, 2], 50)).toEqual([[1, 2]]);
  });

  it("rechaza un tamaño inválido en vez de colgarse en un bucle infinito", () => {
    expect(() => partirEnLotes([1], 0)).toThrow("TAM_LOTE_INVALIDO");
  });
});

describe("planificarLimpieza", () => {
  it("saca de la cola lo aplicado y lo duplicado", () => {
    const plan = planificarLimpieza({
      ventas: [
        { uid: "a", estado: "aplicada", saleId: 1 },
        { uid: "b", estado: "duplicada", saleId: 2 },
      ],
    });
    expect(plan.uidsResueltos).toEqual(["a", "b"]);
    expect(plan.rechazadas).toEqual([]);
  });

  it("saca también las rechazadas: ningún error del replay se arregla reintentando", () => {
    const plan = planificarLimpieza({
      ventas: [{ uid: "c", estado: "error", error: "VARIANT_NOT_FOUND" }],
    });
    expect(plan.uidsResueltos).toEqual([]);
    expect(plan.rechazadas).toEqual([{ uid: "c", error: "VARIANT_NOT_FOUND" }]);
  });

  it("un error sin código no se pierde", () => {
    const plan = planificarLimpieza({ ventas: [{ uid: "c", estado: "error" }] });
    expect(plan.rechazadas).toEqual([{ uid: "c", error: "ERROR_DESCONOCIDO" }]);
  });

  it("junta los avisos de las ventas que sí entraron", () => {
    const plan = planificarLimpieza({
      ventas: [
        { uid: "a", estado: "aplicada", saleId: 7, avisos: ["Stock negativo en Remera: quedó en -2."] },
        { uid: "b", estado: "aplicada", saleId: 8, avisos: [] },
      ],
    });
    expect(plan.avisos).toEqual([
      { uid: "a", saleId: 7, avisos: ["Stock negativo en Remera: quedó en -2."] },
    ]);
  });

  it("resuelve los clientes creados y los ya existentes", () => {
    const plan = planificarLimpieza({
      clientes: [
        { uid: "c1", estado: "aplicado", clientId: 1 },
        { uid: "c2", estado: "duplicado", clientId: 2 },
        { uid: "c3", estado: "error", error: "EMPTY_NAME" },
      ],
    });
    expect(plan.clienteUidsResueltos).toEqual(["c1", "c2"]);
  });

  it("un cliente que falló NO se saca de la cola: sus ventas todavía lo necesitan", () => {
    const plan = planificarLimpieza({ clientes: [{ uid: "c3", estado: "error" }] });
    expect(plan.clienteUidsResueltos).toEqual([]);
  });

  it("tolera una respuesta sin ventas, clientes ni productos", () => {
    expect(planificarLimpieza({})).toEqual({
      uidsResueltos: [], clienteUidsResueltos: [], productoUidsResueltos: [],
      rechazadas: [], avisos: [],
    });
  });

  it("resuelve los productos creados y los que ya existían", () => {
    const plan = planificarLimpieza({
      productos: [
        { uid: "p1", estado: "aplicado", variantId: 10 },
        { uid: "p2", estado: "duplicado", variantId: 11 },
        { uid: "p3", estado: "error", error: "EMPTY_NAME" },
      ],
    });
    expect(plan.productoUidsResueltos).toEqual(["p1", "p2"]);
  });

  it("los avisos de productos llegan junto con los de ventas", () => {
    const plan = planificarLimpieza({
      productos: [{ uid: "p1", estado: "aplicado", avisos: ['El SKU "X" ya existía.'] }],
      ventas: [{ uid: "v1", estado: "aplicada", saleId: 3, avisos: ["Stock negativo."] }],
    });
    expect(plan.avisos.map((a) => a.uid)).toEqual(["p1", "v1"]);
  });
});

describe("resumirSincronizacion", () => {
  it("suma a través de varios lotes", () => {
    const resumen = resumirSincronizacion([
      planificarLimpieza({ ventas: [{ uid: "a", estado: "aplicada", avisos: ["x"] }] }),
      planificarLimpieza({ ventas: [{ uid: "b", estado: "error", error: "EMPTY_SALE" }] }),
      planificarLimpieza({ ventas: [{ uid: "c", estado: "duplicada" }] }),
    ]);
    expect(resumen).toEqual({ sincronizadas: 2, rechazadas: 1, conAvisos: 1 });
  });

  it("sin lotes da todo en cero", () => {
    expect(resumirSincronizacion([])).toEqual({ sincronizadas: 0, rechazadas: 0, conAvisos: 0 });
  });
});

describe("mensajeDeRechazo", () => {
  it("traduce los códigos del dominio", () => {
    expect(mensajeDeRechazo("VARIANT_NOT_FOUND")).toMatch(/ya no existe/);
    expect(mensajeDeRechazo("CASH_SESSION_NOT_FOUND")).toMatch(/caja/);
  });

  it("no muestra códigos crudos ante un error desconocido", () => {
    const msg = mensajeDeRechazo("ALGO_RARO");
    expect(msg).not.toContain("ALGO_RARO");
    expect(msg.length).toBeGreaterThan(10);
  });
});
