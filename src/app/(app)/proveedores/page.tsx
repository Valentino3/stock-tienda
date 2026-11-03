import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { db } from "@/db";
import { requireStoreOwner } from "@/lib/session";
import { money } from "@/lib/format";
import { deudaPorProveedor } from "@/domain/proveedores";
import { listarRubros } from "@/domain/gastos";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProveedorForm } from "./proveedores-client";

/**
 * A quién se le debe y qué está vencido. Es la pantalla que se abre cuando
 * llega un proveedor a cobrar, o el lunes para ver qué hay que pagar.
 */

type Params = { ver?: string };
const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;

export default async function ProveedoresPage({ searchParams }: { searchParams: Promise<Params> }) {
  let storeId: number;
  try {
    ({ storeId } = await requireStoreOwner());
  } catch (err) {
    unstable_rethrow(err);
    redirect("/caja");
  }

  const { ver } = await searchParams;
  const [todos, rubros] = await Promise.all([
    deudaPorProveedor(db, storeId, { incluirInactivos: ver === "todos" }),
    listarRubros(db, storeId),
  ]);
  const lista = ver === "deuda" ? todos.filter((d) => d.saldo > 0)
    : ver === "vencidas" ? todos.filter((d) => d.vencido > 0)
    : todos;
  const deuda = todos.reduce((a, d) => a + Math.max(0, d.saldo), 0);
  const vencido = todos.reduce((a, d) => a + d.vencido, 0);

  const filtro = (valor: string | undefined, texto: string) => (
    <Button asChild size="sm" variant={ver === valor ? "default" : "outline"}>
      <Link href={valor ? `/proveedores?ver=${valor}` : "/proveedores"}>{texto}</Link>
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Proveedores"
        description="Lo que se les debe, por factura y vencimiento."
        actions={<ProveedorForm rubros={rubros.map((r) => ({ id: r.id, nombre: r.nombre }))} />}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <StatTile label="Deuda total" value={money(deuda)} />
        <StatTile label="Vencido" value={money(vencido)} tone={vencido > 0 ? "destructive" : "default"} />
      </div>

      <div className="flex flex-wrap gap-2">
        {filtro(undefined, "Activos")}
        {filtro("deuda", "Con deuda")}
        {filtro("vencidas", "Con vencidas")}
        {filtro("todos", "Todos, incluso inactivos")}
      </div>

      <Panel flush>
        <Table aria-label="Proveedores">
          <TableHeader>
            <TableRow>
              <TableHead>Proveedor</TableHead>
              <TableHead>Rubro</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead className="text-right">Vencido</TableHead>
              <TableHead>Próximo vencimiento</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {todos.length === 0 ? "Todavía no hay proveedores. Creá el primero con el botón de arriba." : "Nada para mostrar con este filtro."}
                </TableCell>
              </TableRow>
            ) : lista.map((d) => (
              <TableRow key={d.proveedor.id} className={d.proveedor.activo ? undefined : "opacity-60"}>
                <TableCell className="font-medium">
                  <Link href={`/proveedores/${d.proveedor.id}`} className="underline-offset-4 hover:underline">
                    {d.proveedor.nombre}
                  </Link>
                  {!d.proveedor.activo && <Badge variant="secondary" className="ml-2">Inactivo</Badge>}
                </TableCell>
                <TableCell>{d.rubro ?? "—"}</TableCell>
                <TableCell className="figure text-right">
                  {d.saldo < 0 ? <span className="text-success">{money(-d.saldo)} a favor</span> : money(d.saldo)}
                </TableCell>
                <TableCell className={`figure text-right ${d.vencido > 0 ? "font-semibold text-destructive" : ""}`}>
                  {d.vencido > 0 ? money(d.vencido) : "—"}
                </TableCell>
                <TableCell className="figure">{d.proximoVencimiento ? fechaCorta(d.proximoVencimiento) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </div>
  );
}
