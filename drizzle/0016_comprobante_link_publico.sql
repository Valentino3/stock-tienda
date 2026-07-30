ALTER TABLE "clients" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "comprobantes" ADD COLUMN "public_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "comprobantes_public_token_idx" ON "comprobantes" USING btree ("public_token");