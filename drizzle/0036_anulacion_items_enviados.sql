ALTER TABLE "order_items" ADD COLUMN "voided_at" timestamp;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "voided_by" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "wasted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "modified_at" timestamp;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "correccion_vista_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancelled_by" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_voided_by_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_anulacion_completa" CHECK (("order_items"."voided_at" is null and "order_items"."voided_by" is null and "order_items"."void_reason" is null and "order_items"."wasted" = false)
      or ("order_items"."voided_at" is not null and "order_items"."voided_by" is not null and "order_items"."void_reason" is not null
          and "order_items"."sent_at" is not null and "order_items"."sale_id" is null));