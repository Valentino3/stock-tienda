import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { products, productVariants } from "@/db/schema";

/**
 * Listado de inventario a nivel VARIANTE.
 *
 * La pantalla de Productos listaba productos con sus variantes adentro, y los
 * filtros de variante solo decidían qué productos entraban: pedir "proveedor
 * ORION" devolvía el producto con todas sus variantes, incluidas las de otro
 * proveedor. Acá la fila es la variante, así que un filtro filtra lo que dice
 * que filtra.
 */

export const PAGE_SIZE = 50;

export type StockState = "out" | "low" | "in";
export type SortKey = "product" | "stock" | "price" | "margin" | "supplier";
export type SortDir = "asc" | "desc";

export const SORT_KEYS: SortKey[] = ["product", "stock", "price", "margin", "supplier"];
export const STOCK_STATES: StockState[] = ["out", "low", "in"];

/** Tiene o no precio de venta en dolares (propio o heredado del producto). */
export type UsdState = "con" | "sin";
export const USD_STATES: UsdState[] = ["con", "sin"];

export type InventoryFilters = {
  q?: string;
  categories: string[];
  suppliers: string[];
  sets: string[];
  conditions: string[];
  languages: string[];
  stockState?: StockState;
  usdState?: UsdState;
  priceMin?: number;
  priceMax?: number;
  costMin?: number;
  costMax?: number;
  marginMin?: number;
  marginMax?: number;
  foil?: boolean;
  /** undefined = activos e inactivos. */
  active?: boolean;
  sort: SortKey;
  dir: SortDir;
  page: number;
};

export const EMPTY_FILTERS: InventoryFilters = {
  categories: [], suppliers: [], sets: [], conditions: [], languages: [],
  sort: "product", dir: "asc", page: 1,
};

export type InventoryRow = {
  variantId: number;
  productId: number;
  productName: string;
  category: string | null;
  variantName: string;
  sku: string | null;
  stock: number;
  lowStockThreshold: number;
  /** false = no se cuenta por unidades. La UI oculta stock y sus acciones. */
  tracksStock: boolean;
  isPromo: boolean;
  /** Precio de venta ya resuelto: el propio de la variante o el base del producto. */
  price: number;
  /** El precio propio de la variante, null si hereda. Lo necesita el form de edición. */
  ownPrice: number | null;
  /** true si la variante tiene precio propio; false si hereda el del producto. */
  priceOverridden: boolean;
  /** Precio de venta en dolares ya resuelto: el propio o el del producto. */
  priceUsd: number | null;
  /** El propio de la variante, null si hereda. Lo necesita el form de edicion. */
  ownPriceUsd: number | null;
  priceCash: number | null;
  priceWholesale: number | null;
  costArs: number | null;
  costUsd: number | null;
  /** Margen % sobre el precio de venta. null si no hay costo con el que calcularlo. */
  margin: number | null;
  supplier: string | null;
  supplierSku: string | null;
  setName: string | null;
  condition: string | null;
  foil: boolean;
  language: string | null;
  variantActive: boolean;
  productActive: boolean;
};

// El precio efectivo es `variant.price ?? product.basePrice`. Esa regla estaba
// repetida en cuatro archivos de UI; acá queda una sola vez y del lado de la
// base, para poder filtrar y ordenar por ella.
const effectivePrice = sql<number>`coalesce(${productVariants.price}, ${products.basePrice})`;

// Dolar efectivo, misma herencia que el precio. Nullable: la mayoria del
// catalogo no se ata a la cotizacion.
const effectiveUsd = sql<number | null>`coalesce(${productVariants.priceUsd}, ${products.basePriceUsd})`;

// Margen % sobre el precio de venta. Solo tiene sentido con costo cargado y
// precio positivo; en cualquier otro caso es null y la fila queda fuera de los
// filtros de margen en vez de contar como 0.
const marginExpr = sql<number | null>`
  case
    when ${productVariants.costArs} is null
      or ${productVariants.costArs} <= 0
      or coalesce(${productVariants.price}, ${products.basePrice}) <= 0
    then null
    else round(
      ((coalesce(${productVariants.price}, ${products.basePrice}) - ${productVariants.costArs})
        / coalesce(${productVariants.price}, ${products.basePrice})) * 100,
      2
    )
  end
`;

