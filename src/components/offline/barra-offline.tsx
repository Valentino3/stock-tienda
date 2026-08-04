"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { number } from "@/lib/format";
import {
  exportarRespaldo, iniciarOffline, limpiarAvisos, sincronizarCola, useEstadoOffline,
} from "@/lib/offline/estado";

/**
 * Barra de estado offline y arranque del modo sin conexión.
 *
 * Vive en el layout de la app, no en la pantalla de venta: una vez que hay
 * ventas en la cola, el vendedor tiene que verlo esté donde esté. Que la cola
 * quede invisible al navegar a otra pantalla es exactamente cómo se pierde
 * plata sin que nadie se entere.
 */
export function BarraOffline() {
  const { conectado, verificado, pendientes, sincronizando, rechazadas, avisos } = useEstadoOffline();
  const [, arranca] = useTransition();
  const [swListo, setSwListo] = useState(false);

  useEffect(() => {
    void iniciarOffline();

    // El service worker es lo que permite ABRIR /vender sin conexión. Sin él,
    // la cola offline serviría de poco: no habría pantalla donde usarla.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then(() => setSwListo(true))
        .catch(() => {
          // Contexto no seguro (http sin localhost) o SW deshabilitado. La app
          // online no se ve afectada.
        });
    }
  }, [arranca]);

  async function sincronizarAhora() {
    const resumen = await sincronizarCola();
    if (!resumen) {
      toast.error("No se pudo conectar con el servidor. Se reintenta solo.");
      return;
    }
    if (resumen.sincronizadas > 0) {
      toast.success(`${number(resumen.sincronizadas)} venta(s) sincronizada(s).`);
    }
    if (resumen.rechazadas > 0) {
      toast.error(`${number(resumen.rechazadas)} venta(s) no se pudieron registrar. Revisá el detalle.`);
    }
  }

  async function descargarRespaldo() {
    const res = await exportarRespaldo();
    if (!res.ok) {
      toast.error("No se pudo generar el respaldo.");
      return;
    }
    toast.success(`Respaldo de ${number(res.ventas)} venta(s) descargado. Guardalo hasta que sincronicen.`);
  }

  const hayReportes = rechazadas.length > 0 || avisos.length > 0;
  if (!verificado && pendientes === 0 && !hayReportes) return null;
  if (conectado && pendientes === 0 && !hayReportes) return null;

  return (
    <div className="space-y-3">
      {(!conectado || pendientes > 0) && (
        <div
          role="status"
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm",
            conectado ? "border-chart-3/40 bg-chart-3/10" : "border-destructive/30 bg-destructive/10",
          )}
        >
          <span>
            {conectado ? (
              <>Hay <strong>{number(pendientes)}</strong> venta(s) sin sincronizar.</>
            ) : (
              <>
                <strong>Sin conexión.</strong> Podés seguir vendiendo: las ventas quedan
                guardadas en este dispositivo
                {pendientes > 0 && <> ({number(pendientes)} pendiente(s))</>}.
              </>
            )}
          </span>
          <span className="flex shrink-0 gap-2">
            {/* Bajar el respaldo tiene que poder hacerse SIN conexión: es la
                defensa contra que el navegador borre la cola, y ese riesgo
                existe justamente durante el corte. */}
            {pendientes > 0 && (
              <Button size="sm" variant="ghost" onClick={descargarRespaldo}>
                Descargar respaldo
              </Button>
            )}
            {conectado && pendientes > 0 && (
              <Button size="sm" variant="outline" disabled={sincronizando} onClick={sincronizarAhora}>
                {sincronizando ? "Sincronizando…" : "Sincronizar ahora"}
              </Button>
            )}
          </span>
        </div>
      )}

      {rechazadas.length > 0 && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm"
        >
          <span>
            <strong>{number(rechazadas.length)} venta(s) cobradas no quedaron registradas.</strong>{" "}
            Hay que cargarlas a mano.
          </span>
          <Button asChild size="sm" variant="outline" className="shrink-0">
            <Link href="/vender/revision">Ver detalle</Link>
          </Button>
        </div>
      )}

      {avisos.length > 0 && (
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm shadow-xs">
          <div className="flex items-center justify-between gap-3">
            <strong>Avisos de la última sincronización</strong>
            <Button size="sm" variant="ghost" onClick={limpiarAvisos}>Entendido</Button>
          </div>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {avisos.map((a) => (
              <li key={a.uid}>
                {a.saleId ? `Venta #${a.saleId}: ` : ""}{a.avisos.join(" ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!swListo && !conectado && (
        <p className="text-xs text-muted-foreground">
          Este dispositivo todavía no guardó la app para usarse sin conexión.
        </p>
      )}
    </div>
  );
}
