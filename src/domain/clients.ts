import { and, desc, eq, sql } from "drizzle-orm";
import { clients, clientAccountMovements, type Client } from "@/db/schema";

const round2 = (n: number) => Math.round(n * 100) / 100;

// Saldo = Σcargo − Σpago (positivo = el cliente debe).
const balanceExpr = sql<number>`coalesce(sum(case when ${clientAccountMovements.type} = 'cargo' then ${clientAccountMovements.amount} else -${clientAccountMovements.amount} end), 0)`;

export async function createClient(
  db: any,
  input: { storeId: number; name: string; phone?: string | null; note?: string | null }
): Promise<Client> {
  if (!input.name.trim()) throw new Error("EMPTY_NAME");
  const [row] = await db.insert(clients).values({
    storeId: input.storeId,
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    note: input.note?.trim() || null,
  }).returning();
  return row;
}

export async function listClientsWithBalance(db: any, storeId: number) {
  return db
    .select({
      id: clients.id,
      name: clients.name,
      phone: clients.phone,
      active: clients.active,
      balance: balanceExpr.mapWith(Number),
    })
    .from(clients)
    .leftJoin(clientAccountMovements, eq(clientAccountMovements.clientId, clients.id))
    .where(eq(clients.storeId, storeId))
    .groupBy(clients.id)
    .orderBy(clients.name);
}

export async function getClient(db: any, storeId: number, id: number): Promise<Client | null> {
  const [row] = await db.select().from(clients)
    .where(and(eq(clients.id, id), eq(clients.storeId, storeId)));
  return row ?? null;
}

export async function getClientMovements(db: any, storeId: number, clientId: number) {
  return db.select().from(clientAccountMovements)
    .where(and(eq(clientAccountMovements.storeId, storeId), eq(clientAccountMovements.clientId, clientId)))
    .orderBy(desc(clientAccountMovements.createdAt));
}

export async function getClientBalance(db: any, storeId: number, clientId: number): Promise<number> {
  const [row] = await db
    .select({ balance: balanceExpr.mapWith(Number) })
    .from(clientAccountMovements)
    .where(and(eq(clientAccountMovements.storeId, storeId), eq(clientAccountMovements.clientId, clientId)));
  return round2(row?.balance ?? 0);
}

// Registra un pago del cliente (baja la deuda). El medio (efectivo/etc.) es
// informativo — NO entra a la caja en este alcance (ver plan, follow-up).
export async function recordPayment(
  db: any,
  input: { storeId: number; clientId: number; amount: number; method?: string | null; note?: string | null; userId: string }
): Promise<void> {
  if (!(input.amount > 0)) throw new Error("INVALID_AMOUNT");
  const client = await getClient(db, input.storeId, input.clientId);
  if (!client) throw new Error("CLIENT_NOT_FOUND");
  await db.insert(clientAccountMovements).values({
    storeId: input.storeId,
    clientId: input.clientId,
    type: "pago",
    amount: round2(input.amount),
    method: (input.method as any) ?? null,
    note: input.note?.trim() || null,
    createdBy: input.userId,
  });
}
