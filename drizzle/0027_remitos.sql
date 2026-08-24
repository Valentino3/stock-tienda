ALTER TABLE "sales" ADD COLUMN "remito_numero" integer;--> statement-breakpoint
ALTER TABLE "store_fiscal_config" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "remito_ultimo_numero" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_store_remito_idx" ON "sales" USING btree ("store_id","remito_numero");