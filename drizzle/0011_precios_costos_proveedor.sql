ALTER TABLE "product_variants" ADD COLUMN "price_cash" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "price_wholesale" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "cost_usd" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "cost_ars" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "supplier" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "supplier_sku" text;