<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Reglas de este repo

**Nunca corras `drizzle-kit push`.** Solo `npm run migrate`. Hay índices únicos
parciales que `src/db/schema.ts` no modela (`cash_sessions_one_open_idx` y los
tres `comprobantes_*` de `drizzle/0015`); `push` los borra en silencio y el
daño aparece días después como dos cajas abiertas o dos comprobantes con el
mismo número.

**Las migraciones escritas a mano van también en `drizzle/meta/_journal.json`.**
`tests/helpers/db.ts` replica todos los `.sql` de la carpeta, así que una
migración sin entrada en el journal pasa todos los tests y nunca se aplica en
producción.

**Esto cobra plata de verdad.** Dos locales venden con esto todos los días.
Antes de tocar `src/domain/sales.ts`, `cash.ts`, `fiscal-*.ts` o
`src/lib/offline/*`, mirá los tests que los cubren: un error ahí es un arqueo
que no cuadra o un comprobante fiscal que no se puede anular.
