import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { sales, user } from "@/db/schema";
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
        <CajaClient session={null} openedByName={null} totals={[]} movements={[]} isOwner={isOwner} />
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
        isOwner={isOwner}
      />
    </div>
  );
}
