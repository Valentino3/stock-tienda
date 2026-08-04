"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { InventoryFilters as Filters, StockState } from "@/domain/inventory";
import type { AtributoCatalogo } from "@/lib/verticals";
import { buildQuery, activeChips } from "./filters";

export type Facets = {
  categories: string[]; suppliers: string[]; sets: string[];
  conditions: string[]; languages: string[];
};

const STOCK_OPTIONS: { value: StockState; label: string }[] = [
  { value: "out", label: "Sin stock" },
  { value: "low", label: "Stock bajo" },
  { value: "in", label: "Con stock" },
];

/** Cuántos filtros hay puestos, para el contador del botón "Más filtros". */
function countPanelFilters(f: Filters): number {
  return (
    f.categories.length + f.suppliers.length + f.sets.length +
    f.conditions.length + f.languages.length +
    [f.priceMin, f.priceMax, f.costMin, f.costMax, f.marginMin, f.marginMax, f.foil, f.active]
      .filter((v) => v !== undefined).length
  );
}

export function InventoryFilters({
  filters,
  facets,
  isOwner,
  total,
  atributos,
}: {
  filters: Filters;
  facets: Facets;
  isOwner: boolean;
  total: number;
  /** Atributos de catálogo que este rubro muestra. Ver src/lib/verticals. */
  atributos: readonly AtributoCatalogo[];
}) {
  const router = useRouter();
  const go = (patch: Partial<Filters>) => router.push(buildQuery(filters, patch));

  const chips = activeChips(filters);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox filters={filters} />

        <div className="inline-flex rounded-lg border border-border p-0.5">
          {STOCK_OPTIONS.map((opt) => {
            const active = filters.stockState === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                // Volver a tocar el estado activo lo apaga: sin esto no hay
                // forma de sacar el filtro sin ir a los chips.
                onClick={() => go({ stockState: active ? undefined : opt.value })}
                className={cn(
                  "rounded-md px-2.5 py-1 text-sm transition-colors",
                  active ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <FiltersPanel filters={filters} facets={facets} isOwner={isOwner} atributos={atributos} />

        <span className="ml-auto text-sm text-muted-foreground">
          {total === 1 ? "1 variante" : `${total.toLocaleString("es-AR")} variantes`}
        </span>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => go(chip.clear)}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 py-0.5 pr-1.5 pl-2.5 text-xs transition-colors hover:bg-muted"
            >
              {chip.label}
              <X className="size-3 text-muted-foreground" />
              <span className="sr-only">Quitar filtro</span>
            </button>
          ))}
          <Button
            variant="ghost"
            size="xs"
            onClick={() => router.push("/productos")}
            className="text-muted-foreground"
          >
            Limpiar todo
          </Button>
        </div>
      )}
    </div>
  );
}

function SearchBox({ filters }: { filters: Filters }) {
  const [value, setValue] = useState(filters.q ?? "");
  const router = useRouter();
  const mounted = useRef(false);

  useEffect(() => {
    // No navegar en el montaje: una URL cargada con ?q=&page=3 se reescribiría
    // sola ~300ms después. Solo se navega cuando el usuario edita el término.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const handle = setTimeout(() => {
      // buildQuery conserva el resto de los filtros. Antes el buscador armaba
      // el querystring desde cero y borraba la categoría seleccionada.
      router.push(buildQuery(filters, { q: value.trim() || undefined }));
    }, 300);
    return () => clearTimeout(handle);
    // `filters` se omite a propósito: incluirlo re-dispararía la navegación
    // cada vez que cambia cualquier otro filtro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, router]);

  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder="Buscar producto, SKU o set…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="pl-9"
      />
    </div>
  );
}

