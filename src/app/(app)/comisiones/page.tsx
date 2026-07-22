import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { db } from "@/db";
import { user } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { isoDate } from "@/lib/dates";
import { money, number } from "@/lib/format";
import { getSellerSalesSummary } from "@/domain/reports";
import { listCommissions } from "@/domain/commissions";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CommissionForm, DeleteCommissionButton } from "./commission-form";

type Params = { from?: string; to?: string };

export default async function ComisionesPage({ searchParams }: { searchParams: Promise<Params> }) {
  try {
    await requireOwner();
  } catch (err) {
    unstable_rethrow(err);
    redirect("/vender");
  }

  const params = await searchParams;

  const now = new Date();
  const defaultTo = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const defaultFrom = new Date(defaultTo);
  defaultFrom.setDate(defaultFrom.getDate() - 30);
  defaultFrom.setHours(0, 0, 0, 0);

  const from = params.from ? new Date(`${params.from}T00:00:00`) : defaultFrom;
  const to = params.to
    ? new Date(new Date(`${params.to}T00:00:00`).getTime() + 24 * 60 * 60 * 1000 - 1)
    : defaultTo;
  const fromValue = params.from ?? defaultFrom.toISOString().slice(0, 10);
  const toValue = params.to ?? defaultTo.toISOString().slice(0, 10);

  const [summary, commissions, employees] = await Promise.all([
    getSellerSalesSummary(db, { from, to }),
    listCommissions(db, { from, to }),
    db.select({ id: user.id, name: user.name, banned: user.banned }).from(user).orderBy(user.name),
  ]);

  const activeEmployees = employees
    .filter((e: { banned: boolean | null }) => !e.banned)
    .map((e: { id: string; name: string }) => ({ id: e.id, name: e.name }));

  const today = new Date();
  const monthAgo = new Date(today);
  monthAgo.setMonth(monthAgo.getMonth() - 1);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Comisiones"
        description={`Ventas por empleado y comisiones anotadas · ${fromValue} → ${toValue}`}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/comisiones?from=${isoDate(monthAgo)}&to=${isoDate(today)}`}>Último mes</Link>
            </Button>
          </div>
        }
      />

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4 shadow-xs">
        <label className="flex flex-col gap-1.5">
          <span className="ledger-label">Desde</span>
          <input type="date" name="from" defaultValue={fromValue} className="h-9 w-40 rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="ledger-label">Hasta</span>
          <input type="date" name="to" defaultValue={toValue} className="h-9 w-40 rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" />
        </label>
        <Button type="submit" size="sm">Filtrar</Button>
        {(params.from || params.to) && (
          <Button asChild variant="ghost" size="sm"><Link href="/comisiones">Limpiar</Link></Button>
        )}
      </form>

      <Section label="Ventas por empleado (período)">
        {summary.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin ventas en el período.</p>
        ) : (
          <div className="rounded-xl border border-border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empleado</TableHead>
                  <TableHead className="text-right">Ventas</TableHead>
                  <TableHead className="text-right">Total vendido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.map((row: { sellerId: string; name: string; count: number; total: number }) => (
                  <TableRow key={row.sellerId}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-right font-mono">{number(row.count)}</TableCell>
                    <TableCell className="text-right font-mono font-medium">{money(row.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section label="Anotar comisión">
        <CommissionForm
          employees={activeEmployees}
          salesByEmployee={Object.fromEntries(
            summary.map((r: { sellerId: string; total: number }) => [r.sellerId, r.total])
          )}
          defaultFrom={fromValue}
          defaultTo={toValue}
        />
      </Section>

      <Section label="Comisiones registradas">
        {commissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay comisiones registradas en el período.</p>
        ) : (
          <div className="rounded-xl border border-border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Empleado</TableHead>
                  <TableHead>Nota</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commissions.map(
                  (row: { commission: { id: number; amount: number; note: string | null; createdAt: Date }; employeeName: string }) => (
                    <TableRow key={row.commission.id}>
                      <TableCell className="font-mono">{row.commission.createdAt.toLocaleDateString("es-AR")}</TableCell>
                      <TableCell className="font-medium">{row.employeeName}</TableCell>
                      <TableCell className="text-muted-foreground">{row.commission.note ?? "—"}</TableCell>
                      <TableCell className="text-right font-mono font-medium">{money(row.commission.amount)}</TableCell>
                      <TableCell className="text-right">
                        <DeleteCommissionButton id={row.commission.id} />
                      </TableCell>
                    </TableRow>
                  )
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
    </div>
  );
}
