# Deploy a Vercel (demo)

Guía para poner la app online. El stack (Next.js + Neon) está hecho para Vercel; el deploy es directo. La app es **multi-tienda**: cada tienda es un tenant aislado; un super-admin de plataforma crea tiendas y dueños. La base Neon ya tiene aplicadas las migraciones `0007` (multi-tienda) y `0008` (clientes/fiado), y las cuentas de prueba (ver "Login de la demo").

## Requisitos previos (una sola vez, los hacés vos)

```bash
npm i -g vercel      # instala el CLI de Vercel (ya instalado)
vercel login         # login por navegador (OAuth) — no se puede automatizar
```

## Pasos

Desde la raíz del proyecto (`stock-tienda`):

```bash
# 1. Vincular / crear el proyecto en Vercel (elegí crear uno nuevo cuando pregunte)
vercel link

# 2. Cargar las variables de entorno para producción.
#    Cada comando pide el valor de forma interactiva (lo pegás):
vercel env add DATABASE_URL production
#    → pegar el mismo valor que está en .env.local (la connection string de Neon)

vercel env add BETTER_AUTH_SECRET production
#    → pegar el mismo valor que está en .env.local

vercel env add OPENAI_API_KEY production
#    → tu API key de OpenAI (import de facturas con IA). Sin esto, el import IA falla;
#      el resto de la app anda igual.

vercel env add BETTER_AUTH_URL production
#    → dejarlo pendiente por ahora: no conocés el dominio hasta el primer deploy.
#      Opción simple: hacé el paso 3 primero, anotá el dominio que te da
#      (ej. https://stock-tienda-xxxx.vercel.app), y recién ahí corré este
#      comando con ese valor, y volvé a deployar (paso 3 de nuevo).

# 3. Deploy a producción
vercel --prod
```

> **Migraciones**: si producción usa la MISMA base Neon que `.env.local`, ya están
> aplicadas (0007 + 0008). Si es otra base, corré `npx drizzle-kit migrate` apuntando
> a esa `DATABASE_URL` antes del primer deploy.

Al terminar, Vercel imprime la URL pública (algo como `https://stock-tienda-xxxx.vercel.app`). Esa es la demo.

## Orden recomendado para BETTER_AUTH_URL (evita el huevo-y-gallina)

1. `vercel link`
2. `vercel env add DATABASE_URL production`, `vercel env add BETTER_AUTH_SECRET production`, `vercel env add OPENAI_API_KEY production`
3. `vercel --prod` → anotá la URL que devuelve
4. `vercel env add BETTER_AUTH_URL production` → pegá esa URL (con `https://`, sin barra final)
5. `vercel --prod` de nuevo → ahora el login queda 100% correcto

## Login de la demo

Cuentas de prueba ya creadas en Neon (password de todas: `testing1234`):

| Cuenta | Rol | Tienda |
|---|---|---|
| `duenioztg@testing.com` | Dueño | ZTG |
| `empleadoztg@testing.com` | Empleado | ZTG |
| `duenioatico@testing.com` | Dueño | Ático |
| `empleadoatico@testing.com` | Empleado | Ático |

Cada dueño ve solo su tienda (aislamiento total). El empleado vende, opera caja y
ve sus ventas; el dueño además tiene reportes, importar, comisiones, usuarios.

Seeds disponibles (apuntando `.env.local` a Neon):
- `npm run seed:superadmin` — admin de plataforma (rol superadmin) → panel `/admin`
  para crear tiendas y dueños desde la UI. Env: `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`.
- `npm run seed:store` — una tienda + su dueño. Env: `STORE_NAME`, `STORE_SLUG`, `OWNER_EMAIL`, `OWNER_PASSWORD`.
- `npm run seed:demo` — recrea las 4 cuentas de arriba (ZTG + Ático). Password: `DEMO_PASSWORD` (default `testing1234`).
- Empleados también se crean desde la UI: dueño → Usuarios → + Nuevo empleado.

## Notas

- El deploy por CLI sube los archivos directamente, no necesita que el repo esté en GitHub.
- `/login` es estático; el resto de las páginas son server-rendered on demand — el build no necesita la base de datos, pero el runtime sí (por eso las env vars).
- Si más adelante conectás un remoto de GitHub, se puede pasar a deploy automático por push (Vercel lo detecta solo).

## Antes de uso productivo real (no para la demo)

Dos verificaciones de performance que quedaron pendientes (la demo con pocos datos anda igual):
- Importar ~10.000 productos distintos contra Neon y medir el tiempo (el import por lote de creación todavía es secuencial por grupo de producto).
- `EXPLAIN ANALYZE` sobre la búsqueda de Vender con miles de filas sembradas, para confirmar que usa los índices trigram.