function FiltersPanel({
  filters,
  facets,
  isOwner,
  atributos,
}: {
  filters: Filters;
  facets: Facets;
  isOwner: boolean;
  atributos: readonly AtributoCatalogo[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Filters>(filters);
  const count = countPanelFilters(filters);

  // El panel edita un borrador y aplica todo junto: tildar cinco proveedores no
  // debería disparar cinco navegaciones al servidor.
  function openChange(next: boolean) {
    if (next) setDraft(filters);
    setOpen(next);
  }

  function apply() {
    router.push(buildQuery(filters, draft));
    setOpen(false);
  }

  const patch = (over: Partial<Filters>) => setDraft((d) => ({ ...d, ...over }));

  return (
    <Popover open={open} onOpenChange={openChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontal className="size-4" />
          Más filtros
          {count > 0 && <Badge variant="brand" className="ml-1 h-5 px-1.5">{count}</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-[70vh] w-80 overflow-y-auto sm:w-96">
        <div className="space-y-4">
          <FacetList
            label="Categoría"
            options={facets.categories}
            selected={draft.categories}
            onChange={(categories) => patch({ categories })}
          />
          <FacetList
            label="Proveedor"
            options={facets.suppliers}
            selected={draft.suppliers}
            onChange={(suppliers) => patch({ suppliers })}
          />
          {atributos.includes("setName") && (
            <FacetList
              label="Set"
              options={facets.sets}
              selected={draft.sets}
              onChange={(sets) => patch({ sets })}
            />
          )}
          {atributos.includes("condition") && (
            <FacetList
              label="Condición"
              options={facets.conditions}
              selected={draft.conditions}
              onChange={(conditions) => patch({ conditions })}
            />
          )}
          {atributos.includes("language") && (
            <FacetList
              label="Idioma"
              options={facets.languages}
              selected={draft.languages}
              onChange={(languages) => patch({ languages })}
            />
          )}

          <Range
            label="Precio de venta"
            min={draft.priceMin} max={draft.priceMax}
            onChange={(priceMin, priceMax) => patch({ priceMin, priceMax })}
          />
          {isOwner && (
            <>
              <Range
                label="Costo (ARS)"
                min={draft.costMin} max={draft.costMax}
                onChange={(costMin, costMax) => patch({ costMin, costMax })}
              />
              <Range
                label="Margen (%)"
                min={draft.marginMin} max={draft.marginMax}
                onChange={(marginMin, marginMax) => patch({ marginMin, marginMax })}
                hint="Solo entran las variantes con costo cargado."
              />
            </>
          )}

          {atributos.includes("foil") && (
            <Tri
              label="Foil"
              value={draft.foil}
              labels={["Solo foil", "Sin foil"]}
              onChange={(foil) => patch({ foil })}
            />
          )}
          <Tri
            label="Estado"
            value={draft.active}
            labels={["Solo activos", "Solo inactivos"]}
            onChange={(active) => patch({ active })}
          />

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button size="sm" onClick={apply}>Aplicar</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Lista multi-selección. Con muchas opciones agrega su propio buscador. */
function FacetList({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [term, setTerm] = useState("");
  if (options.length === 0) return null;

  const searchable = options.length > 8;
  const shown = searchable && term.trim()
    ? options.filter((o) => o.toLowerCase().includes(term.trim().toLowerCase()))
    : options;

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label className="text-xs font-medium">{label}</Label>
        {selected.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="text-xs text-muted-foreground hover:text-foreground">
            Quitar ({selected.length})
          </button>
        )}
      </div>
      {searchable && (
        <Input
          className="h-7 text-xs"
          placeholder={`Buscar ${label.toLowerCase()}…`}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
      )}
      <div className={cn("space-y-1", searchable && "max-h-36 overflow-y-auto pr-1")}>
        {shown.map((option) => (
          <label key={option} className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={selected.includes(option)} onCheckedChange={() => toggle(option)} />
            <span className="truncate" title={option}>{option}</span>
          </label>
        ))}
        {shown.length === 0 && <p className="text-xs text-muted-foreground">Sin resultados.</p>}
      </div>
    </div>
  );
}

function Range({
  label,
  min,
  max,
  onChange,
  hint,
}: {
  label: string;
  min: number | undefined;
  max: number | undefined;
  onChange: (min: number | undefined, max: number | undefined) => void;
  hint?: string;
}) {
  const parse = (v: string) => (v.trim() === "" ? undefined : Number(v));
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          className="h-8" type="number" placeholder="Mín." value={min ?? ""}
          onChange={(e) => onChange(parse(e.target.value), max)}
        />
        <span className="text-muted-foreground">–</span>
        <Input
          className="h-8" type="number" placeholder="Máx." value={max ?? ""}
          onChange={(e) => onChange(min, parse(e.target.value))}
        />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Filtro booleano de tres estados: sin filtro / sí / no. */
function Tri({
  label,
  value,
  labels,
  onChange,
}: {
  label: string;
  value: boolean | undefined;
  labels: [string, string];
  onChange: (next: boolean | undefined) => void;
}) {
  const options: { v: boolean | undefined; label: string }[] = [
    { v: undefined, label: "Todos" },
    { v: true, label: labels[0] },
    { v: false, label: labels[1] },
  ];
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      <div className="inline-flex rounded-lg border border-border p-0.5">
        {options.map((opt) => (
          <button
            key={String(opt.v)}
            type="button"
            onClick={() => onChange(opt.v)}
            className={cn(
              "rounded-md px-2 py-0.5 text-xs transition-colors",
              value === opt.v ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
