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
| Productos | Únicos, sin variantes (talles se cargan como productos separados) |

## Stack

- **Next.js** (App Router) desplegado en **Vercel**
- **Postgres** serverless en **Neon**
- **Drizzle ORM**
- **better-auth** para autenticación (email + contraseña)
- Mutaciones vía **Server Actions** — sin API REST separada
- Responsive: usable desde celular

## Autenticación y roles

Sin registro público. El dueño crea las cuentas de empleados.

- **Empleado**: vender, ver productos, ver sus propias ventas.
- **Dueño (owner)**: todo lo anterior + editar productos/stock, anular ventas, reportes, gestión de usuarios.

## Modelo de datos

- **users**: nombre, email, hash de contraseña, rol (`owner` | `employee`), activo/inactivo
- **products**: nombre, SKU (opcional, único), precio, stock actual, umbral de stock bajo, activo/inactivo
- **sales**: fecha, vendedor (user), total, medio de pago (`efectivo` | `transferencia` | `tarjeta`), anulada (bool)
- **sale_items**: venta, producto, cantidad, precio unitario al momento de la venta (el histórico no cambia si cambia el precio)
- **stock_movements**: producto, tipo (`venta` | `reposicion` | `ajuste` | `anulacion`), cantidad ±, fecha, user, venta asociada si aplica, motivo (para ajustes)

Regla: **todo movimiento de stock pasa por `stock_movements`**. Auditoría completa desde el día 1.

## Pantallas

1. **Vender** (pantalla principal): buscador por nombre/SKU, carrito, selección de medio de pago, confirmar. La venta descuenta stock en una transacción atómica.
2. **Productos**: lista con stock actual, alta/edición, reposición rápida (+N unidades), ajuste manual con motivo.
3. **Ventas**: historial con filtros por fecha/vendedor, detalle de cada venta, anular venta (solo dueño, devuelve stock).
4. **Reportes** (solo dueño): ventas por día/rango, totales por medio de pago, productos más vendidos, alerta de stock bajo según umbral por producto.
5. **Usuarios** (solo dueño): crear y desactivar empleados.

## Errores y casos borde

- **Stock insuficiente**: la venta se bloquea con aviso. No se permite stock negativo.
- **Anulación de venta**: solo dueño. Revierte stock mediante movimiento inverso (`anulacion`). La venta queda marcada como anulada, no se borra.
- **Producto con ventas**: nunca se borra, se desactiva. Las ventas históricas lo siguen referenciando.
- **Concurrencia**: el descuento de stock se hace dentro de una transacción con verificación de stock disponible, para evitar sobreventa con dos cajas simultáneas.

## Testing

Tests automáticos solo sobre lógica crítica:

- Descuento de stock transaccional al confirmar venta
- Bloqueo por stock insuficiente
- Anulación revierte stock correctamente

UI sin tests automáticos en MVP.

## Fuera de alcance (posibles fases futuras)

Tickets/comprobantes, lector de código de barras, variantes de producto, importación desde Excel, facturación fiscal (ARCA), multi-sucursal, gestión de proveedores/compras, cierre de caja.
