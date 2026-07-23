import Link from "next/link";
import { and, eq, ilike, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { products, productVariants } from "@/db/schema";
import type { Product, ProductVariant } from "@/db/schema";
import { requireStore } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ProductForm } from "./product-form";
import { ProductList } from "./product-list";
import { SearchInput } from "./search-input";

export type ProductWithVariants = Product & { variants: ProductVariant[] };

const PAGE_SIZE = 50;

async function getProducts(opts: { storeId: number; q?: string; page: number }): Promise<{ products: ProductWithVariants[]; hasNextPage: boolean }> {
  const q = opts.q?.trim();

  // Un término que solo matchea el SKU/nombre/set de una VARIANTE (no el
  // nombre del producto padre) igual debe traer el producto padre completo
  // — de lo contrario buscar por SKU de carta no encontraría nada.
  const matchesVariant = q
    ? db
        .select({ productId: productVariants.productId })
        .from(productVariants)
        .where(and(
          eq(productVariants.storeId, opts.storeId),
          or(
            ilike(productVariants.sku, `%${q}%`),
            ilike(productVariants.name, `%${q}%`),
            ilike(productVariants.setName, `%${q}%`),
          ),
        ))
    : undefined;

  // Siempre acotado a la tienda; el término q es un filtro adicional.
  const where = and(
    eq(products.storeId, opts.storeId),
    q ? or(ilike(products.name, `%${q}%`), inArray(products.id, matchesVariant!)) : undefined,
  );

  // Se pagina a nivel de PRODUCTO (no de fila post-join): un producto con
  // muchas variantes no puede hacer que una página traiga menos productos
  // de los esperados. Se pide una fila de más (`PAGE_SIZE + 1`) para saber
  // si hay página siguiente sin una segunda query de conteo.
  const matched = await db
    .select()
    .from(products)
    .where(where)
    .orderBy(products.name, products.id)
    .limit(PAGE_SIZE + 1)
    .offset((opts.page - 1) * PAGE_SIZE);

  const hasNextPage = matched.length > PAGE_SIZE;
  const pageProducts = matched.slice(0, PAGE_SIZE);
  const productIds = pageProducts.map((p) => p.id);

  const variantRows = productIds.length
    ? await db.select().from(productVariants).where(inArray(productVariants.productId, productIds)).orderBy(productVariants.id)
    : [];

  const byId = new Map<number, ProductWithVariants>();
  for (const p of pageProducts) byId.set(p.id, { ...p, variants: [] });
  for (const v of variantRows) byId.get(v.productId)?.variants.push(v);

  return { products: [...byId.values()], hasNextPage };
}

type Params = { q?: string; page?: string };

export default async function ProductosPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireStore();
  const isOwner = user.role === "owner";
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const q = params.q ?? "";
  const { products: productList, hasNextPage } = await getProducts({ storeId: user.storeId, q, page });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Productos"
        description="Catálogo, variantes y stock."
        actions={isOwner ? <ProductForm /> : undefined}
      />

      <SearchInput defaultValue={q} />

      {productList.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-10 text-center text-sm text-muted-foreground">
          {q ? "Sin resultados para tu búsqueda." : "No hay productos cargados todavía."}
        </p>
      ) : (
        <ProductList products={productList} isOwner={isOwner} />
      )}

      {(page > 1 || hasNextPage) && (
        <div className="flex items-center justify-center gap-3">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/productos?q=${encodeURIComponent(q)}&page=${page - 1}`}>Anterior</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>Anterior</Button>
          )}
          <span className="ledger-label">Página {page}</span>
          {hasNextPage ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/productos?q=${encodeURIComponent(q)}&page=${page + 1}`}>Siguiente</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>Siguiente</Button>
          )}
        </div>
      )}
    </div>
  );
}
