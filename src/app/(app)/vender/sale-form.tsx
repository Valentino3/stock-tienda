"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Minus, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { SectionLabel } from "@/components/ui/section";
import { cn } from "@/lib/utils";
import { money, number } from "@/lib/format";
import { buscarEnCatalogo, precioDe } from "@/lib/offline/busqueda";
import { descargarSnapshot, encolar, altaClienteOffline, useEstadoOffline } from "@/lib/offline/estado";
import type { VentaEnCola } from "@/lib/offline/db";
import { searchVariants, submitSale, createClientForSale } from "./actions";
import { TicketOffline } from "./ticket-offline";

type SearchResult = Awaited<ReturnType<typeof searchVariants>>[number];
type PaymentMethod = "efectivo" | "transferencia" | "tarjeta" | "cuenta";
/**
 * Un cliente creado sin conexión todavía no tiene id: el servidor lo asigna al
 * sincronizar. Hasta entonces se lo referencia por `uid`, y el `<select>` usa
 * un valor con prefijo para no confundir los dos espacios de identidad.
 */
type ClientOption = { id: number | null; uid?: string; name: string };

const valorCliente = (c: ClientOption) => (c.id != null ? `id:${c.id}` : `uid:${c.uid}`);
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
  stock: number;
  quantity: number;
  discountKind: DiscountKind;
  discountValue: number;
};

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "cuenta", label: "Cuenta" },
];

const CLIENT_SELECT_CLASS =
  "h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Carrito persistido en localStorage por tienda.
 *
 * Un F5, un cuelgue del navegador o un cierre accidental no pueden costar el
 * carrito que el vendedor tiene armado con el cliente esperando enfrente. Se
 * guarda también el `uid`: es la clave de idempotencia de esta venta, y si se
 * regenerara al recargar, un reintento después de un corte de red cobraría dos
 * veces (ver sales.uid en schema.ts).
 */
const CARRITO_VERSION = 1;
const carritoKey = (storeId: number) => `stock-tienda:carrito:${storeId}`;

type CarritoGuardado = {
  v: number;
  uid: string;
  cart: CartItem[];
  paymentMethod: PaymentMethod;
  clientId: string;
  saleDiscountKind: DiscountKind;
  saleDiscountValue: number;
};

/** El tipo de documento se infiere por el largo: un campo, sin selector. */
function docHint(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (d.length === 0) return null;
  if (d.length === 11) return "Se guarda como CUIT.";
  if (d.length >= 7 && d.length <= 8) return "Se guarda como DNI.";
  return "Tiene que ser un DNI (7-8 dígitos) o un CUIT (11).";
}

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

