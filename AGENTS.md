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

**Después de desplegar: `npm run check:prod`.** Solo lectura.
Reemplaza el "entrá al local y vendé algo a ver si anda": revisa migraciones
sin aplicar, que los índices únicos parciales sigan existiendo, y las
corrupciones que esos índices previenen (dos cajas abiertas, comprobantes o
remitos con número repetido, dos comandas en una mesa). Los índices no los
puede ver ningún test, porque el schema no los modela: la única forma de saber
si siguen ahí es mirar la base.

Revisa además lo que ningún índice puede expresar: que toda venta tenga sus
pagos y que sumen su total (`sale_payments`), y que la parte fiada coincida con
el cargo en la cuenta del cliente. Una venta sin pagos no aporta al arqueo y
aparece como un faltante que nadie explica.

**Para probar contra producción está la tienda de prueba, no un local real.**
`npm run seed:prueba OWNER_PASSWORD=…` la crea en la misma base, marcada con `stores.esPrueba`.
Esa marca no es cosmética: `requireFiscalConfig` **rechaza emitir en ambiente
producción** desde una tienda de prueba. El kill switch `ARCA_ALLOW_PRODUCCION`
es del servidor entero y en producción está en `true`, así que sin esa guarda
una prueba emitiría una factura real ante ARCA, y eso se deshace con una nota
de crédito, no con un `delete`. Para vaciarla:
`npm run reset:prueba STORE_SLUG=… CONFIRMAR=…`, que exige el slug dos veces y
se niega a tocar una tienda sin la marca.

**Los scripts aceptan `CLAVE=valor` como argumento**, no solo como variable de
entorno: este repo se opera desde PowerShell, donde el prefijo `FOO=bar comando`
de bash no existe y npm lo reenvía como argumento suelto. Ver
`scripts/argv-env.ts`. Si agregás un script que pida variables, llamá a
`leerArgsComoEnv()` o el primero que lo use desde PowerShell va a ver un "falta
FOO" que no explica nada.

**Las invariantes de plata van como propiedades, no como ejemplos.** Los
`tests/propiedades-*.test.ts` generan las entradas con fast-check en vez de
enumerarlas: el arqueo se compara contra un modelo escrito aparte sobre
secuencias de operaciones al azar, y el prorrateo del descuento fiscal contra
su post-condición `Σ = S − D`. Si agregás algo que suma o resta plata, la
propiedad es más barata y más completa que veinte casos a mano.

**La plata por medio de pago sale de `sale_payments`, no de
`sales.paymentMethod`.** Una venta puede cobrarse con varios medios a la vez.
`sales.paymentMethod` guarda el predominante y sirve para mostrar: si lo usás
para sumar, la parte de tarjeta termina dentro del efectivo esperado. Las
cuatro agrupaciones por medio (`cash.ts`, `cash-close.ts`, `caja/page.tsx`,
`reports.ts`) ya leen de la tabla; el `aCuenta` de `getSellerSalesSummary` va
en consulta aparte a propósito, porque esa query ya tiene un `leftJoin` a
`sale_items` y otro join más multiplicaría filas e inflaría el total del
vendedor.

**`sales.sellerId` es a quién se le acredita; `registeredBy`, quién la anotó.**
La comisión se paga sobre el primero y el vendedor se elige en el mostrador, así
que `createSale` valida que sea un usuario activo de esa tienda. Los
movimientos de stock y los asientos en cuenta corriente cuelgan del segundo: el
libro de stock responde quién movió la mercadería.

**Esto cobra plata de verdad.** Dos locales venden con esto todos los días.
Antes de tocar `src/domain/sales.ts`, `cash.ts`, `pagos.ts`, `fiscal-*.ts` o
`src/lib/offline/*`, mirá los tests que los cubren: un error ahí es un arqueo
que no cuadra o un comprobante fiscal que no se puede anular.
