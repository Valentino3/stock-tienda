-- Nullable primero: un ADD COLUMN NOT NULL sin default falla con órdenes ya
-- cargadas. El mozo de cada orden existente es quien la abrió.
ALTER TABLE "orders" ADD COLUMN "waiter_id" text;--> statement-breakpoint
UPDATE "orders" SET "waiter_id" = "opened_by" WHERE "waiter_id" IS NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "waiter_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_waiter_id_user_id_fk" FOREIGN KEY ("waiter_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
