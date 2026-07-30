import { and, desc, eq, getTableColumns, inArray, max, sql } from "drizzle-orm";
import {
  clients, comprobantes, products, productVariants, saleItems, sales,
  type Comprobante, type StoreFiscalConfig,
} from "@/db/schema";
import type { FeCaeRequest, FeCaeResponse, FeCompConsultarResponse } from "@/lib/arca/types";
import { esNumeracionDesfasada, mensajeRechazo } from "@/lib/arca/errors";
import { scrubPayload } from "@/lib/arca/soap";
import { requireFiscalConfig } from "@/domain/fiscal-config";
import {
  construirComprobante, construirNotaCredito, payloadDesdeFila,
  resolverReceptor, type ClienteFiscal, type DatosReceptor, type ItemVenta,
} from "@/domain/fiscal-comprobante";
import { isoDesdeArca } from "@/domain/fiscal-importes";
import { ncPara, type CbteTipoFactura } from "@/domain/fiscal-catalogs";

/**
 * Orquestación de la emisión: reservar número, llamar a ARCA, asentar resultado.
 *
 * PATRÓN CENTRAL — reservar → llamar → asentar, con la llamada SOAP FUERA de
 * toda transacción.
 *
 * Se descartó explícitamente envolver la llamada a ARCA dentro de la transacción
 * que reserva el número. Es más simple y ordena bien, pero tiene una propiedad
 * fatal: si el commit falla DESPUÉS de que ARCA otorgó el CAE, la fila
 * desaparece y se destruye el único registro de un CAE que legalmente existe.
 * Además dejaría una conexión de Neon `idle in transaction` durante segundos.
 */

/**
 * Puerto hacia ARCA. Se declara ACÁ, en el dominio, y NO se importa de
 * src/lib/arca: el dominio es dueño de la interfaz y el cliente la implementa.
 * Así todo esto se testea con un fake de veinte líneas.
 */
export type ArcaClientPort = {
  lastAuthorized(cbteTipo: number): Promise<number>;
  authorize(req: FeCaeRequest): Promise<FeCaeResponse>;
  consult(cbteTipo: number, numero: number): Promise<FeCompConsultarResponse | null>;
};

/** Otra emisión de la misma secuencia más nueva que esto se considera en vuelo. */
const EN_VUELO_MS = 60_000;
const TIMEOUT_ARCA_MS = 30_000;

// ---- lectura ----

export async function getComprobantesBySale(db: any, storeId: number, saleId: number): Promise<Comprobante[]> {
  return db.select().from(comprobantes)
    .where(and(eq(comprobantes.storeId, storeId), eq(comprobantes.saleId, saleId)))
    .orderBy(desc(comprobantes.id));
}

/** Comprobantes de varias ventas de una, para la lista de /ventas. */
export async function getComprobantesForSales(
  db: any, storeId: number, saleIds: number[],
): Promise<Comprobante[]> {
  if (saleIds.length === 0) return [];
  return db.select().from(comprobantes)
    .where(and(eq(comprobantes.storeId, storeId), inArray(comprobantes.saleId, saleIds)))
    .orderBy(desc(comprobantes.id));
}

/**
 * Comprobante + si su `pendiente` ya se puede dar por perdido, calculado EN SQL.
 *
 * ⚠️ La edad NO se puede calcular en JS comparando `updatedAt` contra
 * `new Date()`. La columna es `timestamp` sin zona: Postgres la escribe en UTC y
 * el driver la lee como hora LOCAL del proceso. En un server a UTC-3 eso da 180
 * minutos de diferencia fantasma, y un comprobante recién creado parecería
 * viejo — con lo cual "Consultar en ARCA" lo marcaría rechazado mientras la
 * emisión real sigue en vuelo. Preguntándole a Postgres, los dos lados del
 * cálculo viven en el mismo marco.
 */
const RECONCILIAR_TRAS_MS = 5 * 60_000;

