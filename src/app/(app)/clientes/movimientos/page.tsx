import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { ListChecks, SearchX } from "lucide-react";
import { db } from "@/db";
import { clients, user } from "@/db/schema";
import { requireStore } from "@/lib/session";
import { money } from "@/lib/format";
import { METODO_LABEL, type PaymentMethod } from "@/domain/pagos";
import {
  FILTROS_TIPO_MOVIMIENTO, listAccountMovements, type AccountMovementRow,
} from "@/domain/clients";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Campo, Toolbar } from "@/components/ui/toolbar";
import { AnularMovimientoButton } from "../[id]/anular-movimiento";
import { leerFiltros, querystring, type ParamsMovimientos } from "./filtros";

/**
 * El registro de movimientos de las cuentas corrientes de toda la tienda.
 *
 * La ficha de cada cliente ya muestra su historia. Esto contesta las preguntas
 * que la ficha no puede: qué se anotó hoy en todas las cuentas, qué ajustes se
 * hicieron este mes, qué anuló tal persona. Por eso los anulados están por
 * defecto: son justo lo que se viene a revisar.
 */

const dateTime = (d: Date) =>
  new Date(d).toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

function Tipo({ m }: { m: AccountMovementRow }) {
  if (m.type === "cargo") {
    return <Badge variant="destructive">{m.saleId ? `Venta #${m.saleId}` : "Cargo manual"}</Badge>;
  }
  if (m.type === "pago") return <Badge variant="success">Cobro</Badge>;
  if (m.type === "credito") return <Badge variant="brand">Carga de crédito</Badge>;
  if (m.type === "ajuste") return <Badge variant="secondary">Ajuste</Badge>;
  return <Badge variant="outline">{m.saleId ? `Anulación venta #${m.saleId}` : "Anulación"}</Badge>;
}

const DESCRIPCION: Record<string, string> = {
  cargo: "el cargo manual", pago: "el cobro", credito: "la carga de crédito", ajuste: "el ajuste",
};

