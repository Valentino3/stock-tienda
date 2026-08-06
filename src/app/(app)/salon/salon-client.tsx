"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import { abrirMesa } from "./actions";

type OrdenViva = {
  id: number;
  status: string;
  total: number;
  openedAt: Date;
  guests: number | null;
  tableId: number | null;
  tableName: string | null;
  sector: string | null;
};

type MesaConOrden = {
  mesa: { id: number; name: string; sector: string; capacity: number | null };
  orden: OrdenViva | null;
};

/** Cuánto hace que está abierta, para saber a quién atender primero. */
function espera(desde: Date): string {
  const min = Math.max(0, Math.floor((Date.now() - new Date(desde).getTime()) / 60000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

/**
 * Grilla de mesas por sector y sección de pedidos sin mesa.
 *
 * Van separadas porque la página las ubica distinto: en pantalla grande la
 * grilla se reemplaza por el plano, pero los pedidos de mostrador no entran en
 * un plano y se muestran en los dos casos. Con un solo componente, la sección
 * de mostrador terminaba renderizada dos veces en el DOM.
 */
export function SalonClient({
  mesas, deMostrador, soloMesas = false, soloMostrador = false,
}: {
  mesas: MesaConOrden[];
  deMostrador: OrdenViva[];
  soloMesas?: boolean;
  soloMostrador?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [abriendo, setAbriendo] = useState<number | null>(null);

  function abrir(tableId: number | null) {
    setAbriendo(tableId ?? -1);
    startTransition(async () => {
      const res = await abrirMesa(tableId);
      setAbriendo(null);
      if ("error" in res && res.error) {
        toast.error(res.error);
        // Otro mozo ganó la carrera por esa mesa: se refresca para mostrar la
        // comanda que sí existe, en vez de dejar la pantalla mintiendo.
        router.refresh();
        return;
      }
      if ("ok" in res) router.push(`/salon/${res.orderId}`);
    });
  }

  // Agrupadas por sector, que es como el mozo piensa el salón.
  const sectores = [...new Set(mesas.map((m) => m.mesa.sector))].sort();

  return (
    <div className="space-y-8">
      {!soloMostrador && sectores.map((sector) => (
        <Section key={sector} label={sector}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {mesas.filter((m) => m.mesa.sector === sector).map(({ mesa, orden }) => {
              const ocupada = orden != null;
              return (
                <button
                  key={mesa.id}
                  type="button"
                  disabled={pending}
                  onClick={() => (ocupada ? router.push(`/salon/${orden.id}`) : abrir(mesa.id))}
                  className={cn(
                    "flex min-h-24 flex-col items-start gap-1 rounded-xl border px-4 py-3 text-left transition-colors",
                    "disabled:opacity-60",
                    ocupada
                      ? "border-chart-3/40 bg-chart-3/10 hover:bg-chart-3/20"
                      : "border-border bg-card hover:bg-accent",
                  )}
                >
                  <span className="text-base font-semibold">{mesa.name}</span>
                  {ocupada ? (
                    <>
                      <span className="figure text-sm">{money(orden.total)}</span>
                      <span className="ledger-label text-muted-foreground">
                        {espera(orden.openedAt)}
                        {orden.status === "a_cobrar" && " · pago parcial"}
                      </span>
                    </>
                  ) : (
                    <span className="ledger-label text-muted-foreground">
                      Libre{mesa.capacity ? ` · ${mesa.capacity}` : ""}
                      {abriendo === mesa.id && " · abriendo…"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Section>
      ))}

      {!soloMesas && (
      <Section label="Mostrador y para llevar">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {deMostrador.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => router.push(`/salon/${o.id}`)}
              className="flex min-h-24 flex-col items-start gap-1 rounded-xl border border-chart-3/40 bg-chart-3/10 px-4 py-3 text-left transition-colors hover:bg-chart-3/20"
            >
              <span className="text-base font-semibold">Pedido #{o.id}</span>
              <span className="figure text-sm">{money(o.total)}</span>
              <span className="ledger-label text-muted-foreground">{espera(o.openedAt)}</span>
            </button>
          ))}
          <Button
            type="button"
            variant="outline"
            className="min-h-24 rounded-xl border-dashed"
            disabled={pending}
            onClick={() => abrir(null)}
          >
            {abriendo === -1 ? "Abriendo…" : "+ Pedido sin mesa"}
          </Button>
        </div>
      </Section>
      )}
    </div>
  );
}
