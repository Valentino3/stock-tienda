"use client";
import { useEffect, useState, useTransition } from "react";
import { Minus, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section";
import { cn } from "@/lib/utils";
import { money, number } from "@/lib/format";
import { searchVariants, submitSale } from "./actions";

type SearchResult = Awaited<ReturnType<typeof searchVariants>>[number];
type PaymentMethod = "efectivo" | "transferencia" | "tarjeta";
type DiscountKind = "amount" | "percent";
type CartItem = {
  variantId: number;
  productName: string;
  variantName: string;
  setName: string | null;
  condition: string | null;
  foil: boolean;
  language: string | null;
  price: number;
  quantity: number;
  discountKind: DiscountKind;
  discountValue: number;
};

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "tarjeta", label: "Tarjeta" },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

// Mismo cálculo que el server (domain/sales.ts) para el total mostrado.
function resolveDiscount(kind: DiscountKind, value: number, base: number): number {
  if (!(value > 0)) return 0;
  const raw = kind === "percent" ? (base * value) / 100 : value;
  return round2(Math.min(Math.max(raw, 0), base));
}

function label(item: {
  productName: string;
  variantName: string;
  setName?: string | null;
  condition?: string | null;
  foil?: boolean;
  language?: string | null;
}) {
  const parts = [item.variantName, item.setName, item.condition, item.foil ? "Foil" : null, item.language].filter(Boolean);
  return parts.length ? `${item.productName} — ${parts.join(" ")}` : item.productName;
}

