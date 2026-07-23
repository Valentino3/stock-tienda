import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { cashMovements, cashSessions, sales, type CashMovement, type CashSession } from "@/db/schema";

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function getOpenSession(db: any, storeId: number): Promise<CashSession | null> {
  const rows = await db.select().from(cashSessions)
    .where(and(eq(cashSessions.storeId, storeId), isNull(cashSessions.closedAt))).limit(1);
  return rows[0] ?? null;
}

// Registra una salida de efectivo (gasto o egreso) contra la caja abierta.
// Ambos tipos restan del efectivo esperado al cerrar (ver closeCashSession).
export async function createCashMovement(
  db: any,
  input: { storeId: number; sessionId: number; kind: "gasto" | "egreso"; amount: number; description: string; userId: string }
): Promise<CashMovement> {
  if (!(input.amount > 0)) throw new Error("INVALID_AMOUNT");
  if (!input.description.trim()) throw new Error("EMPTY_DESCRIPTION");
  const session = await getOpenSession(db, input.storeId);
  if (!session || session.id !== input.sessionId) throw new Error("NO_OPEN_SESSION");
  const [row] = await db.insert(cashMovements).values({
    cashSessionId: input.sessionId,
    kind: input.kind,
    amount: round2(input.amount),
    description: input.description.trim(),
    createdBy: input.userId,
  }).returning();
  return row;
}

export async function getSessionCashMovements(db: any, sessionId: number): Promise<CashMovement[]> {
  return db.select().from(cashMovements)
    .where(eq(cashMovements.cashSessionId, sessionId))
    .orderBy(desc(cashMovements.createdAt));
}

// Código de error de Postgres (y PGlite) para violación de restricción
// unique/exclusion, incluyendo índices únicos parciales.
const PG_UNIQUE_VIOLATION = "23505";

export async function openCashSession(db: any, input: { storeId: number; userId: string; openingCash: number }): Promise<CashSession> {
  if (await getOpenSession(db, input.storeId)) throw new Error("SESSION_ALREADY_OPEN");
  try {
    const [s] = await db.insert(cashSessions)
      .values({ storeId: input.storeId, openedBy: input.userId, openingCash: round2(input.openingCash) })
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
  input: { storeId: number; sessionId: number; userId: string; countedCash: number; notes?: string }
): Promise<CashSession> {
  return db.transaction(async (tx: any) => {
    // Lock the session row so a concurrent close (or a sale committing
    // between the totals select and the final update) serializes against
    // this transaction — same FOR UPDATE pattern as createSale in sales.ts.
    // Scopeado por tienda: no se cierra la caja de otra tienda por id.
    const [session] = await tx.select().from(cashSessions)
      .where(and(eq(cashSessions.id, input.sessionId), eq(cashSessions.storeId, input.storeId))).for("update");
    if (!session || session.closedAt) throw new Error("SESSION_NOT_OPEN");

    const totals = await tx
      .select({
        method: sales.paymentMethod,
        total: sql<number>`coalesce(sum(${sales.total}), 0)`.mapWith(Number),
      })
      .from(sales)
      .where(and(eq(sales.cashSessionId, input.sessionId), eq(sales.voided, false)))
      .groupBy(sales.paymentMethod);

    // Gastos + egresos: efectivo que salió de la caja, resta del esperado.
    const [{ out }] = await tx
      .select({ out: sql<number>`coalesce(sum(${cashMovements.amount}), 0)`.mapWith(Number) })
      .from(cashMovements)
      .where(eq(cashMovements.cashSessionId, input.sessionId));

    const byMethod = Object.fromEntries(totals.map((t: any) => [t.method, t.total]));
    const expectedCash = round2(session.openingCash + (byMethod.efectivo ?? 0) - out);

    const [closed] = await tx.update(cashSessions)
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
      .where(and(eq(cashSessions.id, input.sessionId), eq(cashSessions.storeId, input.storeId), isNull(cashSessions.closedAt)))
      .returning();
    if (!closed) throw new Error("SESSION_NOT_OPEN");
    return closed;
  });
}
