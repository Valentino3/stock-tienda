import Link from "next/link";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { sales, saleItems, productVariants, products, user } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { VoidButton } from "./void-button";

const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
};

type Params = { from?: string; to?: string; seller?: string };

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default async function VentasPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const currentUser = await requireUser();
  const isOwner = currentUser.role === "owner";

  const conditions = [];
  if (params.from) conditions.push(gte(sales.createdAt, new Date(`${params.from}T00:00:00`)));
  if (params.to) {
    const exclusiveEnd = new Date(new Date(`${params.to}T00:00:00`).getTime() + 24 * 60 * 60 * 1000);
    conditions.push(lt(sales.createdAt, exclusiveEnd));
  }
  if (!isOwner) conditions.push(eq(sales.sellerId, currentUser.id));
  else if (params.seller) conditions.push(eq(sales.sellerId, params.seller));

  const rows = await db
    .select({ sale: sales, sellerName: user.name })
    .from(sales)
    .innerJoin(user, eq(sales.sellerId, user.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(sales.createdAt));

  const saleIds = rows.map((r) => r.sale.id);
  const itemRows = saleIds.length
    ? await db
        .select({
          id: saleItems.id,
          saleId: saleItems.saleId,
          quantity: saleItems.quantity,
          unitPrice: saleItems.unitPrice,
          productName: products.name,
          variantName: productVariants.name,
        })
        .from(saleItems)
        .innerJoin(productVariants, eq(saleItems.variantId, productVariants.id))
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(inArray(saleItems.saleId, saleIds))
    : [];

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

  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

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

      {rows.length === 0 && <p className="text-sm text-muted-foreground">No hay ventas para el filtro seleccionado.</p>}

      {rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>N°</TableHead>
              <TableHead>Vendedor</TableHead>
              <TableHead>Medio de pago</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ sale, sellerName }) => (
              <TableRow key={sale.id} className={sale.voided ? "opacity-60" : ""}>
                <TableCell colSpan={6} className="p-0">
                  <details>
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
                        {(itemsBySale.get(sale.id) ?? []).map((item) => (
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
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
