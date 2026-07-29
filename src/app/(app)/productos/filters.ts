import {
  EMPTY_FILTERS, SORT_KEYS, STOCK_STATES,
  type InventoryFilters, type SortKey, type StockState,
} from "@/domain/inventory";

/**
 * Único traductor entre la URL y los filtros del inventario.
 *
 * Antes cada pieza de la pantalla armaba su propio querystring, y el buscador
 * lo hacía desde cero: tipear borraba la categoría seleccionada. Con todo
 * pasando por `buildQuery`, ninguna parte puede volver a descartar los
 * parámetros de las otras.
 */

export type SearchParams = Record<string, string | string[] | undefined>;

/** Nombres cortos para que la URL siga siendo legible y compartible. */
const PARAM = {
  q: "q", categories: "cat", suppliers: "prov", sets: "set",
  conditions: "cond", languages: "lang", stockState: "stock",
  priceMin: "pmin", priceMax: "pmax",
  costMin: "cmin", costMax: "cmax",
  marginMin: "mmin", marginMax: "mmax",
  foil: "foil", active: "estado", sort: "sort", dir: "dir", page: "page",
} as const;

const one = (sp: SearchParams, key: string): string | undefined => {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s?.trim() || undefined;
};

/** "ORION,CP" -> ["ORION", "CP"]. Descarta vacíos y repetidos. */
const list = (sp: SearchParams, key: string): string[] => {
  const raw = one(sp, key);
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
};

