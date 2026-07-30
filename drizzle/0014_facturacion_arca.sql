CREATE TYPE "public"."arca_ambiente" AS ENUM('homologacion', 'produccion');--> statement-breakpoint
CREATE TYPE "public"."comprobante_clase" AS ENUM('factura', 'nota_credito');--> statement-breakpoint
CREATE TYPE "public"."comprobante_estado" AS ENUM('pendiente', 'autorizado', 'rechazado', 'error');--> statement-breakpoint
CREATE TABLE "arca_access_tickets" (
	"store_id" integer NOT NULL,
	"ambiente" "arca_ambiente" NOT NULL,
	"service" text DEFAULT 'wsfe' NOT NULL,
	"cuit" text NOT NULL,
	"token" text NOT NULL,
	"sign" text NOT NULL,
	"generated_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	"locked_until" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "arca_access_tickets_store_id_ambiente_service_pk" PRIMARY KEY("store_id","ambiente","service")
);
--> statement-breakpoint
CREATE TABLE "arca_credentials" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "arca_credentials_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"store_id" integer NOT NULL,
	"ambiente" "arca_ambiente" NOT NULL,
	"cert_pem_enc" text NOT NULL,
	"key_pem_enc" text NOT NULL,
	"cert_subject" text,
	"cert_cuit" text,
	"cert_expires_at" timestamp,
	"cert_fingerprint" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comprobantes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "comprobantes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"store_id" integer NOT NULL,
	"sale_id" integer NOT NULL,
	"client_id" integer,
	"clase" "comprobante_clase" NOT NULL,
	"cbte_tipo" smallint NOT NULL,
	"ambiente" "arca_ambiente" NOT NULL,
	"pto_vta" integer NOT NULL,
	"numero" integer NOT NULL,
	"estado" "comprobante_estado" DEFAULT 'pendiente' NOT NULL,
	"doc_tipo" smallint NOT NULL,
	"doc_nro" text NOT NULL,
	"cond_iva_receptor" smallint NOT NULL,
	"receptor_nombre" text NOT NULL,
	"receptor_domicilio" text,
	"imp_total" numeric(12, 2) NOT NULL,
	"imp_neto" numeric(12, 2) NOT NULL,
	"imp_iva" numeric(12, 2) NOT NULL,
	"imp_tot_conc" numeric(12, 2) DEFAULT 0 NOT NULL,
	"imp_op_ex" numeric(12, 2) DEFAULT 0 NOT NULL,
	"imp_trib" numeric(12, 2) DEFAULT 0 NOT NULL,
	"iva_desglose" jsonb NOT NULL,
	"lineas" jsonb NOT NULL,
	"cbte_fch" date NOT NULL,
	"cae" text,
	"cae_vto" date,
	"resultado" text,
	"observaciones" jsonb,
	"error_msg" text,
	"intentos" integer DEFAULT 0 NOT NULL,
	"autorizado_at" timestamp,
	"cbte_asoc_id" integer,
	"cuit_emisor" text NOT NULL,
	"request_json" jsonb,
	"response_json" jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_fiscal_config" (
	"store_id" integer PRIMARY KEY NOT NULL,
	"cuit" text NOT NULL,
	"razon_social" text NOT NULL,
	"nombre_fantasia" text,
	"domicilio" text NOT NULL,
	"condicion_iva" smallint DEFAULT 1 NOT NULL,
	"ingresos_brutos" text,
	"inicio_actividades" date,
	"punto_venta" integer NOT NULL,
	"ambiente" "arca_ambiente" DEFAULT 'homologacion' NOT NULL,
	"default_iva_id" smallint DEFAULT 5 NOT NULL,
	"umbral_consumidor_final" numeric(12, 2),
	"empleados_pueden_emitir" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "doc_tipo" smallint;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "doc_nro" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "condicion_iva" smallint;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "razon_social" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "domicilio" text;--> statement-breakpoint
ALTER TABLE "arca_access_tickets" ADD CONSTRAINT "arca_access_tickets_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arca_credentials" ADD CONSTRAINT "arca_credentials_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_cbte_asoc_id_comprobantes_id_fk" FOREIGN KEY ("cbte_asoc_id") REFERENCES "public"."comprobantes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_fiscal_config" ADD CONSTRAINT "store_fiscal_config_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "arca_credentials_store_ambiente_idx" ON "arca_credentials" USING btree ("store_id","ambiente");--> statement-breakpoint
CREATE INDEX "comprobantes_sale_idx" ON "comprobantes" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "comprobantes_store_fch_idx" ON "comprobantes" USING btree ("store_id","cbte_fch");--> statement-breakpoint
CREATE INDEX "clients_store_doc_idx" ON "clients" USING btree ("store_id","doc_nro");