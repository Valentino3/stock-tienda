"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChefHat, Minus, Plus, Printer, Scissors, Search, StickyNote, Trash2 } from "lucide-react";
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
  dividirLinea, mandarComandaACocina, ponerComensales, ponerNota,
} from "../actions";
import { CuentaImprimible } from "./cuenta-imprimible";

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
  orden, items, clientes, ventas, titulo,
}: {
  orden: Order;
  items: OrderItem[];
  clientes: ClienteOption[];
  ventas: Sale[];
  titulo: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [term, setTerm] = useState("");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [metodo, setMetodo] = useState<Metodo>("efectivo");
  const [clientId, setClientId] = useState("");
  const [seleccion, setSeleccion] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [mostrarCuenta, setMostrarCuenta] = useState(false);
  const [descuento, setDescuento] = useState("");
  const [tipoDescuento, setTipoDescuento] = useState<"amount" | "percent">("amount");
  // Qué línea tiene la nota abierta para editar, y su borrador.
  const [notaAbierta, setNotaAbierta] = useState<number | null>(null);
  const [borradorNota, setBorradorNota] = useState("");

  const cerrada = orden.status === "pagada" || orden.status === "cancelada";
  const sinMandar = items.filter((i) => i.sentAt == null && i.saleId == null).length;
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

  function mandarACocina() {
    setError("");
    startTransition(async () => {
      const res = await mandarComandaACocina(orden.id);
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      if ("ok" in res) {
        toast.success(
          res.mandados === 1 ? "1 ítem a cocina." : `${res.mandados} ítems a cocina.`,
        );
        router.refresh();
      }
    });
  }

  const dividir = (itemId: number) =>
    correr(() => dividirLinea(orden.id, itemId, 1), () => setSeleccion([]));

  const guardarNota = (itemId: number) =>
    correr(() => ponerNota(orden.id, itemId, borradorNota), () => {
      setNotaAbierta(null);
      setBorradorNota("");
    });

  function cobrar() {
    if (metodo === "cuenta" && !clientId) {
      setError("Elegí un cliente para la venta a cuenta.");
      return;
    }
    setError("");
    startTransition(async () => {
      const valorDescuento = Number(descuento.replace(",", "."));
      const res = await cobrarComanda({
        orderId: orden.id,
        paymentMethod: metodo,
        clientId: metodo === "cuenta" ? Number(clientId) : undefined,
        itemIds: seleccion.length ? seleccion : undefined,
        saleDiscount: valorDescuento > 0 ? { kind: tipoDescuento, value: valorDescuento } : undefined,
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
        setDescuento("");
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

          {!cerrada && sinMandar > 0 && (
            <Button type="button" variant="outline" className="w-full" disabled={pending} onClick={mandarACocina}>
              <ChefHat className="mr-1 size-4" />
              Mandar a cocina ({number(sinMandar)})
            </Button>
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
                        {i.sentAt != null && !cobrado && " · en cocina"}
                        {cobrado && " · cobrado"}
                        {i.notes && ` · ${i.notes}`}
                      </div>
                    </div>
                    {!cerrada && !cobrado && (
                      <div className="flex items-center gap-1">
                        <Button
                          type="button" variant="ghost" size="icon" className="size-7"
                          disabled={pending} aria-label="Nota para cocina"
                          onClick={() => {
                            setNotaAbierta(notaAbierta === i.id ? null : i.id);
                            setBorradorNota(i.notes ?? "");
                          }}
                        >
                          <StickyNote className={cn("size-3", i.notes && "text-brand")} />
                        </Button>
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
                        {i.quantity > 1 && (
                          // Partir una unidad en su propia línea: es lo que
                          // permite que cada comensal pague la suya cuando se
                          // pidieron dos iguales.
                          <Button
                            type="button" variant="ghost" size="icon" className="size-7"
                            disabled={pending} aria-label={`Separar una unidad de ${i.nameSnapshot}`}
                            title="Separar una unidad para cobrarla aparte"
                            onClick={() => dividir(i.id)}
                          >
                            <Scissors className="size-3" />
                          </Button>
                        )}
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

          {notaAbierta != null && (
            <div className="flex items-end gap-2 rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex-1 space-y-1">
                <span className="ledger-label">Nota para cocina</span>
                <Input
                  className="h-8"
                  value={borradorNota}
                  autoFocus
                  placeholder="Sin sal, a punto, sin cebolla…"
                  onChange={(e) => setBorradorNota(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); guardarNota(notaAbierta); }
                    if (e.key === "Escape") setNotaAbierta(null);
                  }}
                />
              </div>
              <Button type="button" size="sm" disabled={pending} onClick={() => guardarNota(notaAbierta)}>
                Guardar
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{cerrada ? "Cerrada" : "Cobrar"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {ventas.length > 0 && (
            // Con la cuenta dividida, el cajero necesita ver las tandas ya
            // cobradas: sumarlas de memoria es cómo se cobra dos veces o se
            // deja ir una mesa a medio pagar.
            <div className="space-y-1 rounded-lg border border-border bg-muted/30 p-3">
              <span className="ledger-label">Ya cobrado</span>
              <ul className="space-y-0.5 text-sm">
                {ventas.map((v) => (
                  <li key={v.id} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">
                      Venta #{v.id} · {METODOS.find((m) => m.value === v.paymentMethod)?.label ?? v.paymentMethod}
                    </span>
                    <span className="figure">{money(v.total)}</span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between border-t border-border pt-1 text-sm font-medium">
                <span>Total cobrado</span>
                <span className="figure">{money(ventas.reduce((a, v) => a + v.total, 0))}</span>
              </div>
            </div>
          )}

          {!cerrada && (
            <>
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <span className="ledger-label">Comensales</span>
                  <Input
                    className="h-8"
                    inputMode="numeric"
                    defaultValue={orden.guests ?? ""}
                    placeholder="—"
                    aria-label="Cantidad de comensales"
                    // onBlur y no onChange: guardar en cada tecla dispararía
                    // una acción de servidor por dígito.
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      const n = v === "" ? null : Number(v);
                      if (n === (orden.guests ?? null)) return;
                      correr(() => ponerComensales(orden.id, n));
                    }}
                  />
                </div>
                <Button
                  type="button" variant="outline" size="sm"
                  disabled={impagos.length === 0}
                  onClick={() => setMostrarCuenta(true)}
                >
                  {/* "Imprimir cuenta" y no "Cuenta" a secas: en esta misma
                      pantalla hay un método de pago que se llama "Cuenta"
                      (corriente). Dos botones con la misma palabra al lado uno
                      del otro es una confusión servida. */}
                  <Printer className="mr-1 size-3" /> Imprimir cuenta
                </Button>
              </div>

              <div className="space-y-1">
                <span className="ledger-label">Descuento (opcional)</span>
                <div className="flex gap-2">
                  <Input
                    className="h-8"
                    inputMode="decimal"
                    value={descuento}
                    placeholder="0"
                    aria-label="Descuento"
                    onChange={(e) => setDescuento(e.target.value)}
                  />
                  <div className="flex overflow-hidden rounded-lg border border-border">
                    {(["amount", "percent"] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setTipoDescuento(k)}
                        aria-pressed={tipoDescuento === k}
                        aria-label={k === "amount" ? "Descuento en pesos" : "Descuento en porcentaje"}
                        className={cn(
                          "size-8 text-sm transition-colors",
                          tipoDescuento === k
                            ? "bg-brand text-brand-foreground"
                            : "text-muted-foreground hover:bg-accent",
                        )}
                      >
                        {k === "amount" ? "$" : "%"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

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

      {mostrarCuenta && (
        <CuentaImprimible
          titulo={titulo}
          items={impagos}
          comensales={orden.guests}
          onClose={() => setMostrarCuenta(false)}
        />
      )}
    </div>
  );
}
