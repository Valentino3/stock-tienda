CREATE TABLE "price_recalc_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"created_by" text NOT NULL,
	"usd_rate" numeric(12, 2) NOT NULL,
	"rounding_mode" text NOT NULL,
	"rounding_step" integer NOT NULL,
	"cash_pct" numeric(5, 2),
	"wholesale_pct" numeric(5, 2),
	"rows" jsonb NOT NULL,
	"changed" integer DEFAULT 0 NOT NULL,
	"unchanged" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"overridden" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp,
	"reverted_at" timestamp,
	"reverted_by" text
);
--> statement-breakpoint
CREATE TABLE "store_pricing_config" (
	"store_id" integer PRIMARY KEY NOT NULL,
	"usd_rate" numeric(12, 2),
	"usd_rate_updated_at" timestamp,
	"usd_rate_updated_by" text,
	"rounding_mode" text DEFAULT 'nearest' NOT NULL,
	"rounding_step" integer DEFAULT 100 NOT NULL,
	"cash_pct" numeric(5, 2),
	"wholesale_pct" numeric(5, 2),
	"prices_updated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "price_usd" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "base_price_usd" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "price_recalc_batches" ADD CONSTRAINT "price_recalc_batches_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_recalc_batches" ADD CONSTRAINT "price_recalc_batches_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_recalc_batches" ADD CONSTRAINT "price_recalc_batches_reverted_by_user_id_fk" FOREIGN KEY ("reverted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_pricing_config" ADD CONSTRAINT "store_pricing_config_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_pricing_config" ADD CONSTRAINT "store_pricing_config_usd_rate_updated_by_user_id_fk" FOREIGN KEY ("usd_rate_updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "price_recalc_batches_store_status_idx" ON "price_recalc_batches" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "product_variants_store_price_usd_idx" ON "product_variants" USING btree ("store_id","price_usd");