function buildWhere(db: any, storeId: number, f: InventoryFilters): SQL | undefined {
  const conditions: (SQL | undefined)[] = [eq(productVariants.storeId, storeId)];

  const term = f.q?.trim();
  if (term) {
    const pattern = `%${term}%`;
    // Igual que en domain/catalog.ts: un OR que abarca columnas de dos tablas
    // joineadas no es servible por los índices GIN trigram después del join.
    // Se aísla el match del lado variante en una subquery autocontenida y se
    // combina con inArray, para que cada rama use su propio índice.
    const variantMatch = db
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(and(
        eq(productVariants.storeId, storeId),
        or(
          ilike(productVariants.sku, pattern),
          ilike(productVariants.name, pattern),
          ilike(productVariants.setName, pattern),
          ilike(productVariants.supplierSku, pattern),
        ),
      ));
    conditions.push(or(
      ilike(products.name, pattern),
      inArray(productVariants.id, variantMatch),
    ));
  }

  // Multi-selección: lista vacía = sin filtro.
  if (f.categories.length) conditions.push(inArray(products.category, f.categories));
  if (f.suppliers.length) conditions.push(inArray(productVariants.supplier, f.suppliers));
  if (f.sets.length) conditions.push(inArray(productVariants.setName, f.sets));
  if (f.conditions.length) conditions.push(inArray(productVariants.condition, f.conditions));
  if (f.languages.length) conditions.push(inArray(productVariants.language, f.languages));

  // El umbral de stock bajo es POR PRODUCTO, no una constante global.
  //
  // Filtrar por estado de stock excluye lo que no lleva stock: un plato no
  // está "sin stock", simplemente no se cuenta. Si no, filtrar por "Sin stock"
  // en un restaurante devolvería la carta entera.
  if (f.stockState !== undefined) conditions.push(eq(products.tracksStock, true));
  if (f.stockState === "out") conditions.push(eq(productVariants.stock, 0));
  if (f.stockState === "low") {
    conditions.push(sql`${productVariants.stock} > 0 and ${productVariants.stock} <= ${products.lowStockThreshold}`);
  }
  if (f.stockState === "in") {
    conditions.push(sql`${productVariants.stock} > ${products.lowStockThreshold}`);
  }

  // El recalculo por dolar deja afuera lo que no tiene USD; este filtro es lo
  // que convierte "quedaron 340 sin tocar" en poder hacer algo al respecto.
  if (f.usdState === "con") conditions.push(sql`${effectiveUsd} is not null`);
  if (f.usdState === "sin") conditions.push(sql`${effectiveUsd} is null`);

  if (f.priceMin !== undefined) conditions.push(gte(effectivePrice, f.priceMin));
  if (f.priceMax !== undefined) conditions.push(lte(effectivePrice, f.priceMax));
  if (f.costMin !== undefined) conditions.push(gte(productVariants.costArs, f.costMin));
  if (f.costMax !== undefined) conditions.push(lte(productVariants.costArs, f.costMax));
  if (f.marginMin !== undefined) conditions.push(sql`${marginExpr} >= ${f.marginMin}`);
  if (f.marginMax !== undefined) conditions.push(sql`${marginExpr} <= ${f.marginMax}`);

  if (f.foil !== undefined) conditions.push(eq(productVariants.foil, f.foil));
  // Una variante activa de un producto desactivado no se vende: el estado
  // efectivo es la conjunción de los dos.
  if (f.active === true) {
    conditions.push(and(eq(productVariants.active, true), eq(products.active, true)));
  }
  if (f.active === false) {
    conditions.push(or(eq(productVariants.active, false), eq(products.active, false)));
  }

  return and(...conditions);
}

function buildOrderBy(f: InventoryFilters): SQL[] {
  const dir = f.dir === "desc" ? desc : asc;
  const byKey: Record<SortKey, SQL[]> = {
    product: [dir(products.name), dir(productVariants.name)],
    stock: [dir(productVariants.stock)],
    price: [dir(effectivePrice)],
    margin: [dir(marginExpr)],
    supplier: [dir(productVariants.supplier)],
  };
  // Desempate obligatorio: sin él, las filas empatadas (mismo stock, mismo
  // margen) salen en orden indefinido y con LIMIT/OFFSET una misma variante
  // puede aparecer en dos páginas o en ninguna.
  return [...byKey[f.sort], asc(productVariants.id)];
}

