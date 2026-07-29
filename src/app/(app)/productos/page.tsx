import Link from "next/link";
import { db } from "@/db";
import { requireStore } from "@/lib/session";
import { listInventory, getInventoryFacets, PAGE_SIZE } from "@/domain/inventory";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ProductForm } from "./product-form";
import { InventoryFilters } from "./inventory-filters";
import { InventoryTable } from "./inventory-table";
import { parseFilters, buildQuery, forRole, type SearchParams } from "./filters";

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireStore();
  const isOwner = user.role === "owner";
  // Al empleado no se le ocultan costo y margen solo en la UI: los filtros y el
  // orden por esas columnas se descartan acá. Si no, bastaba con escribir
  // ?mmin=60 en la barra de direcciones y, tanteando el valor, deducir a cuánto
  // se compró cada producto.
  const filters = forRole(parseFilters(await searchParams), isOwner);

  const [{ rows, total, hasNextPage }, facets] = await Promise.all([
    listInventory(db, user.storeId, filters),
    getInventoryFacets(db, user.storeId),
  ]);

  const hasFilters = buildQuery(filters, { sort: filters.sort, dir: filters.dir, page: 1 }) !== "/productos";
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Productos"
        description="Inventario por variante, con filtros y orden."
        actions={isOwner ? <ProductForm categories={facets.categories} /> : undefined}
      />

      <InventoryFilters filters={filters} facets={facets} isOwner={isOwner} total={total} />

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-10 text-center text-sm text-muted-foreground">
          {hasFilters
            ? "Ningún producto coincide con estos filtros."
            : "No hay productos cargados todavía."}
        </p>
      ) : (
        <InventoryTable rows={rows} filters={filters} isOwner={isOwner} />
      )}

      {(filters.page > 1 || hasNextPage) && (
        <div className="flex items-center justify-center gap-3">
          {filters.page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={buildQuery(filters, { page: filters.page - 1 })}>Anterior</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>Anterior</Button>
          )}
          <span className="ledger-label">Página {filters.page} de {lastPage}</span>
          {hasNextPage ? (
            <Button asChild variant="outline" size="sm">
              <Link href={buildQuery(filters, { page: filters.page + 1 })}>Siguiente</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>Siguiente</Button>
          )}
        </div>
      )}
    </div>
  );
}
