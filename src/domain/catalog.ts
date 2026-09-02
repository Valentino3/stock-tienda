import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { products, productVariants } from "@/db/schema";
import { LIMITE_RESULTADOS, MIN_CARACTERES, type VarianteCatalogo } from "@/lib/offline/busqueda";

/**
 * Tope de variantes que se bajan al dispositivo. 20k cubre con holgura los
 * catálogos reales (los docs hablan de "miles") y acota el peso: a ~150 bytes
 * por fila son unos 3 MB de JSON. Si una tienda lo supera, el snapshot avisa
 * en vez de mandar un catálogo cortado en silencio.
 */
export const MAX_VARIANTES_SNAPSHOT = 20_000;

/**
 * Catálogo completo para vender sin conexión. Mismas columnas que
 * searchVariants: el resultado se guarda tal cual en el dispositivo y la
 * pantalla de venta no distingue de dónde salió cada fila.
 *
 * El `stock` viaja pero es una foto: sirve para avisar en el momento, no para
 * garantizar nada. La garantía real la da el índice del servidor al sincronizar
 * (ver src/domain/sales-replay.ts).
 */
export async function snapshotCatalogo(
  db: any,
  storeId: number
): Promise<{ variantes: VarianteCatalogo[]; truncado: boolean }> {
  const filas = await db
    .select({
      variantId: productVariants.id,
      productName: products.name,
      variantName: productVariants.name,
      sku: productVariants.sku,
      stock: productVariants.stock,
      // Viaja al dispositivo para que la venta offline sepa si tiene que
      // frenar por falta de stock o no. Ver la nota de DB_VERSION en
      // src/lib/offline/db.ts: el default de una fila vieja es "sí descuenta".
      tracksStock: products.tracksStock,
      price: productVariants.price,
      // Las dos listas alternativas viajan al dispositivo para poder cobrar
      // por ellas sin conexión. Nullable: la mayoría del catálogo no las tiene.
      priceCash: productVariants.priceCash,
      priceWholesale: productVariants.priceWholesale,
      basePrice: products.basePrice,
      setName: productVariants.setName,
      condition: productVariants.condition,
      foil: productVariants.foil,
      language: productVariants.language,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(
      eq(productVariants.storeId, storeId),
      eq(products.active, true), eq(productVariants.active, true),
    ))
    // `productVariants.id` desempata: sin una columna única al final, dos
    // variantes del mismo producto salen en orden indefinido y el corte de
    // MAX_VARIANTES_SNAPSHOT sería distinto en cada descarga. Además es lo que
    // hace que el orden del snapshot coincida con el de searchVariants, que es
    // de lo que depende la paridad online/offline.
    .orderBy(asc(products.name), asc(productVariants.id))
    .limit(MAX_VARIANTES_SNAPSHOT + 1);

  const truncado = filas.length > MAX_VARIANTES_SNAPSHOT;
  return { variantes: truncado ? filas.slice(0, MAX_VARIANTES_SNAPSHOT) : filas, truncado };
}

export async function searchVariants(
  db: any,
  storeId: number,
  term: string
): Promise<VarianteCatalogo[]> {
  const t = term.trim();
  if (t.length < MIN_CARACTERES) return [];
  const pattern = `%${t}%`;

  /**
   * Ranking, espejo del de `buscarEnCatalogo`: SKU exacto → lo que arranca con
   * el término → el resto. El escaneo de un código de barras tiene que caer
   * primero siempre.
   *
   * El `concat_ws` con `nullif` reproduce el `textoBuscable` del offline, que
   * hace `[productName, variantName, sku, setName].filter(Boolean).join(" ")`:
   * sin el `nullif`, la variante default —que tiene `name: ""`— metería un
   * espacio doble y el rango 1 diferiría del que calcula el dispositivo.
   */
  const rango = sql`case
    when lower(${productVariants.sku}) = ${t.toLowerCase()} then 0
    when concat_ws(' ',
           nullif(${products.name}, ''), nullif(${productVariants.name}, ''),
           nullif(${productVariants.sku}, ''), nullif(${productVariants.setName}, '')
         ) ilike ${`${t}%`} then 1
    else 2 end`;

  // Igual que Productos (getProducts en productos/page.tsx): un OR que abarca
  // columnas de dos tablas joineadas generalmente no es servible por Postgres
  // vía BitmapOr por-columna (GIN trigram) — termina escaneando después del
  // join. Aislamos el match del lado variante en una subquery autocontenida
  // sobre productVariants y la combinamos con inArray, para que cada rama
  // siga siendo elegible para su propio índice.
  const variantMatch = db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(and(
      eq(productVariants.storeId, storeId),
      or(
        ilike(productVariants.sku, pattern),
        ilike(productVariants.name, pattern),
        ilike(productVariants.setName, pattern),
      ),
    ));

  return db
    .select({
      variantId: productVariants.id,
      productName: products.name,
      variantName: productVariants.name,
      sku: productVariants.sku,
      stock: productVariants.stock,
      // Viaja al dispositivo para que la venta offline sepa si tiene que
      // frenar por falta de stock o no. Ver la nota de DB_VERSION en
      // src/lib/offline/db.ts: el default de una fila vieja es "sí descuenta".
      tracksStock: products.tracksStock,
      price: productVariants.price,
      // Las dos listas alternativas viajan al dispositivo para poder cobrar
      // por ellas sin conexión. Nullable: la mayoría del catálogo no las tiene.
      priceCash: productVariants.priceCash,
      priceWholesale: productVariants.priceWholesale,
      basePrice: products.basePrice,
      setName: productVariants.setName,
      condition: productVariants.condition,
      foil: productVariants.foil,
      language: productVariants.language,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(and(
      eq(productVariants.storeId, storeId),
      eq(products.active, true), eq(productVariants.active, true),
      or(
        ilike(products.name, pattern),
        inArray(productVariants.id, variantMatch),
      )
    ))
    // ⚠️ Sin ORDER BY esta consulta era no determinista Y estaba sesgada
    // contra lo recién cargado: el Bitmap Heap Scan de los índices GIN emite
    // en orden físico del heap, así que la fila insertada hace un minuto sale
    // última y es la primera que se come el LIMIT. El síntoma era "cargo un
    // producto y no aparece en Vender".
    // El desempate por id es obligatorio por el mismo motivo que en
    // src/domain/inventory.ts: sin una columna única al final, las filas
    // empatadas siguen saliendo en orden indefinido.
    .orderBy(rango, asc(products.name), asc(productVariants.id))
    .limit(LIMITE_RESULTADOS);
}
