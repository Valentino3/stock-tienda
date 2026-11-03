CREATE TABLE "compras" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "compras_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"store_id" integer NOT NULL,
	"proveedor_id" integer NOT NULL,
	"rubro_id" integer NOT NULL,
	"tipo" text,
	"numero" text NOT NULL,
	"fecha" date NOT NULL,
	"vencimiento" date NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"detalle" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"voided_at" timestamp,
	"voided_by" text,
	"void_reason" text,
	CONSTRAINT "compras_total_positivo" CHECK ("compras"."total" > 0),
	CONSTRAINT "compras_vence_despues" CHECK ("compras"."vencimiento" >= "compras"."fecha"),
	CONSTRAINT "compras_anulacion_completa" CHECK (("compras"."voided_at" is null and "compras"."voided_by" is null and "compras"."void_reason" is null)
      or ("compras"."voided_at" is not null and "compras"."voided_by" is not null and "compras"."void_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "pagos_proveedor" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pagos_proveedor_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"store_id" integer NOT NULL,
	"proveedor_id" integer NOT NULL,
	"fecha" date NOT NULL,
	"monto" numeric(12, 2) NOT NULL,
	"medio" text NOT NULL,
	"detalle" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"voided_at" timestamp,
	"voided_by" text,
	"void_reason" text,
	CONSTRAINT "pagos_proveedor_monto_positivo" CHECK ("pagos_proveedor"."monto" > 0),
	CONSTRAINT "pagos_proveedor_anulacion_completa" CHECK (("pagos_proveedor"."voided_at" is null and "pagos_proveedor"."voided_by" is null and "pagos_proveedor"."void_reason" is null)
      or ("pagos_proveedor"."voided_at" is not null and "pagos_proveedor"."voided_by" is not null and "pagos_proveedor"."void_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "proveedores" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "proveedores_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"store_id" integer NOT NULL,
	"nombre" text NOT NULL,
	"cuit" text,
	"rubro_id" integer,
	"plazo_dias" integer,
	"telefono" text,
	"notas" text,
	"activo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "proveedores_plazo_no_negativo" CHECK ("proveedores"."plazo_dias" is null or "proveedores"."plazo_dias" >= 0)
);
--> statement-breakpoint
ALTER TABLE "compras" ADD CONSTRAINT "compras_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compras" ADD CONSTRAINT "compras_proveedor_id_proveedores_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compras" ADD CONSTRAINT "compras_rubro_id_rubros_id_fk" FOREIGN KEY ("rubro_id") REFERENCES "public"."rubros"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compras" ADD CONSTRAINT "compras_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compras" ADD CONSTRAINT "compras_voided_by_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos_proveedor" ADD CONSTRAINT "pagos_proveedor_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos_proveedor" ADD CONSTRAINT "pagos_proveedor_proveedor_id_proveedores_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos_proveedor" ADD CONSTRAINT "pagos_proveedor_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagos_proveedor" ADD CONSTRAINT "pagos_proveedor_voided_by_user_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proveedores" ADD CONSTRAINT "proveedores_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proveedores" ADD CONSTRAINT "proveedores_rubro_id_rubros_id_fk" FOREIGN KEY ("rubro_id") REFERENCES "public"."rubros"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compras_store_fecha_idx" ON "compras" USING btree ("store_id","fecha");--> statement-breakpoint
CREATE INDEX "compras_proveedor_idx" ON "compras" USING btree ("proveedor_id");--> statement-breakpoint
CREATE INDEX "pagos_proveedor_proveedor_idx" ON "pagos_proveedor" USING btree ("proveedor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proveedores_store_nombre_idx" ON "proveedores" USING btree ("store_id","nombre");