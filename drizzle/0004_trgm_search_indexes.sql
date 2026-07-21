-- Custom SQL migration file, put your code below! --
-- Postgres no puede usar un índice btree común para `ilike '%term%'`
-- (comodín al inicio) — con miles de variantes esto degrada a Seq Scan.
-- pg_trgm + GIN permite que ILIKE con comodín al inicio use un índice.
-- Ver docs/superpowers/specs/2026-07-20-tcg-catalog-performance-design.md
-- para la justificación completa (por qué trigram y no full-text search).
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "products_name_trgm_idx" ON "products" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "product_variants_sku_trgm_idx" ON "product_variants" USING gin ("sku" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "product_variants_name_trgm_idx" ON "product_variants" USING gin ("name" gin_trgm_ops);
