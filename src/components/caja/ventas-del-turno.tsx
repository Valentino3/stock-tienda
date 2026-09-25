import Link from "next/link";
import type { Remito } from "@/domain/cash-close";
import { METODO_LABEL, type PaymentMethod } from "@/domain/pagos";
import { resumirLineas, totalesDelListado } from "@/domain/resumen-venta";
import { diaHora, hora, money, number } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";

/**
 * Las ventas de un turno, una por fila: qué se llevó y con qué pagó.
 *
 * Es la respuesta a "en el resumen de caja no se ve con qué se vendió cada
 * cosa": el arqueo agrupa por medio, y hasta ahora el único lugar donde se veía
 * cada venta era el paquete de remitos A4, uno por hoja.
 *
 * Server component a propósito, sin `"use client"`: `/caja` lo recibe ya
 * renderizado como prop, así que el arreglo de remitos nunca viaja al
 * navegador. Por eso tampoco usa `@/components/ui/table`, que sí es de
 * cliente.
 */

/** Arriba de esto la pantalla muestra las últimas y remite a la hoja. */
const MAX_FILAS = 200;

const GRID = "md:grid-cols-[4.5rem_5.5rem_1fr_1fr_2fr_1.4fr_7rem]";

const metodo = (m: string) => METODO_LABEL[m as PaymentMethod] ?? m;

// Clave de día en hora argentina, para saber si la hora sola alcanza.
const diaAr = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit",
});

/**
 * Un turno que cruza la medianoche —o una caja que quedó abierta de un día
 * para el otro— con la hora sola mostraría "09:10" antes que "23:40" sin
 * explicar por qué. Ahí va la fecha.
 */
function formatoDeHora(remitos: Remito[]) {
  const dias = new Set(remitos.map((r) => diaAr.format(r.createdAt)));
  return dias.size > 1 ? diaHora : hora;
}

/**
 * Con un solo medio basta el nombre: el monto es el total de la fila. Con pago
 * dividido va cada parte con su monto, igual que la condición de venta del
 * remito — si no, "Efectivo, Tarjeta" no dice cuánto entró al cajón.
 */
function Medios({ pagos }: { pagos: Remito["pagos"] }) {
  if (pagos.length <= 1) return <>{pagos[0] ? metodo(pagos[0].method) : "—"}</>;
  return (
    <span className="flex flex-wrap gap-x-1.5 md:flex-col">
      {pagos.map((p, i) => (
        <span key={p.method} className="whitespace-nowrap">
          {i > 0 && <span className="text-muted-foreground md:hidden">+ </span>}
          {metodo(p.method)} <span className="figure">{money(p.amount)}</span>
        </span>
      ))}
    </span>
  );
}

function textoMedios(pagos: Remito["pagos"]) {
  if (pagos.length <= 1) return pagos[0] ? metodo(pagos[0].method) : "—";
  return pagos.map((p) => `${metodo(p.method)} ${money(p.amount)}`).join(" + ");
}

function textoLlevo(r: Remito, max?: number) {
  const { texto, resto } = resumirLineas(r.lineas, max);
  if (!texto) return "—";
  return resto > 0 ? `${texto} y ${number(resto)} más` : texto;
}

