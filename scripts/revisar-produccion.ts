import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";

/**
 * Revisión de una base real, SOLO LECTURA.
 *
 * Es la versión automática de lo que hoy se verifica a mano después de cada
 * deploy: entrar al local, vender algo y ver si se rompió. Eso encuentra lo que
 * se rompió recién; esto encuentra lo que se rompió y todavía nadie notó.
 *
 * Revisa tres cosas, en orden de urgencia:
 *
 *   1. MIGRACIONES PENDIENTES. El modo de falla más caro y más común: el deploy
 *      sale, nadie corre `npm run migrate`, y la app tira "column does not
 *      exist" en la primera venta. Compara `drizzle/meta/_journal.json` contra
 *      lo que la base dice tener aplicado.
 *
 *   2. LOS ÍNDICES ÚNICOS PARCIALES. AGENTS.md lo dice: `drizzle-kit push` los
 *      borra en silencio y el daño aparece días después. El schema de Drizzle
 *      no los modela, así que ningún test los puede ver: la ÚNICA forma de
 *      saber si siguen ahí es mirar la base.
 *
 *   3. LO QUE ESOS ÍNDICES PROTEGEN. Si alguno se cayó alguna vez, el daño ya
 *      está en los datos y ningún índice restaurado lo va a deshacer. Se busca
 *      directamente: dos cajas abiertas, dos comprobantes con el mismo número,
 *      dos remitos con el mismo número, dos comandas abiertas en una mesa.
 *
 * Uso:
 *   DATABASE_URL=... npm run check:prod
 *   DATABASE_URL=... DB_DRIVER=pg npm run check:prod    # Postgres común
 *
 * No escribe absolutamente nada. Sale con código 1 si encuentra algo, para
 * poder encadenarlo en un deploy.
 */

// Igual que los demás scripts: si hay .env.local se usa, si no lo que venga del
// entorno. Nunca hardcodea una URL.
config({ path: ".env.local" });

type Hallazgo = { nivel: "error" | "aviso"; titulo: string; detalle: string };

const hallazgos: Hallazgo[] = [];
const error = (titulo: string, detalle: string) => hallazgos.push({ nivel: "error", titulo, detalle });
const aviso = (titulo: string, detalle: string) => hallazgos.push({ nivel: "aviso", titulo, detalle });

/**
 * Índices que el schema NO modela y que `drizzle-kit push` borra sin avisar.
 * Cada uno con lo que pasa cuando falta, porque el nombre solo no lo dice.
 */
