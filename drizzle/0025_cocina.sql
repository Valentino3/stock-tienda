ALTER TABLE "order_items" ADD COLUMN "sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "printed_at" timestamp;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "station" text;