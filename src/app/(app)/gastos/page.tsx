import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { db } from "@/db";
import { requireStoreOwner } from "@/lib/session";
import { haceDiasAR, hoyAR } from "@/lib/dates";
import { money } from "@/lib/format";
import { listarGastos, listarRubros, resumenPorRubro } from "@/domain/gastos";
import { MEDIOS_DE_GASTO } from "@/domain/gastos-medios";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Campo, Toolbar } from "@/components/ui/toolbar";
import { AnularGasto, NuevoGasto, Rubros } from "./gastos-client";

/**
 * Gastos del local por rubro, y cuánto pesa cada rubro sobre lo vendido.
 *
 * Junta los gastos que no salen de la caja (sueldos, alquiler,
 * transferencias), que se cargan acá, con los que se pagaron desde la caja,
 * que se cargan en Caja. La columna "% de ventas" es el índice que pidió el
 * local: con "Sueldos y jornales", cuánto de lo vendido se fue en sueldos.
 */

type Params = { desde?: string; hasta?: string; rubro?: string };

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MEDIO = new Map<string, string>(MEDIOS_DE_GASTO.map((m) => [m.value, m.label]));
const pct = (n: number | null) => (n == null ? "—" : `${n.toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`);
const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;

export default async function GastosPage({ searchParams }: { searchParams: Promise<Params> }) {
  let storeId: number;
  try {
    ({ storeId } = await requireStoreOwner());
  } catch (err) {
    unstable_rethrow(err);
    redirect("/caja");
  }

  const params = await searchParams;
  const hoy = hoyAR();
  // Por defecto, el mes en curso: los sueldos y el alquiler son mensuales.
  const inicioDeMes = `${hoy.slice(0, 7)}-01`;
  const desde = params.desde && FECHA.test(params.desde) ? params.desde : inicioDeMes;
  const hasta = params.hasta && FECHA.test(params.hasta) ? params.hasta : hoy;
  const rubroId = Number(params.rubro) || null;

  const [rubros, resumen, lista] = await Promise.all([
    listarRubros(db, storeId, { incluirInactivos: true }),
    resumenPorRubro(db, storeId, { desde, hasta }),
    listarGastos(db, storeId, { desde, hasta, rubroId }),
  ]);

  const atajo = (d: string, h: string) => `/gastos?desde=${d}&hasta=${h}`;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Gastos"
        description={`${fechaCorta(desde)} → ${fechaCorta(hasta)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm"><Link href={atajo(hoy, hoy)}>Hoy</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href={atajo(haceDiasAR(6), hoy)}>Últimos 7 días</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href={atajo(inicioDeMes, hoy)}>Este mes</Link></Button>
          </div>
        }
      />

      <Section label="Nuevo gasto fuera de caja">
        <p className="mb-3 text-sm text-muted-foreground">
          Sueldos, alquiler, servicios: lo que no sale del cajón. Lo que se paga
          con efectivo de la caja se carga en Caja, y las facturas de
          proveedores en Proveedores; las dos suman acá en su rubro.
        </p>
        <NuevoGasto rubros={rubros} hoy={hoy} />
      </Section>

      <Section label="Por rubro">
        <Panel flush>
          <Table aria-label="Gastos por rubro">
            <TableHeader>
              <TableRow>
                <TableHead>Rubro</TableHead>
                <TableHead className="text-right">Fuera de caja</TableHead>
                <TableHead className="text-right">Desde la caja</TableHead>
                <TableHead className="text-right">Compras</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">% de ventas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resumen.rubros.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No hay gastos en este período.
                  </TableCell>
                </TableRow>
              ) : resumen.rubros.map((r) => (
                <TableRow key={r.rubroId ?? "sin"}>
                  <TableCell className="font-medium">{r.nombre}</TableCell>
                  <TableCell className="figure text-right">{money(r.fueraDeCaja)}</TableCell>
                  <TableCell className="figure text-right">{money(r.enCaja)}</TableCell>
                  <TableCell className="figure text-right">{money(r.compras)}</TableCell>
                  <TableCell className="figure text-right font-medium">{money(r.total)}</TableCell>
                  <TableCell className="figure text-right">{pct(r.sobreVentas)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total gastos</TableCell>
                <TableCell colSpan={3} />
                <TableCell className="figure text-right font-semibold">{money(resumen.total)}</TableCell>
                <TableCell className="figure text-right">
                  {pct(resumen.ventas > 0 ? Math.round((resumen.total / resumen.ventas) * 1000) / 10 : null)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Ventas del período</TableCell>
                <TableCell colSpan={3} />
                <TableCell className="figure text-right">{money(resumen.ventas)}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </Panel>
      </Section>

      <Section label="Detalle fuera de caja">
        <Toolbar asChild>
          <form method="get">
            <Campo label="Desde" htmlFor="f-desde">
              <Input id="f-desde" type="date" name="desde" defaultValue={desde} className="w-40" />
            </Campo>
            <Campo label="Hasta" htmlFor="f-hasta">
              <Input id="f-hasta" type="date" name="hasta" defaultValue={hasta} className="w-40" />
            </Campo>
            <Campo label="Rubro" htmlFor="f-rubro">
              <Select id="f-rubro" name="rubro" defaultValue={params.rubro ?? ""} className="w-48">
                <option value="">Todos</option>
                {rubros.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
              </Select>
            </Campo>
            <Button type="submit" size="sm">Filtrar</Button>
          </form>
        </Toolbar>

        <Panel flush className="mt-3">
          <Table aria-label="Gastos fuera de caja">
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Rubro</TableHead>
                <TableHead>Detalle</TableHead>
                <TableHead>Pago</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No hay gastos fuera de caja en este período.
                  </TableCell>
                </TableRow>
              ) : lista.map((g) => (
                <TableRow key={g.id} className={g.voidedAt ? "opacity-60" : undefined}>
                  <TableCell className="figure">{fechaCorta(g.fecha)}</TableCell>
                  <TableCell>{g.rubro}</TableCell>
                  <TableCell>
                    {g.detalle ?? "—"}
                    {g.voidedAt && (
                      <span className="block text-xs text-destructive">Anulado: {g.voidReason}</span>
                    )}
                  </TableCell>
                  <TableCell>{MEDIO.get(g.medio) ?? g.medio}</TableCell>
                  <TableCell className={`figure text-right ${g.voidedAt ? "line-through" : ""}`}>{money(g.monto)}</TableCell>
                  <TableCell className="text-right">
                    {g.voidedAt
                      ? <Badge variant="secondary">Anulado</Badge>
                      : <AnularGasto gastoId={g.id} monto={g.monto} rubro={g.rubro} />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </Section>

      <Section label="Rubros">
        <Rubros rubros={rubros} />
      </Section>
    </div>
  );
}
