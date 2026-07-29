import { describe, it, expect } from "vitest";
import { parseFilters, buildQuery, activeChips, forRole } from "@/app/(app)/productos/filters";
import { EMPTY_FILTERS, type InventoryFilters } from "@/domain/inventory";

/** Simula lo que Next entrega en searchParams a partir de un querystring. */
const sp = (query: string) => Object.fromEntries(new URLSearchParams(query));

const f = (over: Partial<InventoryFilters> = {}): InventoryFilters => ({ ...EMPTY_FILTERS, ...over });

describe("parseFilters", () => {
  it("una URL vacía da los filtros por defecto", () => {
    expect(parseFilters({})).toEqual(EMPTY_FILTERS);
  });

  it("lee listas separadas por comas y descarta vacíos y repetidos", () => {
    const parsed = parseFilters(sp("prov=ORION,CP,,ORION&cat=Pok%C3%A9mon"));
    expect(parsed.suppliers).toEqual(["ORION", "CP"]);
    expect(parsed.categories).toEqual(["Pokémon"]);
  });

  it("lee rangos, foil y estado", () => {
    const parsed = parseFilters(sp("pmin=100&pmax=500&mmax=30&foil=1&estado=inactivo"));
    expect(parsed.priceMin).toBe(100);
    expect(parsed.priceMax).toBe(500);
    expect(parsed.marginMax).toBe(30);
    expect(parsed.foil).toBe(true);
    expect(parsed.active).toBe(false);
  });

  it("ignora valores fuera del dominio en vez de pasarlos a la query", () => {
    // La URL la puede editar cualquiera a mano.
    const parsed = parseFilters(sp("sort=;drop&dir=arriba&stock=cualquiera&pmin=abc&page=-3&foil=quizas"));
    expect(parsed.sort).toBe("product");
    expect(parsed.dir).toBe("asc");
    expect(parsed.stockState).toBeUndefined();
    expect(parsed.priceMin).toBeUndefined();
    expect(parsed.page).toBe(1);
    expect(parsed.foil).toBeUndefined();
  });

  it("acepta un param repetido quedándose con el primero", () => {
    expect(parseFilters({ q: ["remera", "gorra"] }).q).toBe("remera");
  });
});

describe("buildQuery", () => {
  it("omite los defaults para que la URL quede corta", () => {
    expect(buildQuery(EMPTY_FILTERS)).toBe("/productos");
    expect(buildQuery(f({ sort: "product", dir: "asc", page: 1 }))).toBe("/productos");
  });

  it("hace ida y vuelta sin perder ni inventar filtros", () => {
    const original = f({
      q: "charizard",
      categories: ["Pokémon"], suppliers: ["ORION", "CP"], sets: ["Base Set"],
      conditions: ["NM"], languages: ["EN"],
      stockState: "low",
      priceMin: 100, priceMax: 5000, costMin: 50, costMax: 900,
      marginMin: 10, marginMax: 80,
      foil: true, active: false,
      sort: "margin", dir: "desc", page: 3,
    });

    const url = buildQuery(original);
    expect(parseFilters(sp(url.split("?")[1]))).toEqual(original);
  });

  it("un cambio de filtro resetea a la página 1", () => {
    const current = f({ page: 5, suppliers: ["ORION"] });
    expect(buildQuery(current, { stockState: "out" })).not.toContain("page=");
  });

  it("cambiar de página NO resetea la página", () => {
    const current = f({ suppliers: ["ORION"] });
    expect(buildQuery(current, { page: 4 })).toContain("page=4");
  });

  it("preserva el resto de los filtros al cambiar solo la búsqueda", () => {
    // Este es el bug que motivó centralizar el codec: el buscador armaba el
    // querystring desde cero y borraba la categoría.
    const current = f({ categories: ["Pokémon"], suppliers: ["ORION"], stockState: "out", sort: "stock" });
    const url = buildQuery(current, { q: "carpeta" });

    const parsed = parseFilters(sp(url.split("?")[1]));
    expect(parsed.q).toBe("carpeta");
    expect(parsed.categories).toEqual(["Pokémon"]);
    expect(parsed.suppliers).toEqual(["ORION"]);
    expect(parsed.stockState).toBe("out");
    expect(parsed.sort).toBe("stock");
  });

  it("un filtro vaciado desaparece de la URL", () => {
    const current = f({ suppliers: ["ORION"], q: "algo" });
    const url = buildQuery(current, { suppliers: [], q: undefined });
    expect(url).toBe("/productos");
  });
});

