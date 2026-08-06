import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { money, number } from "@/lib/format";
import type { InventoryFilters, InventoryRow, SortKey } from "@/domain/inventory";
import type { AtributoCatalogo } from "@/lib/verticals";
import { buildQuery } from "./filters";
import { VariantActions } from "./variant-actions";

/**
 * Inventario como tabla plana: una fila por variante.
 *
 * Costo y margen son solo para el dueño — un empleado en el mostrador no tiene
 * por qué ver a cuánto se compró. Proveedor sí lo ven los dos, porque sirve
 * para armar una reposición.
 */
export function InventoryTable({
  rows,
  filters,
  isOwner,
  atributos,
}: {
  rows: InventoryRow[];
  filters: InventoryFilters;
  isOwner: boolean;
  /** Atributos de catálogo que este rubro muestra. Ver src/lib/verticals. */
  atributos: readonly AtributoCatalogo[];
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead field="product" filters={filters}>Producto</SortableHead>
            <TableHead>SKU</TableHead>
            <SortableHead field="stock" filters={filters} align="right">Stock</SortableHead>
            <SortableHead field="price" filters={filters} align="right">Venta</SortableHead>
            <TableHead className="text-right">Efectivo</TableHead>
            <TableHead className="text-right">Mayorista</TableHead>
            {isOwner && <TableHead className="text-right">Costo</TableHead>}
            {isOwner && (
              <SortableHead field="margin" filters={filters} align="right">Margen</SortableHead>
            )}
            <SortableHead field="supplier" filters={filters}>Proveedor</SortableHead>
            {atributos.length > 0 && <TableHead>Atributos</TableHead>}
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <InventoryTableRow key={row.variantId} row={row} isOwner={isOwner} atributos={atributos} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SortableHead({
  field,
  filters,
  align = "left",
  children,
}: {
  field: SortKey;
  filters: InventoryFilters;
  align?: "left" | "right";
  children: React.ReactNode;
}) {
  const isActive = filters.sort === field;
  // Click en la columna activa invierte; en otra, arranca ascendente.
  const nextDir = isActive && filters.dir === "asc" ? "desc" : "asc";
  const Icon = !isActive ? ChevronsUpDown : filters.dir === "asc" ? ArrowUp : ArrowDown;

  return (
    <TableHead className={align === "right" ? "text-right" : undefined}>
      <Link
        href={buildQuery(filters, { sort: field, dir: nextDir })}
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          align === "right" && "flex-row-reverse",
          isActive && "text-foreground"
        )}
        aria-sort={isActive ? (filters.dir === "asc" ? "ascending" : "descending") : "none"}
      >
        {children}
        <Icon className={cn("size-3", !isActive && "opacity-40")} />
      </Link>
    </TableHead>
  );
}

function InventoryTableRow({
  row, isOwner, atributos,
}: { row: InventoryRow; isOwner: boolean; atributos: readonly AtributoCatalogo[] }) {
  const inactive = !row.variantActive || !row.productActive;
  // Lo que no lleva stock nunca está bajo: apaga el badge rojo y también el
  // botón de avisar al dueño y las acciones de reponer/ajustar.
  const lowStock = row.tracksStock && row.stock <= row.lowStockThreshold;

  return (
    <TableRow className={cn(inactive && "opacity-55")}>
      <TableCell className="max-w-[22rem]">
        <div className="truncate font-medium" title={row.productName}>{row.productName}</div>
        {(row.variantName || row.category || inactive) && (
          <div className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            {row.variantName && <span className="truncate">{row.variantName}</span>}
            {row.category && <span className="truncate">· {row.category}</span>}
            {inactive && <Badge variant="outline" className="h-4 px-1 text-[10px]">Inactivo</Badge>}
          </div>
        )}
      </TableCell>

      <TableCell className="figure text-xs text-muted-foreground">{row.sku ?? "—"}</TableCell>

      <TableCell className="text-right">
        {!row.tracksStock ? (
          // Sin control de stock el número existe en la fila pero no significa
          // nada. Mostrar "0" en rojo sería mentirle al dueño.
          <span className="text-muted-foreground" title="Este producto no lleva control de stock">—</span>
        ) : lowStock ? (
          <Badge variant="destructive" className="font-mono">{number(row.stock)}</Badge>
        ) : (
          <span className="figure">{number(row.stock)}</span>
        )}
      </TableCell>

      <TableCell className="figure text-right font-medium">
        {money(row.price)}
        {!row.priceOverridden && (
          // Sin esto no se distingue un precio propio de uno heredado, y al
          // editar la variante el campo aparece vacío sin explicación.
          <span className="ml-1 text-[10px] text-muted-foreground" title="Heredado del precio base del producto">
            base
          </span>
        )}
      </TableCell>

      <TableCell className="figure text-right text-muted-foreground">
        {row.priceCash != null ? money(row.priceCash) : "—"}
      </TableCell>
      <TableCell className="figure text-right text-muted-foreground">
        {row.priceWholesale != null ? money(row.priceWholesale) : "—"}
      </TableCell>

      {isOwner && (
        <TableCell className="figure text-right text-muted-foreground">
          {row.costArs != null ? money(row.costArs) : "—"}
          {row.costUsd != null && (
            <span className="block text-[10px]">US$ {number(row.costUsd)}</span>
          )}
        </TableCell>
      )}
      {isOwner && (
        <TableCell className="figure text-right">
          {row.margin == null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className={row.margin < 0 ? "text-destructive" : undefined}>{row.margin}%</span>
          )}
        </TableCell>
      )}

      <TableCell className="max-w-[10rem] truncate text-muted-foreground" title={row.supplier ?? ""}>
        {row.supplier ?? "—"}
      </TableCell>

      {/* Columna de atributos de carta. Un rubro que no los declara ni siquiera
          renderiza la celda — las columnas siguen existiendo en la base con sus
          defaults, pero acá serían siempre vacías. */}
      {atributos.length > 0 && (
        <TableCell>
          <div className="flex flex-wrap items-center gap-1">
            {atributos.includes("setName") && row.setName && (
              <span className="max-w-[9rem] truncate text-xs text-muted-foreground" title={row.setName}>
                {row.setName}
              </span>
            )}
            {atributos.includes("condition") && row.condition && (
              <Badge variant="outline" className="h-5">{row.condition}</Badge>
            )}
            {atributos.includes("foil") && row.foil && (
              <Badge variant="secondary" className="h-5">Foil</Badge>
            )}
            {atributos.includes("language") && row.language && (
              <Badge variant="outline" className="h-5">{row.language}</Badge>
            )}
          </div>
        </TableCell>
      )}

      <TableCell className="text-right">
        <VariantActions
          variant={{
            id: row.variantId,
            productId: row.productId,
            name: row.variantName,
            sku: row.sku,
            stock: row.stock,
            active: row.variantActive,
            ownPrice: row.ownPrice,
            priceCash: row.priceCash,
            priceWholesale: row.priceWholesale,
            costUsd: row.costUsd,
            costArs: row.costArs,
            supplier: row.supplier,
            supplierSku: row.supplierSku,
            setName: row.setName,
            condition: row.condition,
            foil: row.foil,
            language: row.language,
          }}
          lowStock={lowStock}
          isOwner={isOwner}
          tracksStock={row.tracksStock}
        />
      </TableCell>
    </TableRow>
  );
}
