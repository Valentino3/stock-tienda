-- Escrito a mano: drizzle-kit no modela índices con cláusula WHERE.
-- Mismo caso que 0002_cash_sessions_one_open_idx y los tres de 0015.
--
-- Como mucho UNA orden viva por mesa. Sin esto, dos mozos abriendo la misma
-- mesa a la vez crean dos comandas para el mismo grupo y la cuenta sale
-- partida al azar.
--
-- `table_id` es NULL en las órdenes de mostrador / para llevar. Postgres trata
-- cada NULL como distinto en un índice único, así que esas no chocan entre sí
-- y pueden convivir tantas como haga falta — el comportamiento correcto sale
-- gratis, sin una segunda cláusula.
--
-- 'pagada' y 'cancelada' quedan fuera del índice a propósito: son estados
-- terminales y la mesa vuelve a estar libre.
CREATE UNIQUE INDEX "orders_una_abierta_por_mesa_idx"
  ON "orders" ("table_id")
  WHERE "status" IN ('abierta', 'a_cobrar');
