"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Printer, PrinterCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/utils";
import { number } from "@/lib/format";
import type { Comanda } from "@/domain/kitchen";
import { confirmarCorrecciones, confirmarImpresion, traerComandas } from "../salon/actions";

/**
 * Pantalla de cocina: consulta cada pocos segundos y, si está activado,
 * imprime lo nuevo.
 *
 * El intervalo es deliberadamente tonto —no hay websockets ni push— porque una
 * cocina tiene una sola pantalla y un pedido cada varios minutos. Sostener una
 * conexión viva para eso sería más piezas que se pueden romper un viernes a la
 * noche.
 */

const INTERVALO_MS = 5000;
const CLAVE_AUTOIMPRESION = "stock-tienda:cocina:autoimprimir";

function espera(desde: Date | string): string {
  const min = Math.max(0, Math.floor((Date.now() - new Date(desde).getTime()) / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function CocinaClient({
  inicial, estaciones, estacion,
}: {
  inicial: Comanda[];
  estaciones: string[];
  estacion: string | null;
}) {
  const [comandas, setComandas] = useState<Comanda[]>(inicial);
  const [autoimprimir, setAutoimprimir] = useState(false);
  const [error, setError] = useState("");
  // Comanda que se está imprimiendo en este momento. Se imprime de a una:
  // window.print() saca TODO lo que esté visible, así que hay que aislar.
  const [imprimiendo, setImprimiendo] = useState<Comanda | null>(null);
  // Por versión de línea y no por orden: la segunda ronda de una mesa, o una
  // anulación de algo ya impreso, tienen que salir aunque esa mesa ya haya
  // salido antes. Con la orden como clave, solo salía la primera ronda.
  const yaImpresas = useRef<Set<string>>(new Set());

  // La preferencia vive en el dispositivo: la PC de la cocina imprime, la del
  // mostrador no. El setState sincrónico acá no se puede evitar con un
  // inicializador perezoso porque el servidor no ve localStorage y habría
  // desajuste de hidratación. Cuesta un render extra, una sola vez.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAutoimprimir(localStorage.getItem(CLAVE_AUTOIMPRESION) === "1");
  }, []);

  // Marca el body mientras hay una comanda montada: es lo que hace que
  // @media print deje solo el papel. Ver globals.css.
  useEffect(() => {
    if (!imprimiendo) return;
    document.body.classList.add("imprimiendo-ticket");
    return () => document.body.classList.remove("imprimiendo-ticket");
  }, [imprimiendo]);

  const refrescar = useCallback(async () => {
    try {
      const nuevas = await traerComandas(estacion);
      setComandas(nuevas);
      setError("");
    } catch {
      // Se cayó la red o el server: se reintenta en el próximo tick. No se
      // borra lo que hay en pantalla — el cocinero lo está usando.
      setError("Sin conexión con el servidor. Reintentando…");
    }
  }, [estacion]);

  useEffect(() => {
    const t = setInterval(refrescar, INTERVALO_MS);
    return () => clearInterval(t);
  }, [refrescar]);

  // Auto-impresión: de a una comanda, marcando antes de imprimir para que un
  // corte en el medio no dispare una reimpresión infinita al recargar.
  useEffect(() => {
    if (!autoimprimir || imprimiendo) return;

    // Solo lo que falta en papel: lo nuevo y las correcciones. Reimprimir la
    // comanda entera por una línea agregada es papel que confunde.
    const pendiente = comandas
      .map((c) => ({
        ...c,
        lineas: c.lineas.filter((l) => l.porImprimir && !yaImpresas.current.has(l.version)),
      }))
      .find((c) => c.lineas.length > 0);
    if (!pendiente) return;

    for (const l of pendiente.lineas) yaImpresas.current.add(l.version);
    setImprimiendo(pendiente);

    (async () => {
      const res = await confirmarImpresion(pendiente.lineas.map((l) => l.itemId));
      if ("error" in res && res.error) setError(res.error);
      // El print va después de marcar: si el navegador se cuelga en el diálogo
      // o la máquina se apaga, el peor caso es una comanda sin imprimir que se
      // reimprime a mano, no una impresora escupiendo la misma comanda sola.
      window.print();
      setImprimiendo(null);
      void refrescar();
    })();
  }, [autoimprimir, comandas, imprimiendo, refrescar]);

  function alternarAuto(valor: boolean) {
    setAutoimprimir(valor);
    localStorage.setItem(CLAVE_AUTOIMPRESION, valor ? "1" : "0");
    // Lo que ya está en pantalla al activar no se imprime de golpe: sería una
    // pila de papel de todo el servicio.
    if (valor) for (const c of comandas) for (const l of c.lineas) yaImpresas.current.add(l.version);
  }

  async function entendido(c: Comanda) {
    const ids = c.lineas.filter((l) => l.anulada || l.modificada).map((l) => l.itemId);
    const res = await confirmarCorrecciones(ids);
    if ("error" in res && res.error) setError(res.error);
    void refrescar();
  }

  async function imprimirAMano(c: Comanda) {
    setImprimiendo(c);
    await confirmarImpresion(c.lineas.map((l) => l.itemId));
    window.print();
    setImprimiendo(null);
    void refrescar();
  }

  return (
    <div className="space-y-4">
      <div className="no-imprimir flex flex-wrap items-center gap-2">
        <Link
          href="/cocina"
          className={cn(
            "rounded-lg border px-3 py-1.5 text-sm transition-colors",
            !estacion ? "border-brand bg-brand text-brand-foreground" : "border-border hover:bg-accent",
          )}
        >
          Todo
        </Link>
        {estaciones.map((e) => (
          <Link
            key={e}
            href={`/cocina?estacion=${encodeURIComponent(e)}`}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm capitalize transition-colors",
              estacion === e ? "border-brand bg-brand text-brand-foreground" : "border-border hover:bg-accent",
            )}
          >
            {e}
          </Link>
        ))}

        <label className="ml-auto flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoimprimir}
            onChange={(e) => alternarAuto(e.target.checked)}
          />
          Imprimir automáticamente
        </label>
      </div>

      {autoimprimir && (
        <div className="no-imprimir">
          <Notice tone="info">
            Para que salga sin diálogo, esta máquina tiene que tener Chrome abierto
            con <code>--kiosk-printing</code> y la impresora de cocina como
            predeterminada.
          </Notice>
        </div>
      )}

      {error && <div className="no-imprimir" role="alert"><Notice tone="warn">{error}</Notice></div>}

      {comandas.length === 0 ? (
        <p className="no-imprimir rounded-xl border border-dashed border-border bg-card/50 px-4 py-12 text-center text-muted-foreground">
          No hay nada para preparar.
        </p>
      ) : (
        <div className="no-imprimir grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {comandas.map((c) => {
            const correcciones = c.lineas.some((l) => l.anulada || l.modificada);
            return (
              <article
                key={c.orderId}
                className={cn(
                  "rounded-xl border bg-card p-4",
                  correcciones ? "border-destructive" : "border-border",
                )}
              >
                <header className="flex items-baseline justify-between gap-2">
                  <h2 className="text-base font-semibold">
                    {c.mesa ? `Mesa ${c.mesa}` : `Pedido #${c.orderId}`}
                  </h2>
                  <span className="ledger-label text-muted-foreground">{espera(c.mandadaEn)}</span>
                </header>
                {c.sector && <p className="ledger-label text-muted-foreground">{c.sector}</p>}
                {c.cancelada && (
                  <p className="mt-2 rounded-md bg-destructive/10 px-2 py-1 text-sm font-semibold text-destructive">
                    MESA CANCELADA: no preparar
                  </p>
                )}

                <ul className="mt-3 space-y-1.5">
                  {c.lineas.map((l) => (
                    <li key={l.itemId} className="flex gap-2 text-sm">
                      <span className={cn("figure font-semibold", l.anulada && "line-through")}>
                        {number(l.quantity)}
                      </span>
                      <span className="min-w-0">
                        {l.anulada ? (
                          <>
                            <span className="line-through">{l.nombre}</span>{" "}
                            <span className="font-semibold text-destructive">ANULADO</span>
                            {l.motivoAnulacion && (
                              <span className="block text-muted-foreground">{l.motivoAnulacion}</span>
                            )}
                          </>
                        ) : (
                          <>
                            {l.nombre}
                            {l.modificada && (
                              <span className="ml-1 font-semibold text-destructive">MODIF</span>
                            )}
                            {l.notes && (
                              // La nota es lo que más importa de una comanda: si se
                              // pierde, sale un plato que hay que rehacer.
                              <span className="block font-semibold text-warning">{l.notes}</span>
                            )}
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="mt-3 flex gap-2">
                  {correcciones && (
                    // La cocina que trabaja solo con pantalla confirma que leyó
                    // la corrección. Imprimirla también cuenta como leída.
                    <Button type="button" size="sm" className="flex-1" onClick={() => entendido(c)}>
                      Entendido
                    </Button>
                  )}
                  <Button
                    type="button" variant="outline" size="sm" className="flex-1"
                    onClick={() => imprimirAMano(c)}
                  >
                    <Printer className="mr-1 size-3" /> Imprimir
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Lo único que sale en papel. Se monta solo mientras se imprime, para
          que window.print() no arrastre la grilla entera. */}
      {imprimiendo && <ComandaImpresa comanda={imprimiendo} />}
    </div>
  );
}

function ComandaImpresa({ comanda }: { comanda: Comanda }) {
  // La hora de la ronda que sale, no la de la primera: una segunda ronda con la
  // hora de la entrada parece demorada.
  const hora = new Date(Math.max(...comanda.lineas.map((l) => new Date(l.sentAt).getTime())));
  const soloCorrecciones = comanda.lineas.every((l) => l.anulada || l.modificada);
  return (
    <div className="ticket-overlay fixed inset-0 z-50 grid place-items-center bg-foreground/45 p-4 supports-backdrop-filter:backdrop-blur-xs">
      <div className="ticket-hoja w-full max-w-[80mm] bg-white p-3 text-black">
        <p className="text-center text-base font-bold">
          {comanda.mesa ? `MESA ${comanda.mesa}` : `PEDIDO #${comanda.orderId}`}
        </p>
        {(comanda.cancelada || soloCorrecciones) && (
          <p className="text-center text-sm font-bold">
            {comanda.cancelada ? "*** MESA CANCELADA ***" : "*** CORRECCIÓN ***"}
          </p>
        )}
        <p className="text-center text-[10px]">
          {hora.toLocaleTimeString("es-AR")}
          {comanda.sector ? ` · ${comanda.sector}` : ""}
        </p>

        <hr className="my-2 border-black/30" />

        <ul className="space-y-2">
          {comanda.lineas.map((l) => (
            <li key={l.itemId} className="text-sm leading-tight">
              {l.anulada ? (
                <>
                  <span className="font-bold">ANULAR {l.quantity}× {l.nombre}</span>
                  {l.motivoAnulacion && <span className="block text-[11px]">({l.motivoAnulacion})</span>}
                </>
              ) : (
                <>
                  <span className="font-bold">
                    {l.modificada && "MODIF: "}{l.quantity}× {l.nombre}
                  </span>
                  {l.notes && <span className="block text-[12px] font-bold">** {l.notes} **</span>}
                </>
              )}
            </li>
          ))}
        </ul>

        <p className="mt-3 flex items-center justify-center gap-1 text-[9px]">
          <PrinterCheck className="size-3" /> Comanda de cocina
        </p>
      </div>
    </div>
  );
}
