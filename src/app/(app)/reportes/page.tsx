import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { db } from "@/db";
import { requireOwner } from "@/lib/session";
import { getSalesReport, getTopProducts, getLowStock, getCashSessionHistory } from "@/domain/reports";

const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
};

function money(n: number | null | undefined) {
  return `$${(n ?? 0).toFixed(2)}`;
}

type Params = { from?: string; to?: string };

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  try {
    await requireOwner();
  } catch (err) {
    unstable_rethrow(err);
    redirect("/vender");
  }

  const params = await searchParams;

  const now = new Date();
  const defaultTo = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const defaultFrom = new Date(defaultTo);
  defaultFrom.setDate(defaultFrom.getDate() - 30);
  defaultFrom.setHours(0, 0, 0, 0);

  const from = params.from ? new Date(`${params.from}T00:00:00`) : defaultFrom;
  const to = params.to
    ? new Date(new Date(`${params.to}T00:00:00`).getTime() + 24 * 60 * 60 * 1000 - 1)
    : defaultTo;

  const fromValue = params.from ?? defaultFrom.toISOString().slice(0, 10);
  const toValue = params.to ?? defaultTo.toISOString().slice(0, 10);

  const [{ byDay, byMethod }, topProducts, lowStock, cashHistory] = await Promise.all([
    getSalesReport(db, { from, to }),
    getTopProducts(db, { from, to, limit: 10 }),
    getLowStock(db),
    getCashSessionHistory(db, { limit: 30 }),
  ]);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold">Reportes</h1>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-500">Desde</span>
          <input type="date" name="from" defaultValue={fromValue} className="rounded border p-1 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-gray-500">Hasta</span>
          <input type="date" name="to" defaultValue={toValue} className="rounded border p-1 text-sm" />
        </label>
        <button type="submit" className="rounded border px-3 py-1 text-sm">
          Filtrar
        </button>
        {(params.from || params.to) && (
          <Link href="/reportes" className="text-sm text-blue-600 hover:underline">
            Limpiar
          </Link>
        )}
      </form>

      <section className="space-y-2">
        <h2 className="font-semibold">Ventas por día</h2>
        {byDay.length === 0 && <p className="text-sm text-gray-500">Sin ventas en el rango seleccionado.</p>}
        {byDay.length > 0 && (
          <div className="divide-y rounded border">
            <div className="grid grid-cols-3 gap-2 bg-gray-50 p-2 text-xs font-semibold text-gray-500">
              <span>Fecha</span>
              <span>Cantidad</span>
              <span>Total</span>
            </div>
            {byDay.map((row: { day: string; count: number; total: number }) => (
              <div key={row.day} className="grid grid-cols-3 gap-2 p-2 text-sm">
                <span>{row.day}</span>
                <span>{row.count}</span>
                <span>{money(row.total)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Totales por medio de pago</h2>
        {byMethod.length === 0 && <p className="text-sm text-gray-500">Sin ventas en el rango seleccionado.</p>}
        {byMethod.length > 0 && (
          <div className="divide-y rounded border">
            <div className="grid grid-cols-3 gap-2 bg-gray-50 p-2 text-xs font-semibold text-gray-500">
              <span>Medio de pago</span>
              <span>Cantidad</span>
              <span>Total</span>
            </div>
            {byMethod.map((row: { method: string; count: number; total: number }) => (
              <div key={row.method} className="grid grid-cols-3 gap-2 p-2 text-sm">
                <span>{PAYMENT_LABELS[row.method] ?? row.method}</span>
                <span>{row.count}</span>
                <span>{money(row.total)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Top 10 productos</h2>
        {topProducts.length === 0 && <p className="text-sm text-gray-500">Sin ventas en el rango seleccionado.</p>}
        {topProducts.length > 0 && (
          <div className="divide-y rounded border">
            <div className="grid grid-cols-4 gap-2 bg-gray-50 p-2 text-xs font-semibold text-gray-500">
              <span>Producto</span>
              <span>Variante</span>
              <span>Unidades vendidas</span>
              <span>Ingresos</span>
            </div>
            {topProducts.map(
              (row: { productName: string; variantName: string; unitsSold: number; revenue: number }, i: number) => (
                <div key={i} className="grid grid-cols-4 gap-2 p-2 text-sm">
                  <span>{row.productName}</span>
                  <span>{row.variantName || "—"}</span>
                  <span>{row.unitsSold}</span>
                  <span>{money(row.revenue)}</span>
                </div>
              )
            )}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Stock bajo</h2>
        {lowStock.length === 0 && <p className="text-sm text-gray-500">No hay productos con stock bajo.</p>}
        {lowStock.length > 0 && (
          <div className="divide-y rounded border">
            <div className="grid grid-cols-4 gap-2 bg-gray-50 p-2 text-xs font-semibold text-gray-500">
              <span>Producto</span>
              <span>Variante</span>
              <span>Stock</span>
              <span>Umbral</span>
            </div>
            {lowStock.map(
              (row: { productName: string; variantName: string; stock: number; threshold: number }, i: number) => (
                <div key={i} className="grid grid-cols-4 gap-2 p-2 text-sm text-red-600">
                  <span>{row.productName}</span>
                  <span>{row.variantName || "—"}</span>
                  <span>{row.stock}</span>
                  <span>{row.threshold}</span>
                </div>
              )
            )}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Cierres de caja</h2>
        {cashHistory.length === 0 && <p className="text-sm text-gray-500">No hay cierres de caja registrados.</p>}
        {cashHistory.length > 0 && (
          <div className="divide-y rounded border">
            <div className="grid grid-cols-4 gap-2 bg-gray-50 p-2 text-xs font-semibold text-gray-500">
              <span>Fecha</span>
              <span>Esperado</span>
              <span>Contado</span>
              <span>Diferencia</span>
            </div>
            {cashHistory.map(
              (session: {
                id: number;
                closedAt: Date | null;
                expectedCash: number | null;
                countedCash: number | null;
                difference: number | null;
              }) => (
                <div key={session.id} className="grid grid-cols-4 gap-2 p-2 text-sm">
                  <span>{session.closedAt?.toLocaleString("es-AR") ?? "—"}</span>
                  <span>{money(session.expectedCash)}</span>
                  <span>{money(session.countedCash)}</span>
                  <span className={session.difference && session.difference !== 0 ? "text-red-600 font-semibold" : ""}>
                    {money(session.difference)}
                  </span>
                </div>
              )
            )}
          </div>
        )}
      </section>
    </div>
  );
}
