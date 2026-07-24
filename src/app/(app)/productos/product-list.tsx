import type { ProductWithVariants } from "./page";
import { money } from "@/lib/format";
import { SectionLabel } from "@/components/ui/section";
import { ProductForm } from "./product-form";
import { VariantRow } from "./variant-row";

const SIN_CAT = "Sin categoría";

function ProductCard({ product, isOwner, categories }: { product: ProductWithVariants; isOwner: boolean; categories: string[] }) {
  return (
    <div className={`rounded-xl border border-border bg-card shadow-xs ${!product.active ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-semibold tracking-tight">{product.name}</h2>
            {!product.active && <span className="ledger-label">Inactivo</span>}
          </div>
          <p className="text-xs text-muted-foreground">
            Precio base <span className="figure text-foreground">{money(product.basePrice)}</span>
          </p>
        </div>
        {isOwner && <ProductForm product={product} categories={categories} />}
      </div>
      <div className="divide-y divide-border px-5">
        {product.variants.map((variant) => (
          <VariantRow
            key={variant.id}
            variant={variant}
            basePrice={product.basePrice}
            lowStockThreshold={product.lowStockThreshold}
            isOwner={isOwner}
          />
        ))}
      </div>
    </div>
  );
}

export function ProductList({
  products,
  isOwner,
  categories,
  grouped,
}: {
  products: ProductWithVariants[];
  isOwner: boolean;
  categories: string[];
  grouped: boolean;
}) {
  if (!grouped) {
    return (
      <div className="space-y-4">
        {products.map((p) => <ProductCard key={p.id} product={p} isOwner={isOwner} categories={categories} />)}
      </div>
    );
  }

  // Agrupar por categoría; "Sin categoría" al final.
  const byCat = new Map<string, ProductWithVariants[]>();
  for (const p of products) {
    const key = p.category?.trim() || SIN_CAT;
    byCat.set(key, [...(byCat.get(key) ?? []), p]);
  }
  const orderedKeys = [...byCat.keys()].sort((a, b) => {
    if (a === SIN_CAT) return 1;
    if (b === SIN_CAT) return -1;
    return a.localeCompare(b);
  });

  return (
    <div className="space-y-8">
      {orderedKeys.map((key) => (
        <section key={key} className="space-y-4">
          <SectionLabel aside={<span className="text-xs text-muted-foreground">{byCat.get(key)!.length}</span>}>{key}</SectionLabel>
          <div className="space-y-4">
            {byCat.get(key)!.map((p) => <ProductCard key={p.id} product={p} isOwner={isOwner} categories={categories} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
