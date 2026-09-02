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
producción. Lo verifica `tests/migraciones-journal.test.ts`.

**Antes de abrir un PR: `npm run verificar`.** Corre tsc, lint, los tests y el
build de una. Es lo mismo que corre CI.

**Después de desplegar: `DATABASE_URL=… npm run check:prod`.** Solo lectura.
Reemplaza el "entrá al local y vendé algo a ver si anda": revisa migraciones
sin aplicar, que los índices únicos parciales sigan existiendo, y las
corrupciones que esos índices previenen (dos cajas abiertas, comprobantes o
remitos con número repetido, dos comandas en una mesa). Los índices no los
puede ver ningún test, porque el schema no los modela: la única forma de saber
si siguen ahí es mirar la base.

**Las invariantes de plata van como propiedades, no como ejemplos.** Los
`tests/propiedades-*.test.ts` generan las entradas con fast-check en vez de
enumerarlas: el arqueo se compara contra un modelo escrito aparte sobre
secuencias de operaciones al azar, y el prorrateo del descuento fiscal contra
su post-condición `Σ = S − D`. Si agregás algo que suma o resta plata, la
propiedad es más barata y más completa que veinte casos a mano.

**Esto cobra plata de verdad.** Dos locales venden con esto todos los días.
Antes de tocar `src/domain/sales.ts`, `cash.ts`, `fiscal-*.ts` o
`src/lib/offline/*`, mirá los tests que los cubren: un error ahí es un arqueo
que no cuadra o un comprobante fiscal que no se puede anular.