/**
 * Marca de tiempo del lado de Postgres, no de JS.
 *
 * Es la otra mitad del mismo problema: si estos UPDATE escribieran
 * `new Date()`, la fila quedaría con una hora en el marco del proceso y el
 * cálculo de edad de arriba —que corre en el marco de la base— la leería
 * desplazada. Escribiendo y leyendo con `now()`, los dos lados coinciden
 * siempre, corra el server en la zona que corra.
 */
const AHORA_DB = sql`now()`;

const columnasConEdad = {
  ...getTableColumns(comprobantes),
  vencido: sql<boolean>`${comprobantes.updatedAt} <= now() - interval '${sql.raw(String(RECONCILIAR_TRAS_MS / 1000))} seconds'`,
};

type ComprobanteConEdad = Comprobante & { vencido: boolean };

/** ¿Hay que ir a preguntarle a ARCA antes de tocar este comprobante? */
function hayQueReconciliar(c: ComprobanteConEdad): boolean {
  if (c.estado === "error") return true;
  return c.estado === "pendiente" && c.vencido;
}

async function getFacturaViva(db: any, storeId: number, saleId: number): Promise<ComprobanteConEdad | null> {
  const filas = await db.select(columnasConEdad).from(comprobantes).where(and(
    eq(comprobantes.storeId, storeId),
    eq(comprobantes.saleId, saleId),
    eq(comprobantes.clase, "factura"),
    inArray(comprobantes.estado, ["pendiente", "autorizado", "error"]),
  )).orderBy(desc(comprobantes.id)).limit(1);
  return filas[0] ?? null;
}

export async function getFacturaAutorizada(db: any, storeId: number, saleId: number): Promise<Comprobante | null> {
  const [fila] = await db.select().from(comprobantes).where(and(
    eq(comprobantes.storeId, storeId),
    eq(comprobantes.saleId, saleId),
    eq(comprobantes.clase, "factura"),
    eq(comprobantes.estado, "autorizado"),
  )).limit(1);
  return fila ?? null;
}

// ---- emisión de facturas ----

export type EmitirFacturaInput = {
  storeId: number;
  saleId: number;
  userId: string;
  /** Cliente a adjuntar en el momento de facturar (no toca sales.clientId). */
  clientId?: number | null;
  ahora?: Date;
};

export async function emitirFactura(
  db: any, arca: ArcaClientPort, input: EmitirFacturaInput,
): Promise<Comprobante> {
  const ahora = input.ahora ?? new Date();
  const config = await requireFiscalConfig(db, input.storeId);

  // Si quedó algo sin resolver de un intento anterior, se resuelve contra ARCA
  // ANTES de tocar la numeración.
  const previa = await getFacturaViva(db, input.storeId, input.saleId);
  if (previa?.estado === "autorizado") return previa;
  if (previa && hayQueReconciliar(previa)) {
    const resuelta = await reconciliarComprobante(db, arca, {
      storeId: input.storeId, comprobanteId: previa.id,
    });
    if (resuelta.estado === "autorizado") return resuelta;
    if (resuelta.estado === "error") throw new Error("RECONCILIACION_PENDIENTE");
  } else if (previa?.estado === "pendiente") {
    throw new Error("EMISION_EN_CURSO");
  } else if (previa?.estado === "error") {
    throw new Error("RECONCILIACION_PENDIENTE");
  }

  const { venta, items, cliente } = await cargarVenta(db, input.storeId, input.saleId, input.clientId);

  const receptor = resolverReceptor({
    cliente,
    impTotal: venta.total,
    umbralConsumidorFinal: config.umbralConsumidorFinal,
  });

  const reservado = await reservarFactura(db, arca, {
    config, venta, items, receptor, userId: input.userId, ahora,
  });

  return llamarYAsentar(db, arca, reservado.id, reservado.payload);
}

// ---- emisión de notas de crédito ----

