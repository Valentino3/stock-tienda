-- A quién se le acredita la venta (`seller_id`) deja de ser necesariamente
-- quien la anotó. Se agrega `registered_by` para no perder el segundo dato.
--
-- Tres statements y no un ADD COLUMN ... NOT NULL DEFAULT: no hay default
-- sensato para "quién operó", y un valor fijo sería indistinguible de un dato
-- real. El backfill `= seller_id` no inventa historia: antes de esta columna
-- el que vendía era el que operaba, porque no se podía elegir otro.
ALTER TABLE "sales" ADD COLUMN "registered_by" text;--> statement-breakpoint
UPDATE "sales" SET "registered_by" = "seller_id" WHERE "registered_by" IS NULL;--> statement-breakpoint
ALTER TABLE "sales" ALTER COLUMN "registered_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_registered_by_user_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- El historial del empleado pasa a filtrar por seller_id OR registered_by.
CREATE INDEX "sales_store_registered_by_idx" ON "sales" USING btree ("store_id","registered_by");
