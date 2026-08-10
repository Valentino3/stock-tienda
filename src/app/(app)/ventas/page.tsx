import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";
import { requireStore } from "@/lib/session";
import { isoDate } from "@/lib/dates";
import { money } from "@/lib/format";
import { getSalesHistory } from "@/domain/sales-history";
import { getComprobantesForSales } from "@/domain/fiscal-emision";
import { getFiscalConfig } from "@/domain/fiscal-config";
import { mensajeDeObservaciones } from "@/domain/fiscal-comprobante";
import { CBTE_LABEL, formatearNumeroComprobante, type CbteTipo } from "@/domain/fiscal-catalogs";
import { Receipt, SearchX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import { Campo, Toolbar } from "@/components/ui/toolbar";
import { VoidButton } from "./void-button";
import { InvoiceButton, type ComprobanteResumen } from "./invoice-button";

const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  cuenta: "Cuenta",
};

type Params = { from?: string; to?: string; seller?: string; all?: string; page?: string; facturacion?: string };

/** Estado de facturación de una venta, resumido para la grilla. */
type EstadoFactura = "sin" | "autorizada" | "rechazada" | "sin_verificar" | "nc_pendiente";

const FACTURA_BADGE: Record<EstadoFactura, { variant: "success" | "destructive" | "outline" | "secondary"; label: string }> = {
  sin: { variant: "outline", label: "Sin facturar" },
  autorizada: { variant: "success", label: "Facturada" },
  rechazada: { variant: "destructive", label: "Rechazada" },
  sin_verificar: { variant: "destructive", label: "Sin verificar" },
  nc_pendiente: { variant: "destructive", label: "NC pendiente" },
};

/**
 * Columnas del listado, de md para arriba.
 *
 * Antes eran anchos fijos en `rem` que sumaban ~42rem de mínimo, dentro de un
 * contenedor con `overflow-hidden`: abajo de esa medida el contenido se
 * RECORTABA, no scrolleaba, y la pantalla no tenía un solo prefijo responsive
 * en 342 líneas. En un teléfono se perdían las últimas columnas —total,
 * estado, factura— sin ninguna señal de que estaban ahí.
 *
 * Ahora la grilla existe solo desde `md`; abajo, las mismas celdas se
 * reacomodan solas (ver `md:contents` en la fila).
 *
 * El sobrante se reparte entre Vendedor y Medio en vez de caer entero en una
 * sola columna. Seis columnas de contenido corto en una tabla de 1100px
 * siempre dejan aire; concentrarlo en una deja un tajo en el medio de la fila
 * y el ojo pierde el renglón. Fecha y Total van fijas porque su contenido no
 * varía de largo.
 */
const GRID_COLS = (conFactura: boolean) =>
  conFactura
    ? "md:grid-cols-[11.5rem_4rem_1.4fr_1fr_8rem_6rem_7rem]"
    : "md:grid-cols-[11.5rem_4rem_1.4fr_1fr_8rem_6rem]";

/**
 * Estado de facturación de una venta.
 *
 * ⚠️ `nc_pendiente` es el caso que hay que gritar: una venta anulada cuya
 * factura conserva CAE es IVA declarado que el comercio nunca cobró. El
 * predicado se escribe contra el ESTADO y no contra un flag, así la carrera
 * "se anula mientras la factura está en vuelo" se resuelve sola cuando la
 * reconciliación marca la factura como autorizada.
 */
function resolverEstadoFactura(cbtes: ComprobanteResumen[], voided: boolean): EstadoFactura {
  const facturaAutorizada = cbtes.find((c) => c.clase === "factura" && c.estado === "autorizado");
  const ncViva = cbtes.find((c) => c.clase === "nota_credito" && (c.estado === "autorizado" || c.estado === "pendiente"));

  if (voided && facturaAutorizada && !ncViva) return "nc_pendiente";
  if (cbtes.some((c) => c.estado === "error" || c.estado === "pendiente")) return "sin_verificar";
  if (facturaAutorizada) return "autorizada";
  if (cbtes.some((c) => c.clase === "factura" && c.estado === "rechazado")) return "rechazada";
  return "sin";
}

