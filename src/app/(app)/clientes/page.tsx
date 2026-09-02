import Link from "next/link";
import { db } from "@/db";
import { requireStore } from "@/lib/session";
import { money, moneyDiff, number } from "@/lib/format";
import { listClientsWithBalance } from "@/domain/clients";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NewClientForm, MovimientoCuentaButton } from "./clientes-client";

export default async function ClientesPage() {
  const { storeId } = await requireStore();
  const rows = await listClientsWithBalance(db, storeId);

  const totalDeuda = rows.reduce((acc: number, c: { balance: number }) => acc + Math.max(0, c.balance), 0);
  const conDeuda = rows.filter((c: { balance: number }) => c.balance > 0).length;
  // El saldo a favor NO se resta de la deuda: son dos plata distintas. Uno es
  // lo que el local tiene por cobrar, el otro lo que ya cobro y debe en
  // mercaderia. Netearlos esconderia las dos cosas.
  const totalAFavor = rows.reduce((acc: number, c: { balance: number }) => acc + Math.max(0, -c.balance), 0);
  const conAFavor = rows.filter((c: { balance: number }) => c.balance < 0).length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Clientes"
        description="Cuenta corriente y fiado."
        actions={
          <Button asChild size="sm">
            {/* `<a>` y no `<Link>` a propósito: /clientes/export es un route
                handler que devuelve un .xlsx. Con Link, Next lo prefetchea y
                lo navega del lado cliente, y la descarga no se dispara. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/clientes/export">Exportar Excel</a>
          </Button>
        }
      />

      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Clientes" value={number(rows.length)} />
        <StatTile label="Con deuda" value={number(conDeuda)} tone={conDeuda > 0 ? "brand" : "default"} />
        <StatTile label="Deuda total" value={money(totalDeuda)} tone={totalDeuda > 0 ? "destructive" : "success"} />
        <StatTile
          label="A favor"
          value={money(totalAFavor)}
          tone={totalAFavor > 0 ? "brand" : "default"}
          hint={conAFavor === 1 ? "1 cliente" : `${number(conAFavor)} clientes`}
        />
      </div>

      <NewClientForm />

      <Section label="Cuentas">
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-10 text-center text-sm text-muted-foreground">
            No hay clientes todavía.
          </p>
        ) : (
          <Panel flush>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c: { id: number; name: string; phone: string | null; active: boolean; balance: number }) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      <Link href={`/clientes/${c.id}`} className="hover:text-brand hover:underline">
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell className="figure text-muted-foreground">{c.phone ?? "—"}</TableCell>
                    <TableCell>
                      {/* Tres estados y no dos: antes, un cliente con crédito
                          decía "Al día" en verde, igual que uno en cero. */}
                      {c.balance > 0
                        ? <Badge variant="destructive">Debe</Badge>
                        : c.balance < 0
                          ? <Badge variant="brand">A favor</Badge>
                          : <Badge variant="success">Al día</Badge>}
                    </TableCell>
                    <TableCell
                      className={`text-right figure font-medium ${
                        c.balance > 0 ? "text-destructive" : c.balance < 0 ? "text-brand" : ""
                      }`}
                    >
                      {/* `moneyDiff` existe para exactamente esto: en una
                          columna de números, el guion de un negativo se
                          confunde con un separador. */}
                      {moneyDiff(c.balance)}
                    </TableCell>
                    <TableCell className="text-right">
                      <MovimientoCuentaButton clientId={c.id} clientName={c.name} balance={c.balance} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>
        )}
      </Section>
    </div>
  );
}
