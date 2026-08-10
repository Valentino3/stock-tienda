import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { db } from "@/db";
import { requireStoreOwner } from "@/lib/session";
import { isoDate } from "@/lib/dates";
import { money, moneyDiff, number } from "@/lib/format";
import { getSalesReport, getTopProducts, getLowStock, getCashSessionHistory, getCashMovementsReport } from "@/domain/reports";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Campo, Toolbar } from "@/components/ui/toolbar";

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
  const hayFiltro = Boolean(params.from || params.to || params.set);
  const totalUnidades = topProducts.reduce((a: number, r: { unitsSold: number }) => a + r.unitsSold, 0);
  const totalIngresosTop = topProducts.reduce((a: number, r: { revenue: number }) => a + r.revenue, 0);
  const totalVentas = byDay.reduce((a: number, r: { count: number }) => a + r.count, 0);

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

      {/* Las dos tarjetas de alarma solo se pintan cuando hay algo que mirar.
          Un cero en verde grande hace levantar la vista para leer que no pasa
          nada: el color se gasta en el caso bueno y deja de gritar en el malo. */}
      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-3">
        <StatTile label="Total del período" value={money(totalPeriodo)} hint={`${number(totalVentas)} ventas`} />
        <StatTile
          label="Productos con stock bajo"
          value={number(lowStock.length)}
          tone={lowStock.length > 0 ? "destructive" : "default"}
          hint={lowStock.length > 0 ? "Requieren reposición" : "Todo en orden"}
        />
        <StatTile
          label="Cierres con diferencia"
          value={number(cierresConDiferencia)}
          tone={cierresConDiferencia > 0 ? "destructive" : "default"}
          hint={cierresConDiferencia > 0 ? "Revisar caja" : "Caja cuadrada"}
        />
      </div>

      <Toolbar asChild>
        <form method="get">
          <Campo label="Desde" htmlFor="f-desde">
            <Input id="f-desde" type="date" name="from" defaultValue={fromValue} className="w-40" />
          </Campo>
          <Campo label="Hasta" htmlFor="f-hasta">
            <Input id="f-hasta" type="date" name="to" defaultValue={toValue} className="w-40" />
          </Campo>
          <Campo label="Set" htmlFor="f-set">
            <Input id="f-set" type="text" name="set" defaultValue={params.set ?? ""} placeholder="Ej: Base Set" className="w-44" />
          </Campo>
          <Button type="submit" size="sm">
            Filtrar
          </Button>
          {hayFiltro && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/reportes">Limpiar</Link>
            </Button>
          )}
        </form>
      </Toolbar>

      <Section label="Ventas por día">
        {byDay.length === 0 ? (
          <SinDatos que="ventas" />
        ) : (
          <Panel flush>
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
                    <TableCell className="figure">{row.day}</TableCell>
                    <TableCell className="figure text-right">{number(row.count)}</TableCell>
                    <TableCell className="figure text-right font-medium">{money(row.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="text-muted-foreground">Total</TableCell>
                  <TableCell className="figure text-right">{number(totalVentas)}</TableCell>
                  <TableCell className="figure text-right">{money(totalPeriodo)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </Panel>
        )}
      </Section>

      <Section label="Totales por medio de pago">
        {byMethod.length === 0 ? (
          <SinDatos que="ventas" />
        ) : (
          <Panel flush>
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
                    <TableCell className="figure text-right">{number(row.count)}</TableCell>
                    <TableCell className="figure text-right font-medium">{money(row.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="text-muted-foreground">Total</TableCell>
                  <TableCell className="figure text-right">
                    {number(byMethod.reduce((a: number, r: { count: number }) => a + r.count, 0))}
                  </TableCell>
                  <TableCell className="figure text-right">
                    {money(byMethod.reduce((a: number, r: { total: number }) => a + r.total, 0))}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </Panel>
        )}
      </Section>

      {/* El total solo se pinta si salió plata. En cero no hay nada malo que
          señalar, y un "−$ 0,00" rojo arriba de la sección hacía parecer que
          sí. */}
      <Section
        label="Gastos y egresos"
        aside={
          movementsTotal > 0 ? (
            <span className="figure text-sm font-medium text-destructive">−{money(movementsTotal)}</span>
          ) : undefined
        }
      >
        {cashMovements.length === 0 ? (
          <SinDatos que="gastos ni egresos" />
        ) : (
          <Panel flush>
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
                    <TableCell className="figure text-right">{number(row.count)}</TableCell>
                    <TableCell className="figure text-right font-medium text-destructive">−{money(row.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>
        )}
      </Section>

      <Section label="Top 10 productos">
        {topProducts.length === 0 ? (
          <SinDatos que="ventas" />
        ) : (
          <Panel flush>
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
                      <TableCell className="figure text-right">{number(row.unitsSold)}</TableCell>
                      <TableCell className="figure text-right font-medium">{money(row.revenue)}</TableCell>
                    </TableRow>
                  )
                )}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground">Total del top 10</TableCell>
                  <TableCell className="figure text-right">{number(totalUnidades)}</TableCell>
                  <TableCell className="figure text-right">{money(totalIngresosTop)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </Panel>
        )}
      </Section>

      <Section label="Stock bajo">
        {lowStock.length === 0 ? (
          <EmptyState size="sm" titulo="Nada por reponer: ningún producto quedó por debajo de su umbral." />
        ) : (
          <Panel flush>
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
                        <Badge variant="destructive" className="figure">{number(row.stock)}</Badge>
                      </TableCell>
                      <TableCell className="figure text-right text-muted-foreground">{number(row.threshold)}</TableCell>
                    </TableRow>
                  )
                )}
              </TableBody>
            </Table>
          </Panel>
        )}
      </Section>

      <Section label="Cierres de caja">
        {cashHistory.length === 0 ? (
          <EmptyState size="sm" titulo="Todavía no se cerró ninguna caja: el primer cierre aparece acá al terminar el turno." />
        ) : (
          <Panel flush>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Esperado</TableHead>
                  <TableHead className="text-right">Contado</TableHead>
                  <TableHead className="text-right">Diferencia</TableHead>
                  <TableHead></TableHead>
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
                        <TableCell className="figure">{session.closedAt?.toLocaleString("es-AR") ?? "—"}</TableCell>
                        <TableCell className="figure text-right">{money(session.expectedCash)}</TableCell>
                        <TableCell className="figure text-right">{money(session.countedCash)}</TableCell>
                        {/* Paréntesis y no guion: en una columna de importes un
                            "−" se confunde con un separador, y este número es
                            el que decide si hay que ir a contar el cajón. */}
                        <TableCell
                          className={`figure text-right ${off ? "font-semibold text-destructive" : "text-muted-foreground"}`}
                        >
                          {moneyDiff(session.difference)}
                        </TableCell>
                        {/* Reimprimir un cierre viejo con sus remitos. */}
                        <TableCell className="text-right">
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/caja/${session.id}/cierre`}>Ver cierre</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  }
                )}
              </TableBody>
            </Table>
          </Panel>
        )}
      </Section>
    </div>
  );
}

/**
 * Vacío de esta pantalla. Siempre es "por filtro": Reportes se mira sobre un
 * rango, así que no hay nada que dar de alta — lo que hay que hacer es correr
 * las fechas. Antes esta página mezclaba dos tratamientos, panel punteado en
 * tres secciones y renglón gris pelado en las otras tres, con el mismo peso.
 */
function SinDatos({ que }: { que: string }) {
  return <EmptyState size="sm" filtrado titulo={`Sin ${que} en el rango seleccionado.`} />;
}
