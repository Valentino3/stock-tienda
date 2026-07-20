# Rediseño de UI — Diseño

**Fecha:** 2026-07-20
**Estado:** Aprobado

## Objetivo

Mejorar la interfaz visual y la experiencia de uso de las 8 pantallas existentes (Login, Vender, Productos, Ventas, Caja, Importar, Reportes, Usuarios), sin cambiar comportamiento de servidor, roles, ni flujos de datos ya validados. Es una capa de presentación + fricción reducida, no una feature nueva.

## Alcance

- **Tipo de mejora**: visual (colores, tipografía, espaciado, jerarquía) + UX (flujo, feedback, atajos).
- **Dispositivo**: responsive parejo — uso mitad mobile, mitad desktop/notebook.
- **Identidad**: sin marca definida todavía. Paleta neutra profesional genérica, fácil de re-themear después si aparece una marca.
- **Cobertura**: las 8 pantallas en un solo pase, con un sistema de diseño común.

## Sistema de componentes

**shadcn/ui** sobre Tailwind (ya instalado). Los componentes se copian al repo (`src/components/ui/`), no son una dependencia de caja negra — quedan editables como cualquier código propio. Resuelve de entrada accesibilidad y estados (foco/disabled/hover) para primitivas que hoy son HTML plano: diálogos modales, selects, badges, tablas.

Componentes a instalar según necesidad de cada pantalla: `button`, `input`, `dialog`, `select`, `table`, `badge`, `card`, `sheet` (drawer mobile para el nav), `sonner` (toasts).

## Navegación

- **Desktop**: sidebar fija a la izquierda con links + íconos.
- **Mobile**: sidebar oculta detrás de un botón de menú (hamburguesa), se abre como panel deslizante (`Sheet`).
- Mismo gate de roles que hoy (Importar/Reportes/Usuarios solo owner) — el gate ya es server-side, esto es solo su representación visual.
- Header: nombre del negocio (placeholder), usuario logueado, botón salir.

## Color y tipografía

- **Paleta neutra** (grises de fondo/texto/borde) + **un color de acento** para acciones primarias, elegido para no chocar con los colores semánticos de alerta.
- **Colores semánticos reservados**, nunca usados para UI normal:
  - Rojo: alertas (stock bajo, diferencia de caja ≠ 0, errores)
  - Verde: éxito / diferencia de caja $0
  - Ámbar: advertencia (venta anulada, estados pendientes)
- **Tipografía**: Geist (ya viene con el scaffold de Next.js), con jerarquía clara: título de pantalla grande/negrita, subtítulos de sección medianos, texto de tabla legible.
- **Espaciado**: más aire que el estado actual (hoy muy compacto/utilitario) — padding real en cards, separación clara entre secciones.

## Mejoras de UX por pantalla

Mismos flujos, mismos datos, mismo comportamiento de servidor — solo se retoca cómo se ven y se sienten:

- **Login**: tarjeta centrada con el sistema visual nuevo.
- **Vender**: layout tipo caja registradora — buscador y resultados a un lado, carrito y total bien visibles al otro (o abajo en mobile). Cantidad con botones +/− en vez de input numérico crudo. Confirmación de venta como toast en vez de texto plano.
- **Productos**: edición en diálogo modal (`Dialog`) en vez de panel inline que empuja el layout. Stock bajo con badge rojo. Buscador sobre la lista.
- **Ventas**: mantiene expandir-para-detalle (comportamiento ya establecido). Suma atajos de fecha (Hoy / Esta semana) además de los inputs manuales. Badge de color para estado (Activa/Anulada).
- **Caja**: estado abierta/cerrada como tarjeta con indicador de color. Diferencia de cierre grande y coloreada (verde $0 / rojo ≠ 0).
- **Importar**: preview más legible: tabla con el mismo componente `table` del sistema, botón de confirmar fijo mientras se scrollea.
- **Reportes**: sigue siendo solo tablas (decisión ya tomada en el diseño original del MVP — sin gráficos). Se agregan tarjetas resumen (`card`) arriba de las tablas para lectura rápida (total del período, cantidad de productos con stock bajo, etc.).
- **Usuarios**: badges de estado (Activo/Desactivado), confirmación antes de desactivar (ya existe la lógica de bloqueo de autodesactivación; esto es solo la confirmación visual).

## Fuera de alcance

- Identidad de marca real (nombre/logo/colores del negocio) — placeholder por ahora.
- Dark mode — no es prioridad; shadcn deja la base de variables CSS lista para agregarlo después sin retrabajo.
- Gráficos en Reportes — decisión ya tomada de mantener solo tablas.
- Cualquier cambio de comportamiento de servidor, validaciones, roles o lógica de negocio — esto es puramente visual/UX.

## Testing

Sin tests automáticos nuevos (es una capa de presentación sobre lógica ya testeada). Verificación manual con `npm run dev` recorriendo las 8 pantallas en ambos roles (dueño/empleado) y en viewport mobile y desktop.
