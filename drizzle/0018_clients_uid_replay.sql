ALTER TABLE "clients" ADD COLUMN "uid" text;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_store_uid_idx" ON "clients" USING btree ("store_id","uid");