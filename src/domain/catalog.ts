import { and, eq, ilike, inArray, or } from "drizzle-orm";
import { products, productVariants } from "@/db/schema";

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
