"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTransition } from "react";
import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import type { FloorMarkerType } from "@/db/schema";
import type { PlanoDelSector } from "@/domain/floor-plan";
import type { OrdenViva } from "@/domain/orders";
import { abrirMesa } from "./actions";

/**
 * El salón dibujado: mismo plano que armó el dueño, coloreado por estado.
 *
 * Solo lectura. Acomodar el salón es configuración y vive en /mesas; acá el
 * mozo toca una mesa y entra a su comanda.
 *
 * Es la vista de escritorio. En el teléfono manda la grilla de tarjetas
 * (salon-client.tsx): arrastrar y apuntar cajitas de 12% en una pantalla de
 * cinco pulgadas es peor que una lista ordenada por tiempo de espera.
 */

const ETIQUETA_MARCADOR: Record<FloorMarkerType, string> = {
  puerta: "Puerta", pared: "Pared", ventana: "Ventana", barra: "Barra",
};

const CLASES_MARCADOR: Record<FloorMarkerType, string> = {
  pared: "border-foreground/30 bg-foreground/70 text-background",
  ventana: "border-brand/40 bg-brand-muted text-brand",
  puerta: "border-chart-3/50 bg-chart-3/15 text-foreground",
  barra: "border-border bg-muted text-foreground",
};

function espera(desde: Date | string): string {
  const min = Math.max(0, Math.floor((Date.now() - new Date(desde).getTime()) / 60000));
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`;
}

export function PlanoSalon({
  plano, ordenes,
}: {
  plano: PlanoDelSector[];
  ordenes: OrdenViva[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sector, setSector] = useState(plano[0]?.sector ?? "Salón");
  const actual = plano.find((p) => p.sector === sector) ?? plano[0];

  const porMesa = new Map(
    ordenes.flatMap((o) => (o.tableId != null ? [[o.tableId, o] as const] : [])),
  );

  function tocar(tableId: number) {
    const orden = porMesa.get(tableId);
    if (orden) {
      router.push(`/salon/${orden.id}`);
      return;
    }
    startTransition(async () => {
      const res = await abrirMesa(tableId);
      if ("error" in res && res.error) {
        toast.error(res.error);
        // Otro mozo pudo haber ganado la mesa mientras tanto.
        router.refresh();
        return;
      }
      if ("ok" in res) router.push(`/salon/${res.orderId}`);
    });
  }

  if (!actual) return null;

  return (
    <div className="space-y-3">
      {plano.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {plano.map((p) => (
            <button
              key={p.sector}
              type="button"
              onClick={() => setSector(p.sector)}
              aria-pressed={p.sector === sector}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                p.sector === sector
                  ? "border-brand bg-brand text-brand-foreground"
                  : "border-border hover:bg-accent",
              )}
            >
              {p.sector}
            </button>
          ))}
        </div>
      )}

      <div data-lienzo className="relative aspect-4/3 w-full overflow-hidden rounded-xl border border-border bg-muted/30">
        {actual.marcadores.map((m) => (
          <div
            key={`k${m.id}`}
            data-marcador={m.id}
            style={{
              left: `${m.floorX}%`, top: `${m.floorY}%`,
              width: `${m.floorWidth}%`, height: `${m.floorHeight}%`,
            }}
            className={cn(
              "absolute flex items-center justify-center rounded border text-[10px]",
              CLASES_MARCADOR[m.type],
            )}
          >
            <span className="truncate px-1">{m.label || ETIQUETA_MARCADOR[m.type]}</span>
          </div>
        ))}

        {actual.mesas.map((m) => {
          const orden = porMesa.get(m.id);
          const ocupada = orden != null;
          return (
            <button
              key={m.id}
              data-mesa={m.id}
              type="button"
              disabled={pending}
              onClick={() => tocar(m.id)}
              style={{
                left: `${m.floorX ?? 0}%`, top: `${m.floorY ?? 0}%`,
                width: `${m.floorWidth ?? 12}%`, height: `${m.floorHeight ?? 14}%`,
              }}
              className={cn(
                "absolute flex flex-col items-center justify-center gap-0.5 border-2 p-1 text-sm font-semibold transition-colors disabled:opacity-60",
                m.shape === "circle" ? "rounded-full" : "rounded-lg",
                ocupada
                  ? "border-chart-3/50 bg-chart-3/15 hover:bg-chart-3/25"
                  : "border-border bg-card hover:bg-accent",
              )}
            >
              <span className="leading-none">{m.name}</span>
              {ocupada ? (
                <>
                  <span className="figure text-[11px] leading-none font-normal">
                    {money(orden.total)}
                  </span>
                  <span className="ledger-label leading-none text-muted-foreground">
                    {espera(orden.openedAt)}
                  </span>
                </>
              ) : (
                m.capacity != null && (
                  <span className="ledger-label leading-none text-muted-foreground">
                    {m.capacity}
                  </span>
                )
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
