"use client";
import { useEffect, useState, useTransition } from "react";
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
  const [success, setSuccess] = useState<{ saleId: number; total: number } | null>(null);

  // debounce 300ms
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
    setSuccess(null);
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

  function updateQuantity(variantId: number, quantity: number) {
    setCart((prev) => prev.map((i) => (i.variantId === variantId ? { ...i, quantity } : i)));
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
        setSuccess({ saleId: res.saleId, total: res.total });
        setCart([]);
      }
    });
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="relative">
        <input
          className="w-full rounded border p-2 text-sm"
          placeholder="Buscar producto o SKU..."
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        {results.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full rounded border bg-white shadow">
            {results.map((r) => (
              <li key={r.variantId}>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                  onClick={() => addToCart(r)}
                >
                  {label(r)} · ${(r.price ?? r.basePrice).toFixed(2)} · stock {r.stock}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded border">
        {cart.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">El carrito está vacío.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500">
                <th className="p-2">Producto</th>
                <th className="p-2">Cant.</th>
                <th className="p-2">Subtotal</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {cart.map((item) => (
                <tr key={item.variantId} className="border-b last:border-0">
                  <td className="p-2">{label(item)}</td>
                  <td className="p-2">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      className="w-16 rounded border p-1"
                      value={item.quantity}
                      onChange={(e) =>
                        updateQuantity(item.variantId, Math.max(1, Math.trunc(Number(e.target.value) || 1)))
                      }
                    />
                  </td>
                  <td className="p-2">${(item.price * item.quantity).toFixed(2)}</td>
                  <td className="p-2">
                    <button
                      type="button"
                      className="text-xs text-red-600 hover:underline"
                      onClick={() => removeItem(item.variantId)}
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="font-semibold">Total: ${total.toFixed(2)}</span>
        <div className="flex gap-2">
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setPaymentMethod(m.value)}
              className={`rounded border px-3 py-1 text-sm ${
                paymentMethod === m.value ? "bg-black text-white" : ""
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && (
        <p className="text-sm font-medium text-green-600">
          Venta #{success.saleId} registrada — ${success.total.toFixed(2)}
        </p>
      )}

      <button
        type="button"
        disabled={pending || cart.length === 0}
        onClick={confirmSale}
        className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {pending ? "Confirmando…" : "Confirmar venta"}
      </button>
    </div>
  );
}
