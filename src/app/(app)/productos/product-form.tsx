"use client";
import { useState, useTransition } from "react";
import { saveProduct, saveVariant, toggleProductActive } from "./actions";
import type { Product } from "@/db/schema";

type Props = { product?: Product };

export function ProductForm({ product }: Props) {
  const isEdit = !!product;
  const [open, setOpen] = useState(false);
  const [addingVariant, setAddingVariant] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(product?.name ?? "");
  const [basePrice, setBasePrice] = useState(product ? String(product.basePrice) : "");
  const [lowStockThreshold, setLowStockThreshold] = useState(product ? String(product.lowStockThreshold) : "3");

  const [vName, setVName] = useState("");
  const [vSku, setVSku] = useState("");
  const [vPrice, setVPrice] = useState("");
  const [vError, setVError] = useState("");

  function submitProduct(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveProduct({
        id: product?.id,
        name,
        basePrice: Number(basePrice),
        lowStockThreshold: Number(lowStockThreshold),
      });
      if ("error" in res && res.error) setError(res.error);
      else {
        setError("");
        setOpen(false);
      }
    });
  }

  function submitVariant(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return;
    startTransition(async () => {
      const res = await saveVariant({
        productId: product.id,
        name: vName,
        sku: vSku || null,
        price: vPrice === "" ? null : Number(vPrice),
      });
      if ("error" in res && res.error) setVError(res.error);
      else {
        setVError("");
        setVName("");
        setVSku("");
        setVPrice("");
        setAddingVariant(false);
      }
    });
  }

  function toggleActive() {
    if (!product) return;
    startTransition(async () => {
      await toggleProductActive(product.id, !product.active);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button className="rounded border px-2 py-1 text-sm" onClick={() => setOpen(true)}>
          {isEdit ? "Editar" : "+ Nuevo producto"}
        </button>
        {isEdit && (
          <>
            <button className="text-sm text-blue-600 hover:underline" onClick={() => setAddingVariant((v) => !v)}>
              + Variante
            </button>
            <button className="text-sm text-gray-600 hover:underline" disabled={pending} onClick={toggleActive}>
              {product.active ? "Desactivar" : "Activar"}
            </button>
          </>
        )}
      </div>

      {open && (
        <div
          className="fixed inset-0 z-10 flex items-center justify-center bg-black/30"
          onClick={() => setOpen(false)}
        >
          <form
            onSubmit={submitProduct}
            onClick={(e) => e.stopPropagation()}
            className="w-80 space-y-3 rounded bg-white p-4 shadow"
          >
            <h3 className="font-semibold">{isEdit ? "Editar producto" : "Nuevo producto"}</h3>
            <input
              className="w-full rounded border p-2 text-sm"
              placeholder="Nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <input
              className="w-full rounded border p-2 text-sm"
              type="number"
              step="0.01"
              min="0"
              placeholder="Precio base"
              value={basePrice}
              onChange={(e) => setBasePrice(e.target.value)}
              required
            />
            <input
              className="w-full rounded border p-2 text-sm"
              type="number"
              min="0"
              placeholder="Umbral stock bajo"
              value={lowStockThreshold}
              onChange={(e) => setLowStockThreshold(e.target.value)}
              required
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="text-sm" onClick={() => setOpen(false)}>Cancelar</button>
              <button type="submit" disabled={pending} className="rounded bg-black px-3 py-1 text-sm text-white">
                Guardar
              </button>
            </div>
          </form>
        </div>
      )}

      {addingVariant && product && (
        <form onSubmit={submitVariant} className="flex flex-wrap items-end gap-2 rounded border p-2">
          <input className="rounded border p-1 text-sm" placeholder="Nombre variante" value={vName} onChange={(e) => setVName(e.target.value)} required />
          <input className="rounded border p-1 text-sm" placeholder="SKU" value={vSku} onChange={(e) => setVSku(e.target.value)} />
          <input className="w-32 rounded border p-1 text-sm" type="number" step="0.01" placeholder="Precio (opcional)" value={vPrice} onChange={(e) => setVPrice(e.target.value)} />
          {vError && <p className="text-xs text-red-600">{vError}</p>}
          <button type="submit" disabled={pending} className="rounded bg-black px-2 py-1 text-sm text-white">Agregar</button>
          <button type="button" className="text-sm" onClick={() => setAddingVariant(false)}>Cancelar</button>
        </form>
      )}
    </div>
  );
}
