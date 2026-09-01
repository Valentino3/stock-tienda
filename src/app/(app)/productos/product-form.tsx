"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
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
import { CONDITION_SUGGESTIONS, LANGUAGE_SUGGESTIONS } from "@/lib/card-conditions";
import type { AtributoCatalogo } from "@/lib/verticals";
import type { Product } from "@/db/schema";

/**
 * Recibe los datos sueltos del rubro y NO el `VerticalConfig` entero.
 *
 * No es preferencia de estilo: ese objeto tiene una función `nav`, y las
 * funciones no cruzan la frontera de Server a Client Component. Pasarlo
 * completo hace que React tire "Functions cannot be passed directly to Client
 * Components" al renderizar — un error que el build NO detecta y que los tests
 * de dominio tampoco ven, porque solo aparece cuando la página se dibuja.
 */
type Props = {
  product?: Product;
  categories?: string[];
  /** Qué columnas TCG muestra este rubro. Ver src/lib/verticals. */
  atributos: readonly AtributoCatalogo[];
  ejemploCategoria: string;
  tracksStockPorDefecto: boolean;
  /** Solo gastronomía rutea a estaciones de cocina. */
  usaEstaciones?: boolean;
};

export function ProductForm({
  product, categories = [], atributos, ejemploCategoria, tracksStockPorDefecto,
  usaEstaciones = false,
}: Props) {
  const isEdit = !!product;
  const [open, setOpen] = useState(false);
  const [addingVariant, setAddingVariant] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(product?.name ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [basePrice, setBasePrice] = useState(product ? String(product.basePrice) : "");
  const [lowStockThreshold, setLowStockThreshold] = useState(product ? String(product.lowStockThreshold) : "3");
  // Al crear, el default sale del rubro: un comercio cuenta unidades, un
  // restaurante no. Al editar, manda lo que ya tenía el producto.
  const [isPromo, setIsPromo] = useState(product ? Boolean(product.isPromo) : false);
  const [tracksStock, setTracksStock] = useState(
    product ? product.tracksStock : tracksStockPorDefecto,
  );

  const [station, setStation] = useState(product?.station ?? "");
  // Solo al crear: van a la variante default. En edición el SKU se toca desde
  // la fila del inventario y el stock por Reponer/Ajustar, que dejan
  // movimiento.
  const [sku, setSku] = useState("");
  const [stockInicial, setStockInicial] = useState("");

  const [vName, setVName] = useState("");
  const [vSku, setVSku] = useState("");
  const [vStock, setVStock] = useState("");
  const [vPrice, setVPrice] = useState("");
  const [vSetName, setVSetName] = useState("");
  const [vCondition, setVCondition] = useState("");
  const [vFoil, setVFoil] = useState(false);
  const [vLanguage, setVLanguage] = useState("");
  const [vError, setVError] = useState("");

  function submitProduct(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveProduct({
        id: product?.id,
        name,
        category,
        basePrice: Number(basePrice),
        lowStockThreshold: Number(lowStockThreshold),
        tracksStock,
        isPromo,
        station: usaEstaciones ? station : undefined,
        sku: isEdit ? undefined : (sku || null),
        stockInicial: isEdit ? undefined : Number(stockInicial || 0),
      });
      if ("error" in res && res.error) setError(res.error);
      else {
        // El aviso de arriba se ve mientras se tipea; este se ve DESPUES, que
        // es cuando el producto ya quedo invendible. El enlace lleva al filtro
        // de inventario que ya existe.
        if (!isEdit && tracksStock && Number(stockInicial || 0) === 0) {
          toast.warning("Cargado sin stock", {
            description: "No se va a poder vender hasta que le cargues stock desde Productos.",
            action: { label: "Ver sin stock", onClick: () => { window.location.href = "/productos?stock=out"; } },
            duration: 8000,
          });
        }
        setError("");
        setSku("");
        setStockInicial("");
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
        stockInicial: Number(vStock || 0),
        price: vPrice === "" ? null : Number(vPrice),
        setName: vSetName || null,
        condition: vCondition || null,
        foil: vFoil,
        language: vLanguage || null,
      });
      if ("error" in res && res.error) setVError(res.error);
      else {
        setVError("");
        setVName("");
        setVSku("");
        setVStock("");
        setVPrice("");
        setVSetName("");
        setVCondition("");
        setVFoil(false);
        setVLanguage("");
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
                <Label htmlFor="product-category">Categoría (opcional)</Label>
                <Input id="product-category" list="product-categories" value={category} onChange={(e) => setCategory(e.target.value)} placeholder={ejemploCategoria} />
                <datalist id="product-categories">
                  {categories.map((c) => <option key={c} value={c} />)}
                </datalist>
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
              <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={tracksStock}
                  onChange={(e) => setTracksStock(e.target.checked)}
                />
                <span>
                  Lleva control de stock
                  <span className="block text-xs text-muted-foreground">
                    Destildalo para algo que no se cuenta por unidades: un plato, un
                    servicio, un recargo. Se puede vender siempre y no aparece en los
                    avisos de stock bajo.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={isPromo}
                  onChange={(e) => setIsPromo(e.target.checked)}
                />
                <span>
                  En promoción
                  <span className="block text-xs text-muted-foreground">
                    No cambia el precio: lo único que hace es que sus ventas
                    comisionen aparte, al porcentaje de promo. Se guarda en cada
                    venta, así que apagarlo después no reescribe las comisiones
                    de un período ya cerrado.
                  </span>
                </span>
              </label>
              {usaEstaciones && (
                <div className="space-y-2">
                  <Label htmlFor="product-station">Estación (opcional)</Label>
                  <Input
                    id="product-station" list="estaciones" value={station}
                    onChange={(e) => setStation(e.target.value)}
                    placeholder="cocina, barra, plancha…"
                  />
                  <datalist id="estaciones">
                    {["cocina", "barra", "plancha", "postres"].map((e) => <option key={e} value={e} />)}
                  </datalist>
                  <p className="text-xs text-muted-foreground">
                    Define a qué pantalla de cocina va la comanda. Vacío = no se manda
                    a preparar.
                  </p>
                </div>
              )}
              {!isEdit && (
                <div className="space-y-2">
                  <Label htmlFor="product-sku">Código / SKU (opcional)</Label>
                  <Input
                    id="product-sku"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    placeholder="El del código de barras, si tiene"
                  />
                  <p className="text-xs text-muted-foreground">
                    Con SKU podés buscarlo escaneando el código en Vender. Sin
                    SKU solo se encuentra por el nombre.
                  </p>
                </div>
              )}
              {tracksStock && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {!isEdit && (
                    <div className="space-y-2">
                      <Label htmlFor="product-stock">Stock inicial</Label>
                      <Input
                        id="product-stock"
                        type="number"
                        min="0"
                        step="1"
                        value={stockInicial}
                        onChange={(e) => setStockInicial(e.target.value)}
                        placeholder="0"
                      />
                      {/* Sin este aviso el producto nace invendible y no hay
                          forma de saberlo hasta que el cliente está en el
                          mostrador. Era la mitad del bug. */}
                      {Number(stockInicial || 0) === 0 && (
                        <p className="text-xs text-warning">
                          Con 0 no vas a poder agregarlo al carrito en Vender
                          hasta que le cargues stock.
                        </p>
                      )}
                    </div>
                  )}
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
                </div>
              )}
              {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
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
        <form onSubmit={submitVariant} className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <div className="space-y-1">
            <Label className="text-xs">Nombre variante</Label>
            <Input className="h-8" value={vName} onChange={(e) => setVName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">SKU</Label>
            <Input className="h-8" value={vSku} onChange={(e) => setVSku(e.target.value)} />
          </div>
          {product.tracksStock && (
            <div className="space-y-1">
              <Label className="text-xs">Stock inicial</Label>
              <Input className="h-8 w-24" type="number" min="0" step="1" placeholder="0"
                value={vStock} onChange={(e) => setVStock(e.target.value)} />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Precio (opcional)</Label>
            <Input className="h-8 w-32" type="number" step="0.01" value={vPrice} onChange={(e) => setVPrice(e.target.value)} />
          </div>
          {atributos.includes("setName") && (
            <div className="space-y-1">
              <Label className="text-xs">Set</Label>
              <Input className="h-8" value={vSetName} onChange={(e) => setVSetName(e.target.value)} />
            </div>
          )}
          {atributos.includes("condition") && (
            <div className="space-y-1">
              <Label className="text-xs">Condición</Label>
              <Input className="h-8" list="condition-suggestions" value={vCondition} onChange={(e) => setVCondition(e.target.value)} />
            </div>
          )}
          {atributos.includes("language") && (
            <div className="space-y-1">
              <Label className="text-xs">Idioma</Label>
              <Input className="h-8" list="language-suggestions" value={vLanguage} onChange={(e) => setVLanguage(e.target.value)} />
            </div>
          )}
          {atributos.includes("foil") && (
            <label className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={vFoil} onChange={(e) => setVFoil(e.target.checked)} />
              Foil
            </label>
          )}
          {vError && <p className="text-sm text-destructive" role="alert">{vError}</p>}
          <Button type="submit" size="sm" disabled={pending}>
            Agregar
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAddingVariant(false)}>
            Cancelar
          </Button>
        </form>
      )}
      <datalist id="condition-suggestions">
        {CONDITION_SUGGESTIONS.map((c) => <option key={c} value={c} />)}
      </datalist>
      <datalist id="language-suggestions">
        {LANGUAGE_SUGGESTIONS.map((l) => <option key={l} value={l} />)}
      </datalist>
    </div>
  );
}
