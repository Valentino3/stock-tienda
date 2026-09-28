import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { clientAccountMovements, clients, sales, salePayments, user } from "@/db/schema";
import { requireStore } from "@/lib/session";
import { efectivoDeCuentaEnCaja, getOpenSession, getSessionCashMovements } from "@/domain/cash";
import { getVentasDelTurno } from "@/domain/cash-close";
import { VentasDelTurno } from "@/components/caja/ventas-del-turno";
import { PageHeader } from "@/components/ui/page-header";
import { CajaClient } from "./caja-client";

export default async function CajaPage() {
  const currentUser = await requireStore();
  const isOwner = currentUser.role === "owner";
  const session = await getOpenSession(db, currentUser.storeId);

  if (!session) {
    return (
      <div className="space-y-6">
        <PageHeader title="Caja" description="Abrí la caja para empezar a vender." />
        <CajaClient session={null} openedByName={null} totals={[]} movements={[]} cobrosCuenta={[]} isOwner={isOwner} />
      </div>
    );
  }

  const [openedByUser] = await db.select({ name: user.name }).from(user).where(eq(user.id, session.openedBy));

  const [totals, movements, ventas] = await Promise.all([
    db
      // Se suma de `sale_payments`: con pago dividido una venta aporta a mas
      // de un medio. `count` pasa a contar PAGOS, no ventas — ver la etiqueta.
      .select({
        method: salePayments.method,
        count: sql<number>`count(*)`.mapWith(Number),
        total: sql<number>`coalesce(sum(${salePayments.amount}), 0)`.mapWith(Number),
      })
      .from(salePayments)
      .innerJoin(sales, eq(salePayments.saleId, sales.id))
      .where(and(eq(sales.cashSessionId, session.id), eq(sales.voided, false)))
      .groupBy(salePayments.method),
    getSessionCashMovements(db, session.id),
    // La lista SÍ se recorta al empleado; los totales de arriba no. Un empleado
    // ya veía el total de la caja entera y lo sigue viendo: lo que no ve son
    // las ventas de otro, igual que en /ventas.
    getVentasDelTurno(db, currentUser.storeId, session.id, {
      visibleParaUserId: isOwner ? undefined : currentUser.id,
    }),
  ]);

  // Cobros de cuenta corriente en efectivo imputados a esta caja. Van a la
  // pantalla porque desde ahora suman al esperado: sin mostrarlos, el arqueo
  // incluiria plata que la caja no explica en ningun lado.
  const cobrosCuenta = await db
    .select({
      id: clientAccountMovements.id,
      clientName: clients.name,
      type: clientAccountMovements.type,
      amount: clientAccountMovements.amount,
    })
    .from(clientAccountMovements)
    .innerJoin(clients, eq(clientAccountMovements.clientId, clients.id))
    .where(efectivoDeCuentaEnCaja(session.id))
    .orderBy(clientAccountMovements.createdAt);

  return (
    <div className="space-y-6">
      <PageHeader title="Caja" description="Caja abierta. Cerrá con el conteo al terminar el turno." />
      <CajaClient
        session={{ id: session.id, openedAt: session.openedAt, openingCash: session.openingCash }}
        openedByName={openedByUser?.name ?? null}
        totals={totals}
        movements={movements.map((m) => ({
          id: m.id,
          kind: m.kind,
          amount: m.amount,
          description: m.description,
          createdAt: m.createdAt,
        }))}
        cobrosCuenta={cobrosCuenta as any[]}
        isOwner={isOwner}
        ventasDelTurno={
          <VentasDelTurno
            remitos={ventas ?? []}
            soloPropias={!isOwner}
            hojaHref={isOwner ? `/caja/${session.id}/cierre` : undefined}
          />
        }
      />
    </div>
  );
}