export default async function MovimientosPage({ searchParams }: { searchParams: Promise<ParamsMovimientos> }) {
  const params = await searchParams;
  const { storeId } = await requireStore();
  const page = Math.max(1, Number(params.page) || 1);
  const filtros = leerFiltros(params);

  const [{ rows, hasNextPage }, clientes, usuarios] = await Promise.all([
    listAccountMovements(db, { storeId, ...filtros, page }),
    db.select({ id: clients.id, name: clients.name }).from(clients)
      .where(eq(clients.storeId, storeId)).orderBy(asc(clients.name)),
    db.select({ id: user.id, name: user.name }).from(user)
      .where(eq(user.storeId, storeId)).orderBy(asc(user.name)),
  ]);

  const hayFiltros = Boolean(params.from || params.to || params.tipo || params.cliente || params.usuario || params.estado);
  const ventanaPorDefecto = !params.from && !params.to;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Movimientos de cuentas"
        description="Todo lo que se anotó en las cuentas corrientes: quién, cuándo y por qué."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/clientes">Volver a Clientes</Link>
            </Button>
            <Button asChild size="sm">
              {/* `<a>`: es un route handler que devuelve un .xlsx, ver /clientes. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href={`/clientes/movimientos/export${querystring(params)}`}>Exportar Excel</a>
            </Button>
          </div>
        }
      />

      <Toolbar asChild>
        <form method="get">
          <Campo label="Desde" htmlFor="m-desde">
            <Input id="m-desde" type="date" name="from" defaultValue={params.from ?? ""} className="w-40" />
          </Campo>
          <Campo label="Hasta" htmlFor="m-hasta">
            <Input id="m-hasta" type="date" name="to" defaultValue={params.to ?? ""} className="w-40" />
          </Campo>
          <Campo label="Tipo" htmlFor="m-tipo">
            <Select id="m-tipo" name="tipo" defaultValue={params.tipo ?? ""} className="w-44">
              <option value="">Todos</option>
              {FILTROS_TIPO_MOVIMIENTO.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Select>
          </Campo>
          <Campo label="Cliente" htmlFor="m-cliente">
            <Select id="m-cliente" name="cliente" defaultValue={params.cliente ?? ""} className="w-48">
              <option value="">Todos</option>
              {clientes.map((c: { id: number; name: string }) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Campo>
          <Campo label="Hecho por" htmlFor="m-usuario">
            <Select id="m-usuario" name="usuario" defaultValue={params.usuario ?? ""} className="w-44">
              <option value="">Todos</option>
              {usuarios.map((u: { id: string; name: string }) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </Select>
          </Campo>
          <Campo label="Estado" htmlFor="m-estado">
            <Select id="m-estado" name="estado" defaultValue={params.estado ?? ""} className="w-36">
              <option value="">Todos</option>
              <option value="vigentes">Vigentes</option>
              <option value="anulados">Anulados</option>
            </Select>
          </Campo>
          <Button type="submit" size="sm">Filtrar</Button>
          {hayFiltros && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/clientes/movimientos">Limpiar</Link>
            </Button>
          )}
        </form>
      </Toolbar>

      {ventanaPorDefecto && (
        <p className="text-xs text-muted-foreground">
          Mostrando los últimos 30 días. Elegí un rango para ver más atrás.
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          filtrado={hayFiltros}
          icon={hayFiltros ? SearchX : ListChecks}
          titulo={hayFiltros ? "Ningún movimiento con estos filtros" : "Todavía no hay movimientos en las cuentas"}
          detalle={
            hayFiltros
              ? "Probá con otro rango de fechas o sacá algún filtro."
              : "Las ventas a cuenta, los cobros y los ajustes aparecen acá."
          }
          accion={
            hayFiltros ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/clientes/movimientos">Limpiar filtros</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Panel flush>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Movimiento</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead>Registró</TableHead>
                <TableHead>Detalle</TableHead>
                <TableHead className="text-right"><span className="sr-only">Acción</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => (
                <TableRow key={m.id} className={m.voided ? "opacity-70" : ""}>
                  <TableCell className="figure whitespace-nowrap text-muted-foreground">{dateTime(m.createdAt)}</TableCell>
                  <TableCell className="font-medium">
                    <Link href={`/clientes/${m.clientId}`} className="hover:text-brand hover:underline">
                      {m.clientName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Tipo m={m} />
                      {m.voided && <Badge variant="destructive">Anulado</Badge>}
                      {m.method && (
                        <span className="text-xs text-muted-foreground">
                          {METODO_LABEL[m.method as PaymentMethod] ?? m.method}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell
                    className={`figure whitespace-nowrap text-right font-medium ${m.voided ? "text-muted-foreground line-through" : m.type === "cargo" ? "text-destructive" : ""}`}
                  >
                    {m.type === "cargo" ? "+" : "−"}{money(m.amount)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{m.createdByName ?? "—"}</TableCell>
                  <TableCell className="max-w-72 text-sm">
                    {m.note && <span className="text-muted-foreground">{m.note}</span>}
                    {m.voided && (
                      <span className="block">
                        <span className="ledger-label">Anulado</span>{" "}
                        <span className="text-muted-foreground">
                          {m.voidedByName ? `por ${m.voidedByName} ` : ""}
                          {m.voidedAt ? `el ${dateTime(m.voidedAt)}` : ""}
                          {m.voidedReason ? `: ${m.voidedReason}` : ""}
                        </span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {m.anulable && (
                      <AnularMovimientoButton
                        movementId={m.id}
                        descripcion={DESCRIPCION[m.type] ?? "el movimiento"}
                        monto={m.amount}
                        enEfectivo={m.method === "efectivo"}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}

      {(page > 1 || hasNextPage) && (
        <div className="flex items-center justify-center gap-3">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/clientes/movimientos${querystring(params, { page: String(page - 1) })}`}>Anterior</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>Anterior</Button>
          )}
          <span className="ledger-label">Página {page}</span>
          {hasNextPage ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/clientes/movimientos${querystring(params, { page: String(page + 1) })}`}>Siguiente</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>Siguiente</Button>
          )}
        </div>
      )}
    </div>
  );
}
