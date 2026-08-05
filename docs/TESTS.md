# Tests

Dos capas, con trabajos distintos.

## Dominio (vitest + PGlite) — `npm test`

572 tests contra una base Postgres en memoria que replica todas las
migraciones (`tests/helpers/db.ts`). Cubren la lógica: qué pasa al cobrar, al
anular, al sincronizar, al facturar. Son rápidos y es donde va casi todo.

No pueden ver si la interfaz está conectada. Un formulario que le pasa mal los
datos a una acción, o una página que ni siquiera renderiza, pasan verdes.

## Navegador (Playwright) — `npm run e2e`

10 tests que recorren los caminos de plata en una app real: servicio de
restaurante completo, venta de mostrador, y que el arqueo cierre con el número
correcto.

Son pocos a propósito. Un E2E que se rompe porque cambió una etiqueta es un
E2E que en dos meses nadie mira. Estos fallan cuando algo que cobra plata
dejó de funcionar.

### Correrlos

Requiere Docker andando.

```bash
npm run e2e          # levanta Postgres, siembra y corre todo
npm run e2e:ui       # lo mismo, con la interfaz de Playwright
npm run e2e:db:down  # apaga y borra la base
```

La primera vez: `cp .env.e2e.example .env.e2e` y
`npx playwright install chromium`.

### Contra qué base corren

Contra un Postgres de Docker, **nunca contra Neon**. `scripts/seed-e2e.ts`
hace TRUNCATE de todas las tablas, y apuntarlo a producción vaciaría los dos
locales que venden todos los días. El script se niega a correr si
`DATABASE_URL` no es local.

Eso es lo que motivó el switch de driver de `src/db/index.ts`: con
`DB_DRIVER=pg` la app habla por TCP con un Postgres común en vez de por
WebSocket con Neon. Los dos drivers son intercambiables de verdad
—`@neondatabase/serverless` es un fork de node-postgres— así que el
`FOR UPDATE` de la caja y el `pg_advisory_xact_lock` de la numeración fiscal
significan lo mismo de los dos lados.

### Cómo están armados

- **La base se siembra en cada corrida**, desde `e2e/global-setup.ts`. Si
  sembrar fuera un paso de npm aparte, correr `playwright test` a secas
  —que es lo que uno hace mientras arregla un test— arrancaría sobre lo que
  dejó la corrida anterior: mesas ocupadas, stock descontado, caja cerrada.
- **Serial, un solo worker.** Los tests comparten base: en paralelo se
  pisarían el stock, la caja abierta y la numeración de comprobantes.
- **El login se hace una vez** y la sesión se guarda en disco
  (`e2e/auth.setup.ts`). Además de ser más rápido, evita que better-auth corte
  por exceso de intentos: a partir del cuarto login devuelve "Email o
  contraseña incorrectos" con credenciales correctas.
- **Build de producción, no `dev`.** En dev, Next compila cada ruta en el
  primer acceso y el primer clic de cada pantalla tarda segundos.

### Cuentas de prueba

Las siembra `scripts/seed-e2e.ts`:

| Rubro | Email | Contraseña |
|-|-|-|
| Gastronomía | `resto@test.local` | `test1234` |
| Retail | `cartas@test.local` | `test1234` |

El restaurante viene con carta (tres platos sin stock y un vino que sí lleva),
seis mesas en dos sectores y un cliente de cuenta corriente.

### Qué agregar y qué no

Agregá un E2E cuando el camino toca plata y cruza varias pantallas. Todo lo
demás —validaciones, cálculos, reglas— va en un test de dominio, que corre en
milisegundos y no depende de un navegador.

## CI

Los dos corren en GitHub Actions. El job `navegador` depende de `verificar`:
si el typecheck ya falló, no tiene sentido levantar una base y un navegador.
Cuando un E2E falla, el reporte HTML con capturas, video y traza queda como
artifact de la corrida.
