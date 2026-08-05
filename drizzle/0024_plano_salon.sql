CREATE TYPE "public"."floor_marker_type" AS ENUM('puerta', 'pared', 'ventana', 'barra');--> statement-breakpoint
CREATE TABLE "floor_plan_markers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "floor_plan_markers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"store_id" integer NOT NULL,
	"type" "floor_marker_type" NOT NULL,
	"label" text,
	"sector" text DEFAULT 'Salón' NOT NULL,
	"floor_x" numeric(5, 2) DEFAULT 10 NOT NULL,
	"floor_y" numeric(5, 2) DEFAULT 10 NOT NULL,
	"floor_width" numeric(5, 2) DEFAULT 20 NOT NULL,
	"floor_height" numeric(5, 2) DEFAULT 4 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "floor_plan_markers" ADD CONSTRAINT "floor_plan_markers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "floor_plan_markers_store_idx" ON "floor_plan_markers" USING btree ("store_id");