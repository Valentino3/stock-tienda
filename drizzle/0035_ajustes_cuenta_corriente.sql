ALTER TYPE "public"."client_movement_type" ADD VALUE 'ajuste';--> statement-breakpoint
ALTER TABLE "client_account_movements" ADD COLUMN "voided" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "client_account_movements" ADD COLUMN "voided_at" timestamp;--> statement-breakpoint
ALTER TABLE "client_account_movements" ADD COLUMN "voided_by" text;--> statement-breakpoint
ALTER TABLE "client_account_movements" ADD COLUMN "voided_reason" text;--> statement-breakpoint
ALTER TABLE "client_account_movements" ADD CONSTRAINT "client_account_movements_voided_by_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_movements_store_created_idx" ON "client_account_movements" USING btree ("store_id","created_at");--> statement-breakpoint
ALTER TABLE "client_account_movements" ADD CONSTRAINT "client_movements_anulacion_completa" CHECK (("client_account_movements"."voided" = false and "client_account_movements"."voided_at" is null and "client_account_movements"."voided_by" is null and "client_account_movements"."voided_reason" is null)
      or ("client_account_movements"."voided" = true and "client_account_movements"."voided_at" is not null and "client_account_movements"."voided_by" is not null and "client_account_movements"."voided_reason" is not null));