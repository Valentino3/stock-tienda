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

Restrained: neutros fríos + un acento (cobalto) + tres semánticos (esmeralda,
ámbar, rojo). Claro, no oscuro: la escena es un mostrador de día. **Sin modo
oscuro por decisión de producto** — y por eso no hay bloque de tokens `.dark`.
La línea `@custom-variant dark` de `globals.css` se queda igual: sin ella,
`dark:` vuelve al default de Tailwind (`prefers-color-scheme`) y cualquier
resto perdido se activaría solo en la máquina de quien tenga el sistema en
oscuro.

## Tokens

Definidos en `src/app/globals.css`. Fuentes Geist Sans/Mono cargadas en
`src/app/layout.tsx` con `display: "optional"` — con el `swap` por defecto,
cada cifra cambia de ancho al terminar de cargar y la tabla entera salta.

**Dos niveles de borde, y es de donde sale la densidad.** `--border` separa
(contenedores, filas de tabla). `--border-strong` estructura: inputs, el borde
del encabezado de tabla contra su cuerpo, el de la fila de totales. El ojo saca
jerarquía de dos grises sin que aparezca una sola línea gruesa.

**`--warning`** existe para "esperando / demorado / atención". Antes ese papel
lo hacía `--chart-3`, que es un token de gráficos: un aviso y una serie de un
gráfico quedaban atados al mismo color sin querer.

**Radio 0.28rem**: 4.5px en controles, 6.3px en superficies. Antes era
0.625rem, que daba 14px por card — redondez de panel de administración, no de
libro mayor.

## Reglas durables

- Cifras siempre en mono tabular, con la clase `.figure` y **nunca**
  `font-mono` suelto: `.figure` agrega el tracking y el `tabular-nums` que la
  utilidad de Tailwind no trae. Plata formateada es-AR (`src/lib/format.ts`).
  Incluye las cuatro hojas de papel: en la columna de importes de una factura,
  la alineación es lo único que la hace legible.
- Diferencias y saldos con `moneyDiff`: el negativo va entre paréntesis, como
  en el resumen del banco. En una columna de importes un "−" se confunde con
  un separador.
- **Superficies con borde, nunca con sombra.** La sombra queda reservada para
  las dos hojas de papel en pantalla, que es lo que las hace parecer papel.
  Toda superficie de datos es `<Panel>`; `flush` cuando envuelve una tabla.
- Tablas: encabezado en etiqueta mayúscula tracked sobre fondo tenue, con
  borde fuerte contra el cuerpo; fila de totales con la gramática espejada;
  columnas numéricas a la derecha; hover un paso MÁS oscuro que el encabezado.
  Zebra solo en tablas anchas (`<Table zebra>`, hoy solo /productos): DESIGN.md
  prohíbe la zebra *pesada*, no la zebra.
- KPIs: cifra grande en mono con regla superior fina, no card con sombra y
  acento. Evitar la plantilla hero-métrica. **El color solo se gasta cuando hay
  algo que mirar**: un cero en verde hace levantar la vista para leer que no
  pasa nada.
- Estados vacíos con `<EmptyState>`, redactados en el idioma del negocio, no
  "sin datos". Distinguir vacío de verdad (punteado, "todavía no hay clientes")
  de vacío por filtro (borde sólido, "limpiar filtros"): decir "no hay nada"
  cuando hay 400 productos y el filtro está mal puesto es el peor caso.
  `size="sm"` para el vacío de una sección entre varias — el remedio se ofrece
  una vez, donde está el filtro, no seis veces en la misma pantalla.
- Errores: caja `<Notice tone="danger">` para lo que falla en un formulario;
  texto al lado del control para lo que falla en un campo. Siempre `role="alert"`.
- Foco visible en cobalto en todo control (teclado).

## Trampas

- **`loading.tsx` va por ruta, nunca en `(app)`.** El límite de Suspense hace
  que la pantalla aparezca antes de que React hidrate. En una pantalla de
  consulta no importa; en /caja y /vender sí: se puede tipear en un input
  controlado antes de la hidratación, el valor queda en el DOM pero no en el
  estado, y al hidratar React lo pisa con el vacío — o sea cerrar el arqueo con
  el efectivo contado en cero.
- **`min-w-0` en el `<main>`.** Un hijo de flex arranca en `min-width: auto` y
  se niega a achicarse por debajo de su contenido: sin eso, una tabla ancha
  empuja el documento entero y aparece scroll horizontal en toda la página.
- Ningún control nuevo con clases a mano: `Input`, `Select` y `Textarea` traen
  `text-base md:text-sm`, que es lo que evita que Safari en iPhone haga zoom al
  enfocar.
