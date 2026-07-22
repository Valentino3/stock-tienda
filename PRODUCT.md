# PRODUCT.md

Sistema de stock y ventas para un comercio: gestión de inventario, venta en
mostrador (POS), control de caja y reportes. Funciona en navegador, sin instalar.
Sirve tanto a comercio general (ropa, kiosco) como a tiendas de cartas (TCG) con
catálogos de miles de productos.

## Mecanismo único

Descuento de stock atómico y transaccional al vender, con control de caja
obligatorio: no se puede vender sin caja abierta, el stock nunca queda negativo,
y todo movimiento (venta, reposición, ajuste, anulación, importación) queda
auditado.

## Usuarios y escena real

- **Dueño:** acceso total (reportes, importación, usuarios, anulaciones).
- **Empleado:** vender, ver productos, operar caja, ver sus propias ventas.

Escena: mostrador de un comercio, en horario de atención, con luz de día y a
veces al apuro frente a un cliente. Se usa en computadora del mostrador y en
celular. Idioma: español (Argentina).

## Superficies (rutas)

- `/login` — ingreso.
- `/vender` — punto de venta: búsqueda instantánea, carrito, cobro.
- `/productos` — catálogo, variantes, stock, reposición/ajuste.
- `/ventas` — historial con filtros por fecha y vendedor; anulación (dueño).
- `/caja` — apertura y cierre con conteo y diferencia.
- `/importar` — carga masiva desde Excel con vista previa validada (dueño).
- `/reportes` — ventas por día, medios de pago, top productos, stock bajo,
  cierres de caja; KPIs del período (dueño).
- `/usuarios` — alta y activación de cuentas (dueño).

## Restricciones

- Marca: `BUSINESS_NAME` es placeholder ("Mi Comercio") hasta que el cliente
  defina nombre real. Fuente única en `src/lib/config.ts`.
- Sin modo oscuro (decisión de producto). Sin lector de código de barras, sin
  facturación fiscal, sin multi-sucursal.
- Permisos verificados siempre en servidor, no solo ocultos en pantalla.

## Modo

Operate. La tarea, el estado y la cifra correcta mandan sobre la expresión; la
marca vive en el detalle.
