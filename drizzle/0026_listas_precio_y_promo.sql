CREATE TYPE "public"."price_list" AS ENUM('venta', 'efectivo', 'mayorista');--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "is_promo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "price_list" "price_list" DEFAULT 'venta' NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "is_promo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "voided_reason" text;