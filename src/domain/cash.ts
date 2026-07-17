import { and, eq, isNull, sql } from "drizzle-orm";
import { cashSessions, sales, type CashSession } from "@/db/schema";

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function getOpenSession(db: any): Promise<CashSession | null> {
  const rows = await db.select().from(cashSessions).where(isNull(cashSessions.closedAt)).limit(1);
  return rows[0] ?? null;
}

// Código de error de Postgres (y PGlite) para violación de restricción
// unique/exclusion, incluyendo índices únicos parciales.
const PG_UNIQUE_VIOLATION = "23505";

export async function openCashSession(db: any, input: { userId: string; openingCash: number }): Promise<CashSession> {
  if (await getOpenSession(db)) throw new Error("SESSION_ALREADY_OPEN");
  try {
    const [s] = await db.insert(cashSessions)
      .values({ openedBy: input.userId, openingCash: round2(input.openingCash) })
      .returning();
    return s;
  } catch (err: any) {
    // Guarda de última instancia contra la carrera check-then-insert: si dos
    // llamadas concurrentes pasan el pre-check de arriba, el índice único
    // parcial `cash_sessions_one_open_idx` (ver schema.ts) rechaza la
    // segunda inserción a nivel de DB. Drizzle envuelve el error real del
    // driver (con el `code` de Postgres) en `err.cause`, así que hay que
    // mirar tanto `err` como `err.cause`.
    const code = err?.code ?? err?.cause?.code;
    const message = String(err?.message ?? err?.cause?.message ?? err ?? "");
    if (code === PG_UNIQUE_VIOLATION || /cash_sessions_one_open_idx/.test(message)) {
      throw new Error("SESSION_ALREADY_OPEN");
    }
    throw err;
  }
}

export async function closeCashSession(
  db: any,
  input: { sessionId: number; userId: string; countedCash: number; notes?: string }
): Promise<CashSession> {
  const [session] = await db.select().from(cashSessions).where(eq(cashSessions.id, input.sessionId));
  if (!session || session.closedAt) throw new Error("SESSION_NOT_OPEN");

  const totals = await db
    .select({
      method: sales.paymentMethod,
      total: sql<number>`coalesce(sum(${sales.total}), 0)`.mapWith(Number),
    })
    .from(sales)
    .where(and(eq(sales.cashSessionId, input.sessionId), eq(sales.voided, false)))
    .groupBy(sales.paymentMethod);

  const byMethod = Object.fromEntries(totals.map((t: any) => [t.method, t.total]));
  const expectedCash = round2(session.openingCash + (byMethod.efectivo ?? 0));

  const [closed] = await db.update(cashSessions)
    .set({
      closedAt: new Date(),
      closedBy: input.userId,
      expectedCash,
      totalTransfer: round2(byMethod.transferencia ?? 0),
      totalCard: round2(byMethod.tarjeta ?? 0),
      countedCash: round2(input.countedCash),
      difference: round2(input.countedCash - expectedCash),
      notes: input.notes,
    })
    .where(eq(cashSessions.id, input.sessionId))
    .returning();
  return closed;
}
