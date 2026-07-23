import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";
import { requireStore } from "@/lib/session";
import { isoDate } from "@/lib/dates";
import { money } from "@/lib/format";
import { getSalesHistory } from "@/domain/sales-history";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { VoidButton } from "./void-button";

const SELECT_CLASS =
  "h-9 w-44 rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  cuenta: "Cuenta",
};

type Params = { from?: string; to?: string; seller?: string; all?: string; page?: string };

export default async function VentasPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const currentUser = await requireStore();
  const isOwner = currentUser.role === "owner";
  const storeId = currentUser.storeId;
  const page = Math.max(1, Number(params.page) || 1);

  const from = params.from ? new Date(`${params.from}T00:00:00`) : (params.all ? new Date(0) : undefined);
  const to = params.to ? new Date(new Date(`${params.to}T00:00:00`).getTime() + 24 * 60 * 60 * 1000) : undefined;
  const sellerId = !isOwner ? currentUser.id : params.seller || undefined;

  const { sales: rows, itemRows, hasNextPage } = await getSalesHistory(db, { storeId, from, to, sellerId, page });

  const itemsBySale = new Map<number, typeof itemRows>();
  for (const item of itemRows) {
    const list = itemsBySale.get(item.saleId) ?? [];
    list.push(item);
    itemsBySale.set(item.saleId, list);
  }

  // Solo vendedores de esta tienda.
  const sellers = isOwner
    ? await db.select({ id: user.id, name: user.name }).from(user).where(eq(user.storeId, storeId)).orderBy(user.name)
    : [];

  const hasFilters = Boolean(params.from || params.to || params.seller);
  const usingDefaultWindow = !params.from && !params.to && !params.all;

  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  // Construye el querystring de paginación a mano en vez de
  // `new URLSearchParams({...params, page})`: `params` puede tener
  // `from`/`to`/`seller`/`all` en `undefined`, y pasar un objeto con
  // valores `undefined` a `URLSearchParams` los serializa como el string
  // literal "undefined" en vez de omitirlos.
  function pageHref(page: number) {
    const sp = new URLSearchParams();
    if (params.from) sp.set("from", params.from);
    if (params.to) sp.set("to", params.to);
    if (params.seller) sp.set("seller", params.seller);
    if (params.all) sp.set("all", params.all);
    sp.set("page", String(page));
    return `/ventas?${sp.toString()}`;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ventas"
        description="Historial de ventas con filtros por fecha y vendedor."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/ventas?from=${isoDate(today)}&to=${isoDate(today)}`}>Hoy</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/ventas?from=${isoDate(weekAgo)}&to=${isoDate(today)}`}>Esta semana</Link>
            </Button>
            <Button asChild size="sm">
              <a href={`/ventas/export${params.from || params.to ? `?from=${params.from ?? ""}&to=${params.to ?? ""}` : ""}`}>
                Exportar Excel
              </a>
            </Button>
          </div>
        }
      />

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-4 shadow-xs"
      >
        <label className="flex flex-col gap-1.5">
          <span className="ledger-label">Desde</span>
          <Input type="date" name="from" defaultValue={params.from ?? ""} className="w-40" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="ledger-label">Hasta</span>
          <Input type="date" name="to" defaultValue={params.to ?? ""} className="w-40" />
        </label>
        {isOwner && (
          <label className="flex flex-col gap-1.5">
            <span className="ledger-label">Vendedor</span>
            <select name="seller" defaultValue={params.seller ?? ""} className={SELECT_CLASS}>
              <option value="">Todos</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button type="submit" size="sm">
          Filtrar
        </Button>
        {hasFilters && (
          <Button asChild variant="ghost" size="sm">
            <Link href="/ventas">Limpiar</Link>
          </Button>
        )}
      </form>

      {usingDefaultWindow && (
        <p className="text-xs text-muted-foreground">
          Mostrando los últimos 30 días.{" "}
          <Link href="/ventas?all=1" className="text-brand underline underline-offset-4">
            Ver todo el historial
          </Link>
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-10 text-center text-sm text-muted-foreground">
          No hay ventas para el filtro seleccionado.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
          <div className="grid grid-cols-[9rem_4rem_1fr_9rem_7rem_6rem] gap-3 border-b border-border bg-muted/40 px-4 py-2.5">
            <span className="ledger-label">Fecha</span>
            <span className="ledger-label">N°</span>
            <span className="ledger-label">Vendedor</span>
            <span className="ledger-label">Medio</span>
            <span className="ledger-label text-right">Total</span>
            <span className="ledger-label">Estado</span>
          </div>
          <div className="divide-y divide-border">
            {rows.map(({ sale, sellerName }: any) => (
              <details key={sale.id} className={`group ${sale.voided ? "opacity-70" : ""}`}>
                <summary className="grid cursor-pointer grid-cols-[9rem_4rem_1fr_9rem_7rem_6rem] items-center gap-3 px-4 py-3 text-sm transition-colors marker:content-none hover:bg-accent">
                  <span className={`figure text-muted-foreground ${sale.voided ? "line-through" : ""}`}>
                    {sale.createdAt.toLocaleString("es-AR")}
                  </span>
                  <span className="figure font-medium">#{sale.id}</span>
                  <span className="truncate">{sellerName}</span>
                  <span className="text-muted-foreground">{PAYMENT_LABELS[sale.paymentMethod] ?? sale.paymentMethod}</span>
                  <span className={`figure text-right font-medium ${sale.voided ? "line-through" : ""}`}>
                    {money(sale.total)}
                  </span>
                  <span>
                    {sale.voided ? (
                      <Badge variant="destructive">Anulada</Badge>
                    ) : (
                      <Badge variant="success">Activa</Badge>
                    )}
                  </span>
                </summary>
                <div className="space-y-3 border-t border-border bg-muted/30 px-4 py-3 text-sm">
                  <ul className="space-y-1.5">
                    {(itemsBySale.get(sale.id) ?? []).map((item: any) => {
                      const lineNet = item.quantity * item.unitPrice - (item.discountAmount ?? 0);
                      return (
                        <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-2">
                          <span>
                            {item.productName}
                            {item.variantName ? ` — ${item.variantName}` : ""}{" "}
                            <span className="text-muted-foreground">× {item.quantity}</span>
                          </span>
                          <span className="figure text-muted-foreground">
                            {money(item.unitPrice)} c/u
                            {item.discountAmount > 0 && ` − ${money(item.discountAmount)} desc.`} = {money(lineNet)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {sale.discountAmount > 0 && (
                    <p className="figure text-xs text-muted-foreground">
                      Descuento general: −{money(sale.discountAmount)}
                    </p>
                  )}
                  {isOwner && !sale.voided && <VoidButton saleId={sale.id} />}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {(page > 1 || hasNextPage) && (
        <div className="flex items-center justify-center gap-3">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(page - 1)}>Anterior</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>Anterior</Button>
          )}
          <span className="ledger-label">Página {page}</span>
          {hasNextPage ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(page + 1)}>Siguiente</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>Siguiente</Button>
          )}
        </div>
      )}
    </div>
  );
}
