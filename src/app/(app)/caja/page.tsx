import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { clientAccountMovements, clients, sales, user } from "@/db/schema";
import { requireStore } from "@/lib/session";
import { getOpenSession, getSessionCashMovements } from "@/domain/cash";
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

  const [totals, movements] = await Promise.all([
    db
      .select({
        method: sales.paymentMethod,
        count: sql<number>`count(*)`.mapWith(Number),
        total: sql<number>`coalesce(sum(${sales.total}), 0)`.mapWith(Number),
      })
      .from(sales)
      .where(and(eq(sales.cashSessionId, session.id), eq(sales.voided, false)))
      .groupBy(sales.paymentMethod),
    getSessionCashMovements(db, session.id),
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
    .where(and(
      eq(clientAccountMovements.cashSessionId, session.id),
      eq(clientAccountMovements.method, "efectivo"),
      inArray(clientAccountMovements.type, ["pago", "credito"]),
    ))
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
      />
    </div>
  );
}
