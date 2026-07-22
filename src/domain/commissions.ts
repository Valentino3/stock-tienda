import { and, desc, eq, gte, lte } from "drizzle-orm";
import { commissions, user, type Commission } from "@/db/schema";

// Comisión anotada a mano por el dueño para un empleado. El monto es libre; el
// período (opcional) documenta a qué ventas corresponde.
export async function createCommission(
  db: any,
  input: {
    employeeId: string;
    amount: number;
    periodFrom?: Date | null;
    periodTo?: Date | null;
    note?: string | null;
    createdBy: string;
  }
): Promise<Commission> {
  if (!(input.amount > 0)) throw new Error("INVALID_AMOUNT");
  const [row] = await db.insert(commissions).values({
    employeeId: input.employeeId,
    amount: Math.round(input.amount * 100) / 100,
    periodFrom: input.periodFrom ?? null,
    periodTo: input.periodTo ?? null,
    note: input.note?.trim() || null,
    createdBy: input.createdBy,
  }).returning();
  return row;
}

export async function listCommissions(
  db: any,
  opts: { employeeId?: string; from?: Date; to?: Date } = {}
) {
  const conditions = [];
  if (opts.employeeId) conditions.push(eq(commissions.employeeId, opts.employeeId));
  if (opts.from) conditions.push(gte(commissions.createdAt, opts.from));
  if (opts.to) conditions.push(lte(commissions.createdAt, opts.to));
  return db
    .select({ commission: commissions, employeeName: user.name })
    .from(commissions)
    .innerJoin(user, eq(commissions.employeeId, user.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(commissions.createdAt));
}

export async function deleteCommission(db: any, id: number): Promise<void> {
  await db.delete(commissions).where(eq(commissions.id, id));
}
