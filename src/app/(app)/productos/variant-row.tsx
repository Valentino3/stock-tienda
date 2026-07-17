"use client";
import { useState, useTransition } from "react";
import { saveVariant, restock, adjustStock, toggleVariantActive } from "./actions";
import type { ProductVariant } from "@/db/schema";

type Props = {
  variant: ProductVariant;
  basePrice: number;
  lowStockThreshold: number;
  isOwner: boolean;
};

type Panel = null | "edit" | "restock" | "adjust";

export function VariantRow({ variant, basePrice, lowStockThreshold, isOwner }: Props) {
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(variant.name);
  const [sku, setSku] = useState(variant.sku ?? "");
  const [price, setPrice] = useState(variant.price != null ? String(variant.price) : "");
  const [qty, setQty] = useState("1");
  const [newStock, setNewStock] = useState(String(variant.stock));
  const [reason, setReason] = useState("");

  const effectivePrice = variant.price ?? basePrice;
  const lowStock = variant.stock <= lowStockThreshold;

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
      });
      if ("error" in res && res.error) setError(res.error);
      else closePanel();
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
        {variant.sku && <span className="text-gray-500">SKU: {variant.sku}</span>}
        <span>${effectivePrice.toFixed(2)}</span>
        <span className={lowStock ? "font-semibold text-red-600" : ""}>Stock: {variant.stock}</span>
        {!variant.active && <span className="text-gray-500">Inactivo</span>}
        {isOwner && (
          <div className="ml-auto flex gap-2">
            <button className="text-blue-600 hover:underline" onClick={() => setPanel(panel === "edit" ? null : "edit")}>Editar</button>
            <button className="text-blue-600 hover:underline" onClick={() => setPanel(panel === "restock" ? null : "restock")}>Reponer</button>
            <button className="text-blue-600 hover:underline" onClick={() => setPanel(panel === "adjust" ? null : "adjust")}>Ajustar</button>
            <button className="text-gray-600 hover:underline" disabled={pending} onClick={toggleActive}>
              {variant.active ? "Desactivar" : "Activar"}
            </button>
          </div>
        )}
      </div>

      {panel === "edit" && (
        <form onSubmit={submitEdit} className="mt-2 flex flex-wrap items-end gap-2">
          <input className="rounded border p-1" placeholder="Nombre variante" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="rounded border p-1" placeholder="SKU" value={sku} onChange={(e) => setSku(e.target.value)} />
          <input className="w-32 rounded border p-1" type="number" step="0.01" placeholder="Precio (opcional)" value={price} onChange={(e) => setPrice(e.target.value)} />
          <button type="submit" disabled={pending} className="rounded bg-black px-2 py-1 text-white">Guardar</button>
          <button type="button" onClick={closePanel}>Cancelar</button>
        </form>
      )}

      {panel === "restock" && (
        <form onSubmit={submitRestock} className="mt-2 flex items-end gap-2">
          <input className="w-24 rounded border p-1" type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
          <button type="submit" disabled={pending} className="rounded bg-black px-2 py-1 text-white">Reponer</button>
          <button type="button" onClick={closePanel}>Cancelar</button>
        </form>
      )}

      {panel === "adjust" && (
        <form onSubmit={submitAdjust} className="mt-2 flex flex-wrap items-end gap-2">
          <input className="w-24 rounded border p-1" type="number" min="0" value={newStock} onChange={(e) => setNewStock(e.target.value)} />
          <input className="rounded border p-1" placeholder="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="submit" disabled={pending} className="rounded bg-black px-2 py-1 text-white">Ajustar</button>
          <button type="button" onClick={closePanel}>Cancelar</button>
        </form>
      )}

      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
