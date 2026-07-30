import { and, eq } from "drizzle-orm";
import { comprobantes, storeFiscalConfig, stores, type Comprobante, type StoreFiscalConfig } from "@/db/schema";
import { qrUrlDeComprobante } from "@/lib/arca/qr";

/**
 * Ensamblado de datos para imprimir un comprobante.
 *
 * El armado va separado del renderizado a propósito: si algún día hace falta un
 * PDF por email, se cambia el renderer sin tocar nada de esto.
 */

export type ComprobanteView = {
  comprobante: Comprobante;
  emisor: StoreFiscalConfig;
  nombreTienda: string;
  /** null mientras no haya CAE. */
  qrUrl: string | null;
  /** El comprobante asociado, cuando es una nota de crédito. */
  asociado: { cbteTipo: number; ptoVta: number; numero: number; cbteFch: string } | null;
};

/**
 * ⚠️ Scopeado por storeId SIEMPRE: los ids son secuenciales y un `eq(id)` pelado
 * filtraría documentos fiscales de otro comercio.
 */
export async function getComprobanteView(
  db: any, storeId: number, comprobanteId: number,
): Promise<ComprobanteView | null> {
  const [cbte] = await db.select().from(comprobantes)
    .where(and(eq(comprobantes.id, comprobanteId), eq(comprobantes.storeId, storeId)));
  if (!cbte) return null;
  return armarView(db, cbte);
}

/**
 * El mismo comprobante, buscado por el token del link público — el que le llega
 * al cliente por WhatsApp o por mail.
 *
 * Acá NO hay storeId porque no hay sesión: el token es la credencial. Por eso el
 * token es de 32 bytes al azar, la búsqueda es por índice único, y solo se
 * devuelven comprobantes AUTORIZADOS: un rechazado o uno a medio emitir no es un
 * documento que corresponda mostrarle a nadie.
 */
export async function getComprobanteViewPorToken(
  db: any, token: string,
): Promise<ComprobanteView | null> {
  // Un token vacío matchearía filas viejas sin token si la columna llegara a
  // tener cadenas vacías. Se corta antes de consultar.
  if (!token || token.length < 20) return null;

  const [cbte] = await db.select().from(comprobantes).where(and(
    eq(comprobantes.publicToken, token),
    eq(comprobantes.estado, "autorizado"),
  ));
  if (!cbte) return null;
  return armarView(db, cbte);
}

async function armarView(db: any, cbte: Comprobante): Promise<ComprobanteView | null> {
  const storeId = cbte.storeId;

  const [emisor] = await db.select().from(storeFiscalConfig)
    .where(eq(storeFiscalConfig.storeId, storeId));
  if (!emisor) return null;

  const [tienda] = await db.select({ name: stores.name }).from(stores).where(eq(stores.id, storeId));

  let asociado: ComprobanteView["asociado"] = null;
  if (cbte.cbteAsocId) {
    const [a] = await db.select({
      cbteTipo: comprobantes.cbteTipo, ptoVta: comprobantes.ptoVta,
      numero: comprobantes.numero, cbteFch: comprobantes.cbteFch,
    }).from(comprobantes).where(and(
      eq(comprobantes.id, cbte.cbteAsocId), eq(comprobantes.storeId, storeId),
    ));
    asociado = a ?? null;
  }

  return {
    comprobante: cbte,
    emisor,
    nombreTienda: tienda?.name ?? emisor.razonSocial,
    qrUrl: qrUrlDeComprobante(cbte),
    asociado,
  };
}
