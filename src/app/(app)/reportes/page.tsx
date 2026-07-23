import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { db } from "@/db";
import { requireStoreOwner } from "@/lib/session";
import { isoDate } from "@/lib/dates";
import { money, number } from "@/lib/format";
import { getSalesReport, getTopProducts, getLowStock, getCashSessionHistory, getCashMovementsReport } from "@/domain/reports";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  cuenta: "Cuenta",
};

type Params = { from?: string; to?: string; set?: string };

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  let storeId: number;
  try {
    ({ storeId } = await requireStoreOwner());
  } catch (err) {
    // requireStoreOwner() -> requireUser() can itself throw Next's internal
    // redirect("/login") error when there's no session at all; that must
    // propagate untouched. Only a genuine FORBIDDEN (logged in, not owner)
    // should be redirected to /vender here.
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

  const [{ byDay, byMethod }, topProducts, lowStock, cashHistory, cashMovements] = await Promise.all([
    getSalesReport(db, storeId, { from, to }),
    getTopProducts(db, storeId, { from, to, limit: 10, setName: params.set || undefined }),
    getLowStock(db, storeId, { setName: params.set || undefined }),
    getCashSessionHistory(db, storeId, { limit: 30 }),
    getCashMovementsReport(db, storeId, { from, to }),
  ]);

  const MOVEMENT_LABELS: Record<string, string> = { gasto: "Gastos", egreso: "Egresos" };
  const movementsTotal = cashMovements.reduce((acc: number, r: { total: number }) => acc + r.total, 0);

  const totalPeriodo = byDay.reduce((acc: number, r: { total: number }) => acc + r.total, 0);
  const cierresConDiferencia = cashHistory.filter(
    (s: { difference: number | null }) => s.difference !== null && s.difference !== 0
  ).length;

  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const rangeLabel = `${fromValue} → ${toValue}`;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Reportes"
        description={`Período ${rangeLabel}`}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/reportes?from=${isoDate(today)}&to=${isoDate(today)}`}>Hoy</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/reportes?from=${isoDate(weekAgo)}&to=${isoDate(today)}`}>Esta semana</Link>
            </Button>
            <Button asChild size="sm">
              <a href={`/reportes/export?from=${fromValue}&to=${toValue}`}>Exportar Excel</a>
            </Button>
          </div>
        }
      />

      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-3">
        <StatTile label="Total del período" value={money(totalPeriodo)} hint={`${number(byDay.reduce((a: number, r: { count: number }) => a + r.count, 0))} ventas`} />
        <StatTile
          label="Productos con stock bajo"
          value={number(lowStock.length)}
          tone={lowStock.length > 0 ? "destructive" : "success"}
          hint={lowStock.length > 0 ? "Requieren reposición" : "Todo en orden"}
        />
        <StatTile
          label="Cierres con diferencia"
          value={number(cierresConDiferencia)}
          tone={cierresConDiferencia > 0 ? "destructive" : "success"}
          hint={cierresConDiferencia > 0 ? "Revisar caja" : "Caja cuadrada"}
        />
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4 shadow-xs"
      >
        <label className="flex flex-col gap-1.5">
          <span className="ledger-label">Desde</span>
          <Input type="date" name="from" defaultValue={fromValue} className="w-40" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="ledger-label">Hasta</span>
          <Input type="date" name="to" defaultValue={toValue} className="w-40" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="ledger-label">Set</span>
          <Input type="text" name="set" defaultValue={params.set ?? ""} placeholder="Ej: Base Set" className="w-44" />
        </label>
        <Button type="submit" size="sm">
          Filtrar
        </Button>
        {(params.from || params.to || params.set) && (
          <Button asChild variant="ghost" size="sm">
            <Link href="/reportes">Limpiar</Link>
          </Button>
        )}
      </form>

      <Section label="Ventas por día">
        {byDay.length === 0 ? (
          <EmptyRange />
        ) : (
          <div className="rounded-xl border border-border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byDay.map((row: { day: string; count: number; total: number }) => (
                  <TableRow key={row.day}>
                    <TableCell className="font-mono">{row.day}</TableCell>
                    <TableCell className="text-right font-mono">{number(row.count)}</TableCell>
                    <TableCell className="text-right font-mono font-medium">{money(row.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section label="Totales por medio de pago">
        {byMethod.length === 0 ? (
          <EmptyRange />
        ) : (
          <div className="rounded-xl border border-border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Medio de pago</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byMethod.map((row: { method: string; count: number; total: number }) => (
                  <TableRow key={row.method}>
                    <TableCell>{PAYMENT_LABELS[row.method] ?? row.method}</TableCell>
                    <TableCell className="text-right font-mono">{number(row.count)}</TableCell>
                    <TableCell className="text-right font-mono font-medium">{money(row.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section label="Gastos y egresos" aside={<span className="figure text-sm font-medium text-destructive">−{money(movementsTotal)}</span>}>
        {cashMovements.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin gastos ni egresos en el período.</p>
        ) : (
          <div className="rounded-xl border border-border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cashMovements.map((row: { kind: string; count: number; total: number }) => (
                  <TableRow key={row.kind}>
                    <TableCell>{MOVEMENT_LABELS[row.kind] ?? row.kind}</TableCell>
                    <TableCell className="text-right font-mono">{number(row.count)}</TableCell>
                    <TableCell className="text-right font-mono font-medium text-destructive">−{money(row.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section label="Top 10 productos">
        {topProducts.length === 0 ? (
          <EmptyRange />
        ) : (
          <div className="rounded-xl border border-border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Variante</TableHead>
                  <TableHead>Set</TableHead>
                  <TableHead className="text-right">Unidades</TableHead>
                  <TableHead className="text-right">Ingresos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topProducts.map(
                  (row: { productName: string; variantName: string; setName: string | null; unitsSold: number; revenue: number }, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{row.productName}</TableCell>
                      <TableCell className="text-muted-foreground">{row.variantName || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{row.setName || "—"}</TableCell>
                      <TableCell className="text-right font-mono">{number(row.unitsSold)}</TableCell>
                      <TableCell className="text-right font-mono font-medium">{money(row.revenue)}</TableCell>
                    </TableRow>
                  )
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section label="Stock bajo">
        {lowStock.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay productos con stock bajo.</p>
        ) : (
          <div className="rounded-xl border border-border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Variante</TableHead>
                  <TableHead>Set</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Umbral</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lowStock.map(
                  (row: { productName: string; variantName: string; setName: string | null; stock: number; threshold: number }, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{row.productName}</TableCell>
                      <TableCell className="text-muted-foreground">{row.variantName || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{row.setName || "—"}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="destructive" className="font-mono">{number(row.stock)}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{number(row.threshold)}</TableCell>
                    </TableRow>
                  )
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section label="Cierres de caja">
        {cashHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay cierres de caja registrados.</p>
        ) : (
          <div className="rounded-xl border border-border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Esperado</TableHead>
                  <TableHead className="text-right">Contado</TableHead>
                  <TableHead className="text-right">Diferencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cashHistory.map(
                  (session: {
                    id: number;
                    closedAt: Date | null;
                    expectedCash: number | null;
                    countedCash: number | null;
                    difference: number | null;
                  }) => {
                    const off = session.difference != null && session.difference !== 0;
                    return (
                      <TableRow key={session.id}>
                        <TableCell className="font-mono">{session.closedAt?.toLocaleString("es-AR") ?? "—"}</TableCell>
                        <TableCell className="text-right font-mono">{money(session.expectedCash)}</TableCell>
                        <TableCell className="text-right font-mono">{money(session.countedCash)}</TableCell>
                        <TableCell
                          className={`text-right font-mono ${off ? "font-semibold text-destructive" : "text-success"}`}
                        >
                          {money(session.difference)}
                        </TableCell>
                      </TableRow>
                    );
                  }
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
    </div>
  );
}

function EmptyRange() {
  return (
    <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-6 text-center text-sm text-muted-foreground">
      Sin ventas en el rango seleccionado.
    </p>
  );
}
