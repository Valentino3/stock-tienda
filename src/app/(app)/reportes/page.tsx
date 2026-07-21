import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { db } from "@/db";
import { requireOwner } from "@/lib/session";
import { isoDate } from "@/lib/dates";
import { getSalesReport, getTopProducts, getLowStock, getCashSessionHistory } from "@/domain/reports";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
};

function money(n: number | null | undefined) {
  return `$${(n ?? 0).toFixed(2)}`;
}

type Params = { from?: string; to?: string; set?: string };

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  try {
    await requireOwner();
  } catch (err) {
    // requireOwner() -> requireUser() can itself throw Next's internal
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

  const [{ byDay, byMethod }, topProducts, lowStock, cashHistory] = await Promise.all([
    getSalesReport(db, { from, to }),
    getTopProducts(db, { from, to, limit: 10, setName: params.set || undefined }),
    getLowStock(db, { setName: params.set || undefined }),
    getCashSessionHistory(db, { limit: 30 }),
  ]);

  const totalPeriodo = byDay.reduce((acc: number, r: { total: number }) => acc + r.total, 0);
  const cierresConDiferencia = cashHistory.filter(
    (s: { difference: number | null }) => s.difference !== null && s.difference !== 0
  ).length;

  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold tracking-tight">Reportes</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total del período</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{money(totalPeriodo)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Productos con stock bajo</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-semibold ${lowStock.length > 0 ? "text-destructive" : ""}`}>
              {lowStock.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Cierres con diferencia</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-semibold ${cierresConDiferencia > 0 ? "text-destructive" : "text-green-600"}`}>
              {cierresConDiferencia}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Desde</span>
            <input
              type="date"
              name="from"
              defaultValue={fromValue}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Hasta</span>
            <input
              type="date"
              name="to"
              defaultValue={toValue}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Set</span>
            <input
              type="text"
              name="set"
              defaultValue={params.set ?? ""}
              placeholder="Ej: Base Set"
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            />
          </label>
          <Button type="submit" variant="outline" size="sm">
            Filtrar
          </Button>
          {(params.from || params.to) && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/reportes">Limpiar</Link>
            </Button>
          )}
        </form>
        <div className="ml-auto flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/reportes?from=${isoDate(today)}&to=${isoDate(today)}`}>Hoy</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/reportes?from=${isoDate(weekAgo)}&to=${isoDate(today)}`}>Esta semana</Link>
          </Button>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Ventas por día</h2>
        {byDay.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin ventas en el rango seleccionado.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Cantidad</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byDay.map((row: { day: string; count: number; total: number }) => (
                <TableRow key={row.day}>
                  <TableCell>{row.day}</TableCell>
                  <TableCell>{row.count}</TableCell>
                  <TableCell className="text-right">{money(row.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Totales por medio de pago</h2>
        {byMethod.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin ventas en el rango seleccionado.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Medio de pago</TableHead>
                <TableHead>Cantidad</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byMethod.map((row: { method: string; count: number; total: number }) => (
                <TableRow key={row.method}>
                  <TableCell>{PAYMENT_LABELS[row.method] ?? row.method}</TableCell>
                  <TableCell>{row.count}</TableCell>
                  <TableCell className="text-right">{money(row.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Top 10 productos</h2>
        {topProducts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin ventas en el rango seleccionado.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Variante</TableHead>
                <TableHead>Set</TableHead>
                <TableHead>Unidades vendidas</TableHead>
                <TableHead className="text-right">Ingresos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topProducts.map(
                (row: { productName: string; variantName: string; setName: string | null; unitsSold: number; revenue: number }, i: number) => (
                  <TableRow key={i}>
                    <TableCell>{row.productName}</TableCell>
                    <TableCell>{row.variantName || "—"}</TableCell>
                    <TableCell>{row.setName || "—"}</TableCell>
                    <TableCell>{row.unitsSold}</TableCell>
                    <TableCell className="text-right">{money(row.revenue)}</TableCell>
                  </TableRow>
                )
              )}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Stock bajo</h2>
        {lowStock.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay productos con stock bajo.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Variante</TableHead>
                <TableHead>Set</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Umbral</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lowStock.map(
                (row: { productName: string; variantName: string; setName: string | null; stock: number; threshold: number }, i: number) => (
                  <TableRow key={i}>
                    <TableCell>{row.productName}</TableCell>
                    <TableCell>{row.variantName || "—"}</TableCell>
                    <TableCell>{row.setName || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="destructive">{row.stock}</Badge>
                    </TableCell>
                    <TableCell>{row.threshold}</TableCell>
                  </TableRow>
                )
              )}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Cierres de caja</h2>
        {cashHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay cierres de caja registrados.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Esperado</TableHead>
                <TableHead>Contado</TableHead>
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
                }) => (
                  <TableRow key={session.id}>
                    <TableCell>{session.closedAt?.toLocaleString("es-AR") ?? "—"}</TableCell>
                    <TableCell>{money(session.expectedCash)}</TableCell>
                    <TableCell>{money(session.countedCash)}</TableCell>
                    <TableCell
                      className={`text-right ${session.difference && session.difference !== 0 ? "font-semibold text-destructive" : ""}`}
                    >
                      {money(session.difference)}
                    </TableCell>
                  </TableRow>
                )
              )}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
