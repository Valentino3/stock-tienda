CREATE INDEX "product_variants_product_id_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_variants_store_active_idx" ON "product_variants" USING btree ("store_id","active");--> statement-breakpoint
CREATE INDEX "product_variants_store_stock_idx" ON "product_variants" USING btree ("store_id","stock");--> statement-breakpoint
CREATE INDEX "product_variants_store_supplier_idx" ON "product_variants" USING btree ("store_id","supplier");--> statement-breakpoint
CREATE INDEX "products_store_category_idx" ON "products" USING btree ("store_id","category");