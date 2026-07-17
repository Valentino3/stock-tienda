# Stock Tienda — Diseño MVP

**Fecha:** 2026-07-17
**Estado:** Aprobado

## Objetivo

Sistema web de gestión de stock y ventas para un comercio chico. Las ventas descuentan stock automáticamente. Sin facturación fiscal, sin comprobantes: solo registro interno.

## Decisiones de alcance

| Decisión | Elección |
|---|---|
| Plataforma | Web hosteada (Vercel + Neon) |
| Usuarios | Dueño + empleados, con roles |
| Carga de venta | Búsqueda por nombre/SKU (sin lector de barras en MVP) |
| Comprobante | Ninguno — solo registro interno |
| Productos | Con variantes (talle/color) mediante modelo padre + variantes |
| Importación | Carga masiva de productos por Excel (.xlsx) |
| Caja | Cierre de caja por sesión (apertura/cierre con conteo de efectivo) |

## Stack

- **Next.js** (App Router) desplegado en **Vercel**
- **Postgres** serverless en **Neon**
- **Drizzle ORM**
- **better-auth** para autenticación (email + contraseña)
- Mutaciones vía **Server Actions** — sin API REST separada
- Responsive: usable desde celular

## Autenticación y roles

Sin registro público. El dueño crea las cuentas de empleados.

- **Empleado**: vender, abrir/cerrar caja, ver productos, ver sus propias ventas.
- **Dueño (owner)**: todo lo anterior + editar productos/stock, anular ventas, importar Excel, reportes, ver cierres de caja, gestión de usuarios.

## Modelo de datos

- **users**: nombre, email, hash de contraseña, rol (`owner` | `employee`), activo/inactivo
- **products**: nombre, precio base, umbral de stock bajo, activo/inactivo
- **product_variants**: producto padre, nombre de variante (texto libre: "M", "Rojo / L"), SKU (opcional, único), stock actual, precio propio opcional (si es null hereda el precio base del padre), activo/inactivo
- **sales**: fecha, vendedor (user), sesión de caja, total, medio de pago (`efectivo` | `transferencia` | `tarjeta`), anulada (bool)
- **sale_items**: venta, variante, cantidad, precio unitario al momento de la venta (el histórico no cambia si cambia el precio)
- **stock_movements**: variante, tipo (`venta` | `reposicion` | `ajuste` | `anulacion`), cantidad ±, fecha, user, venta asociada si aplica, motivo (para ajustes)
- **cash_sessions**: fecha/hora apertura, fecha/hora cierre, user que abre, user que cierra, monto inicial en efectivo, totales por medio de pago al cierre, efectivo contado, diferencia, notas

Reglas:

- **Todo producto tiene 1 o más variantes.** Producto sin variantes reales usa una variante default que la UI oculta. Un solo modelo, sin casos especiales.
- **Todo movimiento de stock pasa por `stock_movements`.** Auditoría completa desde el día 1. Stock vive en la variante.
- **No se puede vender sin una sesión de caja abierta.**

## Pantallas

1. **Vender** (pantalla principal): buscador por nombre/SKU que devuelve variantes ("Remera Roja — M"), carrito, selección de medio de pago, confirmar. La venta descuenta stock en una transacción atómica y se asocia a la sesión de caja abierta.
2. **Productos**: lista con stock por variante, alta/edición de producto y sus variantes, reposición rápida (+N unidades), ajuste manual con motivo.
3. **Ventas**: historial con filtros por fecha/vendedor, detalle de cada venta, anular venta (solo dueño, devuelve stock).
4. **Caja**: abrir sesión con monto inicial en efectivo; cerrar sesión mostrando esperado por medio de pago (inicial + ventas en efectivo, transferencias, tarjeta), cajero ingresa efectivo contado, sistema registra diferencia y notas.
5. **Importar** (solo dueño): subir `.xlsx`, preview con validación fila por fila (SKU duplicado, precio inválido marcados), confirmar e importar. Upsert por SKU: si existe actualiza precio/stock, si no crea producto/variante. Plantilla descargable desde la misma pantalla (columnas: producto, variante, SKU, precio, stock). Stock importado genera movimiento `ajuste` con motivo "importación".
6. **Reportes** (solo dueño): ventas por día/rango, totales por medio de pago, productos más vendidos, alerta de stock bajo según umbral por producto, historial de cierres de caja con diferencias.
7. **Usuarios** (solo dueño): crear y desactivar empleados.

## Errores y casos borde

- **Stock insuficiente**: la venta se bloquea con aviso. No se permite stock negativo.
- **Venta sin caja abierta**: bloqueada; la UI ofrece abrir caja.
- **Anulación de venta**: solo dueño. Revierte stock mediante movimiento inverso (`anulacion`). La venta queda marcada como anulada, no se borra. Si la sesión de caja ya cerró, la anulación no modifica el cierre histórico (queda reflejada solo en reportes).
- **Producto/variante con ventas**: nunca se borra, se desactiva. Las ventas históricas lo siguen referenciando.
- **Concurrencia**: el descuento de stock se hace dentro de una transacción con verificación de stock disponible, para evitar sobreventa con dos cajas simultáneas.
- **Import con errores**: filas inválidas se marcan en el preview y se excluyen; el resto se importa. Nada se escribe hasta confirmar.

## Testing

Tests automáticos solo sobre lógica crítica:

- Descuento de stock transaccional al confirmar venta
- Bloqueo por stock insuficiente
- Anulación revierte stock correctamente
- Cierre de caja: cálculo de esperado y diferencia por medio de pago
- Import: validación de filas y upsert por SKU

UI sin tests automáticos en MVP.

## Fuera de alcance (posibles fases futuras)

Tickets/comprobantes, lector de código de barras, facturación fiscal (ARCA), multi-sucursal, gestión de proveedores/compras.
