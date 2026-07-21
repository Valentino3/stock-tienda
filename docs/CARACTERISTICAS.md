# Sistema de Stock y Ventas — Características

Sistema web para gestión de stock, ventas y caja de un comercio. Funciona desde cualquier navegador (computadora o celular), sin instalar nada. Pensado tanto para comercio general (ropa, kiosco, etc.) como para tiendas de cartas (TCG), con catálogos de miles de productos.

---

## Qué resuelve

- Saber en todo momento qué stock hay y a qué precio.
- Vender rápido en el mostrador descontando stock automáticamente.
- Controlar la caja: cuánto entró, por qué medio de pago, y si cuadra al cerrar.
- Ver reportes de ventas y productos sin planillas manuales.
- Cargar catálogos grandes de una vez desde Excel.

---

## Características por área

### Ventas (mostrador / punto de venta)
- Búsqueda instantánea de productos por nombre o código (SKU) mientras se escribe.
- Carrito con cantidades ajustables (botones + / −).
- Cobro por efectivo, transferencia o tarjeta.
- Descuento de stock automático y atómico al confirmar (nunca deja stock negativo).
- Aviso inmediato si no hay stock suficiente.
- Bloqueo de venta si no hay caja abierta (evita ventas sin control de caja).
- Confirmación visual de cada venta con número y total.

### Productos y stock
- Productos con múltiples variantes (ej: talles, colores; o en TCG: set, condición, foil, idioma).
- Precio por producto, con opción de precio propio por variante.
- Reposición rápida de stock y ajuste manual con motivo (queda auditado).
- Umbral de stock bajo configurable por producto, con alerta visual.
- Buscador con paginación: funciona fluido aunque haya miles de productos.
- Los productos nunca se borran, se desactivan (no se pierde el histórico de ventas).

### Atributos de carta (TCG)
- Campos reales de set, condición (NM/LP/MP/HP/DMG), foil e idioma por variante.
- Búsqueda por cualquiera de esos campos (ej: encontrar todas las cartas de un set).
- Preparado para catálogos de miles de cartas con búsqueda indexada rápida.

### Caja
- Apertura de caja con monto inicial en efectivo.
- Cierre con conteo: el sistema calcula lo esperado por cada medio de pago y muestra la diferencia (verde si cuadra, rojo si no).
- Historial de cierres con sus diferencias.
- Una sola caja abierta a la vez, garantizado a nivel base de datos.

### Historial de ventas
- Listado de todas las ventas con filtros por fecha y vendedor.
- Atajos rápidos: "Hoy" / "Esta semana".
- Detalle de cada venta (productos, cantidades, precios).
- Anulación de ventas (solo dueño): devuelve el stock automáticamente.
- Muestra por defecto los últimos 30 días, con opción de ver todo el historial.

### Reportes (solo dueño)
- Ventas por día y totales por medio de pago.
- Top 10 productos más vendidos.
- Productos con stock bajo.
- Historial de cierres de caja con diferencias.
- Filtro por set (para tiendas TCG).
- Tarjetas resumen: total del período, productos con stock bajo, cierres con diferencia.

### Importación desde Excel
- Carga masiva de productos desde una planilla `.xlsx`.
- Plantilla descargable lista para usar.
- Vista previa con validación fila por fila antes de confirmar (marca errores).
- Actualización o creación por código: re-importar actualiza precio/stock sin duplicar.
- Optimizado para importar miles de filas de una sola vez.

### Usuarios y roles
- Dos roles: **Dueño** (acceso total) y **Empleado** (vender, ver productos, caja, sus propias ventas).
- El empleado no ve reportes, importación, ni gestión de usuarios.
- El dueño crea las cuentas de empleados (sin registro público abierto).
- Activar/desactivar usuarios (no se borran).
- Cada control de permiso se valida en el servidor, no solo se oculta en pantalla.

---

## Aspectos técnicos (para tranquilidad)

- **Interfaz moderna y responsive**: se ve y funciona bien en computadora y celular.
- **Seguridad**: contraseñas hasheadas, sesiones seguras, permisos verificados en servidor.
- **Integridad de datos**: las operaciones de stock y caja son transaccionales — o se completan enteras o no se hacen, nunca a medias.
- **Auditoría de stock**: todo movimiento (venta, reposición, ajuste, anulación, importación) queda registrado.
- **Probado**: la lógica de negocio (ventas, stock, caja, import) tiene tests automáticos.
- **Español (Argentina)**: toda la interfaz.

---

## No incluye (por ahora)

- Facturación electrónica / ARCA (comprobantes internos, no fiscales).
- Lector de código de barras (se puede sumar).
- Compra de productos a clientes (buylist / trade-in en TCG).
- Múltiples sucursales.
- Modo oscuro.

Estos puntos quedan como posibles extensiones futuras.