export async function listInventory(
  db: any,
  storeId: number,
  f: InventoryFilters
): Promise<{ rows: InventoryRow[]; total: number; hasNextPage: boolean }> {
  const where = buildWhere(db, storeId, f);
  const page = Math.max(1, f.page);

  const [rows, countRows] = await Promise.all([
    db
      .select({
        variantId: productVariants.id,
        productId: products.id,
        productName: products.name,
        category: products.category,
        variantName: productVariants.name,
        sku: productVariants.sku,
        stock: productVariants.stock,
        lowStockThreshold: products.lowStockThreshold,
        tracksStock: products.tracksStock,
        isPromo: products.isPromo,
        price: effectivePrice.mapWith(Number),
        ownPrice: productVariants.price,
        priceUsd: effectiveUsd,
        ownPriceUsd: productVariants.priceUsd,
        priceCash: productVariants.priceCash,
        priceWholesale: productVariants.priceWholesale,
        costArs: productVariants.costArs,
        costUsd: productVariants.costUsd,
        margin: marginExpr,
        supplier: productVariants.supplier,
        supplierSku: productVariants.supplierSku,
        setName: productVariants.setName,
        condition: productVariants.condition,
        foil: productVariants.foil,
        language: productVariants.language,
        variantActive: productVariants.active,
        productActive: products.active,
      })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(where)
      .orderBy(...buildOrderBy(f))
      .limit(PAGE_SIZE + 1)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(productVariants)
      .innerJoin(products, eq(productVariants.productId, products.id))
      .where(where),
  ]);

  // El select vuelve sin tipo porque `db` es `any` (ver src/db/index.ts).
  type RawRow = Omit<InventoryRow, "margin" | "priceOverridden"> & {
    margin: string | number | null;
  };

  const hasNextPage = rows.length > PAGE_SIZE;
  const paged = (rows as RawRow[]).slice(0, PAGE_SIZE).map((r): InventoryRow => ({
    ...r,
    // `margin` sale de una expresión y no de una columna, así que el driver no
    // le aplica el mapeo numérico: Neon devuelve string y PGlite number.
    margin: r.margin === null || r.margin === undefined ? null : Number(r.margin),
    priceOverridden: r.ownPrice !== null,
  }));

  return { rows: paged, total: countRows[0]?.n ?? 0, hasNextPage };
}

/**
 * Valores distintos con los que poblar los filtros multi-selección.
 *
 * Es una foto de toda la tienda, no de la consulta actual: si dependiera de los
 * filtros aplicados, tildar un proveedor haría desaparecer al resto de la lista
 * y no habría forma de cambiar la selección.
 */
export async function getInventoryFacets(
  db: any,
  storeId: number
): Promise<{
  categories: string[]; suppliers: string[]; sets: string[];
  conditions: string[]; languages: string[];
}> {
  const [productRows, variantRows] = await Promise.all([
    db.selectDistinct({ category: products.category })
      .from(products)
      .where(eq(products.storeId, storeId)),
    db.selectDistinct({
      supplier: productVariants.supplier,
      setName: productVariants.setName,
      condition: productVariants.condition,
      language: productVariants.language,
    })
      .from(productVariants)
      .where(eq(productVariants.storeId, storeId)),
  ]);

  // Un solo recorrido en memoria en vez de cuatro SELECT DISTINCT: la cardinalidad
  // de estas columnas es baja (decenas de valores) aun con miles de variantes.
  const collect = (rows: Record<string, unknown>[], key: string) =>
    [...new Set(rows.map((r) => r[key]).filter((v): v is string => typeof v === "string" && v.trim() !== ""))]
      .sort((a, b) => a.localeCompare(b, "es"));

  return {
    categories: collect(productRows, "category"),
    suppliers: collect(variantRows, "supplier"),
    sets: collect(variantRows, "setName"),
    conditions: collect(variantRows, "condition"),
    languages: collect(variantRows, "language"),
  };
}
