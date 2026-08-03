ALTER TABLE "sales" ADD COLUMN "uid" text;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_store_uid_idx" ON "sales" USING btree ("store_id","uid");