import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireStore } from "@/lib/session";
import { getOpenSession } from "@/domain/cash";
import { snapshotCatalogo } from "@/domain/catalog";

/**
 * Foto del catálogo, los clientes y la caja abierta para vender sin conexión.
 *
 * Se baja entera y de una: la alternativa (sincronizar deltas) agrega un cursor
 * y una clase de bugs de "me perdí un cambio" para ahorrar unos megabytes en
 * una operación que se hace una vez antes de salir a una feria.
 *
 * El `cashSessionId` es la pieza que no puede faltar: cada venta offline queda
 * imputada a la caja que estaba abierta cuando se cobró, no a la que esté
 * abierta al sincronizar (ver src/domain/sales-replay.ts).
 */

export const maxDuration = 60;

export async function GET() {
  let storeId: number;
  try {
    ({ storeId } = await requireStore());
  } catch {
    return Response.json({ error: "No tenés permiso para hacer esto." }, {
      status: 403, headers: { "Cache-Control": "no-store" },
    });
  }

  const [{ variantes, truncado }, listaClientes, caja] = await Promise.all([
    snapshotCatalogo(db, storeId),
    db.select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(and(eq(clients.storeId, storeId), eq(clients.active, true)))
      .orderBy(clients.name),
    getOpenSession(db, storeId),
  ]);

  return Response.json({
    generadoEn: new Date().toISOString(),
    storeId,
    cashSessionId: caja?.id ?? null,
    variantes,
    clientes: listaClientes,
    truncado,
  }, { headers: { "Cache-Control": "no-store" } });
}
