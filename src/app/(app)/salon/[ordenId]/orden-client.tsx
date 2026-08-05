"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { money, number } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Order, OrderItem, Sale } from "@/db/schema";
import {
  agregarALaComanda, buscarParaComanda, cambiarCantidadDeItem, cancelarComanda, cobrarComanda,
} from "../actions";

type ClienteOption = { id: number; name: string };
type Resultado = Awaited<ReturnType<typeof buscarParaComanda>>[number];

const METODOS = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "cuenta", label: "Cuenta" },
] as const;

type Metodo = (typeof METODOS)[number]["value"];

export function OrdenClient({
  orden, items, clientes, ventas,
}: {
  orden: Order;
  items: OrderItem[];
  clientes: ClienteOption[];
  ventas: Sale[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [term, setTerm] = useState("");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [metodo, setMetodo] = useState<Metodo>("efectivo");
  const [clientId, setClientId] = useState("");
  const [seleccion, setSeleccion] = useState<number[]>([]);
  const [error, setError] = useState("");

  const cerrada = orden.status === "pagada" || orden.status === "cancelada";
  const impagos = items.filter((i) => i.saleId == null);
  const pagados = items.filter((i) => i.saleId != null);
  const totalImpago = impagos.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
  // Sin selección se cobra todo lo impago; con selección, solo eso.
  const totalACobrar = seleccion.length
    ? impagos.filter((i) => seleccion.includes(i.id)).reduce((a, i) => a + i.quantity * i.unitPrice, 0)
    : totalImpago;

  useEffect(() => {
    const t = setTimeout(() => {
      if (term.trim().length < 2) {
        setResultados([]);
        return;
      }
      buscarParaComanda(term).then(setResultados).catch(() => setResultados([]));
    }, 300);
    return () => clearTimeout(t);
  }, [term]);

  function correr(fn: () => Promise<{ error?: string } | { ok: true }>, alOk?: () => void) {
    setError("");
    startTransition(async () => {
      const res = await fn();
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      alOk?.();
      router.refresh();
    });
  }

  const agregar = (r: Resultado) =>
    correr(() => agregarALaComanda(orden.id, r.variantId, 1), () => {
      setTerm("");
      setResultados([]);
    });

  const cambiar = (itemId: number, cantidad: number) =>
    correr(() => cambiarCantidadDeItem(orden.id, itemId, cantidad));

  function cobrar() {
    if (metodo === "cuenta" && !clientId) {
      setError("Elegí un cliente para la venta a cuenta.");
      return;
    }
    setError("");
    startTransition(async () => {
      const res = await cobrarComanda({
        orderId: orden.id,
        paymentMethod: metodo,
        clientId: metodo === "cuenta" ? Number(clientId) : undefined,
        itemIds: seleccion.length ? seleccion : undefined,
      });
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      if ("ok" in res && res.ok) {
        if (res.avisoDePrecio) {
          // El menú cambió con la mesa abierta. Se cobró el precio del
          // catálogo, pero el papel que vio el cliente decía otra cosa.
          toast.warning(
            `El precio del menú cambió: la cuenta decía ${money(res.avisoDePrecio.totalEnLaCuenta)} y se cobró ${money(res.avisoDePrecio.totalCobrado)}.`,
            { duration: 12_000 },
          );
        }
        toast.success(
          res.parcial
            ? `Cobrado ${money(res.total)}. Quedan ítems sin cobrar.`
            : `Venta #${res.saleId} registrada — ${money(res.total)}`,
        );
        setSeleccion([]);
        if (!res.parcial) router.push("/salon");
        else router.refresh();
      }
    });
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Comanda</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!cerrada && (
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar plato o producto…"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                className="pl-9"
                autoFocus
              />
              {resultados.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
                  {resultados.map((r) => (
                    <li key={r.variantId} className="border-b border-border last:border-0">
                      <button
                        type="button"
                        disabled={pending}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent"
                        onClick={() => agregar(r)}
                      >
                        <span className="min-w-0 truncate">
                          {r.productName}{r.variantName ? ` — ${r.variantName}` : ""}
                        </span>
                        <span className="figure shrink-0 font-medium">
                          {money(r.price ?? r.basePrice)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground">
              La comanda está vacía. Buscá algo arriba para agregarlo.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((i) => {
                const cobrado = i.saleId != null;
                const elegido = seleccion.includes(i.id);
                return (
                  <li key={i.id} className={cn("flex items-center gap-3 py-2.5", cobrado && "opacity-55")}>
                    {!cerrada && !cobrado && (
                      // Elegir ítems es cómo se divide la cuenta: lo tildado se
                      // cobra en esta tanda, el resto queda para la siguiente.
                      <input
                        type="checkbox"
                        checked={elegido}
                        aria-label={`Cobrar ${i.nameSnapshot}`}
                        onChange={(e) =>
                          setSeleccion((prev) =>
                            e.target.checked ? [...prev, i.id] : prev.filter((x) => x !== i.id),
                          )
                        }
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{i.nameSnapshot}</div>
                      <div className="ledger-label text-muted-foreground">
                        {number(i.quantity)} × {money(i.unitPrice)}
                        {cobrado && " · cobrado"}
                        {i.notes && ` · ${i.notes}`}
                      </div>
                    </div>
                    {!cerrada && !cobrado && (
                      <div className="flex items-center gap-1">
                        <Button
                          type="button" variant="outline" size="icon" className="size-7"
                          disabled={pending} aria-label="Restar uno"
                          onClick={() => cambiar(i.id, i.quantity - 1)}
                        >
                          <Minus className="size-3" />
                        </Button>
                        <span className="figure w-6 text-center text-sm">{i.quantity}</span>
                        <Button
                          type="button" variant="outline" size="icon" className="size-7"
                          disabled={pending} aria-label="Sumar uno"
                          onClick={() => cambiar(i.id, i.quantity + 1)}
                        >
                          <Plus className="size-3" />
                        </Button>
                        <Button
                          type="button" variant="ghost" size="icon" className="size-7"
                          disabled={pending} aria-label="Quitar"
                          onClick={() => cambiar(i.id, 0)}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    )}
                    <span className="figure w-20 text-right text-sm font-medium">
                      {money(i.quantity * i.unitPrice)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{cerrada ? "Cerrada" : "Cobrar"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {pagados.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Ya cobrado: {money(pagados.reduce((a, i) => a + i.quantity * i.unitPrice, 0))} en{" "}
              {ventas.length === 1 ? "una venta" : `${ventas.length} ventas`}.
            </p>
          )}

          {!cerrada && (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">
                  {seleccion.length ? `${seleccion.length} ítem(s) elegidos` : "Total de la mesa"}
                </span>
                <span className="figure text-xl font-semibold">{money(totalACobrar)}</span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {METODOS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setMetodo(m.value)}
                    aria-pressed={metodo === m.value}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-sm transition-colors",
                      metodo === m.value
                        ? "border-brand bg-brand text-brand-foreground"
                        : "border-border hover:bg-accent",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {metodo === "cuenta" && (
                <select
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  aria-label="Cliente"
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="">Elegí cliente…</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}

              {error && <div role="alert"><Notice tone="danger">{error}</Notice></div>}

              <Button
                type="button" className="w-full" size="lg"
                disabled={pending || impagos.length === 0}
                onClick={cobrar}
              >
                {pending ? "Cobrando…" : seleccion.length ? "Cobrar lo elegido" : "Cobrar todo"}
              </Button>

              {pagados.length === 0 && (
                <Button
                  type="button" variant="ghost" size="sm" className="w-full"
                  disabled={pending}
                  onClick={() => correr(() => cancelarComanda(orden.id), () => router.push("/salon"))}
                >
                  Cancelar comanda
                </Button>
              )}
            </>
          )}

          {cerrada && (
            <Button type="button" variant="outline" className="w-full" onClick={() => router.push("/salon")}>
              Volver al salón
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
