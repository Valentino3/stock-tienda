"use client";
import { useRef, useState, useTransition, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/utils";
import type { FloorMarkerType } from "@/db/schema";
import type { PlanoDelSector } from "@/domain/floor-plan";
import {
  acomodarPlano, agregarMarcador, moverMarcadorEnPlano, moverMesaEnPlano, quitarMarcador,
} from "../salon/actions";

/**
 * Editor del plano: se arrastran las mesas para que el dibujo se parezca al
 * salón real.
 *
 * Portado del editor de olivas-help, con tres cosas cambiadas:
 *
 *  1. La posición se acota TAMBIÉN en el servidor (ver acotarGeometria). El
 *     original acotaba solo acá y con un ancho sin validar, así que un ancho
 *     mayor a 100 dejaba la mesa dibujada fuera de la pantalla.
 *  2. No hay `router.refresh()` al soltar. El original hacía un refetch
 *     completo del RSC por cada mesa movida; el estado local ya alcanza.
 *  3. Se puede redimensionar. El original solo arrastraba: el tamaño salía de
 *     la base y no tenía interfaz.
 *
 * Las coordenadas van en porcentaje del lienzo, así el mismo plano sirve en
 * cualquier pantalla.
 */

type Arrastre = {
  clase: "mesa" | "marcador";
  id: number;
  pointerId: number;
  modo: "mover" | "redimensionar";
  /** Distancia entre el puntero y el origen del elemento, en % del lienzo. */
  dx: number;
  dy: number;
};

type Geo = { floorX: number; floorY: number; floorWidth: number; floorHeight: number };

const MIN_LADO = 4;
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

const ETIQUETA_MARCADOR: Record<FloorMarkerType, string> = {
  puerta: "Puerta",
  pared: "Pared",
  ventana: "Ventana",
  barra: "Barra",
};

/**
 * Colores de las referencias.
 *
 * Van por tokens y no por la paleta cruda de Tailwind, que es lo que hacía el
 * original (`bg-slate-800`, `bg-sky-50`, `bg-emerald-50`): en este repo el
 * verde y el rojo tienen significado reservado y la marca vive en detalles.
 */
const CLASES_MARCADOR: Record<FloorMarkerType, string> = {
  pared: "border-foreground/30 bg-foreground/70 text-background",
  ventana: "border-brand/40 bg-brand-muted text-brand",
  puerta: "border-chart-3/50 bg-chart-3/15 text-foreground",
  barra: "border-border bg-muted text-foreground",
};

const clave = (clase: "mesa" | "marcador", id: number) => `${clase}:${id}`;

export function PlanoEditor({ plano }: { plano: PlanoDelSector[] }) {
  const router = useRouter();
  const lienzoRef = useRef<HTMLDivElement>(null);
  const arrastreRef = useRef<Arrastre | null>(null);
  const [, startTransition] = useTransition();

  const sectores = plano.map((p) => p.sector);
  const [sector, setSector] = useState(sectores[0] ?? "Salón");
  const actual = plano.find((p) => p.sector === sector) ?? plano[0];

  /**
   * Geometría en curso, como SOBRESCRITURAS de lo que dice la base.
   *
   * No es una copia del plano: si lo fuera, habría que sincronizarla cada vez
   * que el servidor devuelve datos nuevos, y algo agregado después de montar
   * —una puerta recién creada— no tendría entrada. Leerlo con respaldo en la
   * fila hace que ese caso no exista.
   */
  const [geo, setGeo] = useState<Record<string, Geo>>({});

  const geoDe = (
    clase: "mesa" | "marcador",
    fila: { id: number; floorX: number | null; floorY: number | null; floorWidth: number | null; floorHeight: number | null },
  ): Geo =>
    geo[clave(clase, fila.id)] ?? {
      floorX: fila.floorX ?? 0,
      floorY: fila.floorY ?? 0,
      floorWidth: fila.floorWidth ?? 12,
      floorHeight: fila.floorHeight ?? 14,
    };

  const [guardando, setGuardando] = useState<string | null>(null);
  const [error, setError] = useState("");

  function posicionDelPuntero(e: PointerEvent) {
    const rect = lienzoRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    };
  }

  function alApretar(
    e: PointerEvent<HTMLElement>,
    clase: "mesa" | "marcador",
    id: number,
    modo: "mover" | "redimensionar",
  ) {
    e.preventDefault();
    e.stopPropagation();
    const p = posicionDelPuntero(e);
    const fila = filaDe(clase, id);
    if (!p || !fila) return;
    const g = geoDe(clase, fila);

    e.currentTarget.setPointerCapture(e.pointerId);
    arrastreRef.current = {
      clase, id, modo, pointerId: e.pointerId,
      dx: modo === "mover" ? p.x - g.floorX : p.x - (g.floorX + g.floorWidth),
      dy: modo === "mover" ? p.y - g.floorY : p.y - (g.floorY + g.floorHeight),
    };
  }

  /** Busca la fila en el sector visible. */
  function filaDe(clase: "mesa" | "marcador", id: number) {
    const s = plano.find((x) => x.sector === sector) ?? plano[0];
    return clase === "mesa"
      ? s?.mesas.find((m) => m.id === id)
      : s?.marcadores.find((m) => m.id === id);
  }

  /** Calcula la geometría nueva. Misma cuenta al mover y al soltar. */
  function geometriaNueva(a: Arrastre, p: { x: number; y: number }): Geo | null {
    const fila = filaDe(a.clase, a.id);
    if (!fila) return null;
    const g = geoDe(a.clase, fila);
    if (a.modo === "mover") {
      return {
        ...g,
        floorX: clamp(p.x - a.dx, 0, 100 - g.floorWidth),
        floorY: clamp(p.y - a.dy, 0, 100 - g.floorHeight),
      };
    }
    return {
      ...g,
      floorWidth: clamp(p.x - a.dx - g.floorX, MIN_LADO, 100 - g.floorX),
      floorHeight: clamp(p.y - a.dy - g.floorY, MIN_LADO, 100 - g.floorY),
    };
  }

  function alMover(e: PointerEvent<HTMLElement>) {
    const a = arrastreRef.current;
    if (!a) return;
    const p = posicionDelPuntero(e);
    if (!p) return;
    const g = geometriaNueva(a, p);
    if (!g) return;
    e.preventDefault();
    setGeo((prev) => ({ ...prev, [clave(a.clase, a.id)]: g }));
  }

  function alSoltar(e: PointerEvent<HTMLElement>) {
    const a = arrastreRef.current;
    if (!a || a.pointerId !== e.pointerId) return;
    arrastreRef.current = null;

    const p = posicionDelPuntero(e);
    if (!p) return;
    e.preventDefault();

    const k = clave(a.clase, a.id);
    const g = geometriaNueva(a, p);
    if (!g) return;
    setGeo((prev) => ({ ...prev, [k]: g }));
    setGuardando(k);

    startTransition(async () => {
      const res = a.clase === "mesa"
        ? await moverMesaEnPlano(a.id, g)
        : await moverMarcadorEnPlano(a.id, g);
      setGuardando(null);
      if ("error" in res && res.error) {
        setError(res.error);
        // El servidor rechazó: se recarga para no dejar la pantalla mostrando
        // una posición que no quedó guardada.
        router.refresh();
      }
    });
  }

  function conAccion(fn: () => Promise<{ error?: string } | { ok: true }>) {
    setError("");
    startTransition(async () => {
      const res = await fn();
      if ("error" in res && res.error) setError(res.error);
      else router.refresh();
    });
  }

  if (!actual) {
    return (
      <Notice tone="info">
        Cargá las mesas del local y después acomodalas acá.
      </Notice>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {sectores.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSector(s)}
            aria-pressed={s === sector}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-sm transition-colors",
              s === sector ? "border-brand bg-brand text-brand-foreground" : "border-border hover:bg-accent",
            )}
          >
            {s}
          </button>
        ))}

        <span className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => conAccion(acomodarPlano)}>
            Acomodar sin ubicar
          </Button>
          {(Object.keys(ETIQUETA_MARCADOR) as FloorMarkerType[]).map((t) => (
            <Button
              key={t} size="sm" variant="ghost"
              onClick={() => conAccion(() => agregarMarcador(t, sector))}
            >
              + {ETIQUETA_MARCADOR[t]}
            </Button>
          ))}
        </span>
      </div>

      {error && <div role="alert"><Notice tone="danger">{error}</Notice></div>}

      <p className="text-sm text-muted-foreground">
        Arrastrá para mover. La esquina de abajo a la derecha cambia el tamaño.
      </p>

      <div
        ref={lienzoRef}
        // touch-none: sin esto el navegador interpreta el arrastre como scroll
        // y en un teléfono no se puede mover nada.
        data-lienzo
        className="relative aspect-4/3 w-full touch-none overflow-hidden rounded-xl border border-border bg-muted/30"
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerCancel={alSoltar}
      >
        {actual.marcadores.map((m) => {
          const g = geoDe("marcador", m);
          return (
            <div
              key={`marcador-${m.id}`}
              data-marcador={m.id}
              data-guardando={guardando === clave("marcador", m.id) || undefined}
              onPointerDown={(e) => alApretar(e, "marcador", m.id, "mover")}
              style={{
                left: `${g.floorX}%`, top: `${g.floorY}%`,
                width: `${g.floorWidth}%`, height: `${g.floorHeight}%`,
              }}
              className={cn(
                "absolute flex cursor-grab items-center justify-center rounded border text-[10px] select-none",
                CLASES_MARCADOR[m.type],
                guardando === clave("marcador", m.id) && "opacity-60",
              )}
            >
              <span className="truncate px-1">{m.label || ETIQUETA_MARCADOR[m.type]}</span>
              <button
                type="button"
                aria-label={`Quitar ${ETIQUETA_MARCADOR[m.type]}`}
                className="absolute -top-2 -right-2 rounded-full border border-border bg-card p-0.5 text-muted-foreground hover:text-destructive"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => conAccion(() => quitarMarcador(m.id))}
              >
                <Trash2 className="size-3" />
              </button>
              <Manija onPointerDown={(e) => alApretar(e, "marcador", m.id, "redimensionar")} />
            </div>
          );
        })}

        {actual.mesas.map((m) => {
          const g = geoDe("mesa", m);
          return (
            <div
              key={`mesa-${m.id}`}
              data-mesa={m.id}
              data-guardando={guardando === clave("mesa", m.id) || undefined}
              onPointerDown={(e) => alApretar(e, "mesa", m.id, "mover")}
              style={{
                left: `${g.floorX}%`, top: `${g.floorY}%`,
                width: `${g.floorWidth}%`, height: `${g.floorHeight}%`,
              }}
              className={cn(
                "absolute flex cursor-grab flex-col items-center justify-center border-2 border-border bg-card text-sm font-semibold shadow-xs select-none",
                m.shape === "circle" ? "rounded-full" : "rounded-lg",
                guardando === clave("mesa", m.id) && "opacity-60",
              )}
            >
              <span>{m.name}</span>
              {m.capacity != null && (
                <span className="ledger-label text-muted-foreground">{m.capacity}</span>
              )}
              <Manija onPointerDown={(e) => alApretar(e, "mesa", m.id, "redimensionar")} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Esquina para redimensionar. */
function Manija({ onPointerDown }: { onPointerDown: (e: PointerEvent<HTMLElement>) => void }) {
  return (
    <span
      role="button"
      aria-label="Cambiar tamaño"
      tabIndex={-1}
      onPointerDown={onPointerDown}
      className="absolute right-0 bottom-0 size-3 cursor-se-resize rounded-tl border-t border-l border-border bg-background/80"
    />
  );
}
