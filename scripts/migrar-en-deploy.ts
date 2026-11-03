import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/**
 * Aplica las migraciones pendientes ANTES de `next build`, solo en el deploy
 * de producción de Vercel.
 *
 * Existe por un incidente concreto: se mergearon tres PRs con migraciones, el
 * deploy salió, nadie corrió `npm run migrate`, y al otro día los locales no
 * podían vender ("column does not exist"). Acordarse no es un proceso.
 *
 * El orden importa. Si la migración falla, el build falla y Vercel no publica
 * nada: sigue andando el código anterior contra la base anterior. Si la
 * migración sale bien y después falla el build, queda el código anterior
 * contra la base nueva, y por eso las migraciones tienen que ser compatibles
 * con el código anterior (agregar columnas que aceptan null, tablas nuevas;
 * no borrar ni renombrar en el mismo deploy). Ver AGENTS.md.
 *
 * Fuera de producción no hace nada: `npm run build` en local, en CI y en los
 * previews de Vercel no toca ninguna base.
 */

/** Solo el deploy de producción migra. Un preview no puede cambiar la base de los locales. */
export function debeMigrar(vercelEnv: string | undefined): boolean {
  return vercelEnv === "production";
}

const INTENTOS = 3;
const ESPERA_MS = 5_000;

async function main() {
  if (!debeMigrar(process.env.VERCEL_ENV)) {
    console.log("migrar-en-deploy: no es el deploy de producción, no se migra.");
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    // En producción sin URL no hay nada que publicar: que el build falle acá
    // y no en la primera venta.
    console.error("migrar-en-deploy: falta DATABASE_URL en el entorno de producción.");
    process.exit(1);
  }

  const migrationsFolder = path.resolve(__dirname, "../drizzle");

  // Dos merges seguidos pueden disparar dos deploys a la vez. Drizzle aplica
  // las pendientes en una sola transacción: el que pierde la carrera choca con
  // "already exists" y su transacción entera vuelve atrás. Al reintentar ya
  // las encuentra aplicadas y no hace nada.
  for (let intento = 1; intento <= INTENTOS; intento++) {
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      await migrate(drizzle(pool), { migrationsFolder });
      console.log("migrar-en-deploy: migraciones al día.");
      return;
    } catch (e) {
      // Drizzle envuelve el error de Postgres: el mensaje es la consulta y la
      // causa ("database does not exist", "already exists") va en `cause`.
      const causa = (e as { cause?: { message?: string } })?.cause?.message;
      const motivo = causa ?? (e instanceof Error ? e.message.split("\n")[0] : String(e));
      if (intento === INTENTOS) {
        console.error(`migrar-en-deploy: no se pudo migrar (${motivo}). No se publica este deploy.`);
        process.exit(1);
      }
      console.warn(`migrar-en-deploy: intento ${intento} falló (${motivo}). Reintento.`);
      await new Promise((r) => setTimeout(r, ESPERA_MS));
    } finally {
      await pool.end();
    }
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
