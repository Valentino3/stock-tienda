import Link from "next/link";
import { db } from "@/db";
import { user } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { isoDate } from "@/lib/dates";
import { getSalesHistory } from "@/domain/sales-history";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VoidButton } from "./void-button";

const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
};

type Params = { from?: string; to?: string; seller?: string; all?: string; page?: string };

export default async function VentasPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const currentUser = await requireUser();
  const isOwner = currentUser.role === "owner";
  const page = Math.max(1, Number(params.page) || 1);

  const from = params.from ? new Date(`${params.from}T00:00:00`) : (params.all ? new Date(0) : undefined);
  const to = params.to ? new Date(new Date(`${params.to}T00:00:00`).getTime() + 24 * 60 * 60 * 1000) : undefined;
  const sellerId = !isOwner ? currentUser.id : params.seller || undefined;

  const { sales: rows, itemRows, hasNextPage } = await getSalesHistory(db, { from, to, sellerId, page });

  const itemsBySale = new Map<number, typeof itemRows>();
  for (const item of itemRows) {
    const list = itemsBySale.get(item.saleId) ?? [];
    list.push(item);
    itemsBySale.set(item.saleId, list);
  }

  const sellers = isOwner
    ? await db.select({ id: user.id, name: user.name }).from(user).orderBy(user.name)
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
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Ventas</h1>

      <div className="flex flex-wrap items-end gap-3">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Desde</span>
            <input
              type="date"
              name="from"
              defaultValue={params.from ?? ""}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Hasta</span>
            <input
              type="date"
              name="to"
              defaultValue={params.to ?? ""}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            />
          </label>
          {isOwner && (
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Vendedor</span>
              <select
                name="seller"
                defaultValue={params.seller ?? ""}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              >
                <option value="">Todos</option>
                {sellers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button type="submit" variant="outline" size="sm">
            Filtrar
          </Button>
          {hasFilters && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/ventas">Limpiar</Link>
            </Button>
          )}
        </form>

        <div className="ml-auto flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/ventas?from=${isoDate(today)}&to=${isoDate(today)}`}>Hoy</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/ventas?from=${isoDate(weekAgo)}&to=${isoDate(today)}`}>Esta semana</Link>
          </Button>
        </div>
      </div>

      {usingDefaultWindow && (
        <p className="text-xs text-muted-foreground">
          Mostrando los últimos 30 días.{" "}
          <Link href="/ventas?all=1" className="underline underline-offset-4">
            Ver todo el historial
          </Link>
        </p>
      )}

      {rows.length === 0 && <p className="text-sm text-muted-foreground">No hay ventas para el filtro seleccionado.</p>}

      {rows.length > 0 && (
        <div className="rounded-md border">
          <div className="grid grid-cols-6 gap-2 border-b bg-muted/50 px-4 py-3 text-sm font-medium text-muted-foreground">
            <span>Fecha</span>
            <span>N°</span>
            <span>Vendedor</span>
            <span>Medio de pago</span>
            <span className="text-right">Total</span>
            <span>Estado</span>
          </div>
          <div className="divide-y">
            {rows.map(({ sale, sellerName }: any) => (
              <details key={sale.id} className={sale.voided ? "opacity-60" : ""}>
                <summary className={`grid cursor-pointer grid-cols-6 gap-2 px-4 py-3 text-sm ${sale.voided ? "line-through" : ""}`}>
                  <span>{sale.createdAt.toLocaleString("es-AR")}</span>
                  <span>#{sale.id}</span>
                  <span>{sellerName}</span>
                  <span>{PAYMENT_LABELS[sale.paymentMethod] ?? sale.paymentMethod}</span>
                  <span className="text-right">${sale.total.toFixed(2)}</span>
                  <span>
                    {sale.voided ? (
                      <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                        Anulada
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-green-300 bg-green-50 text-green-800">
                        Activa
                      </Badge>
                    )}
                  </span>
                </summary>
                <div className="space-y-2 border-t bg-muted/30 px-4 py-3 pl-8 text-sm">
                  <ul className="space-y-1">
                    {(itemsBySale.get(sale.id) ?? []).map((item: any) => (
                      <li key={item.id}>
                        {item.productName}
                        {item.variantName ? ` — ${item.variantName}` : ""} × {item.quantity} — $
                        {item.unitPrice.toFixed(2)} c/u = ${(item.quantity * item.unitPrice).toFixed(2)}
                      </li>
                    ))}
                  </ul>
                  {isOwner && !sale.voided && <VoidButton saleId={sale.id} />}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {(page > 1 || hasNextPage) && (
        <div className="flex justify-center gap-2">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(page - 1)}>Anterior</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>Anterior</Button>
          )}
          <span className="flex items-center text-sm text-muted-foreground">Página {page}</span>
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
