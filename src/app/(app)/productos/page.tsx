import Link from "next/link";
import { ilike, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { products, productVariants } from "@/db/schema";
import type { Product, ProductVariant } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { ProductForm } from "./product-form";
import { ProductList } from "./product-list";
import { SearchInput } from "./search-input";

export type ProductWithVariants = Product & { variants: ProductVariant[] };

const PAGE_SIZE = 50;

async function getProducts(opts: { q?: string; page: number }): Promise<{ products: ProductWithVariants[]; hasNextPage: boolean }> {
  const q = opts.q?.trim();

  // Un término que solo matchea el SKU/nombre/set de una VARIANTE (no el
  // nombre del producto padre) igual debe traer el producto padre completo
  // — de lo contrario buscar por SKU de carta no encontraría nada.
  const matchesVariant = q
    ? db
        .select({ productId: productVariants.productId })
        .from(productVariants)
        .where(or(
          ilike(productVariants.sku, `%${q}%`),
          ilike(productVariants.name, `%${q}%`),
          ilike(productVariants.setName, `%${q}%`),
        ))
    : undefined;

  const where = q ? or(ilike(products.name, `%${q}%`), inArray(products.id, matchesVariant!)) : undefined;

  // Se pagina a nivel de PRODUCTO (no de fila post-join): un producto con
  // muchas variantes no puede hacer que una página traiga menos productos
  // de los esperados. Se pide una fila de más (`PAGE_SIZE + 1`) para saber
  // si hay página siguiente sin una segunda query de conteo.
  const matched = await db
    .select()
    .from(products)
    .where(where)
    .orderBy(products.name)
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
  const user = await requireUser();
  const isOwner = user.role === "owner";
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const q = params.q ?? "";
  const { products: productList, hasNextPage } = await getProducts({ q, page });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Productos</h1>
        {isOwner && <ProductForm />}
      </div>

      <SearchInput defaultValue={q} />

      {productList.length === 0 ? (
        <p className="text-sm text-muted-foreground">{q ? "Sin resultados." : "No hay productos cargados."}</p>
      ) : (
        <ProductList products={productList} isOwner={isOwner} />
      )}

      {(page > 1 || hasNextPage) && (
        <div className="flex justify-center gap-2">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/productos?q=${encodeURIComponent(q)}&page=${page - 1}`}>Anterior</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>Anterior</Button>
          )}
          <span className="flex items-center text-sm text-muted-foreground">Página {page}</span>
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
