CREATE INDEX "sale_items_sale_idx" ON "sale_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sales_cash_session_idx" ON "sales" USING btree ("cash_session_id");