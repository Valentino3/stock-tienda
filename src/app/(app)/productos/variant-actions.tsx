"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CONDITION_SUGGESTIONS, LANGUAGE_SUGGESTIONS } from "@/lib/card-conditions";
import { saveVariant, restock, adjustStock, toggleVariantActive, notifyLowStock } from "./actions";

/**
 * Acciones sobre una variante: editar, reponer, ajustar stock, activar y avisar
 * stock bajo.
 *
 * Vivía dentro de `variant-row.tsx` junto con la presentación. Al pasar el
 * inventario a una tabla plana se separó, para que la fila solo dibuje celdas y
 * toda la interacción quede en un lugar.
 *
 * Reponer y ajustar usan Popover en vez de un panel inline: en una tabla, una
 * fila extra desplegable obliga a subir el estado a la tabla y a manejar
 * colSpan. El popover queda anclado al botón, conserva el contexto de la fila y
 * mantiene este componente autocontenido.
 */

export type ActionableVariant = {
  id: number;
  productId: number;
  name: string;
  sku: string | null;
  stock: number;
  active: boolean;
  /** El precio propio, null si hereda el del producto. */
  ownPrice: number | null;
  priceCash: number | null;
  priceWholesale: number | null;
  costUsd: number | null;
  costArs: number | null;
  supplier: string | null;
  supplierSku: string | null;
  setName: string | null;
  condition: string | null;
  foil: boolean;
  language: string | null;
};

const str = (n: number | null) => (n != null ? String(n) : "");