export async function emitirNotaCredito(
  db: any, arca: ArcaClientPort, input: { storeId: number; saleId: number; userId: string; ahora?: Date },
): Promise<Comprobante> {
  const ahora = input.ahora ?? new Date();
  const config = await requireFiscalConfig(db, input.storeId);

  const factura = await getFacturaAutorizada(db, input.storeId, input.saleId);
  if (!factura) throw new Error("SIN_FACTURA_PARA_ANULAR");

  const [ncPrevia] = await db.select(columnasConEdad).from(comprobantes).where(and(
    eq(comprobantes.storeId, input.storeId),
    eq(comprobantes.saleId, input.saleId),
    eq(comprobantes.clase, "nota_credito"),
    inArray(comprobantes.estado, ["pendiente", "autorizado", "error"]),
  )).orderBy(desc(comprobantes.id)).limit(1);

  if (ncPrevia?.estado === "autorizado") return ncPrevia;
  if (ncPrevia && hayQueReconciliar(ncPrevia)) {
    const resuelta = await reconciliarComprobante(db, arca, {
      storeId: input.storeId, comprobanteId: ncPrevia.id,
    });
    if (resuelta.estado === "autorizado") return resuelta;
    if (resuelta.estado === "error") throw new Error("RECONCILIACION_PENDIENTE");
  } else if (ncPrevia?.estado === "pendiente") {
    throw new Error("EMISION_EN_CURSO");
  } else if (ncPrevia?.estado === "error") {
    throw new Error("RECONCILIACION_PENDIENTE");
  }

  const cbteTipo = ncPara(factura.cbteTipo as CbteTipoFactura);
  const reservado = await reservarEnSecuencia(db, arca, {
    storeId: input.storeId,
    ambiente: factura.ambiente,
    ptoVta: factura.ptoVta,
    cbteTipo,
    construir: (numero) => construirNotaCredito({ factura, config, numero, userId: input.userId, ahora }),
  });

  return llamarYAsentar(db, arca, reservado.id, reservado.payload);
}

// ---- fase 1: reservar ----

async function reservarFactura(db: any, arca: ArcaClientPort, args: {
  config: StoreFiscalConfig;
  venta: { id: number; total: number; discountAmount: number };
  items: ItemVenta[];
  receptor: DatosReceptor;
  userId: string;
  ahora: Date;
}): Promise<{ id: number; payload: FeCaeRequest }> {
  // Se arma una vez fuera del lock para conocer el tipo (A o B), que define la
  // secuencia de numeración. El número real se asigna adentro.
  const tentativo = construirComprobante({
    saleId: args.venta.id, storeId: args.config.storeId,
    total: args.venta.total, discountAmount: args.venta.discountAmount,
    items: args.items, receptor: args.receptor, config: args.config,
    numero: 0, userId: args.userId, ahora: args.ahora,
  });

  return reservarEnSecuencia(db, arca, {
    storeId: args.config.storeId,
    ambiente: args.config.ambiente,
    ptoVta: args.config.puntoVenta,
    cbteTipo: tentativo.fila.cbteTipo,
    construir: (numero) => ({
      fila: { ...tentativo.fila, numero },
      payload: payloadDesdeFila({ ...tentativo.fila, numero }, args.ahora,
        tentativo.payload.FeDetReq[0].CbtesAsoc?.[0]),
    }),
  });
}

/**
 * Reserva el próximo número de una secuencia e inserta la fila `pendiente`.
 *
 * Todo corre dentro de un `pg_advisory_xact_lock` scopeado a
 * (tienda, ambiente, punto de venta, tipo). Se usa la variante `_xact_` y no
 * `pg_advisory_lock` porque se libera sola en COMMIT/ROLLBACK: una lambda que
 * muere no puede filtrar el lock, y no hay ningún unlock que olvidarse.
 */
