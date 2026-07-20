"use client";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import type { ProductWithVariants } from "./page";
import { ProductForm } from "./product-form";
import { VariantRow } from "./variant-row";

export function ProductList({ products, isOwner }: { products: ProductWithVariants[]; isOwner: boolean }) {
  const [term, setTerm] = useState("");

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(t) ||
        p.variants.some((v) => v.sku?.toLowerCase().includes(t) || v.name.toLowerCase().includes(t))
    );
  }, [products, term]);

  return (
    <div className="space-y-4">
      <Input
        placeholder="Buscar producto o SKU..."
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        className="max-w-sm"
      />

      {filtered.length === 0 && <p className="text-sm text-muted-foreground">Sin resultados.</p>}

      <div className="space-y-4">
        {filtered.map((product) => (
          <div key={product.id} className={`rounded-lg border p-4 ${!product.active ? "opacity-60" : ""}`}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">{product.name}</h2>
                <p className="text-xs text-muted-foreground">
                  Precio base: ${product.basePrice.toFixed(2)} · Umbral stock bajo: {product.lowStockThreshold}
                  {!product.active && " · Inactivo"}
                </p>
              </div>
              {isOwner && <ProductForm product={product} />}
            </div>
            <div className="mt-3 divide-y">
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
    </div>
  );
}
