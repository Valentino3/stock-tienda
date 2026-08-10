import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireStore } from "@/lib/session";
import { money, number } from "@/lib/format";
import { getClient, getClientLedger, getClientSummary, type LedgerEntry } from "@/domain/clients";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { StatTile } from "@/components/ui/stat-tile";
import { PaymentButton } from "../clientes-client";
import { DatosFiscalesCard } from "./datos-fiscales-card";

const METHOD_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  cuenta: "Cuenta",
};

const dateTime = (d: Date) =>
  new Date(d).toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

export default async function ClienteDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { storeId, role } = await requireStore();
  const { id } = await params;

  const clientId = Number(id);
  if (!Number.isInteger(clientId)) notFound();

  const client = await getClient(db, storeId, clientId);
  if (!client) notFound();

  const [ledger, summary] = await Promise.all([
    getClientLedger(db, storeId, clientId),
    getClientSummary(db, storeId, clientId),
  ]);

  // Anular una venta a cuenta genera un movimiento "anulacion" que revierte el
  // cargo. Las ventas anuladas ANTES de esa corrección quedaron sin revertir,
  // así que se detectan por ausencia del movimiento y se avisan: su cargo sigue
  // sumando a la deuda y hay que ajustarlo a mano.
  const reversedSaleIds = new Set(
    ledger.filter((e) => e.type === "anulacion" && e.sale).map((e) => e.sale!.id)
  );
  const unreversed = ledger.filter(
    (e) => e.type === "cargo" && e.sale?.voided && !reversedSaleIds.has(e.sale.id)
  );
  const unreversedTotal = unreversed.reduce((acc, e) => acc + e.amount, 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title={client.name}
        description={
          [client.phone, client.note].filter(Boolean).join(" · ") ||
          "Cuenta corriente y detalle de compras."
        }
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/clientes">Volver</Link>
            </Button>
            <PaymentButton clientId={client.id} clientName={client.name} balance={summary.balance} />
          </>
        }
      />

      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Saldo actual"
          value={money(summary.balance)}
          tone={summary.balance > 0 ? "destructive" : "success"}
          hint={summary.balance > 0 ? "Debe" : "Al día"}
        />
        <StatTile label="Total comprado" value={money(summary.charged)} />
        <StatTile label="Total pagado" value={money(summary.paid)} />
        <StatTile
          label="Compras a cuenta"
          value={number(summary.purchases)}
          hint={summary.lastMovementAt ? `Último mov. ${dateTime(summary.lastMovementAt)}` : undefined}
        />
      </div>

      {unreversedTotal > 0 && (
        <Notice tone="warn">
          Hay {number(unreversed.length)} {unreversed.length === 1 ? "venta anulada" : "ventas anuladas"} por{" "}
          <strong>{money(unreversedTotal)}</strong> cuyo cargo quedó sumando a la deuda. Son
          anteriores a la corrección: hoy anular una venta a cuenta descuenta el cargo solo. Si
          corresponde, registrá un ajuste por ese monto.
        </Notice>
      )}

      {/* Cambiar la condición frente al IVA cambia el comprobante que le
          corresponde al cliente (B pasa a A): es del dueño. */}
      {role === "owner" && <DatosFiscalesCard cliente={client} />}

      <Section label="Movimientos">
        {ledger.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-10 text-center text-sm text-muted-foreground">
            Este cliente todavía no tiene compras a cuenta ni pagos registrados.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Del más reciente al más antiguo. Solo aparecen las ventas a cuenta — las compras
              pagadas en el momento no quedan asociadas a un cliente.
            </p>
            {ledger.map((entry) => (
              <LedgerRow key={`${entry.type}-${entry.id}`} entry={entry} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function LedgerRow({ entry }: { entry: LedgerEntry }) {
  const isCharge = entry.type === "cargo";
  const sale = entry.sale;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-border/60 px-4 py-3">
        <span className="text-sm text-muted-foreground">{dateTime(entry.createdAt)}</span>

        {entry.type === "cargo" && (
          <Badge variant="destructive">{sale ? `Venta #${sale.id}` : "Cargo"}</Badge>
        )}
        {entry.type === "pago" && <Badge variant="success">Pago</Badge>}
        {entry.type === "anulacion" && (
          <Badge variant="outline">{sale ? `Anulación venta #${sale.id}` : "Anulación"}</Badge>
        )}

        {/* Solo en el cargo: en la fila de anulación el badge ya lo dice. */}
        {entry.type === "cargo" && sale?.voided && <Badge variant="outline">Anulada</Badge>}
        {entry.method && (
          <span className="text-xs text-muted-foreground">
            {METHOD_LABELS[entry.method] ?? entry.method}
          </span>
        )}
        {(sale?.sellerName ?? entry.createdByName) && (
          <span className="text-xs text-muted-foreground">
            {sale?.sellerName ?? entry.createdByName}
          </span>
        )}

        <span
          className={`figure ml-auto font-medium ${
            isCharge ? "text-destructive" : entry.type === "pago" ? "text-success" : "text-muted-foreground"
          }`}
        >
          {isCharge ? "+" : "−"}{money(entry.amount)}
        </span>
        <span className="figure w-32 text-right text-sm text-muted-foreground">
          Saldo {money(entry.balanceAfter)}
        </span>
      </div>

      {entry.note && (
        <p className="px-4 pt-2 text-sm text-muted-foreground">{entry.note}</p>
      )}

      {/* El detalle va solo en el cargo: la anulación apunta a la misma venta y
          repetir los productos duplicaría la lista. */}
      {isCharge && sale && sale.items.length > 0 && (
        <ul className="divide-y divide-border/40 px-4 py-2">
          {sale.items.map((it, i) => {
            const lineNet = it.quantity * it.unitPrice - it.discountAmount;
            return (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 py-1.5 text-sm">
                <span className="figure text-muted-foreground">{number(it.quantity)}×</span>
                <span>
                  {it.productName}
                  {it.variantName && <span className="text-muted-foreground"> · {it.variantName}</span>}
                </span>
                <span className="text-xs text-muted-foreground">{money(it.unitPrice)} c/u</span>
                {it.discountAmount > 0 && (
                  <span className="text-xs text-muted-foreground">− {money(it.discountAmount)}</span>
                )}
                <span className="figure ml-auto">{money(lineNet)}</span>
              </li>
            );
          })}
          {sale.discountAmount > 0 && (
            <li className="flex items-baseline justify-between py-1.5 text-sm text-muted-foreground">
              <span>Descuento general</span>
              <span className="figure">− {money(sale.discountAmount)}</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
