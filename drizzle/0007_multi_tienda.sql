CREATE TABLE "stores" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "stores_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stores_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
-- Tienda default para backfill de datos existentes (base limpia: puede quedar sin uso).
INSERT INTO "stores" ("name", "slug") VALUES ('Tienda 1', 'tienda-1');--> statement-breakpoint
ALTER TABLE "product_variants" DROP CONSTRAINT "product_variants_sku_unique";--> statement-breakpoint
-- store_id: se agrega NULLABLE, se backfillea a la tienda default, luego NOT NULL.
ALTER TABLE "cash_sessions" ADD COLUMN "store_id" integer;--> statement-breakpoint
ALTER TABLE "commissions" ADD COLUMN "store_id" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "store_id" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "store_id" integer;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "store_id" integer;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "store_id" integer;--> statement-breakpoint
UPDATE "cash_sessions" SET "store_id" = (SELECT id FROM stores ORDER BY id LIMIT 1) WHERE "store_id" IS NULL;--> statement-breakpoint
UPDATE "commissions" SET "store_id" = (SELECT id FROM stores ORDER BY id LIMIT 1) WHERE "store_id" IS NULL;--> statement-breakpoint
UPDATE "product_variants" SET "store_id" = (SELECT id FROM stores ORDER BY id LIMIT 1) WHERE "store_id" IS NULL;--> statement-breakpoint
UPDATE "products" SET "store_id" = (SELECT id FROM stores ORDER BY id LIMIT 1) WHERE "store_id" IS NULL;--> statement-breakpoint
UPDATE "sales" SET "store_id" = (SELECT id FROM stores ORDER BY id LIMIT 1) WHERE "store_id" IS NULL;--> statement-breakpoint
ALTER TABLE "cash_sessions" ALTER COLUMN "store_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "commissions" ALTER COLUMN "store_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ALTER COLUMN "store_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "store_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "store_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_store_sku_idx" ON "product_variants" USING btree ("store_id","sku");--> statement-breakpoint
CREATE INDEX "products_store_idx" ON "products" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "sales_store_idx" ON "sales" USING btree ("store_id");--> statement-breakpoint
-- Una sola caja abierta POR TIENDA (antes era una global sobre la constante (1)).
DROP INDEX IF EXISTS "cash_sessions_one_open_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "cash_sessions_one_open_idx" ON "cash_sessions" ("store_id") WHERE "closed_at" IS NULL;
