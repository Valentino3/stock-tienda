import { and, eq, ilike, inArray, or } from "drizzle-orm";
import { products, productVariants } from "@/db/schema";

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
export async function snapshotCatalogo(db: any, storeId: number) {
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
    .orderBy(products.name)
    .limit(MAX_VARIANTES_SNAPSHOT + 1);

  const truncado = filas.length > MAX_VARIANTES_SNAPSHOT;
  return { variantes: truncado ? filas.slice(0, MAX_VARIANTES_SNAPSHOT) : filas, truncado };
}

export async function searchVariants(db: any, storeId: number, term: string) {
  const t = term.trim();
  if (t.length < 2) return [];
  const pattern = `%${t}%`;

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
    .limit(20);
}
