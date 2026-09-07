CREATE TABLE "sale_payments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sale_payments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sale_id" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sale_payments_amount_no_negativo" CHECK ("sale_payments"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "registered_by" text NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_payments_sale_idx" ON "sale_payments" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_payments_sale_method_idx" ON "sale_payments" USING btree ("sale_id","method");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_registered_by_user_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_store_registered_by_idx" ON "sales" USING btree ("store_id","registered_by");