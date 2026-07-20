"use client";
import { useState, useTransition } from "react";
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
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant={isEdit ? "outline" : "default"} size="sm">
              {isEdit ? "Editar" : "+ Nuevo producto"}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{isEdit ? "Editar producto" : "Nuevo producto"}</DialogTitle>
              <DialogDescription>Completá los datos del producto.</DialogDescription>
            </DialogHeader>
            <form onSubmit={submitProduct} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="product-name">Nombre</Label>
                <Input id="product-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="product-price">Precio base</Label>
                <Input
                  id="product-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={basePrice}
                  onChange={(e) => setBasePrice(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="product-threshold">Umbral stock bajo</Label>
                <Input
                  id="product-threshold"
                  type="number"
                  min="0"
                  value={lowStockThreshold}
                  onChange={(e) => setLowStockThreshold(e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={pending}>
                  Guardar
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {isEdit && (
          <>
            <Button variant="link" size="sm" onClick={() => setAddingVariant((v) => !v)}>
              + Variante
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={toggleActive}>
              {product.active ? "Desactivar" : "Activar"}
            </Button>
          </>
        )}
      </div>

      {addingVariant && product && (
        <form onSubmit={submitVariant} className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <div className="space-y-1">
            <Label className="text-xs">Nombre variante</Label>
            <Input className="h-8" value={vName} onChange={(e) => setVName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">SKU</Label>
            <Input className="h-8" value={vSku} onChange={(e) => setVSku(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Precio (opcional)</Label>
            <Input className="h-8 w-32" type="number" step="0.01" value={vPrice} onChange={(e) => setVPrice(e.target.value)} />
          </div>
          {vError && <p className="text-xs text-destructive">{vError}</p>}
          <Button type="submit" size="sm" disabled={pending}>
            Agregar
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAddingVariant(false)}>
            Cancelar
          </Button>
        </form>
      )}
    </div>
  );
}
