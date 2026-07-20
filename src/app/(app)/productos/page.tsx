import { eq } from "drizzle-orm";
import { db } from "@/db";
import { products, productVariants } from "@/db/schema";
import type { Product, ProductVariant } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { ProductForm } from "./product-form";
import { ProductList } from "./product-list";

export type ProductWithVariants = Product & { variants: ProductVariant[] };

async function getProducts(): Promise<ProductWithVariants[]> {
  // db.query.* relational API no está disponible (no hay relations() para
  // estas tablas de dominio): join manual + agrupado en JS.
  const rows = await db
    .select({ product: products, variant: productVariants })
    .from(products)
    .leftJoin(productVariants, eq(productVariants.productId, products.id))
    .orderBy(products.name, productVariants.id);

  const byId = new Map<number, ProductWithVariants>();
  for (const row of rows) {
    let entry = byId.get(row.product.id);
    if (!entry) {
      entry = { ...row.product, variants: [] };
      byId.set(row.product.id, entry);
    }
    if (row.variant) entry.variants.push(row.variant);
  }
  return [...byId.values()];
}

export default async function ProductosPage() {
  const user = await requireUser();
  const isOwner = user.role === "owner";
  const productList = await getProducts();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Productos</h1>
        {isOwner && <ProductForm />}
      </div>

      {productList.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay productos cargados.</p>
      ) : (
        <ProductList products={productList} isOwner={isOwner} />
      )}
    </div>
  );
}
