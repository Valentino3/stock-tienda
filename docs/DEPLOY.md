# Deploy a Vercel (demo)

Guía para poner la app online. El stack (Next.js + Neon) está hecho para Vercel; el deploy es directo. La base Neon ya tiene las migraciones aplicadas y un usuario dueño creado (`testing@ztg.com`).

## Requisitos previos (una sola vez, los hacés vos)

```bash
npm i -g vercel      # instala el CLI de Vercel
vercel login         # login por navegador (OAuth) — no se puede automatizar
```

## Pasos

Desde la raíz del proyecto (`stock-tienda`):

```bash
# 1. Vincular / crear el proyecto en Vercel (elegí crear uno nuevo cuando pregunte)
vercel link

# 2. Cargar las 3 variables de entorno para producción.
#    Cada comando pide el valor de forma interactiva (lo pegás):
vercel env add DATABASE_URL production
#    → pegar el mismo valor que está en .env.local (la connection string de Neon)

vercel env add BETTER_AUTH_SECRET production
#    → pegar el mismo valor que está en .env.local

vercel env add BETTER_AUTH_URL production
#    → dejarlo pendiente por ahora: no conocés el dominio hasta el primer deploy.
#      Opción simple: hacé el paso 3 primero, anotá el dominio que te da
#      (ej. https://stock-tienda-xxxx.vercel.app), y recién ahí corré este
#      comando con ese valor, y volvé a deployar (paso 3 de nuevo).

# 3. Deploy a producción
vercel --prod
```

Al terminar, Vercel imprime la URL pública (algo como `https://stock-tienda-xxxx.vercel.app`). Esa es la demo.

## Orden recomendado para BETTER_AUTH_URL (evita el huevo-y-gallina)

1. `vercel link`
2. `vercel env add DATABASE_URL production` y `vercel env add BETTER_AUTH_SECRET production`
3. `vercel --prod` → anotá la URL que devuelve
4. `vercel env add BETTER_AUTH_URL production` → pegá esa URL (con `https://`, sin barra final)
5. `vercel --prod` de nuevo → ahora el login queda 100% correcto

## Login de la demo

- Usuario dueño ya existente: `testing@ztg.com` (contraseña que definiste al seedear).
- Para crear empleados de prueba: entrás como dueño → Usuarios → + Nuevo empleado.
- Para crear un dueño nuevo con otro mail: correr el seed apuntando a Neon
  (`OWNER_EMAIL=... OWNER_PASSWORD=... npm run seed:owner`), ya sea local (con
  `.env.local` apuntando a Neon) o una vez.

## Notas

- El deploy por CLI sube los archivos directamente, no necesita que el repo esté en GitHub.
- `/login` es estático; el resto de las páginas son server-rendered on demand — el build no necesita la base de datos, pero el runtime sí (por eso las env vars).
- Si más adelante conectás un remoto de GitHub, se puede pasar a deploy automático por push (Vercel lo detecta solo).

## Antes de uso productivo real (no para la demo)

Dos verificaciones de performance que quedaron pendientes (la demo con pocos datos anda igual):
- Importar ~10.000 productos distintos contra Neon y medir el tiempo (el import por lote de creación todavía es secuencial por grupo de producto).
- `EXPLAIN ANALYZE` sobre la búsqueda de Vender con miles de filas sembradas, para confirmar que usa los índices trigram.
