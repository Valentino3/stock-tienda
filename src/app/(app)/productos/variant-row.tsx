"use client";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { saveVariant, restock, adjustStock, toggleVariantActive, notifyLowStock } from "./actions";
import { CONDITION_SUGGESTIONS, LANGUAGE_SUGGESTIONS } from "@/lib/card-conditions";
import { money, number } from "@/lib/format";
import type { ProductVariant } from "@/db/schema";

type Props = {
  variant: ProductVariant;
  basePrice: number;
  lowStockThreshold: number;
  isOwner: boolean;
};

type Panel = null | "restock" | "adjust";

export function VariantRow({ variant, basePrice, lowStockThreshold, isOwner }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(variant.name);
  const [sku, setSku] = useState(variant.sku ?? "");
  const [price, setPrice] = useState(variant.price != null ? String(variant.price) : "");
  const [setNameField, setSetNameField] = useState(variant.setName ?? "");
  const [condition, setCondition] = useState(variant.condition ?? "");
  const [foil, setFoil] = useState(variant.foil);
  const [language, setLanguage] = useState(variant.language ?? "");
  const [qty, setQty] = useState("1");
  const [newStock, setNewStock] = useState(String(variant.stock));
  const [reason, setReason] = useState("");

  // VariantRow is keyed by variant.id and reused across revalidatePath
  // re-renders, so the mount-time useState above can go stale (e.g. after a
  // restock while this row's "Ajustar" panel was left open). Re-sync
  // `newStock` whenever the live stock prop changes by adjusting state
  // during render (the React-recommended alternative to an effect for this:
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes),
  // so the adjust input never submits a stale value that would silently
  // revert stock via adjustStock's delta computation.
  const [prevStock, setPrevStock] = useState(variant.stock);
  if (variant.stock !== prevStock) {
    setPrevStock(variant.stock);
    setNewStock(String(variant.stock));
  }

  const effectivePrice = variant.price ?? basePrice;
  const lowStock = variant.stock <= lowStockThreshold;
  const [notified, setNotified] = useState(false);

  function notify() {
    startTransition(async () => {
      const res = await notifyLowStock(variant.id);
      if ("error" in res && res.error) { toast.error(res.error); return; }
      setNotified(true);
      toast.success("Aviso enviado al dueño");
    });
  }

  function openAdjust() {
    setNewStock(String(variant.stock));
    setPanel((p) => (p === "adjust" ? null : "adjust"));
  }

  function closePanel() {
    setPanel(null);
    setError("");
  }

  function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveVariant({
        id: variant.id,
        productId: variant.productId,
        name,
        sku: sku || null,
        price: price === "" ? null : Number(price),
        setName: setNameField || null,
        condition: condition || null,
        foil,
        language: language || null,
      });
      if ("error" in res && res.error) setError(res.error);
      else {
        setError("");
        setEditOpen(false);
      }
    });
  }

  function submitRestock(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await restock(variant.id, Number(qty));
      if ("error" in res && res.error) setError(res.error);
      else closePanel();
    });
  }

  function submitAdjust(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await adjustStock(variant.id, Number(newStock), reason);
      if ("error" in res && res.error) setError(res.error);
      else closePanel();
    });
  }

  function toggleActive() {
    startTransition(async () => {
      await toggleVariantActive(variant.id, !variant.active);
    });
  }

  return (
    <div className={`py-2 text-sm ${!variant.active ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-3">
        {variant.name && <span className="font-medium">{variant.name}</span>}
        {variant.sku && <span className="figure text-xs text-muted-foreground">SKU {variant.sku}</span>}
        <span className="figure font-medium">{money(effectivePrice)}</span>
        {lowStock ? (
          <Badge variant="destructive" className="font-mono">Stock {number(variant.stock)}</Badge>
        ) : (
          <span className="text-muted-foreground">Stock <span className="figure text-foreground">{number(variant.stock)}</span></span>
        )}
        {variant.setName && <span className="text-muted-foreground">{variant.setName}</span>}
        {variant.condition && <Badge variant="outline">{variant.condition}</Badge>}
        {variant.foil && <Badge variant="secondary">Foil</Badge>}
        {variant.language && <Badge variant="outline">{variant.language}</Badge>}
        {!variant.active && <Badge variant="outline">Inactivo</Badge>}

        {!isOwner && lowStock && variant.active && (
          <Button variant="outline" size="sm" className="ml-auto" disabled={pending || notified} onClick={notify}>
            {notified ? "Avisado" : "Avisar al dueño"}
          </Button>
        )}

        {isOwner && (
          <div className="ml-auto flex gap-1">
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogTrigger asChild>
                <Button variant="link" size="sm">
                  Editar
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Editar variante</DialogTitle>
                  <DialogDescription>Editá el nombre, SKU o precio de la variante.</DialogDescription>
                </DialogHeader>
                <form onSubmit={submitEdit} className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor={`variant-name-${variant.id}`}>Nombre variante</Label>
                    <Input id={`variant-name-${variant.id}`} value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`variant-sku-${variant.id}`}>SKU</Label>
                    <Input id={`variant-sku-${variant.id}`} value={sku} onChange={(e) => setSku(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`variant-price-${variant.id}`}>Precio (opcional)</Label>
                    <Input
                      id={`variant-price-${variant.id}`}
                      type="number"
                      step="0.01"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`variant-set-${variant.id}`}>Set</Label>
                    <Input id={`variant-set-${variant.id}`} value={setNameField} onChange={(e) => setSetNameField(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`variant-condition-${variant.id}`}>Condición</Label>
                    <Input
                      id={`variant-condition-${variant.id}`}
                      list="condition-suggestions"
                      value={condition}
                      onChange={(e) => setCondition(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`variant-language-${variant.id}`}>Idioma</Label>
                    <Input
                      id={`variant-language-${variant.id}`}
                      list="language-suggestions"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                    />
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
                    <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                      Cancelar
                    </Button>
                    <Button type="submit" disabled={pending}>
                      Guardar
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
            <Button variant="link" size="sm" onClick={() => setPanel(panel === "restock" ? null : "restock")}>
              Reponer
            </Button>
            <Button variant="link" size="sm" onClick={openAdjust}>
              Ajustar
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={toggleActive}>
              {variant.active ? "Desactivar" : "Activar"}
            </Button>
          </div>
        )}
      </div>

      {panel === "restock" && (
        <form onSubmit={submitRestock} className="mt-2 mb-1 flex items-end gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <div className="space-y-1">
            <Label className="text-xs">Cantidad a reponer</Label>
            <Input className="h-8 w-24" type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            Reponer
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={closePanel}>
            Cancelar
          </Button>
        </form>
      )}

      {panel === "adjust" && (
        <form onSubmit={submitAdjust} className="mt-2 mb-1 flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <div className="space-y-1">
            <Label className="text-xs">Nuevo stock</Label>
            <Input className="h-8 w-24" type="number" min="0" value={newStock} onChange={(e) => setNewStock(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Motivo</Label>
            <Input className="h-8" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            Ajustar
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={closePanel}>
            Cancelar
          </Button>
        </form>
      )}

      {error && panel === null && !editOpen && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
