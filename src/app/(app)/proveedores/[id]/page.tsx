import Link from "next/link";
import { notFound, redirect, unstable_rethrow } from "next/navigation";
import { db } from "@/db";
import { requireStoreOwner } from "@/lib/session";
import { hoyAR } from "@/lib/dates";
import { money } from "@/lib/format";
import { estadoDeCuenta } from "@/domain/proveedores";
import { listarRubros } from "@/domain/gastos";
import { MEDIOS_DE_GASTO } from "@/domain/gastos-medios";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Section } from "@/components/ui/section";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Anular, NuevaFactura, NuevoPago, ProveedorForm } from "../proveedores-client";

/** La cuenta de un proveedor: sus facturas con lo que queda de cada una, y los pagos. */

const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
const MEDIO = new Map<string, string>(MEDIOS_DE_GASTO.map((m) => [m.value, m.label]));

export default async function ProveedorPage({ params }: { params: Promise<{ id: string }> }) {
  let storeId: number;
  try {
    ({ storeId } = await requireStoreOwner());
  } catch (err) {
    unstable_rethrow(err);
    redirect("/caja");
  }

  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const hoy = hoyAR();
  let cuenta;
  try {
    cuenta = await estadoDeCuenta(db, storeId, id, hoy);
  } catch {
    notFound();
  }
  const rubros = (await listarRubros(db, storeId)).map((r) => ({ id: r.id, nombre: r.nombre }));
  const { proveedor, saldo, vencido, proximoVencimiento, facturas, pagos } = cuenta;

  return (
    <div className="space-y-8">
      <PageHeader
        title={proveedor.nombre}
        description={[
          proveedor.cuit && `CUIT ${proveedor.cuit}`,
          proveedor.plazoDias != null && `Plazo ${proveedor.plazoDias} días`,
          proveedor.telefono,
          !proveedor.activo && "Inactivo",
        ].filter(Boolean).join(" · ") || "Proveedor"}
        actions={
          <div className="flex gap-2">
            <Button asChild variant="ghost" size="sm"><Link href="/proveedores">Volver</Link></Button>
            <ProveedorForm rubros={rubros} proveedor={proveedor} />
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label={saldo < 0 ? "A favor del local" : "Se le debe"}
          value={money(Math.abs(saldo))}
          tone={saldo < 0 ? "success" : "default"}
        />
        <StatTile label="Vencido" value={money(vencido)} tone={vencido > 0 ? "destructive" : "default"} />
        <StatTile label="Próximo vencimiento" value={proximoVencimiento ? fechaCorta(proximoVencimiento) : "—"} />
      </div>

      {proveedor.activo && (
        <Section label="Cargar factura">
          <NuevaFactura
            proveedorId={proveedor.id} rubros={rubros} rubroPorDefecto={proveedor.rubroId}
            plazoDias={proveedor.plazoDias} hoy={hoy}
          />
        </Section>
      )}

      <Section label="Registrar pago">
        <p className="mb-3 text-sm text-muted-foreground">
          Fuera de la caja: no toca el arqueo. Se aplica a las facturas que vencen primero.
        </p>
        <NuevoPago proveedorId={proveedor.id} hoy={hoy} saldo={Math.max(0, saldo)} />
      </Section>

      <Section label="Facturas">
        <Panel flush>
          <Table aria-label="Facturas">
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Número</TableHead>
                <TableHead>Rubro</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Vence</TableHead>
                <TableHead className="text-right">Pendiente</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {facturas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Sin facturas cargadas.</TableCell>
                </TableRow>
              ) : [...facturas].reverse().map((f) => (
                <TableRow key={f.id} className={f.voidedAt ? "opacity-60" : undefined}>
                  <TableCell className="figure">{fechaCorta(f.fecha)}</TableCell>
                  <TableCell>
                    {f.tipo ? `${f.tipo} ` : ""}{f.numero}
                    {f.detalle && <span className="block text-xs text-muted-foreground">{f.detalle}</span>}
                    {f.voidedAt && <span className="block text-xs text-destructive">Anulada: {f.voidReason}</span>}
                  </TableCell>
                  <TableCell>{f.rubro}</TableCell>
                  <TableCell className={`figure text-right ${f.voidedAt ? "line-through" : ""}`}>{money(f.total)}</TableCell>
                  <TableCell className="figure">{fechaCorta(f.vencimiento)}</TableCell>
                  <TableCell className="figure text-right">
                    {f.voidedAt ? "—" : f.pendiente === 0
                      ? <Badge variant="success">Pagada</Badge>
                      : <span className={f.vencida ? "font-semibold text-destructive" : undefined}>
                        {money(f.pendiente)}{f.vencida && " · vencida"}
                      </span>}
                  </TableCell>
                  <TableCell className="text-right">
                    {!f.voidedAt && <Anular tipo="compra" proveedorId={proveedor.id} id={f.id} titulo={`la factura ${f.numero}`} />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </Section>

      <Section label="Pagos">
        <Panel flush>
          <Table aria-label="Pagos">
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Cómo</TableHead>
                <TableHead>Detalle</TableHead>
                <TableHead className="text-right">Monto</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagos.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Sin pagos registrados.</TableCell>
                </TableRow>
              ) : [...pagos].reverse().map((p) => (
                <TableRow key={p.id} className={p.voidedAt ? "opacity-60" : undefined}>
                  <TableCell className="figure">{fechaCorta(p.fecha)}</TableCell>
                  <TableCell>{MEDIO.get(p.medio) ?? p.medio}</TableCell>
                  <TableCell>
                    {p.detalle ?? "—"}
                    {p.voidedAt && <span className="block text-xs text-destructive">Anulado: {p.voidReason}</span>}
                  </TableCell>
                  <TableCell className={`figure text-right ${p.voidedAt ? "line-through" : ""}`}>{money(p.monto)}</TableCell>
                  <TableCell className="text-right">
                    {!p.voidedAt && <Anular tipo="pago" proveedorId={proveedor.id} id={p.id} titulo={`el pago de ${money(p.monto)}`} />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </Section>
    </div>
  );
}
