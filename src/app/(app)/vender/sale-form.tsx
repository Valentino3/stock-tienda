"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Minus, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
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
import type { PriceList } from "@/domain/sales";
import { buscarEnCatalogo, MIN_CARACTERES } from "@/lib/offline/busqueda";
import { esErrorDeRed } from "@/lib/errores-red";
import {
  descargarSnapshot, encolar, altaClienteOffline, altaProductoOffline, restaurarRespaldo,
  refrescarConexion, useEstadoOffline,
} from "@/lib/offline/estado";
import type { VentaEnCola } from "@/lib/offline/db";
import { searchVariants, submitSale, createClientForSale } from "./actions";
import { TicketOffline } from "./ticket-offline";

type SearchResult = Awaited<ReturnType<typeof searchVariants>>[number];
type PaymentMethod = "efectivo" | "transferencia" | "tarjeta" | "cuenta";
/**
 * Un cliente creado sin conexión todavía no tiene id: el servidor lo asigna al
 * sincronizar. Hasta entonces se lo referencia por `uid`, y el `<Select>` usa
 * un valor con prefijo para no confundir los dos espacios de identidad.
 */
type ClientOption = {
  id: number | null;
  uid?: string;
  name: string;
  /**
   * Positivo = debe; negativo = tiene a favor. `undefined` para los clientes
   * que vinieron del snapshot offline: ahi el saldo NO viaja a proposito. Una
   * foto vieja de plata invita a entregar mercaderia dos veces, y eso es peor
   * que no mostrar el dato.
   */
  balance?: number;
};

const valorCliente = (c: ClientOption) => (c.id != null ? `id:${c.id}` : `uid:${c.uid}`);
type DiscountKind = "amount" | "percent";
type CartItem = {
  variantId: number;
  productName: string;
  /**
   * Nullable como en `VarianteCatalogo`. La columna es NOT NULL con default
   * `''` (la variante default de un producto sin variantes reales), pero el
   * tipo del catálogo lo declara opcional y `label` ya filtra los vacíos.
   */
  variantName: string | null;
  setName: string | null;
  condition: string | null;
  foil: boolean;
  language: string | null;
  /** Precio de la lista "venta". Se guardan las tres y el precio mostrado se deriva. */
  price: number;
  priceCash: number | null;
  priceWholesale: number | null;
  priceList: PriceList;
  stock: number;
  /** false = no se cuenta por unidades (un plato, un servicio): no tiene tope. */
  llevaStock: boolean;
  quantity: number;
  discountKind: DiscountKind;
  discountValue: number;
};

const LISTAS: { value: PriceList; label: string; corto: string }[] = [
  { value: "venta", label: "Precio de venta", corto: "Venta" },
  { value: "efectivo", label: "Efectivo menor", corto: "Efvo." },
  { value: "mayorista", label: "Mayorista", corto: "Mayor" },
];

/**
 * Precio de la línea según la lista elegida.
 *
 * `!= null` y nunca `||`: un artículo en promo a $0 es un precio válido, y con
 * `||` se cobraría al precio de lista. Espeja `resolverPrecio` del dominio,
 * que es quien manda — acá solo se muestra.
 */
function precioDe(i: CartItem): number {
  if (i.priceList === "efectivo" && i.priceCash != null) return i.priceCash;
  if (i.priceList === "mayorista" && i.priceWholesale != null) return i.priceWholesale;
  return i.price;
}

/** Solo se ofrecen las listas que la variante tiene cargadas. */
const listaDisponible = (i: CartItem, l: PriceList) =>
  l === "venta" || (l === "efectivo" ? i.priceCash != null : i.priceWholesale != null);

