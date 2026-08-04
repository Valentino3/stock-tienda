ALTER TABLE "product_variants" ADD COLUMN "uid" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "uid" text;--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_store_uid_idx" ON "product_variants" USING btree ("store_id","uid");--> statement-breakpoint
CREATE UNIQUE INDEX "products_store_uid_idx" ON "products" USING btree ("store_id","uid");