export function VariantActions({
  variant,
  lowStock,
  isOwner,
  tracksStock,
}: {
  variant: ActionableVariant;
  lowStock: boolean;
  isOwner: boolean;
  tracksStock: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [notified, setNotified] = useState(false);

  function notify() {
    startTransition(async () => {
      const res = await notifyLowStock(variant.id);
      if ("error" in res && res.error) { toast.error(res.error); return; }
      setNotified(true);
      toast.success("Aviso enviado al dueño");
    });
  }

  function toggleActive() {
    startTransition(async () => {
      await toggleVariantActive(variant.id, !variant.active);
    });
  }

  if (!isOwner) {
    if (!lowStock || !variant.active) return null;
    return (
      <Button variant="outline" size="xs" disabled={pending || notified} onClick={notify}>
        {notified ? "Avisado" : "Avisar al dueño"}
      </Button>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <EditVariantDialog variant={variant} />
      {/* Reponer y ajustar no tienen sentido sin control de stock. El servidor
          igual los rechaza (ver llevaStock en productos/actions.ts): esconder
          el botón es comodidad, no la validación. */}
      {tracksStock && (
        <>
          <RestockPopover variant={variant} />
          <AdjustPopover variant={variant} />
        </>
      )}
      <Button variant="ghost" size="xs" disabled={pending} onClick={toggleActive}>
        {variant.active ? "Desactivar" : "Activar"}
      </Button>
    </div>
  );
}

function EditVariantDialog({ variant }: { variant: ActionableVariant }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(variant.name);
  const [sku, setSku] = useState(variant.sku ?? "");
  const [price, setPrice] = useState(str(variant.ownPrice));
  const [priceCash, setPriceCash] = useState(str(variant.priceCash));
  const [priceWholesale, setPriceWholesale] = useState(str(variant.priceWholesale));
  const [costUsd, setCostUsd] = useState(str(variant.costUsd));
  const [costArs, setCostArs] = useState(str(variant.costArs));
  const [supplier, setSupplier] = useState(variant.supplier ?? "");
  const [supplierSku, setSupplierSku] = useState(variant.supplierSku ?? "");
  const [setNameField, setSetNameField] = useState(variant.setName ?? "");
  const [condition, setCondition] = useState(variant.condition ?? "");
  const [foil, setFoil] = useState(variant.foil);
  const [language, setLanguage] = useState(variant.language ?? "");

  const num = (v: string) => (v === "" ? null : Number(v));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveVariant({
        id: variant.id,
        productId: variant.productId,
        name,
        sku: sku || null,
        price: num(price),
        priceCash: num(priceCash),
        priceWholesale: num(priceWholesale),
        costUsd: num(costUsd),
        costArs: num(costArs),
        supplier: supplier || null,
        supplierSku: supplierSku || null,
        setName: setNameField || null,
        condition: condition || null,
        foil,
        language: language || null,
      });
      if ("error" in res && res.error) setError(res.error);
      else {
        setError("");
        setOpen(false);
      }
    });
  }

  const id = (field: string) => `variant-${field}-${variant.id}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="link" size="xs">Editar</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar variante</DialogTitle>
          <DialogDescription>Editá el nombre, SKU o precio de la variante.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="max-h-[70vh] space-y-3 overflow-y-auto">
          <div className="space-y-2">
            <Label htmlFor={id("name")}>Nombre variante</Label>
            <Input id={id("name")} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={id("sku")}>SKU</Label>
            <Input id={id("sku")} value={sku} onChange={(e) => setSku(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={id("price")}>Precio venta (opcional)</Label>
            <Input id={id("price")} type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Vacío = usa el precio base del producto. Es el precio que cobra la caja.
            </p>
          </div>

          <fieldset className="space-y-3 rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">
              Referencia — no se usan al vender
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor={id("cash")}>Efectivo menor</Label>
                <Input id={id("cash")} type="number" step="0.01" min="0" value={priceCash} onChange={(e) => setPriceCash(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={id("wholesale")}>Precio mayorista</Label>
                <Input id={id("wholesale")} type="number" step="0.01" min="0" value={priceWholesale} onChange={(e) => setPriceWholesale(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={id("cost-usd")}>Costo USD</Label>
                <Input id={id("cost-usd")} type="number" step="0.01" min="0" value={costUsd} onChange={(e) => setCostUsd(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={id("cost-ars")}>Costo ARS</Label>
                <Input id={id("cost-ars")} type="number" step="0.01" min="0" value={costArs} onChange={(e) => setCostArs(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={id("supplier")}>Proveedor</Label>
                <Input id={id("supplier")} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={id("supplier-sku")}>SKU proveedor</Label>
                <Input id={id("supplier-sku")} value={supplierSku} onChange={(e) => setSupplierSku(e.target.value)} />
              </div>
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor={id("set")}>Set</Label>
            <Input id={id("set")} value={setNameField} onChange={(e) => setSetNameField(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={id("condition")}>Condición</Label>
            <Input id={id("condition")} list="condition-suggestions" value={condition} onChange={(e) => setCondition(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={id("language")}>Idioma</Label>
            <Input id={id("language")} list="language-suggestions" value={language} onChange={(e) => setLanguage(e.target.value)} />
          </div>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={foil} onChange={(e) => setFoil(e.target.checked)} />
            Foil
          </label>
          <datalist id="condition-suggestions">
            {CONDITION_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
          </datalist>
          <datalist id="language-suggestions">
            {LANGUAGE_SUGGESTIONS.map((l) => <option key={l} value={l} />)}
          </datalist>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={pending}>Guardar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RestockPopover({ variant }: { variant: ActionableVariant }) {
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState("1");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await restock(variant.id, Number(qty));
      if ("error" in res && res.error) setError(res.error);
      else { setError(""); setQty("1"); setOpen(false); }
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="link" size="xs">Reponer</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56">
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            {/* htmlFor + id: sin eso el Label es texto suelto y el input queda
                sin nombre accesible. El id lleva el de la variante porque hay
                un popover por fila y los ids tienen que ser únicos. */}
            <Label htmlFor={`reponer-${variant.id}`} className="text-xs">Cantidad a reponer</Label>
            <Input id={`reponer-${variant.id}`} className="h-8" type="number" min="1" value={qty} autoFocus onChange={(e) => setQty(e.target.value)} />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" size="sm" disabled={pending}>Reponer</Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function AdjustPopover({ variant }: { variant: ActionableVariant }) {
  const [open, setOpen] = useState(false);
  const [newStock, setNewStock] = useState(String(variant.stock));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  // Este componente se reusa entre re-renders de revalidatePath, así que el
  // useState de montaje puede quedar viejo (por ejemplo tras reponer con el
  // popover de ajuste abierto). Se re-sincroniza `newStock` cuando cambia el
  // stock real, ajustando estado durante el render — la alternativa que
  // recomienda React frente a un efecto para este caso:
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  // Sin esto, el input podría enviar un valor viejo y revertir en silencio una
  // reposición, porque adjustStock calcula un delta contra el stock actual.
  const [prevStock, setPrevStock] = useState(variant.stock);
  if (variant.stock !== prevStock) {
    setPrevStock(variant.stock);
    setNewStock(String(variant.stock));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await adjustStock(variant.id, Number(newStock), reason);
      if ("error" in res && res.error) setError(res.error);
      else { setError(""); setReason(""); setOpen(false); }
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Al abrir se parte siempre del stock real, no de lo que hubiera quedado
        // tipeado en una apertura anterior que se canceló.
        if (next) setNewStock(String(variant.stock));
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="link" size="xs">Ajustar</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor={`ajuste-stock-${variant.id}`} className="text-xs">Nuevo stock</Label>
            <Input id={`ajuste-stock-${variant.id}`} className="h-8" type="number" min="0" value={newStock} autoFocus onChange={(e) => setNewStock(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`ajuste-motivo-${variant.id}`} className="text-xs">Motivo</Label>
            <Input id={`ajuste-motivo-${variant.id}`} className="h-8" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" size="sm" disabled={pending}>Ajustar</Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