export function SaleForm({
  clients: initialClients, storeId, cashSessionId,
}: { clients: ClientOption[]; storeId: number; cashSessionId: number }) {
  const { conectado, verificado, catalogo, clientesNuevos, meta } = useEstadoOffline();
  // Sin conexión NO se busca contra el servidor, pero tampoco se cae: si hay
  // catálogo guardado se busca ahí. Sin catálogo guardado no hay nada que
  // hacer, y la UI lo dice en vez de devolver cero resultados en silencio.
  const offline = verificado && !conectado;
  const [ticket, setTicket] = useState<VentaEnCola | null>(null);
  const [bajando, setBajando] = useState(false);
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("efectivo");
  const [clients, setClients] = useState<ClientOption[]>(initialClients);
  const [clientId, setClientId] = useState<string>("");
  const [saleDiscountKind, setSaleDiscountKind] = useState<DiscountKind>("amount");
  const [saleDiscountValue, setSaleDiscountValue] = useState(0);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  // Clave de idempotencia de la venta en curso. Se genera al confirmar y se
  // MANTIENE mientras el intento falle: reintentar con el mismo uid es lo que
  // hace que un corte de red no derive en doble cobro. Se limpia al confirmar.
  const [saleUid, setSaleUid] = useState("");
  const [reintentable, setReintentable] = useState(false);
  const hidratado = useRef(false);

  // Rehidratar el carrito guardado. Corre solo en cliente y una vez, para no
  // pisar con el estado vacío del render de servidor.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(carritoKey(storeId));
      const snap = raw ? (JSON.parse(raw) as CarritoGuardado) : null;
      if (snap?.v === CARRITO_VERSION && Array.isArray(snap.cart) && snap.cart.length > 0) {
        setCart(snap.cart);
        setSaleUid(snap.uid ?? "");
        setPaymentMethod(snap.paymentMethod ?? "efectivo");
        setClientId(snap.clientId ?? "");
        setSaleDiscountKind(snap.saleDiscountKind ?? "amount");
        setSaleDiscountValue(snap.saleDiscountValue ?? 0);
      }
    } catch {
      // Storage lleno, deshabilitado o con contenido de otra versión: se sigue
      // con el carrito vacío. Nunca vale romper la pantalla de venta por esto.
    }
    hidratado.current = true;
  }, [storeId]);

  useEffect(() => {
    if (!hidratado.current) return;
    try {
      if (cart.length === 0) {
        localStorage.removeItem(carritoKey(storeId));
        return;
      }
      const snap: CarritoGuardado = {
        v: CARRITO_VERSION, uid: saleUid, cart, paymentMethod, clientId, saleDiscountKind, saleDiscountValue,
      };
      localStorage.setItem(carritoKey(storeId), JSON.stringify(snap));
    } catch {
      // Idem: guardar es best-effort.
    }
  }, [storeId, cart, saleUid, paymentMethod, clientId, saleDiscountKind, saleDiscountValue]);

  // Alta de cliente inline (para venta a cuenta sin salir de la pantalla).
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [newClientDoc, setNewClientDoc] = useState("");
  const [newClientError, setNewClientError] = useState("");
  const [newClientPending, startNewClient] = useTransition();

  function submitNewClient(e: React.FormEvent) {
    e.preventDefault();
    startNewClient(async () => {
      if (offline) {
        if (!newClientName.trim()) {
          setNewClientError("Nombre requerido");
          return;
        }
        // Sin conexión no se puede validar el CUIT contra nada ni pedirle un id
        // al servidor. Se guarda con uid y el replay lo crea al sincronizar
        // (ver replayClientes en src/domain/sales-replay.ts).
        const doc = newClientDoc.replace(/\D/g, "");
        const uid = crypto.randomUUID();
        await altaClienteOffline({
          uid,
          name: newClientName.trim(),
          phone: newClientPhone.trim() || null,
          docNro: doc || null,
          docTipo: doc ? (doc.length === 11 ? 80 : 96) : null,
        });
        setClientId(`uid:${uid}`);
        setNewClientOpen(false);
        setNewClientName("");
        setNewClientPhone("");
        setNewClientDoc("");
        setNewClientError("");
        return;
      }

      const res = await createClientForSale(
        newClientName,
        newClientPhone || undefined,
        newClientDoc || undefined,
      );
      if ("error" in res && res.error) {
        setNewClientError(res.error);
        return;
      }
      if ("ok" in res && res.ok) {
        setClients((prev) => [...prev, { id: res.id, name: res.name }].sort((a, b) => a.name.localeCompare(b.name)));
        setClientId(`id:${res.id}`);
        setNewClientOpen(false);
        setNewClientName("");
        setNewClientPhone("");
        setNewClientError("");
      }
    });
  }

  useEffect(() => {
    const handle = setTimeout(() => {
      if (term.trim().length < 2) {
        setResults([]);
        return;
      }
      if (offline) {
        setResults(catalogo ? buscarEnCatalogo(catalogo, term) : []);
        return;
      }
      // El debounce de 300 ms existe por el viaje al servidor; offline la
      // búsqueda es en memoria y responde igual de rápido igualmente.
      searchVariants(term).then(setResults).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(handle);
  }, [term, offline, catalogo]);

  // Los clientes creados sin conexión se pueden elegir enseguida, antes de
  // existir en el servidor. Se mezclan con los que vinieron del snapshot.
  const clientesDisponibles: ClientOption[] = [
    ...clients,
    ...clientesNuevos.map((c) => ({ id: null, uid: c.uid, name: `${c.name} (sin sincronizar)` })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  async function prepararOffline() {
    setBajando(true);
    const res = await descargarSnapshot();
    setBajando(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Catálogo guardado en este dispositivo: ${number(res.variantes)} producto(s).`);
    if (res.truncado) {
      toast.warning("El catálogo es más grande que el máximo que se puede guardar. Faltan productos.");
    }
  }

  function addToCart(r: SearchResult) {
    if (r.stock <= 0) {
      setError(`Sin stock: ${label(r)}`);
      return;
    }
    setError("");
    setCart((prev) => {
      const existing = prev.find((i) => i.variantId === r.variantId);
      if (existing) {
        // No superar el stock disponible.
        return prev.map((i) =>
          i.variantId === r.variantId ? { ...i, quantity: Math.min(i.stock, i.quantity + 1) } : i
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
          stock: r.stock,
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
        i.variantId === variantId
          ? { ...i, quantity: Math.min(i.stock, Math.max(1, i.quantity + delta)) }
          : i
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
    if (paymentMethod === "cuenta" && !clientId) {
      setError("Elegí un cliente para la venta a cuenta.");
      return;
    }
    // El uid sobrevive a los intentos fallidos: recién se renueva cuando una
    // venta se confirma y el carrito se vacía.
    const uid = saleUid || crypto.randomUUID();
    if (uid !== saleUid) setSaleUid(uid);

    const [tipoCliente, valorId] = clientId.split(":");
    const clienteIdNumerico = tipoCliente === "id" ? Number(valorId) : null;
    const clienteUid = tipoCliente === "uid" ? valorId : null;

    if (offline) {
      void guardarVentaOffline(uid, clienteIdNumerico, clienteUid);
      return;
    }

    // Volvió la conexión pero el cliente elegido todavía es uno creado sin
    // conexión: no existe en el servidor, así que la venta a cuenta no tiene a
    // quién imputarle la deuda. Se sincroniza primero.
    if (paymentMethod === "cuenta" && clienteUid) {
      setError("Ese cliente todavía no se sincronizó. Sincronizá las ventas pendientes y volvé a intentar.");
      return;
    }

    startTransition(async () => {
      const res = await submitSale({
        paymentMethod,
        clientId: paymentMethod === "cuenta" ? clienteIdNumerico ?? undefined : undefined,
        items: cart.map((i) => ({
          variantId: i.variantId,
          quantity: i.quantity,
          discount: i.discountValue > 0 ? { kind: i.discountKind, value: i.discountValue } : undefined,
        })),
        saleDiscount: saleDiscountValue > 0 ? { kind: saleDiscountKind, value: saleDiscountValue } : undefined,
        uid,
      });
      if ("error" in res && res.error) {
        setError(res.error);
        setReintentable("reintentable" in res && res.reintentable === true);
        return;
      }
      if ("ok" in res && res.ok) {
        // `duplicada` = este uid ya tenía venta: el reintento devolvió la
        // original en vez de cobrar de nuevo. Se dice explícitamente, porque
        // el vendedor necesita saber que no duplicó el cobro.
        if (res.duplicada) {
          toast.info(`La venta #${res.saleId} ya estaba registrada — ${money(res.total)}. No se cobró de nuevo.`);
        } else {
          toast.success(`Venta #${res.saleId} registrada — ${money(res.total)}`);
        }
        setCart([]);
        setSaleUid("");
        setReintentable(false);
        setSaleDiscountValue(0);
        setClientId("");
        setPaymentMethod("efectivo");
      }
    });
  }

  /**
   * Venta sin conexión: se guarda en el dispositivo y se sincroniza sola
   * cuando vuelva internet.
   *
   * Se imputa a `cashSessionId`: la caja que estaba abierta cuando se cobró.
   * Si al sincronizar hay otra caja abierta —o ninguna— la venta igual entra
   * en la suya, que es lo que hace que el arqueo del día cierre.
   *
   * El precio unitario viaja capturado: es el que el cliente pagó. El servidor
   * lo respeta y avisa si el catálogo cambió mientras tanto.
   */
  async function guardarVentaOffline(uid: string, clienteId: number | null, clienteUid: string | null) {
    const venta: VentaEnCola = {
      uid,
      capturadoEn: new Date().toISOString(),
      cashSessionId: meta?.cashSessionId ?? cashSessionId,
      paymentMethod,
      items: cart.map((i) => ({
        variantId: i.variantId,
        quantity: i.quantity,
        unitPrice: i.price,
        discount: i.discountValue > 0 ? { kind: i.discountKind, value: i.discountValue } : undefined,
        productName: i.productName,
        variantName: i.variantName,
      })),
      saleDiscount: saleDiscountValue > 0 ? { kind: saleDiscountKind, value: saleDiscountValue } : undefined,
      clientId: paymentMethod === "cuenta" ? clienteId : null,
      clientUid: paymentMethod === "cuenta" ? clienteUid : null,
      total,
      intentos: 0,
    };

    try {
      const nuevo = clienteUid
        ? clientesNuevos.find((c) => c.uid === clienteUid)
        : undefined;
      await encolar(venta, nuevo);
    } catch {
      // No se pudo escribir en el dispositivo: es lo único que puede hacer
      // perder la venta, así que NO se limpia el carrito.
      setError("No se pudo guardar la venta en este dispositivo. Anotala aparte antes de seguir.");
      return;
    }

    toast.success(`Venta guardada sin conexión — ${money(total)}. Se sincroniza al volver internet.`);
    setTicket(venta);
    setCart([]);
    setSaleUid("");
    setReintentable(false);
    setSaleDiscountValue(0);
    setClientId("");
    setPaymentMethod("efectivo");
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <CardTitle className="text-base">Buscar producto</CardTitle>
          <div className="text-right">
            <Button type="button" variant="outline" size="sm" disabled={bajando || offline} onClick={prepararOffline}>
              {bajando ? "Descargando…" : catalogo ? "Actualizar catálogo offline" : "Preparar para vender sin conexión"}
            </Button>
            {meta && (
              <p className="mt-1 text-xs text-muted-foreground">
                Catálogo guardado el {new Date(meta.generadoEn).toLocaleString("es-AR")}
              </p>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {offline && !catalogo && (
            <Notice tone="danger">
              Este dispositivo no tiene el catálogo guardado, así que no se puede buscar
              sin conexión. Cuando vuelva internet, tocá «Preparar para vender sin conexión».
            </Notice>
          )}
          {offline && catalogo && (
            <Notice tone="warn">
              Buscando en el catálogo guardado en este dispositivo. El stock que se muestra
              es del último momento con conexión.
            </Notice>
          )}
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
                        disabled={item.quantity >= item.stock}
                        aria-label="Sumar uno"
                      >
                        <Plus className="size-3" />
                      </Button>
                      {item.quantity >= item.stock && (
                        <span className="ledger-label ml-1 text-muted-foreground">máx {number(item.stock)}</span>
                      )}
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
            <div className="grid grid-cols-2 gap-2">
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
            {paymentMethod === "cuenta" && (
              <div className="flex gap-2">
                <select
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className={CLIENT_SELECT_CLASS}
                  aria-label="Cliente"
                >
                  <option value="">Elegí cliente…</option>
                  {clientesDisponibles.map((c) => (
                    <option key={valorCliente(c)} value={valorCliente(c)}>{c.name}</option>
                  ))}
                </select>
                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setNewClientOpen(true)}>
                  + Nuevo
                </Button>
              </div>
            )}
          </div>

          {error && (
            <div role="alert">
              {/* Un corte de red no es un rechazo: la venta pudo haber entrado.
                  Se muestra en tono de aviso, no de error, y el botón pasa a
                  "Reintentar" porque reintentar es la acción correcta. */}
              <Notice tone={reintentable ? "warn" : "danger"}>{error}</Notice>
            </div>
          )}

          <Button
            type="button"
            className="w-full"
            size="lg"
            disabled={pending || cart.length === 0}
            onClick={confirmSale}
          >
            {pending
              ? "Confirmando…"
              : reintentable
                ? "Reintentar venta"
                : offline
                  ? "Cobrar sin conexión"
                  : "Confirmar venta"}
          </Button>
          {offline && cart.length > 0 && (
            <p className="text-center text-xs text-muted-foreground">
              Se guarda en este dispositivo y se sincroniza al volver internet.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={newClientOpen} onOpenChange={setNewClientOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo cliente</DialogTitle>
            <DialogDescription>Se crea y queda seleccionado para esta venta a cuenta.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitNewClient} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="new-client-name">Nombre</Label>
              <Input id="new-client-name" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} required autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-client-phone">Teléfono (opcional)</Label>
              <Input id="new-client-phone" value={newClientPhone} onChange={(e) => setNewClientPhone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-client-doc">CUIT o DNI (opcional)</Label>
              <Input
                id="new-client-doc" inputMode="numeric" value={newClientDoc}
                onChange={(e) => setNewClientDoc(e.target.value)}
                placeholder="Para poder facturarle después"
              />
              {docHint(newClientDoc) && (
                <p className="text-xs text-muted-foreground">{docHint(newClientDoc)}</p>
              )}
            </div>
            {newClientError && <p className="text-sm text-destructive" role="alert">{newClientError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewClientOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={newClientPending}>{newClientPending ? "Creando…" : "Crear"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <TicketOffline venta={ticket} onClose={() => setTicket(null)} />
    </div>
  );
}
