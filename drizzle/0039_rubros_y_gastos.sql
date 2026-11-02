CREATE TABLE "gastos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "gastos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"store_id" integer NOT NULL,
	"rubro_id" integer NOT NULL,
	"fecha" date NOT NULL,
	"monto" numeric(12, 2) NOT NULL,
	"medio" text NOT NULL,
	"detalle" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"voided_at" timestamp,
	"voided_by" text,
	"void_reason" text,
	CONSTRAINT "gastos_monto_positivo" CHECK ("gastos"."monto" > 0),
	CONSTRAINT "gastos_anulacion_completa" CHECK (("gastos"."voided_at" is null and "gastos"."voided_by" is null and "gastos"."void_reason" is null)
      or ("gastos"."voided_at" is not null and "gastos"."voided_by" is not null and "gastos"."void_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "rubros" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rubros_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"store_id" integer NOT NULL,
	"nombre" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cash_movements" ADD COLUMN "rubro_id" integer;--> statement-breakpoint
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_rubro_id_rubros_id_fk" FOREIGN KEY ("rubro_id") REFERENCES "public"."rubros"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_voided_by_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubros" ADD CONSTRAINT "rubros_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gastos_store_fecha_idx" ON "gastos" USING btree ("store_id","fecha");--> statement-breakpoint
CREATE UNIQUE INDEX "rubros_store_nombre_idx" ON "rubros" USING btree ("store_id","nombre");--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_rubro_id_rubros_id_fk" FOREIGN KEY ("rubro_id") REFERENCES "public"."rubros"("id") ON DELETE no action ON UPDATE no action;