describe("activeChips", () => {
  it("sin filtros no hay chips", () => {
    expect(activeChips(EMPTY_FILTERS)).toEqual([]);
  });

  it("cada valor de una multi-selección es su propio chip", () => {
    const chips = activeChips(f({ suppliers: ["ORION", "CP", "DEVIR"] }));
    expect(chips.map((c) => c.label)).toEqual([
      "Proveedor: ORION", "Proveedor: CP", "Proveedor: DEVIR",
    ]);
  });

  it("quitar un chip conserva los demás valores del mismo filtro", () => {
    const current = f({ suppliers: ["ORION", "CP", "DEVIR"] });
    const chip = activeChips(current).find((c) => c.label === "Proveedor: CP")!;
    expect(parseFilters(sp(buildQuery(current, chip.clear).split("?")[1])).suppliers)
      .toEqual(["ORION", "DEVIR"]);
  });

  it("un rango es un solo chip y se limpia entero", () => {
    const current = f({ priceMin: 100, priceMax: 500 });
    const chips = activeChips(current);
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe("Precio 100–500");
    expect(buildQuery(current, chips[0].clear)).toBe("/productos");
  });

  it("describe los rangos abiertos y el margen con %", () => {
    expect(activeChips(f({ marginMax: 30 }))[0].label).toBe("Margen hasta 30%");
    expect(activeChips(f({ priceMin: 1000 }))[0].label).toBe("Precio desde 1000");
  });

  it("el orden y el foil se describen en castellano", () => {
    expect(activeChips(f({ stockState: "low" }))[0].label).toBe("Stock bajo");
    expect(activeChips(f({ foil: false }))[0].label).toBe("Sin foil");
    expect(activeChips(f({ active: true }))[0].label).toBe("Solo activos");
  });
});

// Costo y margen son solo del dueño. Ocultar los controles no alcanza: la URL
// la escribe cualquiera, y tanteando ?mmin= se deduce el costo sin verlo.
describe("forRole", () => {
  it("al dueño no le recorta nada", () => {
    const full = f({ costMin: 100, costMax: 900, marginMin: 10, marginMax: 80, sort: "margin" });
    expect(forRole(full, true)).toEqual(full);
  });

  it("al empleado le descarta los filtros de costo y margen", () => {
    const recortado = forRole(f({ costMin: 100, costMax: 900, marginMin: 10, marginMax: 80 }), false);
    expect(recortado.costMin).toBeUndefined();
    expect(recortado.costMax).toBeUndefined();
    expect(recortado.marginMin).toBeUndefined();
    expect(recortado.marginMax).toBeUndefined();
  });

  it("al empleado le devuelve el orden por margen al default", () => {
    expect(forRole(f({ sort: "margin", dir: "desc" }), false).sort).toBe("product");
    // El resto del orden no se toca.
    expect(forRole(f({ sort: "stock", dir: "desc" }), false).sort).toBe("stock");
    expect(forRole(f({ sort: "stock", dir: "desc" }), false).dir).toBe("desc");
  });

  it("los filtros que el empleado sí puede usar sobreviven", () => {
    const recortado = forRole(
      f({ suppliers: ["ORION"], stockState: "out", q: "auricular", priceMin: 500, marginMin: 60 }),
      false
    );
    expect(recortado.suppliers).toEqual(["ORION"]);
    expect(recortado.stockState).toBe("out");
    expect(recortado.q).toBe("auricular");
    expect(recortado.priceMin).toBe(500); // el precio de venta no es secreto
    expect(recortado.marginMin).toBeUndefined();
  });
});
