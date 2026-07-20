# TCG: Catálogo Estructurado + Performance a Escala — Diseño

**Fecha:** 2026-07-20
**Estado:** Aprobado

## Objetivo

Reorientar `stock-tienda` (hoy un sistema genérico de stock/ventas para comercio chico) a una tienda de TCG (trading card game) que vende **cartas sueltas y producto sellado**, resolviendo dos problemas de fondo:

1. **Escala**: de decenas de productos a **miles de variantes** (2.000-20.000 SKUs típico de un TCG con varios sets). Búsqueda con `ilike` sin índices, listado de Productos sin paginar, historial de Ventas sin límite e import fila-por-fila fueron escritos para catálogos chicos y no escalan a ese volumen sin cambios concretos.
2. **Estructura del catálogo**: hoy una variante es solo `nombre` (texto libre) + `sku` + `precio` + `stock`. Una carta suelta necesita **set, condición (NM/LP/MP/HP/DMG), foil, idioma** como atributos reales y filtrables — no convenciones de texto libre tipo `"Charizard Base Set NM Foil"` metidas en un solo campo.

## Decisiones de alcance

| Decisión | Elección |
|---|---|
| Atributos de carta | Campos reales (no texto libre) |
| Buylist/trade-in (comprarle al cliente) | Fuera de alcance por ahora |
| Escala esperada | Miles de variantes (2.000-20.000) |
| Entrega | Un solo plan, todo junto |
| Filtro condición/foil en Vender | No en esta vuelta (YAGNI) — solo texto libre extendido |
| Productos inactivos | Se siguen mostrando con badge, sin cambio de comportamiento |
| Historial completo de Ventas | Ventana default de 30 días + link explícito "Ver todo el historial" |

## Modelo de datos

`products.name` = nombre de la carta; `productVariants` = impresión específica (set/condición/foil/idioma/sku/precio/stock). Ya es el patrón existente (un producto "Remera" con variantes por talle) — para TCG, un producto "Charizard" agrupa sus variantes por set+condición+foil+idioma. Producto sellado (booster box, deck) es simplemente un producto con una sola variante default, igual que hoy para productos sin variantes reales.

### Migración (`productVariants`, aditiva, sin backfill)

- `setName: text` (nullable)
- `condition: text` (nullable) — valores curados sugeridos vía `<datalist>`, no un enum rígido: NM/LP/MP/HP/DMG/Sellado/Abierto
- `foil: boolean` NOT NULL DEFAULT false
- `language: text` (nullable) — sugeridos: EN/ES/JP

## Arquitectura de índices de búsqueda

Postgres no puede usar un índice btree común para `ilike '%term%'` (comodín al inicio). Se usa **`pg_trgm` + índices GIN trigram** sobre las columnas de texto libre buscadas (`products.name`, `productVariants.sku`, `productVariants.name`, `productVariants.set_name`), y **btree simple** sobre columnas de baja cardinalidad usadas como filtro exacto (`condition`, `foil`, `language`). Se descarta full-text search (`tsvector`) porque nombres de carta y SKUs no son prosa — trigram tolera coincidencias parciales/typos mucho mejor para este caso.

Drizzle no puede generar `CREATE EXTENSION` ni `USING gin (... gin_trgm_ops)` — se necesita un archivo de migración SQL escrito a mano, siguiendo el precedente ya existente en el repo (`drizzle/0002_cash_sessions_one_open_idx.sql`).

**Riesgo a verificar**: PGlite (tests) puede aceptar la sintaxis de `CREATE EXTENSION`/`CREATE INDEX ... USING gin` sin error, pero eso solo prueba que el DDL es válido — no que el planner realmente elija el índice en vez de un `Seq Scan`. Verificar con `EXPLAIN ANALYZE` contra Neon real con datos sembrados (~5.000-20.000 filas) antes de confiar en la mejora.

## Alcance por área

### Búsqueda en Vender
Extraer `searchVariants` (hoy inline en `src/app/(app)/vender/actions.ts`) a una función de dominio testeable en `src/domain/catalog.ts`. Extender la búsqueda para incluir `productVariants.name` (gap real: hoy no se busca por nombre de variante) y `productVariants.setName`. Proyectar `setName`/`condition`/`foil` para mostrar en el resultado ("Charizard — Base Set NM Foil EN"). Firma externa y `.limit(20)` sin cambios.

### Productos
Formulario de variante (`product-form.tsx`, `variant-row.tsx`) gana inputs para Set/Condición/Idioma (con `<datalist>` de sugerencias) y checkbox Foil — todos opcionales, no rompen productos no-carta. Badges condicionales en la fila de variante.

Listado (`page.tsx`/`product-list.tsx`) pasa de "traer todo + filtrar client-side" a paginación server-side vía `searchParams` (`?q=&page=`), mismo patrón que ya usa Ventas. Paginación a nivel de producto (no de fila post-join), página de 50, offset (no keyset — sobre-ingeniería a esta escala).

### Import Excel
`ImportRow`/`ValidatedRow` ganan `setName?`/`condition?`/`foil?`/`language?` opcionales (no rompen el helper de tests existente). Plantilla, parseo de celdas y preview se extienden en consecuencia.

En paralelo, `executeImport` pasa de ~2-3 round-trips secuenciales por fila (riesgo real de timeout serverless con 2.000-10.000 filas) a inserts/updates en lote (`insert().values([...])` multi-fila, `UPDATE ... FROM (VALUES ...)` para precios). `applyStockMovement` por fila se mantiene solo donde su guarda atómica protege algo real (actualizaciones concurrentes); los movimientos de stock por creación nueva se insertan en lote directamente. Firma externa sin cambios.

### Reportes
`getTopProducts`/`getLowStock` ganan `setName?` opcional (aditivo). UI gana input de texto libre para filtrar por set y columna nueva en las tablas.

### Ventas
Ventana default de 30 días cuando no hay filtro de fecha (con link para verlo todo), más paginación (página de 50) — el fan-out a `saleItems` hereda el límite automáticamente.

## Testing

Los 27 tests existentes deben seguir en verde (compatibilidad hacia atrás garantizada por campos opcionales/aditivos). Tests nuevos por área: schema (columnas nuevas), catálogo (búsqueda extendida), import (batching con ~100-200 filas sintéticas), reportes (`tests/reports.test.ts`, no existe hoy — gap encontrado en la investigación).

## Fuera de alcance

Buylist/trade-in (compra de cartas a clientes), filtros de condición/foil como chips en Vender, tabla de referencia rígida de sets/juegos, paginación keyset, background jobs para import (se prefiere batching dentro de la misma transacción salvo que la medición real muestre que no alcanza).
