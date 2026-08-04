import Link from "next/link";
import { db } from "@/db";
import { requireStore } from "@/lib/session";
import { money, number } from "@/lib/format";
import { listClientsWithBalance } from "@/domain/clients";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NewClientForm, PaymentButton } from "./clientes-client";

export default async function ClientesPage() {
  const { storeId } = await requireStore();
  const rows = await listClientsWithBalance(db, storeId);

  const totalDeuda = rows.reduce((acc: number, c: { balance: number }) => acc + Math.max(0, c.balance), 0);
  const conDeuda = rows.filter((c: { balance: number }) => c.balance > 0).length;

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

      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-3">
        <StatTile label="Clientes" value={number(rows.length)} />
        <StatTile label="Con deuda" value={number(conDeuda)} tone={conDeuda > 0 ? "brand" : "default"} />
        <StatTile label="Deuda total" value={money(totalDeuda)} tone={totalDeuda > 0 ? "destructive" : "success"} />
      </div>

      <NewClientForm />

      <Section label="Cuentas">
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-10 text-center text-sm text-muted-foreground">
            No hay clientes todavía.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
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
                    <TableCell className="font-mono text-muted-foreground">{c.phone ?? "—"}</TableCell>
                    <TableCell>
                      {c.balance > 0
                        ? <Badge variant="destructive">Debe</Badge>
                        : <Badge variant="success">Al día</Badge>}
                    </TableCell>
                    <TableCell className={`text-right font-mono font-medium ${c.balance > 0 ? "text-destructive" : ""}`}>
                      {money(c.balance)}
                    </TableCell>
                    <TableCell className="text-right">
                      <PaymentButton clientId={c.id} clientName={c.name} balance={c.balance} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>
    </div>
  );
}
