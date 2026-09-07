-- Una venta puede cobrarse con varios medios a la vez. Las partes viven acá y
-- esta tabla pasa a ser la unica fuente de verdad de la plata por medio: el
-- arqueo, el cierre y los reportes suman de aca, no de sales.payment_method.
--
-- `sales.payment_method` se queda NOT NULL como medio PREDOMINANTE. Hacerlo
-- nullable convertiria en obligatorio tocar la docena de lugares que hoy lo
-- leen para mostrar una etiqueta, incluido el camino offline, sin ganar nada:
-- el dato existe y es util. Lo que ata las dos fuentes es la invariante
-- `suma(sale_payments.amount) = sales.total`, que verifica `npm run check:prod`.
CREATE TABLE "sale_payments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
	"sale_id" integer NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	-- >= y no > 0: una venta con 100% de descuento tiene total 0, y esas ya
	-- existen en produccion. Con > 0 el backfill de abajo explota y createSale
	-- rechazaria una venta legitima.
	CONSTRAINT "sale_payments_amount_no_negativo" CHECK ("amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_payments_sale_idx" ON "sale_payments" USING btree ("sale_id");--> statement-breakpoint
-- Backfill: toda venta historica se cobro con UN medio por el total. Es
-- obligatorio, no opcional: si el arqueo lee de esta tabla, una caja vieja sin
-- filas da un esperado de cero. El NOT EXISTS lo hace reejecutable a mano si
-- el deploy se corta en el medio.
INSERT INTO "sale_payments" ("sale_id", "method", "amount", "created_at")
SELECT s."id", s."payment_method", s."total", s."created_at"
FROM "sales" s
WHERE NOT EXISTS (SELECT 1 FROM "sale_payments" p WHERE p."sale_id" = s."id");
--> statement-breakpoint
-- Un pago por medio por venta. El dominio ya suma los repetidos antes de
-- insertar (normalizarPagos); este indice es el que hace que, si alguna vez se
-- rompiera, falle ruidoso en vez de contar la plata del turno dos veces.
-- Va DESPUES del backfill, que no puede violarlo (una fila por venta).
CREATE UNIQUE INDEX "sale_payments_sale_method_idx" ON "sale_payments" USING btree ("sale_id","method");
