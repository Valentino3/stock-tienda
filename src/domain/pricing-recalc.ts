import { and, eq, sql } from "drizzle-orm";
import {
  priceRecalcBatches, products, productVariants,
  type PriceRecalcBatch, type PriceRecalcTarget,
} from "@/db/schema";
import { precioDeLista, precioDesdeUsd, usdEfectivo, type ReglaRedondeo } from "@/domain/pricing-usd";
import { getPricingConfig, marcarPreciosActualizados, reglaDe } from "@/domain/pricing-config";

/**
 * Recálculo masivo de precios contra la cotización del dólar.
 *
 * Se planifica, se muestra y recién después se aplica: reescribe todos los
 * precios del local y no tiene deshacer por fila. Un cero de más en la
 * cotización es un catálogo diez veces más caro, y la única defensa real es
 * que el dueño lea "de $87.200 a $872.000" antes de apretar. Es el mismo ciclo
 * de `import_batches`, que resuelve exactamente el mismo problema.
 *
 * Lo que este módulo NO hace: cambiar cómo se lee un precio. Escribe en las
 * mismas cuatro columnas que ya escriben `saveVariant` y `executeImport`, y
 * `resolverPrecio` no se entera.
 */

/** Filas que viajan al navegador para revisar. El plan completo vive en la base. */
export const PREVIEW_ROWS = 200;

/**
 * Tuplas por sentencia. `import.ts` mete todas las filas en un solo
 * `UPDATE ... FROM (VALUES ...)`; a 20k variantes eso es una sentencia de
 * varios MB. El chunk la acota sin cambiar la semántica, porque todo sigue
 * adentro de la misma transacción.
 */
const CHUNK = 1000;

/** Los planes sin confirmar se descartan, igual que los lotes de importación. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export type ResumenRecalculo = {
  batchId: string;
  usdRate: number;
  /** Objetivos cuyo precio se mueve. */
  changed: number;
  /** Tienen dólar pero el resultado es idéntico (recálculo repetido). */
  unchanged: number;
  /** Variantes sin precio en dólares: no se tocan. */
  skipped: number;
  /**
   * Variantes que heredarían el dólar de su producto pero tienen precio propio
   * en pesos, así que lo que cobra el mostrador NO se mueve. Es el contador que
   * evita el ticket de soporte de "recalculé y sigue igual".
   */
  overridden: number;
  preview: PriceRecalcTarget[];
};

type FilaCatalogo = {
  productId: number;
  productName: string;
  basePrice: number;
  basePriceUsd: number | null;
  variantId: number;
  variantName: string | null;
  price: number | null;
  priceUsd: number | null;
  priceCash: number | null;
  priceWholesale: number | null;
};

type Parametros = {
  usdRate: number;
  regla: ReglaRedondeo;
  cashPct: number | null;
  wholesalePct: number | null;
};

const nombreDe = (f: FilaCatalogo) =>
  f.variantName ? `${f.productName} — ${f.variantName}` : f.productName;

/**
 * Calcula el plan sin tocar nada.
 *
 * Puro sobre las filas que recibe, para poder testear la aritmética sin base.
 * Incluye productos inactivos a propósito: un producto que se reactive dentro
 * de dos meses tiene que tener el precio de hoy, no el de la cotización vieja.
 */
