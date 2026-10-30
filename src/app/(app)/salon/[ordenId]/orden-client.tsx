"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, ChefHat, Minus, Plus, Printer, Scissors, Search, StickyNote, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { money, number } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Order, OrderItem, Sale } from "@/db/schema";
import {
  agregarALaComanda, anularLinea, buscarParaComanda, cambiarCantidadDeItem, cambiarMozo,
  cancelarComanda, cobrarComanda, dividirLinea, mandarComandaACocina, pasarAMesa, ponerComensales,
  ponerNota,
} from "../actions";
import { CuentaImprimible } from "./cuenta-imprimible";
import { MotivoDialog, type ResultadoMotivo } from "./motivo-dialog";

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
  orden, items, clientes, ventas, titulo, mozos, mesasLibres,
}: {
  orden: Order;
  items: OrderItem[];
  clientes: ClienteOption[];
  ventas: Sale[];
  titulo: string;
  mozos: { id: string; name: string }[];
  mesasLibres: { id: number; nombre: string; sector: string }[];
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
  // Pago con varios medios: «20 mil en efectivo y el resto con tarjeta».
  const [dividido, setDividido] = useState(false);
  const [montos, setMontos] = useState<Record<Metodo, string>>(
    { efectivo: "", transferencia: "", tarjeta: "", cuenta: "" },
  );
  const [personas, setPersonas] = useState("");
  // Clave del intento de cobro. Se conserva si la red se corta en el medio, y
  // el reintento devuelve el cobro que ya entró en vez de cobrar otra vez.
  const uidDelCobro = useRef<string | null>(null);
  const [tipoDescuento, setTipoDescuento] = useState<"amount" | "percent">("amount");
  // Qué línea tiene la nota abierta para editar, y su borrador.
  const [notaAbierta, setNotaAbierta] = useState<number | null>(null);
  const [borradorNota, setBorradorNota] = useState("");
  // Línea ya mandada que se está anulando, y si se está cancelando la mesa.
  const [anulando, setAnulando] = useState<OrderItem | null>(null);
  const [cancelando, setCancelando] = useState(false);
  const [errorDialogo, setErrorDialogo] = useState("");

  const cerrada = orden.status === "pagada" || orden.status === "cancelada";
  // Lo anulado se sigue mostrando —tachado, con su motivo— pero no cuenta para
  // nada: ni para cobrar, ni para mandar, ni para la cuenta impresa.
  const vivos = items.filter((i) => i.voidedAt == null);
  const sinMandar = vivos.filter((i) => i.sentAt == null && i.saleId == null).length;
  const impagos = vivos.filter((i) => i.saleId == null);
  const pagados = vivos.filter((i) => i.saleId != null);
  const enCocina = impagos.filter((i) => i.sentAt != null).length;
  const totalImpago = impagos.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
  // Sin selección se cobra todo lo impago; con selección, solo eso.
  const totalACobrar = seleccion.length
    ? impagos.filter((i) => seleccion.includes(i.id)).reduce((a, i) => a + i.quantity * i.unitPrice, 0)
    : totalImpago;

  // Lo que el servidor va a cobrar, con el descuento. Es una estimación: si un
  // precio cambió con la mesa abierta, el servidor rechaza el reparto y dice el
  // total real.
  const valorDescuento = Number(descuento.replace(",", ".")) || 0;
  const montoDescuento = valorDescuento <= 0 ? 0
    : tipoDescuento === "percent" ? totalACobrar * Math.min(valorDescuento, 100) / 100
    : Math.min(valorDescuento, totalACobrar);
  const aCobrar = Math.round((totalACobrar - montoDescuento) * 100) / 100;
  const pagosDivididos = METODOS
    .map((m) => ({ method: m.value, amount: Math.round((Number(montos[m.value].replace(",", ".")) || 0) * 100) / 100 }))
    .filter((p) => p.amount > 0);
  const resta = Math.round((aCobrar - pagosDivididos.reduce((a, p) => a + p.amount, 0)) * 100) / 100;
  const usaCuenta = dividido ? pagosDivididos.some((p) => p.method === "cuenta") : metodo === "cuenta";
  const nPersonas = Math.floor(Number(personas));

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

  function agregar(r: Resultado) {
    setError("");
    startTransition(async () => {
      const res = await agregarALaComanda(orden.id, r.variantId, 1);
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      setTerm("");
      setResultados([]);
      if ("falta" in res && res.falta) {
        // No se bloquea: el stock cargado rara vez es el de la cava a mitad de
        // servicio. Pero el mozo tiene que saberlo antes de servir.
        toast.warning(
          `${r.productName}: hay ${number(res.falta.disponible)} cargadas y la mesa lleva ${number(res.falta.pedido)}. Fijate si quedan antes de servir.`,
          { duration: 10_000 },
        );
      }
      router.refresh();
    });
  }

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

  function cerrarDialogos() {
    setAnulando(null);
    setCancelando(false);
    setErrorDialogo("");
  }

  function confirmarAnulacion(item: OrderItem, r: ResultadoMotivo) {
    setErrorDialogo("");
    startTransition(async () => {
      const res = await anularLinea({
        orderId: orden.id, itemId: item.id, cantidad: r.cantidad, motivo: r.motivo, wasted: r.wasted,
      });
      if ("error" in res && res.error) {
        setErrorDialogo(res.error);
        return;
      }
      toast.success(`Anulado: ${r.cantidad} × ${item.nameSnapshot}. La cocina recibe el aviso.`);
      cerrarDialogos();
      setSeleccion((prev) => prev.filter((x) => x !== item.id));
      router.refresh();
    });
  }

  function confirmarCancelacion(r: ResultadoMotivo) {
    setErrorDialogo("");
    startTransition(async () => {
      const res = await cancelarComanda(orden.id, r.motivo || undefined, r.wasted);
      if ("error" in res && res.error) {
        setErrorDialogo(res.error);
        return;
      }
      cerrarDialogos();
      router.push("/salon");
    });
  }

  function cobrar() {
    if (usaCuenta && !clientId) {
      setError("Elegí un cliente para la parte a cuenta.");
      return;
    }
    if (dividido && resta !== 0) {
      setError(resta > 0 ? `Falta repartir ${money(resta)}.` : `Sobran ${money(-resta)}.`);
      return;
    }
    setError("");
    uidDelCobro.current ??= crypto.randomUUID();
    const uid = uidDelCobro.current;
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof cobrarComanda>>;
      try {
        res = await cobrarComanda({
          orderId: orden.id,
          ...(dividido ? { pagos: pagosDivididos } : { paymentMethod: metodo }),
          clientId: usaCuenta ? Number(clientId) : undefined,
          itemIds: seleccion.length ? seleccion : undefined,
          saleDiscount: valorDescuento > 0 ? { kind: tipoDescuento, value: valorDescuento } : undefined,
          uid,
        });
      } catch {
        // No se sabe si el cobro entró. La clave se conserva: tocar Cobrar de
        // nuevo devuelve el cobro original si ya estaba, y no cobra dos veces.
        setError("Se cortó la conexión. Tocá Cobrar de nuevo: no se cobra dos veces.");
        return;
      }
      // El servidor contestó, entró o no: el próximo intento es otro cobro.
      uidDelCobro.current = null;
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
        setMontos({ efectivo: "", transferencia: "", tarjeta: "", cuenta: "" });
        setDividido(false);
        if (!res.parcial) router.push("/salon");
        else router.refresh();
      }
    });
  }

  function elegirMozo(waiterId: string) {
    if (waiterId === orden.waiterId) return;
    const nombre = mozos.find((m) => m.id === waiterId)?.name ?? "";
    correr(() => cambiarMozo(orden.id, waiterId), () => toast.success(`La mesa pasó a ${nombre}.`));
  }

  function pasar(tableId: number) {
    const destino = mesasLibres.find((m) => m.id === tableId);
    correr(() => pasarAMesa(orden.id, tableId), () =>
      toast.success(`Se pasó a la mesa ${destino?.nombre ?? ""}${destino ? ` (${destino.sector})` : ""}.`));
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
      {!cerrada && (
        // Quién atiende y dónde está sentada. Arriba y no en el panel de cobro:
        // se cambian en medio del servicio, no al cobrar.
        <div className="flex flex-wrap items-center gap-3 lg:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Mozo</span>
            <select
              value={orden.waiterId}
              disabled={pending}
              onChange={(e) => elegirMozo(e.target.value)}
              aria-label="Mozo de la mesa"
              className="h-11 rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {/* El actual aunque esté dado de baja: si no, el select mostraría a otro. */}
              {!mozos.some((m) => m.id === orden.waiterId) && <option value={orden.waiterId}>—</option>}
              {mozos.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </label>
          {mesasLibres.length > 0 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Pasar a</span>
              <select
                value=""
                disabled={pending}
                onChange={(e) => e.target.value && pasar(Number(e.target.value))}
                aria-label="Pasar a otra mesa"
                className="h-11 rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="">otra mesa…</option>
                {mesasLibres.map((m) => (
                  <option key={m.id} value={m.id}>{m.nombre} · {m.sector}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {/* overflow-visible por el mismo motivo que en vender/sale-form.tsx: el
          dropdown del buscador es `absolute` y el overflow-hidden de Card lo
          recortaba en el borde. */}
      <Card className="overflow-visible">
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
                <ul className="absolute z-20 mt-1 max-h-[40dvh] w-full overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover shadow-lg">
                  {resultados.map((r) => (
                    <li key={r.variantId} className="border-b border-border last:border-0">
                      <button
                        type="button"
                        disabled={pending || r.agotado}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent",
                          r.agotado && "cursor-not-allowed opacity-60 hover:bg-transparent",
                        )}
                        onClick={() => agregar(r)}
                      >
                        <span className={cn("min-w-0 truncate", r.agotado && "line-through")}>
                          {r.productName}{r.variantName ? ` — ${r.variantName}` : ""}
                        </span>
                        {r.agotado ? (
                          <span className="shrink-0 text-xs font-semibold text-destructive">Agotado</span>
                        ) : (
                          <span className="figure shrink-0 font-medium">
                            {money(r.price ?? r.basePrice)}
                          </span>
                        )}
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
                const enviado = i.sentAt != null;
                const elegido = seleccion.includes(i.id);
                if (i.voidedAt != null) {
                  return (
                    <li key={i.id} className="flex items-center gap-3 py-2.5 opacity-55">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm line-through">{i.nameSnapshot}</div>
                        <div className="ledger-label text-destructive">
                          {number(i.quantity)} anulado · {i.voidReason}
                          {i.wasted && " · se tiró"}
                        </div>
                      </div>
                      <span className="figure w-20 text-right text-sm line-through">
                        {money(i.quantity * i.unitPrice)}
                      </span>
                    </li>
                  );
                }
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
                        {enviado && !cobrado && i.readyAt == null && " · en cocina"}
                        {enviado && !cobrado && i.readyAt != null && (
                          <span className="font-semibold text-success"> · listo</span>
                        )}
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
                        {!enviado && (
                          // Lo que todavía no salió se toca libremente. Lo que ya
                          // está en la cocina solo se anula, con motivo: para
                          // pedir otro igual, se agrega desde el buscador.
                          <>
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
                          </>
                        )}
                        {enviado && <span className="figure w-6 text-center text-sm">{i.quantity}</span>}
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
                        {enviado ? (
                          <Button
                            type="button" variant="ghost" size="icon" className="size-7 text-destructive"
                            disabled={pending} aria-label={`Anular ${i.nameSnapshot}`}
                            title="Anular (ya está en la cocina)"
                            onClick={() => { setErrorDialogo(""); setAnulando(i); }}
                          >
                            <Ban className="size-3" />
                          </Button>
                        ) : (
                          <Button
                            type="button" variant="ghost" size="icon" className="size-7"
                            disabled={pending} aria-label="Quitar"
                            onClick={() => cambiar(i.id, 0)}
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        )}
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
                <span className="figure text-xl font-semibold">{money(aCobrar)}</span>
              </div>
              {montoDescuento > 0 && (
                <p className="-mt-3 text-right text-xs text-muted-foreground">
                  {money(totalACobrar)} − {money(montoDescuento)} de descuento
                </p>
              )}

              {/* Cuánto le toca a cada uno. Solo informa: cada persona paga su
                  parte con el medio que quiera, y eso se carga en «Dividir el
                  pago». */}
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Entre</span>
                <Input
                  className="h-8 w-14 text-center"
                  inputMode="numeric"
                  value={personas}
                  placeholder="—"
                  aria-label="Dividir entre cuántas personas"
                  onChange={(e) => setPersonas(e.target.value.replace(/\D/g, ""))}
                />
                <span className="text-muted-foreground">personas</span>
                {nPersonas >= 2 && (
                  <span className="figure ml-auto font-medium">
                    {money(Math.ceil((aCobrar / nPersonas) * 100) / 100)} c/u
                  </span>
                )}
              </div>

              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={dividido}
                  onChange={(e) => setDividido(e.target.checked)}
                />
                Dividir el pago entre varios medios
              </label>

              {!dividido ? (
                <div className="grid grid-cols-2 gap-2">
                  {METODOS.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setMetodo(m.value)}
                      aria-pressed={metodo === m.value}
                      className={cn(
                        "min-h-11 rounded-lg border px-3 py-2 text-sm transition-colors",
                        metodo === m.value
                          ? "border-brand bg-brand text-brand-foreground"
                          : "border-border hover:bg-accent",
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {METODOS.map((m) => (
                    <div key={m.value} className="flex items-center gap-2">
                      <span className="w-28 text-sm">{m.label}</span>
                      <Input
                        className="h-11 flex-1"
                        inputMode="decimal"
                        value={montos[m.value]}
                        placeholder="0"
                        aria-label={`Monto en ${m.label.toLowerCase()}`}
                        onChange={(e) => setMontos((prev) => ({ ...prev, [m.value]: e.target.value }))}
                      />
                      <Button
                        type="button" variant="outline" size="sm" className="h-11"
                        disabled={resta <= 0}
                        aria-label={`Poner lo que falta en ${m.label.toLowerCase()}`}
                        onClick={() => setMontos((prev) => {
                          const actual = Number(prev[m.value].replace(",", ".")) || 0;
                          return { ...prev, [m.value]: String(Math.round((actual + resta) * 100) / 100) };
                        })}
                      >
                        Resto
                      </Button>
                    </div>
                  ))}
                  <p
                    className={cn(
                      "text-right text-sm font-medium",
                      resta === 0 ? "text-success" : "text-destructive",
                    )}
                    aria-live="polite"
                  >
                    {resta === 0 ? "Repartido completo" : resta > 0 ? `Falta ${money(resta)}` : `Sobran ${money(-resta)}`}
                  </p>
                </div>
              )}

              {usaCuenta && (
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
                disabled={pending || impagos.length === 0 || (dividido && resta !== 0)}
                onClick={cobrar}
              >
                {pending ? "Cobrando…" : seleccion.length ? "Cobrar lo elegido" : "Cobrar todo"}
              </Button>

              {pagados.length === 0 && (
                <Button
                  type="button" variant="ghost" size="sm" className="w-full"
                  disabled={pending}
                  onClick={() => { setErrorDialogo(""); setCancelando(true); }}
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

      {anulando && (
        <MotivoDialog
          titulo={`Anular ${anulando.nameSnapshot}`}
          descripcion="Ya está en la cocina. Queda registrado quién lo anuló y por qué, y la cocina recibe el aviso."
          maxCantidad={anulando.quantity}
          textoConfirmar="Anular"
          pending={pending}
          error={errorDialogo}
          onConfirmar={(r) => confirmarAnulacion(anulando, r)}
          onCerrar={cerrarDialogos}
        />
      )}

      {cancelando && (
        <MotivoDialog
          titulo={`Cancelar ${titulo}`}
          descripcion={
            enCocina > 0
              ? `Hay ${money(totalImpago)} sin cobrar y ${number(enCocina)} ítem(s) en la cocina. Se anulan y la cocina recibe el aviso.`
              : `La mesa se libera sin cobrar ${money(totalImpago)}.`
          }
          requiereMotivo={enCocina > 0}
          textoConfirmar="Cancelar la mesa"
          pending={pending}
          error={errorDialogo}
          onConfirmar={confirmarCancelacion}
          onCerrar={cerrarDialogos}
        />
      )}

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
