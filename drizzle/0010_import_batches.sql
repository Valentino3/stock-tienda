CREATE TABLE "import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"created_by" text NOT NULL,
	"source" text NOT NULL,
	"mode" text NOT NULL,
	"rows" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_batches_store_status_idx" ON "import_batches" USING btree ("store_id","status");