/** Tope de cantidad de una línea. Sin stock trackeado no hay techo. */
const topeDe = (i: CartItem) => (i.llevaStock ? i.stock : Number.POSITIVE_INFINITY);

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "cuenta", label: "Cuenta" },
];


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
// v2: las líneas guardan las tres listas de precio y cuál se eligió. El guard
// `snap?.v === CARRITO_VERSION` descarta solo el carrito viejo; sin el bump, un
// cajero con el carrito armado en el momento del deploy rehidrataría líneas sin
// esos campos y `precioDe` devolvería undefined.
const CARRITO_VERSION = 2;
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
  variantName: string | null;
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
  clients: initialClients, storeId, cashSessionId, esDueno, preciosActualizadosEn = null,
}: {
  clients: ClientOption[]; storeId: number; cashSessionId: number; esDueno: boolean;
  /** Ultimo recalculo de precios de la tienda, en ISO. null = nunca hubo. */
  preciosActualizadosEn?: string | null;
}) {
  const { conectado, verificado, catalogo, clientesNuevos, meta } = useEstadoOffline();
  // Sin conexión NO se busca contra el servidor, pero tampoco se cae: si hay
  // catálogo guardado se busca ahí. Sin catálogo guardado no hay nada que
  // hacer, y la UI lo dice en vez de devolver cero resultados en silencio.
  const offline = verificado && !conectado;
  /**
   * 12 h: un snapshot de esta manana sigue siendo utilizable en una feria,
   * uno de anteayer casi seguro tiene precios y stock que ya no existen.
   */
  /**
   * El catalogo guardado quedo antes del ultimo recalculo de precios: este
   * dispositivo, si sale a vender sin conexion, cobra los precios viejos.
   */
  const preciosDesactualizados =
    !!meta && !!preciosActualizadosEn &&
    new Date(meta.generadoEn).getTime() < new Date(preciosActualizadosEn).getTime();
  const catalogoVencido =
    !!meta && Date.now() - new Date(meta.generadoEn).getTime() > 12 * 60 * 60 * 1000;
  const [ticket, setTicket] = useState<VentaEnCola | null>(null);
  const [bajando, setBajando] = useState(false);
  const archivoRef = useRef<HTMLInputElement>(null);

  // Alta de producto sin conexión (mercadería nueva en una feria).
  const [nuevoProdOpen, setNuevoProdOpen] = useState(false);
  const [nuevoProdNombre, setNuevoProdNombre] = useState("");
  const [nuevoProdPrecio, setNuevoProdPrecio] = useState("");
  const [nuevoProdStock, setNuevoProdStock] = useState("");
  const [nuevoProdSku, setNuevoProdSku] = useState("");
  const [nuevoProdError, setNuevoProdError] = useState("");
  const [nuevoProdPending, startNuevoProd] = useTransition();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  /**
   * Avisos del buscador y del carrito: "Sin stock", fallo de la busqueda.
   * Separado de `error`, que es el del cobro y se dibuja en la otra columna
   * — un cartel a dos columnas de distancia del clic que lo produjo se lee
   * como "no pasó nada".
   */
  const [avisoBusqueda, setAvisoBusqueda] = useState("");
  const [buscando, setBuscando] = useState(false);
  /**
   * El termino cuya busqueda YA volvio. Se usa para el vacio en vez de `term`:
   * mientras corre el debounce, `term` ya cambio pero todavia no se busco, y
   * decir "Sin resultados" ahí sería mentir por 300 ms en cada tecla.
   */
  const [terminoBuscado, setTerminoBuscado] = useState("");
  const [reintentandoConexion, setReintentandoConexion] = useState(false);
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
  //
  // El setState sincrónico acá es intencional y no se puede evitar con un
  // inicializador perezoso de useState: el servidor no ve localStorage, así
  // que inicializar desde ahí daría un desajuste de hidratación. El costo es
  // un render extra, una sola vez al montar.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(carritoKey(storeId));
      const snap = raw ? (JSON.parse(raw) as CarritoGuardado) : null;
      if (snap?.v === CARRITO_VERSION && Array.isArray(snap.cart) && snap.cart.length > 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
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
    // Guarda de carrera: sin esto la respuesta de "sob" puede llegar después
    // de la de "sobre" y pisar sus resultados. El cleanup solo cancelaba el
    // timeout, no la petición ya en vuelo.
    let vigente = true;
    const handle = setTimeout(() => {
      const t = term.trim();
      // Los dos caminos que no viajan al servidor apagan `buscando` a mano: si
      // una peticion quedo en vuelo y el dispositivo paso a offline, su
      // `.finally` ya no corre (quedo no vigente) y el cartel "Buscando..."
      // se quedaria prendido para siempre.
      if (t.length < MIN_CARACTERES) {
        setResults([]);
        setTerminoBuscado("");
        setAvisoBusqueda("");
        setBuscando(false);
        return;
      }
      if (offline) {
        setResults(catalogo ? buscarEnCatalogo(catalogo, term) : []);
        setTerminoBuscado(t);
        setAvisoBusqueda("");
        setBuscando(false);
        return;
      }
      setBuscando(true);
      // El debounce de 300 ms existe por el viaje al servidor; offline la
      // búsqueda es en memoria y responde igual de rápido igualmente.
      searchVariants(term)
        .then((r) => {
          if (!vigente) return;
          setResults(r);
          setTerminoBuscado(t);
          setAvisoBusqueda("");
        })
        .catch((err) => {
          // Antes esto era `.catch(() => setResults([]))`: un fallo del
          // servidor se veía exactamente igual que "no hay coincidencias", o
          // sea un espacio en blanco. Es lo que hacía que un problema real
          // pareciera un producto que no existe.
          if (!vigente) return;
          setResults([]);
          setAvisoBusqueda(
            esErrorDeRed(err)
              ? "Sin conexión con el servidor. Reintentá, o prepará el catálogo para vender sin conexión."
              : "No se pudo buscar. Reintentá en unos segundos."
          );
        })
        .finally(() => {
          if (vigente) setBuscando(false);
        });
    }, 300);
    return () => {
      vigente = false;
      clearTimeout(handle);
    };
  }, [term, offline, catalogo]);

  // Los clientes creados sin conexión se pueden elegir enseguida, antes de
  // existir en el servidor. Se mezclan con los que vinieron del snapshot.
  const clienteElegido = clients.find((c) => valorCliente(c) === clientId);
  const clientesDisponibles: ClientOption[] = [
    ...clients,
    ...clientesNuevos.map((c) => ({ id: null, uid: c.uid, name: `${c.name} (sin sincronizar)` })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  /**
   * Alta de producto sin conexión. Existe para el caso de feria: aparece
   * mercadería que no está en el catálogo, y las alternativas son no venderla o
   * cobrarla como si fuera otra cosa — que ensucia el stock de las dos.
   *
   * Queda con id local negativo, entra al buscador y se puede cobrar enseguida.
   * El servidor lo crea de verdad al sincronizar.
   */
  function submitNuevoProducto(e: React.FormEvent) {
    e.preventDefault();
    const precio = Number(nuevoProdPrecio.replace(",", "."));
    const cantidad = Number(nuevoProdStock || "0");

    if (!nuevoProdNombre.trim()) return setNuevoProdError("Poné un nombre.");
    if (!Number.isFinite(precio) || precio < 0) return setNuevoProdError("El precio no es válido.");
    if (!Number.isInteger(cantidad) || cantidad < 0) return setNuevoProdError("La cantidad no es válida.");

    startNuevoProd(async () => {
      try {
        const localVariantId = await altaProductoOffline({
          name: nuevoProdNombre, basePrice: precio, stock: cantidad, sku: nuevoProdSku,
        });
        // Se agrega directo al carrito: se está cargando porque lo están
        // comprando. La cantidad disponible puede ser 0 y la venta igual entra
        // (queda stock negativo, con aviso, al sincronizar).
        addToCart({
          variantId: localVariantId,
          productName: nuevoProdNombre.trim(),
          variantName: null,
          sku: nuevoProdSku.trim() || null,
          stock: Math.max(cantidad, 1),
          price: precio,
          basePrice: precio,
          setName: null, condition: null, foil: false, language: null,
        });
        setNuevoProdOpen(false);
        setNuevoProdNombre(""); setNuevoProdPrecio(""); setNuevoProdStock(""); setNuevoProdSku("");
        setNuevoProdError("");
        toast.success("Producto cargado en este dispositivo. Se crea al sincronizar.");
      } catch {
        setNuevoProdError("No se pudo guardar el producto en este dispositivo.");
      }
    });
  }

  async function restaurarDesdeArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    // Se limpia el input para que elegir el MISMO archivo otra vez vuelva a
    // disparar onChange.
    e.target.value = "";
    if (!archivo) return;

    const res = await restaurarRespaldo(await archivo.text());
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    if (res.restauradas === 0) {
      toast.info(`El respaldo no traía ventas nuevas (${number(res.yaEstaban)} ya estaban en la cola).`);
      return;
    }
    toast.success(`${number(res.restauradas)} venta(s) restaurada(s). Sincronizalas cuando haya conexión.`);
  }

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
    // `!== false` y no `=== true`: una fila del catálogo guardada por una
    // versión anterior no trae el campo, y el default es que SÍ lleva stock.
    const llevaStock = r.tracksStock !== false;
    if (llevaStock && r.stock <= 0) {
      setAvisoBusqueda(`Sin stock: ${label(r)}. Cargá stock desde Productos.`);
      return;
    }
    setError("");
    setCart((prev) => {
      const existing = prev.find((i) => i.variantId === r.variantId);
      if (existing) {
        // No superar el stock disponible. Lo que no lleva stock no tiene tope:
        // se pueden vender diez milanesas aunque el número diga 0.
        return prev.map((i) =>
          i.variantId === r.variantId ? { ...i, quantity: Math.min(topeDe(i), i.quantity + 1) } : i
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
          priceCash: r.priceCash ?? null,
          priceWholesale: r.priceWholesale ?? null,
          priceList: "venta" as PriceList,
          stock: r.stock,
          llevaStock,
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
          ? { ...i, quantity: Math.min(topeDe(i), Math.max(1, i.quantity + delta)) }
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
    const gross = round2(precioDe(i) * i.quantity);
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
          // Se manda la LISTA, no el importe: el precio lo resuelve el servidor.
          priceList: i.priceList,
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
        // El remito va como accion del aviso y no como boton fijo: el POS se
        // usa con cola enfrente y la mayoria de las ventas no necesitan papel.
        // Queda a un toque para las que si, y se va solo cuando no se usa.
        const verRemito = {
          label: "Remito",
          onClick: () => window.open(`/ventas/${res.saleId}/remito`, "_blank"),
        };
        if (res.duplicada) {
          toast.info(`La venta #${res.saleId} ya estaba registrada — ${money(res.total)}. No se cobró de nuevo.`, {
            action: verRemito,
          });
        } else {
          toast.success(`Venta #${res.saleId} registrada — ${money(res.total)}`, {
            action: verRemito,
            duration: 8000,
          });
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
        unitPrice: precioDe(i),
        discount: i.discountValue > 0 ? { kind: i.discountKind, value: i.discountValue } : undefined,
        priceList: i.priceList,
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
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" size="sm" disabled={bajando || offline} onClick={prepararOffline}>
                {bajando ? "Descargando…" : catalogo ? "Actualizar catálogo offline" : "Preparar para vender sin conexión"}
              </Button>
              {/* Restaurar un respaldo se usa poquísimo pero es la única salida
                  si el navegador borró la cola. Vive acá y no en la barra
                  porque la barra desaparece cuando no hay pendientes, que es
                  exactamente el estado en el que hace falta restaurar. */}
              <Button type="button" variant="ghost" size="sm" onClick={() => archivoRef.current?.click()}>
                Restaurar respaldo
              </Button>
              <input
                ref={archivoRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={restaurarDesdeArchivo}
              />
            </div>
            {meta && (
              <p className="mt-1 text-xs text-muted-foreground">
                Catálogo guardado el {new Date(meta.generadoEn).toLocaleString("es-AR")}
              </p>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Con conexion es el unico momento en que se puede hacer algo: el
              catalogo offline solo se baja a mano. */}
          {preciosDesactualizados && !offline && (
            <Notice tone="warn">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  Los precios se actualizaron el{" "}
                  {new Date(preciosActualizadosEn!).toLocaleString("es-AR")} y el
                  catálogo guardado en este dispositivo es anterior. Si vendés sin
                  conexión, va a cobrar los precios viejos.
                </span>
                <Button type="button" variant="outline" size="sm" disabled={bajando} onClick={prepararOffline}>
                  {bajando ? "Descargando…" : "Actualizar catálogo"}
                </Button>
              </div>
            </Notice>
          )}
          {offline && !catalogo && (
            <Notice tone="danger">
              Este dispositivo no tiene el catálogo guardado, así que no se puede buscar
              sin conexión. Cuando vuelva internet, tocá «Preparar para vender sin conexión».
            </Notice>
          )}
          {offline && catalogo && (
            // La antigüedad va acá adentro y no solo en la esquina de arriba:
            // es lo que explica por qué un producto cargado hace un rato no
            // aparece. El snapshot solo se refresca a mano.
            <Notice tone={catalogoVencido ? "danger" : "warn"}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  Buscando en el catálogo guardado en este dispositivo
                  {meta && ` el ${new Date(meta.generadoEn).toLocaleString("es-AR")}`}.
                  El stock y los precios son del último momento con conexión, y lo
                  que hayas cargado después no está acá.
                </span>
                {/* Sin esto, un falso negativo de la sonda (que marca offline
                    si /api/health tarda más de 2,5 s) deja al vendedor
                    buscando en el catálogo viejo hasta el siguiente ciclo de
                    30 segundos, sin ninguna forma de apurarlo. */}
                <Button
                  type="button" variant="outline" size="sm" disabled={reintentandoConexion}
                  onClick={async () => {
                    setReintentandoConexion(true);
                    try { await refrescarConexion(true); } finally { setReintentandoConexion(false); }
                  }}
                >
                  {reintentandoConexion ? "Probando…" : "Reintentar conexión"}
                </Button>
              </div>
            </Notice>
          )}
          {/* Dar de alta un producto es del dueño, igual que en Productos. Si el
              empleado pudiera encolarlo, el lote entero rebotaría con 403 al
              sincronizar y tampoco entrarían sus ventas. */}
          {offline && esDueno && (
            <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>¿El producto no está en el catálogo?</span>
              <Button type="button" variant="outline" size="sm" onClick={() => setNuevoProdOpen(true)}>
                Cargar producto nuevo
              </Button>
            </div>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar producto o SKU…"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              // Enter agrega el primer resultado. Es lo que hace usable un
              // lector de código de barras: el lector tipea el SKU y manda
              // Enter, y hasta ahora ese Enter no hacía nada porque el input no
              // está dentro de un <form>. La búsqueda ya rankea el SKU exacto
              // primero (ver buscarEnCatalogo), así que ese orden estaba
              // desperdiciado.
              onKeyDown={(e) => {
                if (e.key !== "Enter" || results.length === 0) return;
                e.preventDefault();
                addToCart(results[0]);
              }}
              className="pl-9"
              autoFocus
            />
            {results.length > 0 && (
              <ul className="absolute z-20 mt-1 max-h-[40dvh] w-full overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover shadow-lg">
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
                        {/* Mostrar "stock 0" en un plato es ruido que además
                            parece un error. Lo que no se cuenta, no se informa. */}
                        {r.tracksStock !== false && (
                          <span className="ledger-label">stock {number(r.stock)}</span>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Los tres estados que antes eran el mismo espacio en blanco: se
              está buscando, falló la búsqueda, o no hay coincidencias. Y el
              aviso del carrito ("Sin stock") vive acá, al lado del clic que lo
              produce, en vez de en la columna de Cobro. */}
          {avisoBusqueda ? (
            <Notice tone="danger" role="alert">{avisoBusqueda}</Notice>
          ) : buscando ? (
            <p className="text-sm text-muted-foreground">Buscando…</p>
          ) : terminoBuscado && results.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin resultados para «{terminoBuscado}».
            </p>
          ) : null}

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
                      <p className="figure text-xs text-muted-foreground">
                        {money(precioDe(item))} c/u
                        {item.priceList !== "venta" && (
                          <span className="ml-1 text-brand">
                            {LISTAS.find((l) => l.value === item.priceList)?.corto.toLowerCase()}
                          </span>
                        )}
                      </p>
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
                        disabled={item.quantity >= topeDe(item)}
                        aria-label="Sumar uno"
                      >
                        <Plus className="size-3" />
                      </Button>
                      {item.llevaStock && item.quantity >= item.stock && (
                        <span className="ledger-label ml-1 text-muted-foreground">máx {number(item.stock)}</span>
                      )}
                    </div>
                    {(item.priceCash != null || item.priceWholesale != null) && (
                      <div className="flex overflow-hidden rounded-md border border-border">
                        {LISTAS.map((l) => (
                          <button
                            key={l.value}
                            type="button"
                            disabled={!listaDisponible(item, l.value)}
                            onClick={() => patchItem(item.variantId, { priceList: l.value })}
                            title={
                              listaDisponible(item, l.value)
                                ? l.label
                                : `${l.label}: esta variante no lo tiene cargado`
                            }
                            aria-pressed={item.priceList === l.value}
                            className={cn(
                              "px-2 py-1 text-xs transition-colors disabled:opacity-40",
                              item.priceList === l.value
                                ? "bg-brand text-brand-foreground"
                                : "hover:bg-accent disabled:hover:bg-transparent",
                            )}
                          >
                            {l.corto}
                          </button>
                        ))}
                      </div>
                    )}
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
              <>
              <div className="flex gap-2">
                <Select
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  aria-label="Cliente"
                >
                  <option value="">Elegí cliente…</option>
                  {clientesDisponibles.map((c) => (
                    <option key={valorCliente(c)} value={valorCliente(c)}>
                      {c.balance != null && c.balance < 0
                        ? `${c.name} - a favor ${money(-c.balance)}`
                        : c.name}
                    </option>
                  ))}
                </Select>
                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setNewClientOpen(true)}>
                  + Nuevo
                </Button>
              </div>
              {/* Convierte un mecanismo invisible en uno legible: el credito se
                  consume solo, pero hasta ahora nadie lo veia pasar. */}
              {clienteElegido?.balance != null && clienteElegido.balance < 0 && (
                <p className="text-xs text-muted-foreground">
                  Le quedan <strong>{money(-clienteElegido.balance)}</strong> a favor.
                  {total > 0 && (
                    clienteElegido.balance + total < 0
                      ? ` Esta venta lo deja con ${money(-(clienteElegido.balance + total))} a favor.`
                      : clienteElegido.balance + total > 0
                        ? ` Esta venta lo deja debiendo ${money(clienteElegido.balance + total)}.`
                        : " Esta venta lo deja al dia."
                  )}
                </p>
              )}
              </>
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

      <Dialog open={nuevoProdOpen} onOpenChange={setNuevoProdOpen}>
        <DialogContent>
          <form onSubmit={submitNuevoProducto} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Producto nuevo (sin conexión)</DialogTitle>
              <DialogDescription>
                Lo mínimo para poder cobrarlo. Queda guardado en este dispositivo y se crea en
                el sistema al sincronizar; el resto de los datos se completan después desde
                Productos.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="prod-nombre">Nombre</Label>
              <Input
                id="prod-nombre" value={nuevoProdNombre} autoFocus
                onChange={(e) => setNuevoProdNombre(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="prod-precio">Precio</Label>
                <Input
                  id="prod-precio" inputMode="decimal" value={nuevoProdPrecio}
                  onChange={(e) => setNuevoProdPrecio(e.target.value)} placeholder="0,00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prod-stock">Cantidad que tenés</Label>
                <Input
                  id="prod-stock" inputMode="numeric" value={nuevoProdStock}
                  onChange={(e) => setNuevoProdStock(e.target.value)} placeholder="0"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="prod-sku">SKU (opcional)</Label>
              <Input
                id="prod-sku" value={nuevoProdSku}
                onChange={(e) => setNuevoProdSku(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Si ese SKU ya existe en el sistema, el producto se crea sin SKU y te avisa.
              </p>
            </div>
            {nuevoProdError && <p className="text-sm text-destructive" role="alert">{nuevoProdError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNuevoProdOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={nuevoProdPending}>
                {nuevoProdPending ? "Guardando…" : "Cargar y agregar al carrito"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <TicketOffline venta={ticket} onClose={() => setTicket(null)} />
    </div>
  );
}
