"use client";
import { useEffect, useState, useTransition } from "react";
import { Minus, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { searchVariants, submitSale } from "./actions";

type SearchResult = Awaited<ReturnType<typeof searchVariants>>[number];
type PaymentMethod = "efectivo" | "transferencia" | "tarjeta";
type CartItem = {
  variantId: number;
  productName: string;
  variantName: string;
  price: number;
  quantity: number;
};

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "tarjeta", label: "Tarjeta" },
];

function label(item: { productName: string; variantName: string }) {
  return item.variantName ? `${item.productName} — ${item.variantName}` : item.productName;
}

export function SaleForm() {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("efectivo");
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
          price: r.price ?? r.basePrice,
          quantity: 1,
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

  function removeItem(variantId: number) {
    setCart((prev) => prev.filter((i) => i.variantId !== variantId));
  }

  const total = cart.reduce((acc, i) => acc + i.price * i.quantity, 0);

  function confirmSale() {
    setError("");
    startTransition(async () => {
      const res = await submitSale({
        paymentMethod,
        items: cart.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
      });
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      if ("ok" in res && res.ok) {
        toast.success(`Venta #${res.saleId} registrada — $${res.total.toFixed(2)}`);
        setCart([]);
      }
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Buscar producto</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Input
              placeholder="Buscar producto o SKU..."
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
            {results.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
                {results.map((r) => (
                  <li key={r.variantId}>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => addToCart(r)}
                    >
                      {label(r)} · ${(r.price ?? r.basePrice).toFixed(2)} · stock {r.stock}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {cart.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">El carrito está vacío.</p>
          ) : (
            <Table className="mt-4">
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="w-32 text-center">Cant.</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cart.map((item) => (
                  <TableRow key={item.variantId}>
                    <TableCell>{label(item)}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-7"
                          onClick={() => step(item.variantId, -1)}
                        >
                          <Minus className="size-3" />
                        </Button>
                        <span className="w-8 text-center text-sm">{item.quantity}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-7"
                          onClick={() => step(item.variantId, 1)}
                        >
                          <Plus className="size-3" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">${(item.price * item.quantity).toFixed(2)}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive"
                        onClick={() => removeItem(item.variantId)}
                        aria-label="Quitar"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cobro</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="text-2xl font-semibold">${total.toFixed(2)}</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {PAYMENT_METHODS.map((m) => (
              <Button
                key={m.value}
                type="button"
                variant={paymentMethod === m.value ? "default" : "outline"}
                size="sm"
                onClick={() => setPaymentMethod(m.value)}
              >
                {m.label}
              </Button>
            ))}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

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
