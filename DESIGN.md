# DESIGN.md — "Libro mayor"

Mundo visual de la app de stock/ventas. Modo Operate.

## THESIS

Los números SON la interfaz. Plata, stock, SKU y fechas se leen como un libro
mayor: cifras tabulares alineadas en las que se puede confiar de un vistazo.
Rechaza la grilla de cards grises iguales del default de shadcn.

## OWN-WORLD

- **Fondo:** casi-blanco frío (no blanco puro). Superficies con reglas finas de
  1px antes que cards con sombra.
- **Tinta:** primarios (botones de acción) en negro tinta, no en color.
- **Acento:** cobalto. Vive en el detalle — foco, ítem de nav activo, enlaces,
  cifra destacada de un KPI, medio de pago seleccionado. Nunca baña regiones.
- **Semántica:** esmeralda = caja cuadra / ok; rojo = diferencia / stock bajo /
  destructivo. El acento cobalto no compite con estas.
- **Tipografía:** Geist Sans para UI. Geist Mono, `tabular-nums`, para TODA
  cifra (plata, stock, SKU, cantidades, fechas de datos). Números alineados a la
  derecha en tablas.
- **Gramática de sección:** etiqueta chica en mayúscula con tracking (estilo
  ticket/libro mayor) como encabezado de sección de datos. Es el sistema elegido,
  no un eyebrow decorativo — se usa consistente, no en cada bloque suelto.

## Estrategia de color

Restrained: neutros fríos + un acento (cobalto) + dos semánticos (esmeralda,
rojo). Claro, no oscuro: la escena es un mostrador de día. Sin modo oscuro por
decisión de producto.

## Tokens (asentados tras el primer build)

Definidos en `src/app/globals.css`. Radio base 0.625rem. Fuentes Geist
Sans/Mono ya cargadas en `src/app/layout.tsx`.

## Reglas durables

- Cifras siempre en mono tabular; plata formateada es-AR (`src/lib/format.ts`).
- Tablas: encabezado en etiqueta mayúscula tracked; columnas numéricas a la
  derecha; hover de fila sutil; sin zebra pesada.
- KPIs: cifra grande en mono con regla superior fina, no card con sombra y
  acento. Evitar la plantilla hero-métrica.
- Estados vacíos redactados en el idioma del negocio, no "sin datos".
- Foco visible en cobalto en todo control (teclado).
