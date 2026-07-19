import Link from "next/link";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { sales, saleItems, productVariants, products, user } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { VoidButton } from "./void-button";

const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
};

type Params = { from?: string; to?: string; seller?: string };

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

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Ventas</h1>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-500">Desde</span>
          <input type="date" name="from" defaultValue={params.from ?? ""} className="rounded border p-1 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-500">Hasta</span>
          <input type="date" name="to" defaultValue={params.to ?? ""} className="rounded border p-1 text-sm" />
        </label>
        {isOwner && (
          <label className="text-sm">
            <span className="mb-1 block text-xs text-gray-500">Vendedor</span>
            <select name="seller" defaultValue={params.seller ?? ""} className="rounded border p-1 text-sm">
              <option value="">Todos</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" className="rounded border px-3 py-1 text-sm">
          Filtrar
        </button>
        {hasFilters && (
          <Link href="/ventas" className="text-sm text-blue-600 hover:underline">
            Limpiar
          </Link>
        )}
      </form>

      {rows.length === 0 && <p className="text-sm text-gray-500">No hay ventas para el filtro seleccionado.</p>}

      {rows.length > 0 && (
        <div className="divide-y rounded border">
          <div className="grid grid-cols-6 gap-2 bg-gray-50 p-2 text-xs font-semibold text-gray-500">
            <span>Fecha</span>
            <span>N°</span>
            <span>Vendedor</span>
            <span>Medio de pago</span>
            <span>Total</span>
            <span>Estado</span>
          </div>
          {rows.map(({ sale, sellerName }) => (
            <details key={sale.id}>
              <summary
                className={`cursor-pointer p-2 text-sm ${sale.voided ? "text-gray-400 line-through" : ""}`}
              >
                <span className="ml-1 grid grid-cols-6 gap-2 align-middle">
                  <span>{sale.createdAt.toLocaleString("es-AR")}</span>
                  <span>#{sale.id}</span>
                  <span>{sellerName}</span>
                  <span>{PAYMENT_LABELS[sale.paymentMethod] ?? sale.paymentMethod}</span>
                  <span>${sale.total.toFixed(2)}</span>
                  <span className="flex items-center gap-2">
                    {sale.voided ? "Anulada" : "Activa"}
                    {isOwner && !sale.voided && <VoidButton saleId={sale.id} />}
                  </span>
                </span>
              </summary>
              <div className="bg-gray-50 p-3 pl-6 text-sm">
                <ul className="space-y-1">
                  {(itemsBySale.get(sale.id) ?? []).map((item, idx) => (
                    <li key={idx}>
                      {item.productName}
                      {item.variantName ? ` — ${item.variantName}` : ""} × {item.quantity} — $
                      {item.unitPrice.toFixed(2)} c/u = ${(item.quantity * item.unitPrice).toFixed(2)}
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
