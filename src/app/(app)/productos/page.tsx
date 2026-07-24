import Link from "next/link";
import { and, eq, ilike, inArray, isNotNull, or } from "drizzle-orm";
import { db } from "@/db";
import { products, productVariants } from "@/db/schema";
import type { Product, ProductVariant } from "@/db/schema";
import { requireStore } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { ProductForm } from "./product-form";
import { ProductList } from "./product-list";
import { SearchInput } from "./search-input";

export type ProductWithVariants = Product & { variants: ProductVariant[] };

const PAGE_SIZE = 50;

async function getProducts(opts: { storeId: number; q?: string; cat?: string; page: number }): Promise<{ products: ProductWithVariants[]; hasNextPage: boolean }> {
  const q = opts.q?.trim();

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

  // Siempre acotado a la tienda; q y categoría son filtros adicionales.
  const where = and(
    eq(products.storeId, opts.storeId),
    opts.cat ? eq(products.category, opts.cat) : undefined,
    q ? or(ilike(products.name, `%${q}%`), inArray(products.id, matchesVariant!)) : undefined,
  );

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

type Params = { q?: string; cat?: string; page?: string };

export default async function ProductosPage({ searchParams }: { searchParams: Promise<Params> }) {
  const user = await requireStore();
  const isOwner = user.role === "owner";
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const q = params.q ?? "";
  const cat = params.cat ?? "";

  const [{ products: productList, hasNextPage }, catRows] = await Promise.all([
    getProducts({ storeId: user.storeId, q, cat: cat || undefined, page }),
    db.selectDistinct({ category: products.category }).from(products)
      .where(and(eq(products.storeId, user.storeId), isNotNull(products.category)))
      .orderBy(products.category),
  ]);
  const categories = catRows.map((r) => r.category).filter((c): c is string => !!c);

  const qs = (over: Partial<Params>) => {
    const sp = new URLSearchParams();
    const merged = { q, cat, ...over };
    if (merged.q) sp.set("q", merged.q);
    if (merged.cat) sp.set("cat", merged.cat);
    if (merged.page && merged.page !== "1") sp.set("page", String(merged.page));
    const s = sp.toString();
    return s ? `/productos?${s}` : "/productos";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Productos"
        description="Catálogo, variantes y stock."
        actions={isOwner ? <ProductForm categories={categories} /> : undefined}
      />

      <SearchInput defaultValue={q} />

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button asChild variant={cat ? "outline" : "brand"} size="sm">
            <Link href={qs({ cat: "", page: "1" })}>Todas</Link>
          </Button>
          {categories.map((c) => (
            <Button key={c} asChild variant={cat === c ? "brand" : "outline"} size="sm">
              <Link href={qs({ cat: c, page: "1" })} className={cn(cat === c && "font-semibold")}>{c}</Link>
            </Button>
          ))}
        </div>
      )}

      {productList.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-10 text-center text-sm text-muted-foreground">
          {q || cat ? "Sin resultados para el filtro." : "No hay productos cargados todavía."}
        </p>
      ) : (
        <ProductList products={productList} isOwner={isOwner} categories={categories} grouped={!cat} />
      )}

      {(page > 1 || hasNextPage) && (
        <div className="flex items-center justify-center gap-3">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm"><Link href={qs({ page: String(page - 1) })}>Anterior</Link></Button>
          ) : (
            <Button variant="outline" size="sm" disabled>Anterior</Button>
          )}
          <span className="ledger-label">Página {page}</span>
          {hasNextPage ? (
            <Button asChild variant="outline" size="sm"><Link href={qs({ page: String(page + 1) })}>Siguiente</Link></Button>
          ) : (
            <Button variant="outline" size="sm" disabled>Siguiente</Button>
          )}
        </div>
      )}
    </div>
  );
}