export function planificarDesdeFilas(filas: FilaCatalogo[], p: Parametros) {
  const targets: PriceRecalcTarget[] = [];
  let changed = 0, unchanged = 0, skipped = 0, overridden = 0;

  // Un objetivo por producto con dólar propio: escribe `products.base_price`, y
  // sus variantes que heredan siguen heredando.
  const productosVistos = new Set<number>();
  for (const f of filas) {
    if (f.basePriceUsd == null || productosVistos.has(f.productId)) continue;
    productosVistos.add(f.productId);

    const nuevo = precioDesdeUsd(f.basePriceUsd, p.usdRate, p.regla);
    const target: PriceRecalcTarget = {
      nivel: "producto",
      productId: f.productId,
      variantId: null,
      nombre: f.productName,
      usd: f.basePriceUsd,
      antes: { price: f.basePrice, priceCash: null, priceWholesale: null },
      despues: { price: nuevo, priceCash: null, priceWholesale: null },
    };
    targets.push(target);
    if (nuevo === f.basePrice) unchanged++;
    else changed++;
  }

  for (const f of filas) {
    const usd = usdEfectivo(f, f);
    if (usd == null) {
      skipped++;
      continue;
    }

    // Hereda el dólar del producto pero tiene precio propio en pesos: el
    // producto se va a mover y esta variante no. No es un error, es la
    // semántica de "el precio propio pisa al del padre" — pero es invisible.
    if (f.priceUsd == null && f.price != null) overridden++;

    // `null` = no tocar la columna. El precio de la variante solo se escribe si
    // el dólar es SUYO: si lo hereda, el precio también tiene que seguir
    // heredándose, o la herencia se rompería en el primer recálculo.
    const nuevoPrice = f.priceUsd != null ? precioDesdeUsd(f.priceUsd, p.usdRate, p.regla) : null;
    // Las listas nunca se inauguran: si la variante no las tenía cargadas, el
    // recálculo no se las inventa. Poblarlas prendería la lista "efectivo" en
    // miles de artículos que hoy la rechazan, y eso cambia lo que el cajero
    // puede cobrar sin que nadie lo haya pedido.
    const nuevoCash = f.priceCash != null ? precioDeLista(usd, p.usdRate, p.cashPct, p.regla) : null;
    const nuevoWholesale =
      f.priceWholesale != null ? precioDeLista(usd, p.usdRate, p.wholesalePct, p.regla) : null;

    if (nuevoPrice == null && nuevoCash == null && nuevoWholesale == null) continue;

    const seMueve =
      (nuevoPrice != null && nuevoPrice !== f.price) ||
      (nuevoCash != null && nuevoCash !== f.priceCash) ||
      (nuevoWholesale != null && nuevoWholesale !== f.priceWholesale);

    targets.push({
      nivel: "variante",
      productId: f.productId,
      variantId: f.variantId,
      nombre: nombreDe(f),
      usd,
      antes: { price: f.price, priceCash: f.priceCash, priceWholesale: f.priceWholesale },
      despues: { price: nuevoPrice, priceCash: nuevoCash, priceWholesale: nuevoWholesale },
    });
    if (seMueve) changed++;
    else unchanged++;
  }

  return { targets, changed, unchanged, skipped, overridden };
}

/** Ordena por variación relativa descendente: un error de 10× tiene que salir arriba. */
function porVariacion(a: PriceRecalcTarget, b: PriceRecalcTarget) {
  const salto = (t: PriceRecalcTarget) => {
    const antes = t.antes.price ?? t.antes.priceCash ?? t.antes.priceWholesale;
    const despues = t.despues.price ?? t.despues.priceCash ?? t.despues.priceWholesale;
    if (antes == null || despues == null || antes === 0) return 0;
    return Math.abs(despues / antes - 1);
  };
  return salto(b) - salto(a);
}