/** Para la pantalla de `/caja`. */
export function VentasDelTurno({
  remitos, soloPropias, hojaHref,
}: {
  remitos: Remito[];
  /** Empleado: la lista trae solo lo que vendió o anotó. */
  soloPropias: boolean;
  /** La hoja del turno (solo dueño). */
  hojaHref?: string;
}) {
  const tot = totalesDelListado(remitos);
  // Las más nuevas arriba: en el mostrador lo que se busca es la venta que
  // acaba de pasar, no la de la apertura.
  const filas = [...remitos].reverse().slice(0, MAX_FILAS);
  const fmtHora = formatoDeHora(remitos);

  return (
    <section className="space-y-3" aria-labelledby="ventas-del-turno">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="ventas-del-turno" className="text-base font-semibold">
            {soloPropias ? "Tus ventas del turno" : "Ventas del turno"}
          </h2>
          {soloPropias && (
            // Sin esto el empleado suma la lista, no le da lo mismo que el
            // total de arriba, y cree que la caja está mal.
            <p className="text-sm text-muted-foreground">
              Las que vendiste o anotaste vos. Los totales de arriba son de toda la caja.
            </p>
          )}
        </div>
        {hojaHref && (
          <Button asChild variant="outline" size="sm">
            <Link href={hojaHref}>Ver hoja del turno</Link>
          </Button>
        )}
      </div>

      {remitos.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {soloPropias ? "Todavía no vendiste ni anotaste ventas en este turno." : "Sin ventas todavía."}
        </p>
      ) : (
        <Panel flush>
          <div className={`hidden ${GRID} gap-3 border-b border-border-strong bg-muted px-4 py-2.5 md:grid`}>
            <span className="ledger-label">Hora</span>
            <span className="ledger-label">N°</span>
            <span className="ledger-label">Vendedor</span>
            <span className="ledger-label">Cliente</span>
            <span className="ledger-label">Se llevó</span>
            <span className="ledger-label">Medio</span>
            <span className="ledger-label text-right">Total</span>
          </div>
          <div className="divide-y divide-border">
            {filas.map((r) => (
              <details key={r.saleId} className={`group ${r.voided ? "opacity-70" : ""}`}>
                <summary className={`cursor-pointer px-4 py-3 text-sm transition-colors marker:content-none hover:bg-accent md:grid ${GRID} md:items-center md:gap-3`}>
                  {/* Mismo truco que /ventas: `md:contents` disuelve el
                      envoltorio en la grilla. En el teléfono los `order-*`
                      arman tres renglones —hora y total; qué se llevó; medio y
                      personas— sin duplicar el marcado. */}
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 md:contents">
                    <span className="figure order-1 text-muted-foreground md:order-0">{fmtHora(r.createdAt)}</span>
                    <span className="order-2 md:order-0">
                      <span className="figure font-medium">#{r.saleId}</span>
                      {r.numero != null && (
                        <span className="figure ml-1.5 text-xs text-muted-foreground">R {r.numero}</span>
                      )}
                      {r.voided && <Badge variant="destructive" className="ml-1.5">Anulada</Badge>}
                      {r.posteriorAlCierre && !r.voided && <Badge variant="outline" className="ml-1.5">Tardía</Badge>}
                    </span>
                    <span className="order-6 truncate text-muted-foreground md:order-0 md:text-foreground">{r.sellerName}</span>
                    <span className="order-7 truncate text-muted-foreground md:order-0">{r.clientName ?? ""}</span>
                    <span className={`order-4 basis-full line-clamp-2 md:order-0 md:basis-auto ${r.voided ? "line-through" : ""}`}>
                      {textoLlevo(r)}
                    </span>
                    <span className="order-5 md:order-0">
                      <Medios pagos={r.pagos} />
                    </span>
                    <span className={`figure order-3 ml-auto font-medium md:order-0 md:text-right ${r.voided ? "line-through" : ""}`}>
                      {money(r.total)}
                    </span>
                  </div>
                </summary>
                <div className="space-y-3 border-t border-border bg-muted/30 px-4 py-3 text-sm">
                  <ul className="space-y-1.5">
                    {r.lineas.map((l, i) => (
                      <li key={i} className="flex flex-wrap items-baseline justify-between gap-2">
                        <span>
                          {l.productName}
                          {l.variantName ? ` — ${l.variantName}` : ""}{" "}
                          <span className="text-muted-foreground">× {number(l.quantity)}</span>
                        </span>
                        <span className="figure text-muted-foreground">
                          {money(l.unitPrice)} c/u
                          {l.discountAmount > 0 && ` − ${money(l.discountAmount)} desc.`} = {money(l.neto)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {r.discountAmount > 0 && (
                    <p className="figure text-xs text-muted-foreground">Descuento general: −{money(r.discountAmount)}</p>
                  )}
                  {r.voided && r.voidedReason && (
                    <p className="text-xs">
                      <span className="ledger-label">Motivo de la anulación</span>{" "}
                      <span className="text-foreground">{r.voidedReason}</span>
                    </p>
                  )}
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/ventas/${r.saleId}/remito`}>Remito</Link>
                  </Button>
                </div>
              </details>
            ))}
          </div>
          <div className="space-y-0.5 border-t-2 border-foreground/80 px-4 py-2.5 text-sm">
            <p className="flex items-baseline justify-between gap-3">
              <span className="ledger-label">{number(tot.ventas)} venta(s)</span>
              <span className="figure font-semibold">{money(tot.total)}</span>
            </p>
            {tot.anuladas.count > 0 && (
              <p className="text-xs text-muted-foreground">
                {number(tot.anuladas.count)} anulada(s) por {money(tot.anuladas.total)}, fuera del total.
              </p>
            )}
            {remitos.length > MAX_FILAS && (
              <p className="text-xs text-muted-foreground">
                Mostrando las últimas {number(MAX_FILAS)} de {number(remitos.length)}. El total es de todas;
                la lista completa está en la hoja del turno y en el Excel.
              </p>
            )}
          </div>
        </Panel>
      )}
    </section>
  );
}

/**
 * Para la hoja de cierre impresa.
 *
 * `<table>` con `<thead>` porque Chrome repite el encabezado en cada hoja. Lo
 * anulado y lo tardío va dicho con TEXTO y no solo con color: la hoja se
 * imprime en blanco y negro. Sin `break-inside-avoid` por fila: sobre cientos
 * de filas es justo lo que hace arrastrarse al navegador (ver
 * remito-imprimible.tsx).
 */
export function TablaVentasDelTurno({ remitos }: { remitos: Remito[] }) {
  if (remitos.length === 0) {
    return <p className="mt-1 text-sm text-muted-foreground">Sin ventas en este turno.</p>;
  }
  const tot = totalesDelListado(remitos);
  const fmtHora = formatoDeHora(remitos);
  return (
    <table className="mt-1 w-full text-xs">
      <thead>
        <tr className="border-b border-border-strong text-left">
          <th className="ledger-label py-1 pr-2 font-normal">Hora</th>
          <th className="ledger-label py-1 pr-2 font-normal">N°</th>
          <th className="ledger-label py-1 pr-2 font-normal">Vendedor</th>
          <th className="ledger-label py-1 pr-2 font-normal">Cliente</th>
          <th className="ledger-label py-1 pr-2 font-normal">Se llevó</th>
          <th className="ledger-label py-1 pr-2 font-normal">Medio</th>
          <th className="ledger-label py-1 text-right font-normal">Total</th>
        </tr>
      </thead>
      <tbody>
        {remitos.map((r) => (
          <tr key={r.saleId} className="border-b border-border align-top">
            <td className="figure py-1 pr-2 whitespace-nowrap">{fmtHora(r.createdAt)}</td>
            <td className="figure py-1 pr-2 whitespace-nowrap">
              #{r.saleId}
              {r.numero != null && <span className="block text-muted-foreground">R {r.numero}</span>}
            </td>
            <td className="py-1 pr-2">{r.sellerName}</td>
            <td className="py-1 pr-2">{r.clientName ?? ""}</td>
            <td className="py-1 pr-2">
              <span className={r.voided ? "line-through" : ""}>{textoLlevo(r, Infinity)}</span>
              {r.voided && (
                <span className="block font-bold">ANULADA{r.voidedReason ? ` — ${r.voidedReason}` : ""}</span>
              )}
              {r.posteriorAlCierre && !r.voided && <span className="block font-bold">TARDÍA</span>}
            </td>
            <td className="py-1 pr-2">{textoMedios(r.pagos)}</td>
            <td className={`figure py-1 text-right whitespace-nowrap ${r.voided ? "line-through" : ""}`}>
              {money(r.total)}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-border-strong">
          <td colSpan={6} className="py-1 font-semibold">
            {number(tot.ventas)} venta(s)
            {tot.anuladas.count > 0 &&
              ` · ${number(tot.anuladas.count)} anulada(s) por ${money(tot.anuladas.total)}, fuera del total`}
          </td>
          <td className="figure py-1 text-right font-semibold">{money(tot.total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
