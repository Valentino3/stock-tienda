import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Vacía los movimientos de UNA tienda de prueba. Deja el catálogo y el dueño.
 *
 * Existe porque una tienda de prueba sin forma de limpiarla se vuelve inútil en
 * un mes: veinte cajas abiertas sin cerrar, cien ventas basura, y el arqueo del
 * turno de prueba deja de significar nada.
 *
 * ⚠️ ESTE SCRIPT BORRA. Corre contra la MISMA base que los locales reales, así
 * que las guardas no son ceremonia:
 *
 *   1. La tienda tiene que existir Y tener `es_prueba = true`. Una tienda real
 *      no se puede vaciar ni pasándole el slug correcto a mano.
 *   2. El slug va explícito por `STORE_SLUG`. No hay valor por defecto que
 *      pueda apuntar sin querer a otro lado.
 *   3. Todo va en UNA transacción y todo filtra por `store_id`. Ninguna
 *      sentencia puede alcanzar una fila de otra tienda.
 *   4. Pide confirmación con `CONFIRMAR=<slug>`, para que no se dispare por un
 *      historial de terminal.
 *
 * Lo que NO borra: productos, variantes, clientes, mesas, dueño, config fiscal.
 * Se conserva a propósito — volver a poblarlo cada vez haría que las pruebas
 * arranquen distinto cada día, y el punto es lo contrario.
 *
 * Uso:
 *   STORE_SLUG=prueba CONFIRMAR=prueba npm run reset:prueba
 */

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL.");
    process.exit(2);
  }
  const slug = process.env.STORE_SLUG;
  if (!slug) {
    console.error("Falta STORE_SLUG. No hay valor por defecto a propósito.");
    process.exit(2);
  }
  if (process.env.CONFIRMAR !== slug) {
    console.error(`Para confirmar, repetí el slug:\n  STORE_SLUG=${slug} CONFIRMAR=${slug} npm run reset:prueba`);
    process.exit(2);
  }

  const { db } = await import("../src/db");
  const { stores } = await import("../src/db/schema");
  const { eq, sql } = await import("drizzle-orm");

  const [store] = await db.select().from(stores).where(eq(stores.slug, slug));
  if (!store) {
    console.error(`No existe ninguna tienda con slug "${slug}".`);
    process.exit(1);
  }
  if (!store.esPrueba) {
    console.error(
      `"${store.name}" (#${store.id}) NO está marcada como tienda de prueba.\n` +
      `No se borró nada. Esta guarda existe justamente para este momento.`
    );
    process.exit(1);
  }

  const id = store.id;

  await db.transaction(async (tx: any) => {
    // Orden de borrado por dependencia: hijos antes que padres. Las tablas que
    // no tienen store_id propio se filtran por su padre, siempre acotado a
    // esta tienda.
    await tx.execute(sql`
      delete from comprobantes where store_id = ${id}
    `);
    await tx.execute(sql`
      delete from stock_movements where variant_id in (
        select id from product_variants where store_id = ${id}
      )
    `);
    await tx.execute(sql`
      delete from sale_items where sale_id in (select id from sales where store_id = ${id})
    `);
    await tx.execute(sql`delete from client_account_movements where store_id = ${id}`);
    await tx.execute(sql`
      delete from order_items where order_id in (select id from orders where store_id = ${id})
    `);
    await tx.execute(sql`delete from orders where store_id = ${id}`);
    await tx.execute(sql`delete from sales where store_id = ${id}`);
    await tx.execute(sql`
      delete from cash_movements where cash_session_id in (
        select id from cash_sessions where store_id = ${id}
      )
    `);
    await tx.execute(sql`delete from cash_sessions where store_id = ${id}`);
    await tx.execute(sql`delete from commissions where store_id = ${id}`);
    await tx.execute(sql`delete from notifications where store_id = ${id}`);
    await tx.execute(sql`delete from import_batches where store_id = ${id}`);
    await tx.execute(sql`delete from price_recalc_batches where store_id = ${id}`);

    // El stock vuelve a un valor parejo: si quedara donde lo dejó la última
    // prueba, la siguiente arrancaría sin poder vender.
    await tx.execute(sql`
      update product_variants set stock = 20
      where store_id = ${id} and sku <> 'PRB-CERO'
    `);
    // Y el contador de remitos vuelve a cero: es de esta tienda y nada afuera
    // lo referencia.
    await tx.execute(sql`update stores set remito_ultimo_numero = 0 where id = ${id}`);
  });

  console.log(`Tienda "${store.name}" (#${id}) vaciada: ventas, cajas, comprobantes y cuentas.`);
  console.log("Catálogo, clientes, mesas y dueño quedaron como estaban.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
