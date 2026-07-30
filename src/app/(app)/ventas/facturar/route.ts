import { db } from "@/db";
import { assertSameOrigin, requireStore } from "@/lib/session";
import { getFiscalConfig } from "@/domain/fiscal-config";
import { createArcaClientForStore } from "@/lib/arca/client";
import {
  emitirFactura, emitirNotaCredito, reconciliarComprobante, getComprobantesBySale,
} from "@/domain/fiscal-emision";
import { mensajeDeObservaciones } from "@/domain/fiscal-comprobante";
import { CBTE_LABEL, formatearNumeroComprobante, type CbteTipo } from "@/domain/fiscal-catalogs";
import { arcaUserMessage } from "@/lib/arca/errors";
import type { Comprobante } from "@/db/schema";

/**
 * Emisión de comprobantes. Route handler y no server action porque:
 *   1. `maxDuration` es un export de ROUTE SEGMENT: una server action hereda el
 *      de la página, así que darle 60 s a esta operación implicaría dárselos a
 *      toda /ventas.
 *   2. Next serializa las server actions por cliente: una llamada colgada a ARCA
 *      congelaría el resto de la página.
 *   3. Los status HTTP (409/422/502/504) manejan la UI de reintento con
 *      precisión que un `{error: string}` no da.
 *
 * Mismo patrón que src/app/(app)/importar/extract/route.ts.
 */

export const maxDuration = 60;

type Accion = "factura" | "nota_credito" | "consultar";

const fail = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  let storeId: number;
  let userId: string;
  let role: string;
  try {
    await assertSameOrigin();
    const u = await requireStore();
    storeId = u.storeId;
    userId = u.id;
    role = u.role;
  } catch {
    return fail(403, "No tenés permiso para hacer esto.");
  }

  let body: { saleId?: number; clientId?: number | null; accion?: Accion };
  try {
    body = await req.json();
  } catch {
    return fail(400, "Pedido inválido.");
  }

  const saleId = Number(body.saleId);
  if (!Number.isInteger(saleId) || saleId <= 0) return fail(400, "Venta inválida.");
  const accion: Accion = body.accion ?? "factura";

  // El chequeo de configuración va ANTES de armar el cliente de ARCA, para poder
  // dar un mensaje accionable en vez de un error de credenciales.
  const config = await getFiscalConfig(db, storeId);
  if (!config?.enabled) {
    return fail(400, "Todavía no configuraste la facturación electrónica. Andá a Facturación y cargá tu CUIT, punto de venta y certificado.");
  }

  const esDueno = role === "owner";
  if (!esDueno && !config.empleadosPuedenEmitir) {
    return fail(403, "Tu usuario no tiene habilitado emitir facturas. Pedile al dueño que lo active en Facturación.");
  }
  // Las notas de crédito son siempre del dueño: revierten un comprobante fiscal.
  if (accion === "nota_credito" && !esDueno) {
    return fail(403, "Solo el dueño puede emitir notas de crédito.");
  }

  try {
    const arca = await createArcaClientForStore(db, storeId);

    if (accion === "consultar") {
      const previos = await getComprobantesBySale(db, storeId, saleId);
      const aResolver = previos.filter((c) => c.estado === "pendiente" || c.estado === "error");
      if (aResolver.length === 0) return Response.json({ ok: true, comprobantes: previos.map(resumir) });

      for (const c of aResolver) {
        await reconciliarComprobante(db, arca, { storeId, comprobanteId: c.id });
      }
      const actualizados = await getComprobantesBySale(db, storeId, saleId);
      return Response.json({ ok: true, comprobantes: actualizados.map(resumir) });
    }

    const cbte = accion === "nota_credito"
      ? await emitirNotaCredito(db, arca, { storeId, saleId, userId })
      : await emitirFactura(db, arca, { storeId, saleId, userId, clientId: body.clientId ?? undefined });

    // Un rechazo de ARCA NO es una excepción: la fila de auditoría existe y el
    // usuario necesita ver el motivo exacto para poder corregirlo.
    if (cbte.estado === "rechazado") {
      return Response.json(
        { ok: false, comprobante: resumir(cbte), error: cbte.errorMsg ?? "ARCA rechazó el comprobante." },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (cbte.estado === "error") {
      return Response.json(
        {
          ok: false, comprobante: resumir(cbte),
          error: "No se pudo confirmar el resultado con ARCA. Tocá «Consultar en ARCA» para verificar qué pasó.",
        },
        { status: 504, headers: { "Cache-Control": "no-store" } },
      );
    }

    return Response.json({ ok: true, comprobante: resumir(cbte) }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[ventas/facturar]", err instanceof Error ? err.message : err);
    const { status, message } = arcaUserMessage(err);
    return fail(status, message);
  }
}

/** Lo que ve el cliente. Nunca el request/response crudo ni credenciales. */
function resumir(c: Comprobante) {
  return {
    id: c.id,
    clase: c.clase,
    estado: c.estado,
    etiqueta: `${CBTE_LABEL[c.cbteTipo as CbteTipo] ?? `Tipo ${c.cbteTipo}`} ${formatearNumeroComprobante(c.ptoVta, c.numero)}`,
    cae: c.cae,
    caeVto: c.caeVto,
    ambiente: c.ambiente,
    observaciones: mensajeDeObservaciones(c.observaciones),
    errorMsg: c.errorMsg,
  };
}