/** Control compacto de descuento: monto/porcentaje + toggle $ / %. */
function DiscountControl({
  kind,
  value,
  onKind,
  onValue,
  labelText = "Desc.",
}: {
  kind: DiscountKind;
  value: number;
  onKind: (k: DiscountKind) => void;
  onValue: (v: number) => void;
  labelText?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="ledger-label">{labelText}</span>
      <Input
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        value={value || ""}
        onChange={(e) => onValue(Math.max(0, Number(e.target.value) || 0))}
        className="h-8 w-16 px-2 text-sm"
        placeholder="0"
      />
      <div className="flex overflow-hidden rounded-md border border-border">
        {(["amount", "percent"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onKind(k)}
            className={cn(
              "figure size-8 text-sm transition-colors",
              kind === k ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-accent"
            )}
            aria-pressed={kind === k}
            aria-label={k === "amount" ? "Descuento en pesos" : "Descuento en porcentaje"}
          >
            {k === "amount" ? "$" : "%"}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SaleForm() {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("efectivo");
  const [saleDiscountKind, setSaleDiscountKind] = useState<DiscountKind>("amount");
  const [saleDiscountValue, setSaleDiscountValue] = useState(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => {
      if (term.trim().length < 2) {
        setResults([]);
      } else {
        searchVariants(term).then(setResults);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [term]);

  function addToCart(r: SearchResult) {
    setCart((prev) => {
      const existing = prev.find((i) => i.variantId === r.variantId);
      if (existing) {
        return prev.map((i) =>
          i.variantId === r.variantId ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [
        ...prev,
        {
          variantId: r.variantId,
          productName: r.productName,
          variantName: r.variantName,
          setName: r.setName,
          condition: r.condition,
          foil: r.foil,
          language: r.language,
          price: r.price ?? r.basePrice,
          quantity: 1,
          discountKind: "amount" as DiscountKind,
          discountValue: 0,
        },
      ];
    });
    setTerm("");
    setResults([]);
  }

  function step(variantId: number, delta: number) {
    setCart((prev) =>
      prev.map((i) =>
        i.variantId === variantId ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i
      )
    );
  }

  function patchItem(variantId: number, patch: Partial<CartItem>) {
    setCart((prev) => prev.map((i) => (i.variantId === variantId ? { ...i, ...patch } : i)));
  }

  function removeItem(variantId: number) {
    setCart((prev) => prev.filter((i) => i.variantId !== variantId));
  }

  const lines = cart.map((i) => {
    const gross = round2(i.price * i.quantity);
    const discount = resolveDiscount(i.discountKind, i.discountValue, gross);
    return { item: i, gross, discount, net: round2(gross - discount) };
  });
  const subtotal = round2(lines.reduce((acc, l) => acc + l.net, 0));
  const saleDiscount = resolveDiscount(saleDiscountKind, saleDiscountValue, subtotal);
  const total = round2(subtotal - saleDiscount);
  const totalDiscount = round2(lines.reduce((acc, l) => acc + l.discount, 0) + saleDiscount);
  const units = cart.reduce((acc, i) => acc + i.quantity, 0);

  function confirmSale() {
    setError("");
    startTransition(async () => {
      const res = await submitSale({
        paymentMethod,
        items: cart.map((i) => ({
          variantId: i.variantId,
          quantity: i.quantity,
          discount: i.discountValue > 0 ? { kind: i.discountKind, value: i.discountValue } : undefined,
        })),
        saleDiscount: saleDiscountValue > 0 ? { kind: saleDiscountKind, value: saleDiscountValue } : undefined,
      });
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      if ("ok" in res && res.ok) {
        toast.success(`Venta #${res.saleId} registrada — ${money(res.total)}`);
        setCart([]);
        setSaleDiscountValue(0);
      }
    });
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Buscar producto</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar producto o SKU…"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              className="pl-9"
              autoFocus
            />
            {results.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
                {results.map((r) => (
                  <li key={r.variantId} className="border-b border-border last:border-0">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent"
                      onClick={() => addToCart(r)}
                    >
                      <span className="min-w-0 truncate">{label(r)}</span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="figure font-medium">{money(r.price ?? r.basePrice)}</span>
                        <span className="ledger-label">stock {number(r.stock)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {cart.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
              <Search className="size-6 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">
                El carrito está vacío. Buscá un producto para empezar.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {lines.map(({ item, gross, discount, net }) => (
                <li key={item.variantId} className="flex flex-col gap-2.5 py-3 first:pt-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm">{label(item)}</p>
                      <p className="figure text-xs text-muted-foreground">{money(item.price)} c/u</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeItem(item.variantId)}
                      aria-label="Quitar"
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-7"
                        onClick={() => step(item.variantId, -1)}
                        aria-label="Restar uno"
                      >
                        <Minus className="size-3" />
                      </Button>
                      <span className="figure w-8 text-center text-sm font-medium">{item.quantity}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-7"
                        onClick={() => step(item.variantId, 1)}
                        aria-label="Sumar uno"
                      >
                        <Plus className="size-3" />
                      </Button>
                    </div>
                    <DiscountControl
                      kind={item.discountKind}
                      value={item.discountValue}
                      onKind={(k) => patchItem(item.variantId, { discountKind: k })}
                      onValue={(v) => patchItem(item.variantId, { discountValue: v })}
                    />
                    <div className="ml-auto text-right">
                      {discount > 0 && (
                        <p className="figure text-xs text-muted-foreground line-through">{money(gross)}</p>
                      )}
                      <p className="figure text-sm font-medium">{money(net)}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="lg:sticky lg:top-8">
        <CardHeader>
          <CardTitle className="text-base">Cobro</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <SectionLabel aside={<span className="text-xs text-muted-foreground">{number(units)} u.</span>}>
              Total
            </SectionLabel>
            <p className="figure mt-1.5 text-4xl font-semibold tracking-tight tabular-nums">
              {money(total)}
            </p>
            {totalDiscount > 0 && (
              <p className="figure mt-1 text-xs text-muted-foreground">
                Subtotal {money(subtotal + saleDiscount)} · descuento −{money(totalDiscount)}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <SectionLabel>Descuento general</SectionLabel>
            <DiscountControl
              kind={saleDiscountKind}
              value={saleDiscountValue}
              onKind={setSaleDiscountKind}
              onValue={setSaleDiscountValue}
              labelText="Sobre total"
            />
          </div>

          <div className="space-y-2">
            <SectionLabel>Medio de pago</SectionLabel>
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <Button
                  key={m.value}
                  type="button"
                  variant={paymentMethod === m.value ? "brand" : "outline"}
                  size="sm"
                  onClick={() => setPaymentMethod(m.value)}
                >
                  {m.label}
                </Button>
              ))}
            </div>
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <Button
            type="button"
            className="w-full"
            size="lg"
            disabled={pending || cart.length === 0}
            onClick={confirmSale}
          >
            {pending ? "Confirmando…" : "Confirmar venta"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