const INDICES_CRITICOS: Record<string, string> = {
  cash_sessions_one_open_idx: "dos cajas abiertas a la vez en la misma tienda",
  comprobantes_numero_uq: "dos comprobantes fiscales con el mismo número",
  comprobantes_sale_clase_uq: "dos facturas para la misma venta",
  comprobantes_reconciliar_idx: "comprobantes en error que nadie reconcilia",
  orders_una_abierta_por_mesa_idx: "dos comandas abiertas en la misma mesa",
  sales_store_remito_idx: "dos remitos con el mismo número",
};

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL.");
    process.exit(2);
  }

  // Import dinámico: src/db lee DATABASE_URL al cargar el módulo, así que el
  // chequeo de arriba tiene que correr antes.
  const { db } = await import("../src/db");

  // ---- 1. migraciones ----
  const dir = path.resolve(__dirname, "../drizzle");
  const journal = JSON.parse(fs.readFileSync(path.join(dir, "meta/_journal.json"), "utf8")) as {
    entries: { idx: number; when: number; tag: string }[];
  };

  let aplicadas: Set<number>;
  try {
    // `created_at` de la tabla de drizzle es el `when` del journal: es el
    // enganche, y no el hash, que depende del contenido exacto del archivo.
    const filas = await db.execute<{ created_at: string | number }>(
      sql`select created_at from drizzle.__drizzle_migrations`
    );
    const rows = (Array.isArray(filas) ? filas : (filas as any).rows) as { created_at: string | number }[];
    aplicadas = new Set(rows.map((r) => Number(r.created_at)));
  } catch {
    error(
      "La base no tiene tabla de migraciones",
      "Nunca se corrió `npm run migrate` contra esta base, o DATABASE_URL apunta a otro lado."
    );
    aplicadas = new Set();
  }

  const pendientes = journal.entries.filter((e) => !aplicadas.has(e.when));
  if (pendientes.length) {
    error(
      `${pendientes.length} migracion(es) sin aplicar`,
      `${pendientes.map((e) => e.tag).join(", ")}\n  → corré: npm run migrate`
    );
  }

  // ---- 2. índices ----
  const idxRes = await db.execute<{ indexname: string }>(
    sql`select indexname from pg_indexes where schemaname = 'public'`
  );
  const existentes = new Set(
    ((Array.isArray(idxRes) ? idxRes : (idxRes as any).rows) as { indexname: string }[])
      .map((r) => r.indexname)
  );
  for (const [nombre, consecuencia] of Object.entries(INDICES_CRITICOS)) {
    if (!existentes.has(nombre)) {
      error(`Falta el índice ${nombre}`, `Sin él: ${consecuencia}. ¿Alguien corrió drizzle-kit push?`);
    }
  }

  // ---- 3. los datos que esos índices protegen ----
  const contar = async (etiqueta: string, consulta: any, consecuencia: string) => {
    const res = await db.execute<{ n: string | number }>(consulta);
    const rows = (Array.isArray(res) ? res : (res as any).rows) as { n: string | number }[];
    const n = Number(rows[0]?.n ?? 0);
    if (n > 0) error(etiqueta, `${n} caso(s). ${consecuencia}`);
  };

  await contar(
    "Cajas abiertas duplicadas",
    sql`select count(*) as n from (
          select store_id from cash_sessions where closed_at is null
          group by store_id having count(*) > 1
        ) x`,
    "El arqueo de esa tienda no puede cerrar bien: las ventas se reparten entre dos cajas."
  );

  // Espeja `comprobantes_numero_uq` exactamente, incluido el WHERE: un
  // comprobante RECHAZADO reusa su número a propósito (ARCA no avanzó su
  // numeración), así que contarlo como duplicado sería un falso positivo.
  await contar(
    "Comprobantes con número repetido",
    sql`select count(*) as n from (
          select store_id, ambiente, pto_vta, cbte_tipo, numero
          from comprobantes where estado <> 'rechazado'
          group by 1,2,3,4,5 having count(*) > 1
        ) x`,
    "Dos comprobantes fiscales con el mismo número. Es un problema ante ARCA, no solo de datos."
  );

  // Espeja `comprobantes_sale_clase_uq`.
  await contar(
    "Ventas con dos comprobantes de la misma clase",
    sql`select count(*) as n from (
          select sale_id, clase from comprobantes
          where estado in ('pendiente','autorizado')
          group by 1,2 having count(*) > 1
        ) x`,
    "Una venta facturada dos veces."
  );

  await contar(
    "Remitos con número repetido",
    sql`select count(*) as n from (
          select store_id, remito_numero from sales where remito_numero is not null
          group by 1,2 having count(*) > 1
        ) x`,
    "Dos papeles distintos con el mismo NRO circulando por el local."
  );

  await contar(
    "Mesas con más de una comanda abierta",
    sql`select count(*) as n from (
          select table_id from orders where status in ('abierta','a_cobrar') and table_id is not null
          group by table_id having count(*) > 1
        ) x`,
    "Dos comandas sobre la misma mesa: lo que se cobra en una no descuenta de la otra."
  );

  // Cajas abiertas hace mucho: no es corrupción, es un turno que nadie cerró, y
  // se nota recién cuando el arqueo del mes no cierra.
  const viejas = await db.execute<{ n: string | number }>(
    sql`select count(*) as n from cash_sessions
        where closed_at is null and opened_at < now() - interval '2 days'`
  );
  const nViejas = Number(
    (((Array.isArray(viejas) ? viejas : (viejas as any).rows) as any[])[0]?.n) ?? 0
  );
  if (nViejas > 0) {
    aviso("Cajas abiertas hace más de dos días", `${nViejas}. Puede ser un turno que nadie cerró.`);
  }

  // ---- salida ----
  const errores = hallazgos.filter((h) => h.nivel === "error");
  if (hallazgos.length === 0) {
    console.log("Todo en orden: migraciones aplicadas, índices presentes, sin datos duplicados.");
    process.exit(0);
  }
  for (const h of hallazgos) {
    console.log(`\n${h.nivel === "error" ? "✗" : "!"} ${h.titulo}\n  ${h.detalle}`);
  }
  console.log("");
  process.exit(errores.length ? 1 : 0);
}

main().catch((e) => {
  console.error("No se pudo revisar la base:", e instanceof Error ? e.message : e);
  process.exit(2);
});
