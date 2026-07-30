-- Índices PARCIALES de comprobantes. Escritos a mano porque drizzle-kit no
-- modela índices con cláusula WHERE (mismo caso que 0002_cash_sessions_one_open_idx).
-- Ver la nota en src/db/schema.ts, debajo de la tabla `comprobantes`.

-- Un número VIVO por (tienda, ambiente, punto de venta, tipo de comprobante).
-- Un comprobante 'rechazado' queda fuera del índice a propósito: ARCA no avanza
-- su numeración cuando responde Resultado = R, así que el número sigue libre y
-- el reintento tiene que poder reusarlo.
CREATE UNIQUE INDEX "comprobantes_numero_uq"
  ON "comprobantes" ("store_id", "ambiente", "pto_vta", "cbte_tipo", "numero")
  WHERE "estado" <> 'rechazado';
--> statement-breakpoint
-- Idempotencia del botón "Emitir factura": como mucho UNA factura viva y UNA
-- nota de crédito viva por venta. Es el backstop a nivel DB contra el doble
-- clic, incluso si fallara el advisory lock de la reserva de número. El dominio
-- atrapa el 23505 y devuelve la fila existente, igual que openCashSession.
--
-- Emitir dos CAE para una misma venta es el peor modo de falla del sistema: un
-- comprobante autorizado no se puede borrar, solo anular con nota de crédito.
CREATE UNIQUE INDEX "comprobantes_sale_clase_uq"
  ON "comprobantes" ("sale_id", "clase")
  WHERE "estado" IN ('pendiente', 'autorizado');
--> statement-breakpoint
-- Cola de reconciliación: comprobantes cuyo resultado no conocemos y hay que
-- resolver contra ARCA con FECompConsultar.
CREATE INDEX "comprobantes_reconciliar_idx"
  ON "comprobantes" ("store_id")
  WHERE "estado" IN ('pendiente', 'error');
