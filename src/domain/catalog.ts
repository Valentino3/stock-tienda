import { and, eq, ilike, or } from "drizzle-orm";
import { products, productVariants } from "@/db/schema";

export async function searchVariants(db: any, term: string) {
  const t = term.trim();
  if (t.length < 2) return [];
  const pattern = `%${t}%`;
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
      eq(products.active, true), eq(productVariants.active, true),
      or(
        ilike(products.name, pattern),
        ilike(productVariants.sku, pattern),
        ilike(productVariants.name, pattern),
        ilike(productVariants.setName, pattern),
      )
    ))
    .limit(20);
}