/** Número finito o undefined. Un valor basura se ignora en vez de romper la query. */
const num = (sp: SearchParams, key: string): number | undefined => {
  const raw = one(sp, key);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Lee los filtros de la URL. Defensivo a propósito: cualquier valor fuera del
 * dominio cae al default en vez de llegar a la query — la URL la puede editar
 * cualquiera a mano.
 */
export function parseFilters(sp: SearchParams): InventoryFilters {
  const sort = one(sp, PARAM.sort);
  const dir = one(sp, PARAM.dir);
  const stock = one(sp, PARAM.stockState);
  const foil = one(sp, PARAM.foil);
  const estado = one(sp, PARAM.active);
  const page = num(sp, PARAM.page);

  return {
    q: one(sp, PARAM.q),
    categories: list(sp, PARAM.categories),
    suppliers: list(sp, PARAM.suppliers),
    sets: list(sp, PARAM.sets),
    conditions: list(sp, PARAM.conditions),
    languages: list(sp, PARAM.languages),
    stockState: STOCK_STATES.includes(stock as StockState) ? (stock as StockState) : undefined,
    priceMin: num(sp, PARAM.priceMin),
    priceMax: num(sp, PARAM.priceMax),
    costMin: num(sp, PARAM.costMin),
    costMax: num(sp, PARAM.costMax),
    marginMin: num(sp, PARAM.marginMin),
    marginMax: num(sp, PARAM.marginMax),
    foil: foil === "1" ? true : foil === "0" ? false : undefined,
    active: estado === "activo" ? true : estado === "inactivo" ? false : undefined,
    sort: SORT_KEYS.includes(sort as SortKey) ? (sort as SortKey) : EMPTY_FILTERS.sort,
    dir: dir === "desc" ? "desc" : "asc",
    page: page && page >= 1 ? Math.floor(page) : 1,
  };
}

/**
 * Serializa los filtros a `/productos?...`, omitiendo los defaults para que la
 * URL quede corta.
 *
 * Cualquier cambio que no sea de página resetea a la 1: quedarse en la página 7
 * después de agregar un filtro casi siempre deja la lista vacía.
 */
export function buildQuery(
  current: InventoryFilters,
  over: Partial<InventoryFilters> = {},
  pathname = "/productos"
): string {
  const f: InventoryFilters = { ...current, ...over };
  if (over.page === undefined && Object.keys(over).length > 0) f.page = 1;

  const sp = new URLSearchParams();
  const setList = (key: string, values: string[]) => { if (values.length) sp.set(key, values.join(",")); };
  const setNum = (key: string, n: number | undefined) => { if (n !== undefined) sp.set(key, String(n)); };

  if (f.q?.trim()) sp.set(PARAM.q, f.q.trim());
  setList(PARAM.categories, f.categories);
  setList(PARAM.suppliers, f.suppliers);
  setList(PARAM.sets, f.sets);
  setList(PARAM.conditions, f.conditions);
  setList(PARAM.languages, f.languages);
  if (f.stockState) sp.set(PARAM.stockState, f.stockState);
  setNum(PARAM.priceMin, f.priceMin);
  setNum(PARAM.priceMax, f.priceMax);
  setNum(PARAM.costMin, f.costMin);
  setNum(PARAM.costMax, f.costMax);
  setNum(PARAM.marginMin, f.marginMin);
  setNum(PARAM.marginMax, f.marginMax);
  if (f.foil !== undefined) sp.set(PARAM.foil, f.foil ? "1" : "0");
  if (f.active !== undefined) sp.set(PARAM.active, f.active ? "activo" : "inactivo");
  if (f.sort !== EMPTY_FILTERS.sort) sp.set(PARAM.sort, f.sort);
  if (f.dir !== "asc") sp.set(PARAM.dir, f.dir);
  if (f.page > 1) sp.set(PARAM.page, String(f.page));

  const s = sp.toString();
  return s ? `${pathname}?${s}` : pathname;
}

/**
 * Recorta los filtros que un rol no tiene permitido usar.
 *
 * Costo y margen son solo del dueño. Ocultar los controles no alcanza: la URL
 * la escribe cualquiera, y tanteando `?mmin=` se puede deducir el costo de cada
 * producto sin verlo nunca en pantalla. El recorte va del lado del servidor,
 * antes de que los filtros lleguen a la query.
 */
export function forRole(f: InventoryFilters, isOwner: boolean): InventoryFilters {
  if (isOwner) return f;
  return {
    ...f,
    costMin: undefined, costMax: undefined,
    marginMin: undefined, marginMax: undefined,
    sort: f.sort === "margin" ? EMPTY_FILTERS.sort : f.sort,
  };
}

/** Un filtro aplicado, para dibujar los chips que se pueden quitar de a uno. */
export type ActiveChip = {
  key: string;
  label: string;
  /** Filtros que hay que aplicar sobre los actuales para quitar este chip. */
  clear: Partial<InventoryFilters>;
};

const STOCK_LABELS: Record<StockState, string> = {
  out: "Sin stock", low: "Stock bajo", in: "Con stock",
};

/**
 * Los filtros activos como lista plana. Cada valor de una multi-selección es su
 * propio chip: con cinco proveedores tildados se quita uno sin perder los otros.
 */
export function activeChips(f: InventoryFilters): ActiveChip[] {
  const chips: ActiveChip[] = [];

  const listChips = (
    field: "categories" | "suppliers" | "sets" | "conditions" | "languages",
    prefix: string
  ) => {
    for (const value of f[field]) {
      chips.push({
        key: `${field}:${value}`,
        label: `${prefix}: ${value}`,
        clear: { [field]: f[field].filter((v) => v !== value) } as Partial<InventoryFilters>,
      });
    }
  };

  if (f.q?.trim()) chips.push({ key: "q", label: `“${f.q.trim()}”`, clear: { q: undefined } });
  listChips("categories", "Categoría");
  listChips("suppliers", "Proveedor");
  listChips("sets", "Set");
  listChips("conditions", "Condición");
  listChips("languages", "Idioma");

  if (f.stockState) {
    chips.push({ key: "stock", label: STOCK_LABELS[f.stockState], clear: { stockState: undefined } });
  }

  const range = (
    key: string, label: string, min: number | undefined, max: number | undefined,
    minField: keyof InventoryFilters, maxField: keyof InventoryFilters, unit = ""
  ) => {
    if (min === undefined && max === undefined) return;
    const text = min !== undefined && max !== undefined
      ? `${label} ${min}${unit}–${max}${unit}`
      : min !== undefined ? `${label} desde ${min}${unit}` : `${label} hasta ${max}${unit}`;
    chips.push({
      key, label: text,
      clear: { [minField]: undefined, [maxField]: undefined } as Partial<InventoryFilters>,
    });
  };
  range("price", "Precio", f.priceMin, f.priceMax, "priceMin", "priceMax");
  range("cost", "Costo", f.costMin, f.costMax, "costMin", "costMax");
  range("margin", "Margen", f.marginMin, f.marginMax, "marginMin", "marginMax", "%");

  if (f.foil !== undefined) {
    chips.push({ key: "foil", label: f.foil ? "Foil" : "Sin foil", clear: { foil: undefined } });
  }
  if (f.active !== undefined) {
    chips.push({
      key: "active",
      label: f.active ? "Solo activos" : "Solo inactivos",
      clear: { active: undefined },
    });
  }

  return chips;
}