async function leerCatalogo(db: any, storeId: number): Promise<FilaCatalogo[]> {
  return db
    .select({
      productId: products.id,
      productName: products.name,
      basePrice: products.basePrice,
      basePriceUsd: products.basePriceUsd,
      variantId: productVariants.id,
      variantName: productVariants.name,
      price: productVariants.price,
      priceUsd: productVariants.priceUsd,
      priceCash: productVariants.priceCash,
      priceWholesale: productVariants.priceWholesale,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(eq(productVariants.storeId, storeId));
}

/**
 * Planifica y guarda el lote. No escribe ningún precio.
 *
 * Los parámetros quedan congelados en la fila: entre que el dueño mira la
 * previsualización y confirma, la config puede cambiar, y lo que se aplica
 * tiene que ser exactamente lo que leyó.
 */
export async function crearLoteRecalculo(
  db: any,
  input: { storeId: number; userId: string }
): Promise<ResumenRecalculo> {
  const cfg = await getPricingConfig(db, input.storeId);
  if (!cfg?.usdRate) throw new Error("USD_RATE_NOT_SET");

  const p: Parametros = {
    usdRate: cfg.usdRate,
    regla: reglaDe(cfg),
    cashPct: cfg.cashPct,
    wholesalePct: cfg.wholesalePct,
  };

  const plan = planificarDesdeFilas(await leerCatalogo(db, input.storeId), p);

  // Limpieza oportunista, sin cron: igual que los lotes de importación.
  await db.delete(priceRecalcBatches).where(and(
    eq(priceRecalcBatches.storeId, input.storeId),
    eq(priceRecalcBatches.status, "pending"),
    sql`${priceRecalcBatches.createdAt} < ${new Date(Date.now() - STALE_AFTER_MS)}`,
  ));

  const batchId = crypto.randomUUID();
  await db.insert(priceRecalcBatches).values({
    id: batchId,
    storeId: input.storeId,
    createdBy: input.userId,
    usdRate: p.usdRate,
    roundingMode: p.regla.mode,
    roundingStep: p.regla.step,
    cashPct: p.cashPct,
    wholesalePct: p.wholesalePct,
    rows: plan.targets,
    changed: plan.changed,
    unchanged: plan.unchanged,
    skipped: plan.skipped,
    overridden: plan.overridden,
  });

  return {
    batchId,
    usdRate: p.usdRate,
    changed: plan.changed,
    unchanged: plan.unchanged,
    skipped: plan.skipped,
    overridden: plan.overridden,
    preview: [...plan.targets].sort(porVariacion).slice(0, PREVIEW_ROWS),
  };
}

/**
 * Aplica un lote pendiente.
 *
 * El lote se reclama con un UPDATE condicional ANTES de aplicarlo, igual que
 * `confirmImportBatch`: dos requests simultáneas (doble clic) compiten por la
 * fila y solo una la consigue. Un SELECT-y-después-UPDATE dejaría una ventana
 * en la que las dos leen "pending" y las dos escriben.
 *
 * Todo va en una transacción: medio catálogo al dólar nuevo y medio al viejo
 * es peor que no haber recalculado.
 */
export async function confirmarLoteRecalculo(
  db: any,
  storeId: number,
  batchId: string
): Promise<{ aplicados: number }> {
  const [batch] = await db.update(priceRecalcBatches)
    .set({ status: "confirmed", confirmedAt: new Date() })
    .where(and(
      eq(priceRecalcBatches.id, batchId),
      eq(priceRecalcBatches.storeId, storeId),
      eq(priceRecalcBatches.status, "pending"),
    ))
    .returning();
  if (!batch) throw new Error("BATCH_NOT_FOUND");

  const targets = batch.rows as PriceRecalcTarget[];
  await db.transaction(async (tx: any) => {
    await escribir(tx, targets, "despues");
  });
  await marcarPreciosActualizados(db, storeId);

  return { aplicados: targets.length };
}

/**
 * Deshace el último lote confirmado.
 *
 * Condicional a propósito: solo revierte la fila si su precio sigue siendo el
 * que dejó el recálculo. Si alguien lo editó a mano después, el undo no se lo
 * pisa. El apply, en cambio, es incondicional — el dueño pidió recalcular todo,
 * y fallar porque él mismo tocó algo en otra pestaña sería hostil.
 */
export async function revertirLoteRecalculo(
  db: any,
  storeId: number,
  batchId: string,
  userId: string
): Promise<{ revertidos: number; salteados: number }> {
  const [ultimo] = await db.select().from(priceRecalcBatches)
    .where(and(eq(priceRecalcBatches.storeId, storeId), eq(priceRecalcBatches.status, "confirmed")))
    .orderBy(sql`${priceRecalcBatches.confirmedAt} desc`)
    .limit(1);
  // Solo el último: revertir uno viejo resucitaría precios de dos cotizaciones
  // atrás sin que nadie lo pida.
  if (!ultimo || ultimo.id !== batchId) throw new Error("BATCH_NOT_REVERTIBLE");

  const targets = ultimo.rows as PriceRecalcTarget[];
  let revertidos = 0;
  await db.transaction(async (tx: any) => {
    revertidos = await escribir(tx, targets, "antes", true);
    await tx.update(priceRecalcBatches)
      .set({ status: "reverted", revertedAt: new Date(), revertedBy: userId })
      .where(eq(priceRecalcBatches.id, batchId));
  });
  await marcarPreciosActualizados(db, storeId);

  return { revertidos, salteados: targets.length - revertidos };
}

/**
 * Escribe una cara del plan.
 *
 * Qué columnas toca cada objetivo se deriva de `despues`: una columna en null
 * ahí significa "este objetivo no la escribe". Esa marca viaja al SQL como un
 * booleano y NO como un `coalesce` sobre el valor, porque las dos cosas se
 * confunden justo donde importa: al deshacer, el valor previo de una variante
 * que heredaba ES null, y un `coalesce` lo interpretaría como "no tocar" y
 * dejaría el precio recalculado para siempre.
 */
async function escribir(
  tx: any,
  targets: PriceRecalcTarget[],
  cara: "antes" | "despues",
  condicional = false
): Promise<number> {
  const otra = cara === "antes" ? "despues" : "antes";
  const escribe = (t: PriceRecalcTarget, col: "price" | "priceCash" | "priceWholesale") =>
    t.despues[col] != null;
  let filas = 0;

  const productos = targets.filter((t) => t.nivel === "producto");
  for (let i = 0; i < productos.length; i += CHUNK) {
    const chunk = productos.slice(i, i + CHUNK);
    const values = sql.join(
      chunk.map((t) => sql`(${t.productId}::int, ${t[cara].price}::numeric, ${t[otra].price}::numeric)`),
      sql`, `
    );
    // La guarda condicional es solo del deshacer: si alguien edito el precio a
    // mano despues del recalculo, el undo lo saltea en vez de pisarselo.
    const guarda = condicional ? sql` AND p.base_price IS NOT DISTINCT FROM data.esperado` : sql``;
    const res = await tx.execute(sql`
      UPDATE products AS p
      SET base_price = data.valor
      FROM (VALUES ${values}) AS data(id, valor, esperado)
      WHERE p.id = data.id${guarda}
      RETURNING p.id
    `);
    filas += contarFilas(res);
  }

  const variantes = targets.filter((t) => t.nivel === "variante");
  for (let i = 0; i < variantes.length; i += CHUNK) {
    const chunk = variantes.slice(i, i + CHUNK);
    const values = sql.join(
      chunk.map((t) => sql`(
        ${t.variantId}::int,
        ${t[cara].price}::numeric, ${escribe(t, "price")}::boolean,
        ${t[cara].priceCash}::numeric, ${escribe(t, "priceCash")}::boolean,
        ${t[cara].priceWholesale}::numeric, ${escribe(t, "priceWholesale")}::boolean,
        ${t[otra].price}::numeric
      )`),
      sql`, `
    );
    const guarda = condicional ? sql` AND pv.price IS NOT DISTINCT FROM data.esperado` : sql``;
    const res = await tx.execute(sql`
      UPDATE product_variants AS pv
      SET price           = CASE WHEN data.set_price THEN data.price ELSE pv.price END,
          price_cash      = CASE WHEN data.set_cash THEN data.price_cash ELSE pv.price_cash END,
          price_wholesale = CASE WHEN data.set_wholesale THEN data.price_wholesale ELSE pv.price_wholesale END
      FROM (VALUES ${values}) AS data(
        id, price, set_price, price_cash, set_cash, price_wholesale, set_wholesale, esperado
      )
      WHERE pv.id = data.id${guarda}
      RETURNING pv.id
    `);
    filas += contarFilas(res);
  }

  return filas;
}

/**
 * Cuenta filas de un `execute` con RETURNING. Los drivers difieren en la forma
 * del resultado —pg devuelve `{ rows }`, PGlite a veces el array pelado— y el
 * conteo importa: es lo que reporta cuantas filas saltea el deshacer.
 */
function contarFilas(res: any): number {
  if (Array.isArray(res)) return res.length;
  if (Array.isArray(res?.rows)) return res.rows.length;
  return typeof res?.rowCount === "number" ? res.rowCount : 0;
}

/** El último lote confirmado, para ofrecer deshacer. */
export async function getUltimoLoteConfirmado(db: any, storeId: number): Promise<PriceRecalcBatch | null> {
  const [row] = await db.select().from(priceRecalcBatches)
    .where(and(eq(priceRecalcBatches.storeId, storeId), eq(priceRecalcBatches.status, "confirmed")))
    .orderBy(sql`${priceRecalcBatches.confirmedAt} desc`)
    .limit(1);
  return row ?? null;
}
