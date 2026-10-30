ALTER TABLE "order_items" ADD COLUMN "ready_at" timestamp;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "sold_out_on" date;--> statement-breakpoint
-- Lo mandado antes de esta migración ya salió: sin esto, la pantalla de
-- cocina se llenaría con cada plato servido desde que existe el rubro.
UPDATE "order_items" SET "ready_at" = "sent_at" WHERE "sent_at" IS NOT NULL;