export default async function VentasPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const currentUser = await requireStore();
  const isOwner = currentUser.role === "owner";
  const storeId = currentUser.storeId;
  const page = Math.max(1, Number(params.page) || 1);

  const from = params.from ? new Date(`${params.from}T00:00:00`) : (params.all ? new Date(0) : undefined);
  const to = params.to ? new Date(new Date(`${params.to}T00:00:00`).getTime() + 24 * 60 * 60 * 1000) : undefined;
  const sellerId = !isOwner ? currentUser.id : params.seller || undefined;

  const facturacionFiltro = params.facturacion === "sin" || params.facturacion === "con" ? params.facturacion : undefined;

  const { sales: rows, itemRows, hasNextPage } = await getSalesHistory(db, {
    storeId, from, to, sellerId, page, facturacion: facturacionFiltro,
  });

  const itemsBySale = new Map<number, typeof itemRows>();
  for (const item of itemRows) {
    const list = itemsBySale.get(item.saleId) ?? [];
    list.push(item);
    itemsBySale.set(item.saleId, list);
  }

  // Solo vendedores de esta tienda.
  const sellers = isOwner
    ? await db.select({ id: user.id, name: user.name }).from(user).where(eq(user.storeId, storeId)).orderBy(user.name)
    : [];

  // Facturación. Una sola consulta para toda la página, igual que itemsBySale.
  const fiscalConfig = await getFiscalConfig(db, storeId);
  const facturacionActiva = Boolean(fiscalConfig?.enabled);
  const puedeEmitir = facturacionActiva && (isOwner || Boolean(fiscalConfig?.empleadosPuedenEmitir));

  const comprobantes = facturacionActiva
    ? await getComprobantesForSales(db, storeId, rows.map((r: any) => r.sale.id))
    : [];

  const comprobantesBySale = new Map<number, ComprobanteResumen[]>();
  for (const c of comprobantes) {
    const list = comprobantesBySale.get(c.saleId) ?? [];
    list.push({
      id: c.id,
      clase: c.clase,
      estado: c.estado,
      etiqueta: `${CBTE_LABEL[c.cbteTipo as CbteTipo] ?? `Tipo ${c.cbteTipo}`} ${formatearNumeroComprobante(c.ptoVta, c.numero)}`,
      cae: c.cae,
      caeVto: c.caeVto,
      ambiente: c.ambiente,
      observaciones: mensajeDeObservaciones(c.observaciones),
      errorMsg: c.errorMsg,
    });
    comprobantesBySale.set(c.saleId, list);
  }

  const hasFilters = Boolean(params.from || params.to || params.seller || params.facturacion);
  const usingDefaultWindow = !params.from && !params.to && !params.all;

  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  // Construye el querystring de paginación a mano en vez de
  // `new URLSearchParams({...params, page})`: `params` puede tener
  // `from`/`to`/`seller`/`all` en `undefined`, y pasar un objeto con
  // valores `undefined` a `URLSearchParams` los serializa como el string
  // literal "undefined" en vez de omitirlos.
  function pageHref(page: number) {
    const sp = new URLSearchParams();
    if (params.from) sp.set("from", params.from);
    if (params.to) sp.set("to", params.to);
    if (params.seller) sp.set("seller", params.seller);
    if (params.all) sp.set("all", params.all);
    if (params.facturacion) sp.set("facturacion", params.facturacion);
    sp.set("page", String(page));
    return `/ventas?${sp.toString()}`;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ventas"
        description="Historial de ventas con filtros por fecha y vendedor."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/ventas?from=${isoDate(today)}&to=${isoDate(today)}`}>Hoy</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/ventas?from=${isoDate(weekAgo)}&to=${isoDate(today)}`}>Esta semana</Link>
            </Button>
            <Button asChild size="sm">
              <a href={`/ventas/export${params.from || params.to ? `?from=${params.from ?? ""}&to=${params.to ?? ""}` : ""}`}>
                Exportar Excel
              </a>
            </Button>
          </div>
        }
      />

      <Toolbar asChild>
        <form method="get">
          <Campo label="Desde" htmlFor="v-desde">
            <Input id="v-desde" type="date" name="from" defaultValue={params.from ?? ""} className="w-40" />
          </Campo>
          <Campo label="Hasta" htmlFor="v-hasta">
            <Input id="v-hasta" type="date" name="to" defaultValue={params.to ?? ""} className="w-40" />
          </Campo>
          {isOwner && (
            <Campo label="Vendedor" htmlFor="v-vendedor">
              <Select id="v-vendedor" name="seller" defaultValue={params.seller ?? ""} className="w-44">
                <option value="">Todos</option>
                {sellers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Campo>
          )}
          {facturacionActiva && (
            <Campo label="Facturación" htmlFor="v-facturacion">
              <Select id="v-facturacion" name="facturacion" defaultValue={params.facturacion ?? ""} className="w-44">
                <option value="">Todas</option>
                <option value="sin">Sin facturar</option>
                <option value="con">Facturadas</option>
              </Select>
            </Campo>
          )}
          <Button type="submit" size="sm">
            Filtrar
          </Button>
          {hasFilters && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/ventas">Limpiar</Link>
            </Button>
          )}
        </form>
      </Toolbar>

      {usingDefaultWindow && (
        <p className="text-xs text-muted-foreground">
          Mostrando los últimos 30 días.{" "}
          <Link href="/ventas?all=1" className="text-brand underline underline-offset-4">
            Ver todo el historial
          </Link>
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          filtrado={hasFilters}
          icon={hasFilters ? SearchX : Receipt}
          titulo={hasFilters ? "Ninguna venta con estos filtros" : "Todavía no se registró ninguna venta"}
          detalle={
            hasFilters
              ? "Probá con otro rango de fechas o sacá el filtro de vendedor."
              : "Las ventas que cobres en el mostrador aparecen acá."
          }
          accion={
            hasFilters ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/ventas">Limpiar filtros</Link>
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link href="/vender">Ir a vender</Link>
              </Button>
            )
          }
        />
      ) : (
        <Panel flush>
          {/* El encabezado solo existe cuando hay grilla. En el teléfono cada
              venta se lee como bloque y una fila de títulos arriba de celdas
              que ya no están alineadas confunde más de lo que ayuda. */}
          <div className={`hidden ${GRID_COLS(facturacionActiva)} gap-3 border-b border-border-strong bg-muted px-4 py-2.5 md:grid`}>
            <span className="ledger-label">Fecha</span>
            <span className="ledger-label">N°</span>
            <span className="ledger-label">Vendedor</span>
            <span className="ledger-label">Medio</span>
            <span className="ledger-label text-right">Total</span>
            <span className="ledger-label">Estado</span>
            {facturacionActiva && <span className="ledger-label">Factura</span>}
          </div>
          <div className="divide-y divide-border">
            {rows.map(({ sale, sellerName }: any) => {
              const cbtes = comprobantesBySale.get(sale.id) ?? [];
              const estadoFactura = resolverEstadoFactura(cbtes, sale.voided);
              return (
              <details key={sale.id} className={`group ${sale.voided ? "opacity-70" : ""}`}>
                <summary className={`cursor-pointer px-4 py-3 text-sm transition-colors marker:content-none hover:bg-accent md:grid ${GRID_COLS(facturacionActiva)} md:items-center md:gap-3`}>
                  {/* `md:contents` disuelve este envoltorio en la grilla: de md
                      para arriba las celdas son hijas directas y caen en su
                      columna; abajo se acomodan solas en dos renglones. Una
                      sola copia del marcado para las dos formas. */}
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 md:contents">
                    <span className={`figure text-muted-foreground ${sale.voided ? "line-through" : ""}`}>
                      {sale.createdAt.toLocaleString("es-AR")}
                    </span>
                    <span className="figure font-medium">#{sale.id}</span>
                    <span className="truncate">{sellerName}</span>
                    <span className="text-muted-foreground">{PAYMENT_LABELS[sale.paymentMethod] ?? sale.paymentMethod}</span>
                    {/* En el teléfono el importe se va al extremo derecho con
                        `ml-auto`; en la grilla manda `text-right` y el margen
                        no tiene efecto porque cada celda es su propia columna. */}
                    <span className={`figure ml-auto font-medium md:text-right ${sale.voided ? "line-through" : ""}`}>
                      {money(sale.total)}
                    </span>
                    <span>
                      {sale.voided ? (
                        <Badge variant="destructive">Anulada</Badge>
                      ) : (
                        <Badge variant="success">Activa</Badge>
                      )}
                    </span>
                    {facturacionActiva && (
                      <span>
                        <Badge variant={FACTURA_BADGE[estadoFactura].variant}>
                          {FACTURA_BADGE[estadoFactura].label}
                        </Badge>
                      </span>
                    )}
                  </div>
                </summary>
                <div className="space-y-3 border-t border-border bg-muted/30 px-4 py-3 text-sm">
                  <ul className="space-y-1.5">
                    {(itemsBySale.get(sale.id) ?? []).map((item: any) => {
                      const lineNet = item.quantity * item.unitPrice - (item.discountAmount ?? 0);
                      return (
                        <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-2">
                          <span>
                            {item.productName}
                            {item.variantName ? ` — ${item.variantName}` : ""}{" "}
                            <span className="text-muted-foreground">× {item.quantity}</span>
                          </span>
                          <span className="figure text-muted-foreground">
                            {money(item.unitPrice)} c/u
                            {item.discountAmount > 0 && ` − ${money(item.discountAmount)} desc.`} = {money(lineNet)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {sale.discountAmount > 0 && (
                    <p className="figure text-xs text-muted-foreground">
                      Descuento general: −{money(sale.discountAmount)}
                    </p>
                  )}
                  {sale.voided && sale.voidedReason && (
                    <p className="text-xs">
                      <span className="ledger-label">Motivo de la anulación</span>{" "}
                      <span className="text-foreground">{sale.voidedReason}</span>
                    </p>
                  )}
                  <div className="flex flex-wrap items-start gap-3">
                    {isOwner && !sale.voided && (
                      <VoidButton
                        saleId={sale.id}
                        facturada={cbtes.some((c) => c.clase === "factura" && c.estado === "autorizado")}
                      />
                    )}
                    {facturacionActiva && (
                      <InvoiceButton
                        saleId={sale.id}
                        inicial={cbtes}
                        puedeEmitir={puedeEmitir}
                        puedeAnular={isOwner}
                        ventaAnulada={sale.voided}
                      />
                    )}
                  </div>
                </div>
              </details>
              );
            })}
          </div>
        </Panel>
      )}

      {(page > 1 || hasNextPage) && (
        <div className="flex items-center justify-center gap-3">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(page - 1)}>Anterior</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>Anterior</Button>
          )}
          <span className="ledger-label">Página {page}</span>
          {hasNextPage ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(page + 1)}>Siguiente</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>Siguiente</Button>
          )}
        </div>
      )}
    </div>
  );
}
