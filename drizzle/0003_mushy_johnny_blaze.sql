ALTER TABLE "product_variants" ADD COLUMN "set_name" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "condition" text;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "foil" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "language" text;