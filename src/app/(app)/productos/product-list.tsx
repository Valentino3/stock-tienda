import type { ProductWithVariants } from "./page";
import { money, number } from "@/lib/format";
import { ProductForm } from "./product-form";
import { VariantRow } from "./variant-row";

export function ProductList({ products, isOwner }: { products: ProductWithVariants[]; isOwner: boolean }) {
  return (
    <div className="space-y-4">
      {products.map((product) => (
        <div
          key={product.id}
          className={`rounded-xl border border-border bg-card shadow-xs ${!product.active ? "opacity-60" : ""}`}
        >
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate font-semibold tracking-tight">{product.name}</h2>
                {!product.active && <span className="ledger-label">Inactivo</span>}
              </div>
              <p className="text-xs text-muted-foreground">
                Precio base <span className="figure text-foreground">{money(product.basePrice)}</span>
                {" · "}Umbral stock bajo{" "}
                <span className="figure text-foreground">{number(product.lowStockThreshold)}</span>
              </p>
            </div>
            {isOwner && <ProductForm product={product} />}
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
      ))}
    </div>
  );
}