async function reservarEnSecuencia(db: any, arca: ArcaClientPort, args: {
  storeId: number;
  ambiente: Comprobante["ambiente"];
  ptoVta: number;
  cbteTipo: number;
  construir: (numero: number) => { fila: any; payload: FeCaeRequest };
}): Promise<{ id: number; payload: FeCaeRequest }> {
  const { storeId, ambiente, ptoVta, cbteTipo } = args;
  const claveLock = `arca:${storeId}:${ambiente}:${ptoVta}:${cbteTipo}`;

  return db.transaction(async (tx: any) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${claveLock}))`);

    // Otra emisión de ESTA secuencia en vuelo: esperar es mucho mejor UX que
    // que ARCA rechace por no correlativo.
    const enVuelo = await tx.select({ id: comprobantes.id }).from(comprobantes).where(and(
      eq(comprobantes.storeId, storeId),
      eq(comprobantes.ambiente, ambiente),
      eq(comprobantes.ptoVta, ptoVta),
      eq(comprobantes.cbteTipo, cbteTipo),
      eq(comprobantes.estado, "pendiente"),
      sql`${comprobantes.updatedAt} > now() - interval '${sql.raw(String(EN_VUELO_MS / 1000))} seconds'`,
    )).limit(1);
    if (enVuelo.length > 0) throw new Error("EMISION_EN_CURSO");

    const numero = await proximoNumero(tx, arca, { storeId, ambiente, ptoVta, cbteTipo });
    const { fila, payload } = args.construir(numero);

    try {
      const [insertado] = await tx.insert(comprobantes)
        .values({ ...fila, requestJson: scrubPayload(payload) })
        .returning({ id: comprobantes.id });
      return { id: insertado.id, payload };
    } catch (err) {
      // Backstop de los índices parciales de 0015: si dos clics llegaron a la
      // vez, uno rebota acá. Mismo desenvoltorio de error que openCashSession.
      const code = (err as { cause?: { code?: string }; code?: string })?.cause?.code
        ?? (err as { code?: string })?.code;
      if (code === "23505") throw new Error("EMISION_EN_CURSO");
      throw err;
    }
  });
}

/**
 * Próximo número de la secuencia, derivado de la tabla y NUNCA de un contador
 * `next_numero`: un contador es una segunda fuente de verdad que deriva en
 * silencio respecto de lo que ARCA tiene registrado.
 *
 * Los `rechazado` quedan afuera del máximo a propósito: ARCA no avanza su
 * numeración cuando responde Resultado = R, así que el número sigue libre.
 */
async function proximoNumero(tx: any, arca: ArcaClientPort, args: {
  storeId: number; ambiente: Comprobante["ambiente"]; ptoVta: number; cbteTipo: number;
}): Promise<number> {
  const enSecuencia = and(
    eq(comprobantes.storeId, args.storeId),
    eq(comprobantes.ambiente, args.ambiente),
    eq(comprobantes.ptoVta, args.ptoVta),
    eq(comprobantes.cbteTipo, args.cbteTipo),
  );

  const [row] = await tx.select({ ultimo: max(comprobantes.numero) }).from(comprobantes)
    .where(and(enSecuencia, sql`${comprobantes.estado} <> 'rechazado'`));
  const ultimoLocal = row?.ultimo ?? 0;

  // ¿Hay que preguntarle a ARCA cuál fue el último que autorizó?
  //
  //   a) Primera emisión de la secuencia: la tienda pudo haber facturado antes
  //      desde otro sistema, y arrancar en 1 sería rechazo garantizado.
  //   b) El último intento de esta secuencia fue RECHAZADO. Sin esto, el sistema
  //      se cuelga en un bucle: el rechazado no cuenta para el máximo local, así
  //      que el reintento propone el mismo número, ARCA lo vuelve a rechazar, y
  //      así para siempre. Pasa cada vez que la numeración de ARCA avanzó por
  //      afuera — por ejemplo si el contador emitió comprobantes desde el portal
  //      sobre el mismo punto de venta.
  const [ultimoIntento] = await tx.select({ estado: comprobantes.estado }).from(comprobantes)
    .where(enSecuencia).orderBy(desc(comprobantes.id)).limit(1);

  const hayQueConsultar = ultimoLocal === 0 || ultimoIntento?.estado === "rechazado";
  if (!hayQueConsultar) return ultimoLocal + 1;

  const enArca = await arca.lastAuthorized(args.cbteTipo);
  // ARCA es la autoridad, pero se toma el máximo por las dudas: si nuestra base
  // conoce un comprobante autorizado que ARCA todavía no reporta, saltearlo
  // dejaría un duplicado.
  return Math.max(ultimoLocal, enArca) + 1;
}

// ---- fase 2 y 3: llamar y asentar ----

async function llamarYAsentar(
  db: any, arca: ArcaClientPort, comprobanteId: number, payload: FeCaeRequest,
): Promise<Comprobante> {
  let respuesta: FeCaeResponse;
  try {
    respuesta = await conTimeout(arca.authorize(payload), TIMEOUT_ARCA_MS);
  } catch (err) {
    // Un socket colgado no puede dejar la fila `pendiente` sin registro del
    // intento: pasa a `error`, que retiene el número hasta reconciliar.
    const detalle = err instanceof Error ? err.message : String(err);
    console.error("[fiscal/emision] fallo llamando a ARCA:", detalle);
    return asentarError(db, comprobanteId, detalle);
  }

  return asentarResultado(db, arca, comprobanteId, respuesta);
}

/**
 * Asienta la respuesta de ARCA.
 *
 * ⚠️ El caso aprobado NO se guarda por `estado = 'pendiente'`, y esa asimetría es
 * deliberada. Un CAE otorgado es un hecho fiscal irreversible: si mientras la
 * llamada estaba en vuelo alguien tocó la fila (por ejemplo con "Consultar en
 * ARCA"), guardar por `pendiente` haría que el UPDATE no matchee nada y el CAE se
 * perdería en silencio — quedaría autorizado en ARCA y sin registro acá. Por eso
 * se acepta también desde `rechazado` y `error`.
 *
 * El único estado que no se pisa es `autorizado`: ahí ya hay un CAE escrito y
 * sobrescribirlo sí sería destruir información.
 */
export async function asentarResultado(
  db: any, arca: ArcaClientPort, comprobanteId: number, r: FeCaeResponse,
): Promise<Comprobante> {
  const observaciones = [...r.observaciones, ...r.errores];
  const aprobado = (r.resultado === "A" || r.resultado === "P") && !!r.cae;

  if (aprobado) {
    const [fila] = await db.update(comprobantes).set({
      estado: "autorizado",
      cae: r.cae,
      caeVto: r.caeVto ? isoDesdeArca(r.caeVto) : null,
      resultado: r.resultado,
      observaciones: observaciones.length > 0 ? observaciones : null,
      responseJson: r.raw as object,
      autorizadoAt: AHORA_DB,
      errorMsg: null,
      intentos: sql`${comprobantes.intentos} + 1`,
      updatedAt: AHORA_DB,
    }).where(and(
      eq(comprobantes.id, comprobanteId),
      sql`${comprobantes.estado} <> 'autorizado'`,
    )).returning();

    if (fila) return fila;

    // Ya estaba autorizado. Si el CAE guardado no es el que acabamos de recibir,
    // hay dos autorizaciones para el mismo número: no se pisa nada y se grita.
    const actual = await getComprobante(db, comprobanteId);
    if (actual?.cae && actual.cae !== r.cae) {
      console.error(
        `[fiscal/emision] CAE distinto para el comprobante ${comprobanteId}: guardado ${actual.cae}, recibido ${r.cae}`,
      );
    }
    return actual;
  }

  // Rechazado: ARCA NO consumió el número. La fila queda `rechazado` para que el
  // reintento pueda reusarlo (los índices parciales de 0015 lo permiten).
  //
  // Acá SÍ se guarda por `pendiente`: un rechazo nunca puede pisar un CAE.
  const [fila] = await db.update(comprobantes).set({
    estado: "rechazado",
    resultado: r.resultado,
    observaciones: observaciones.length > 0 ? observaciones : null,
    errorMsg: mensajeRechazo(observaciones),
    responseJson: r.raw as object,
    intentos: sql`${comprobantes.intentos} + 1`,
    updatedAt: AHORA_DB,
  }).where(and(eq(comprobantes.id, comprobanteId), eq(comprobantes.estado, "pendiente"))).returning();

  if (esNumeracionDesfasada(observaciones)) {
    console.warn("[fiscal/emision] numeración desfasada; la próxima reserva re-siembra desde ARCA");
  }

  return fila ?? (await getComprobante(db, comprobanteId));
}

async function asentarError(db: any, comprobanteId: number, detalle: string): Promise<Comprobante> {
  const [fila] = await db.update(comprobantes).set({
    estado: "error",
    // NO se le muestra `detalle` al usuario: puede traer texto crudo del
    // proveedor. Va a la columna para diagnóstico y el route handler traduce.
    errorMsg: "No se pudo confirmar el resultado con ARCA. Verificá el comprobante.",
    intentos: sql`${comprobantes.intentos} + 1`,
    updatedAt: AHORA_DB,
  }).where(and(eq(comprobantes.id, comprobanteId), eq(comprobantes.estado, "pendiente"))).returning();
  return fila ?? (await getComprobante(db, comprobanteId));
}

// ---- reconciliación ----

/**
 * Resuelve un comprobante del que no sabemos el resultado, preguntándole a ARCA
 * qué pasó con ese número.
 *
 * Es el mecanismo de recuperación para el peor escenario: ARCA otorgó un CAE y
 * nosotros perdimos la respuesta.
 */
export async function reconciliarComprobante(
  db: any, arca: ArcaClientPort, input: { storeId: number; comprobanteId: number },
): Promise<Comprobante> {
  const [fila] = await db.select(columnasConEdad).from(comprobantes)
    .where(and(eq(comprobantes.id, input.comprobanteId), eq(comprobantes.storeId, input.storeId)));
  if (!fila) throw new Error("VENTA_NO_ENCONTRADA");
  if (fila.estado === "autorizado" || fila.estado === "rechazado") return fila;

  // ⚠️ Guarda de edad OBLIGATORIA, no una optimización.
  //
  // Un `pendiente` reciente puede tener una llamada a ARCA en vuelo AHORA MISMO.
  // Reconciliarlo consultaría un número que ARCA todavía no terminó de procesar,
  // lo marcaría `rechazado` (liberando el número), y cuando llegue la respuesta
  // real con el CAE ese número ya estaría reasignado a otra venta. Este chequeo
  // es lo que impide que el botón "Consultar en ARCA" corrompa una emisión en
  // curso.
  if (!hayQueReconciliar(fila)) return fila;

  let enArca: FeCompConsultarResponse | null;
  try {
    enArca = await conTimeout(arca.consult(fila.cbteTipo, fila.numero), TIMEOUT_ARCA_MS);
  } catch (err) {
    // Incluye el caso en que ARCA responde un error que NO es "no existe": ahí
    // no sabemos nada nuevo, y liberar el número sería inventar información.
    console.error("[fiscal/emision] fallo consultando a ARCA:", err instanceof Error ? err.message : err);
    return fila; // sigue en error / pendiente; se reintenta después
  }

  // Todos los UPDATE de acá abajo van guardados por el estado que leímos: si
  // entretanto la emisión original terminó de asentar su resultado, esta
  // reconciliación no lo pisa.
  const mismoEstado = and(eq(comprobantes.id, fila.id), eq(comprobantes.estado, fila.estado));

  // ARCA dice que no existe: el número nunca se consumió. Queda libre.
  if (!enArca || !enArca.cae) {
    const [act] = await db.update(comprobantes).set({
      estado: "rechazado",
      errorMsg: "ARCA no tiene registrado este comprobante. El número quedó libre para reintentar.",
      updatedAt: AHORA_DB,
    }).where(mismoEstado).returning();
    return act ?? (await getComprobante(db, fila.id));
  }

  // ⚠️ Guarda de seguridad: solo se adopta si el importe coincide al centavo.
  // Si no, ese número lo ocupó OTRO comprobante y adoptarlo sería atribuirnos un
  // documento fiscal ajeno. Requiere un humano.
  const mismoImporte = enArca.impTotal != null
    && Math.round(enArca.impTotal * 100) === Math.round(fila.impTotal * 100);

  if (!mismoImporte) {
    const [act] = await db.update(comprobantes).set({
      estado: "error",
      errorMsg: `El número ${fila.numero} ya fue usado por otro comprobante en ARCA. Contactá a tu contador.`,
      updatedAt: AHORA_DB,
    }).where(mismoEstado).returning();
    return act ?? (await getComprobante(db, fila.id));
  }

  const [act] = await db.update(comprobantes).set({
    estado: "autorizado",
    cae: enArca.cae,
    caeVto: enArca.caeVto ? isoDesdeArca(enArca.caeVto) : null,
    resultado: enArca.resultado ?? "A",
    responseJson: enArca.raw as object,
    autorizadoAt: AHORA_DB,
    errorMsg: null,
    updatedAt: AHORA_DB,
  }).where(mismoEstado).returning();
  return act ?? (await getComprobante(db, fila.id));
}

// ---- helpers ----

async function getComprobante(db: any, id: number): Promise<Comprobante> {
  const [fila] = await db.select().from(comprobantes).where(eq(comprobantes.id, id));
  return fila;
}

async function cargarVenta(db: any, storeId: number, saleId: number, clientIdOverride?: number | null) {
  const [venta] = await db.select().from(sales)
    .where(and(eq(sales.id, saleId), eq(sales.storeId, storeId)));
  if (!venta) throw new Error("VENTA_NO_ENCONTRADA");
  if (venta.voided) throw new Error("VENTA_ANULADA");

  const filas = await db.select({
    quantity: saleItems.quantity,
    unitPrice: saleItems.unitPrice,
    discountAmount: saleItems.discountAmount,
    productName: products.name,
    variantName: productVariants.name,
  }).from(saleItems)
    .innerJoin(productVariants, eq(saleItems.variantId, productVariants.id))
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(eq(saleItems.saleId, saleId))
    .orderBy(saleItems.id);

  const items: ItemVenta[] = filas.map((f: any) => ({
    descripcion: f.variantName ? `${f.productName} ${f.variantName}`.trim() : f.productName,
    cantidad: f.quantity,
    unitPrice: f.unitPrice,
    discountAmount: f.discountAmount,
  }));

  // El cliente puede venir de la venta (cuenta corriente) o adjuntarse recién al
  // facturar. En el segundo caso NO se toca sales.clientId: esa columna significa
  // "cliente de cuenta corriente" y escribirla inyectaría una compra fantasma en
  // el ledger. El vínculo de reporte va en comprobantes.clientId.
  const clientId = clientIdOverride ?? venta.clientId;
  let cliente: ClienteFiscal | null = null;
  if (clientId != null) {
    const [c] = await db.select({
      id: clients.id, name: clients.name, docTipo: clients.docTipo, docNro: clients.docNro,
      condicionIva: clients.condicionIva, razonSocial: clients.razonSocial, domicilio: clients.domicilio,
    }).from(clients).where(and(eq(clients.id, clientId), eq(clients.storeId, storeId)));
    if (!c) throw new Error("CLIENT_NOT_FOUND");
    cliente = c;
  }

  return { venta, items, cliente };
}

function conTimeout<T>(promesa: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promesa,
    new Promise<T>((_, rechazar) => setTimeout(() => rechazar(new Error("ARCA_TIMEOUT")), ms)),
  ]);
}
