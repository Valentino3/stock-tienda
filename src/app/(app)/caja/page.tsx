import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { sales, user } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { getOpenSession } from "@/domain/cash";
import { CajaClient } from "./caja-client";

export default async function CajaPage() {
  await requireUser();
  const session = await getOpenSession(db);

  if (!session) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Caja</h1>
        <CajaClient session={null} openedByName={null} totals={[]} />
      </div>
    );
  }

  const [openedByUser] = await db.select({ name: user.name }).from(user).where(eq(user.id, session.openedBy));

  const totals = await db
    .select({
      method: sales.paymentMethod,
      count: sql<number>`count(*)`.mapWith(Number),
      total: sql<number>`coalesce(sum(${sales.total}), 0)`.mapWith(Number),
    })
    .from(sales)
    .where(and(eq(sales.cashSessionId, session.id), eq(sales.voided, false)))
    .groupBy(sales.paymentMethod);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Caja</h1>
      <CajaClient
        session={{ id: session.id, openedAt: session.openedAt, openingCash: session.openingCash }}
        openedByName={openedByUser?.name ?? null}
        totals={totals}
      />
    </div>
  );
}
