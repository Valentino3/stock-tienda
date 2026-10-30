"use client";
import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/utils";

/**
 * Motivo de una anulación: de un plato ya mandado o de la mesa entera.
 *
 * Una lista corta antes que un campo libre: en el medio del servicio nadie
 * escribe, y un «asdf» como motivo es lo mismo que no tener motivo. «Otro»
 * queda para lo que la lista no cubre.
 */
const MOTIVOS = [
  "Error de carga",
  "El cliente cambió",
  "Demora",
  "Devuelto a cocina",
  "Cortesía de la casa",
] as const;
const OTRO = "Otro";

export type ResultadoMotivo = { cantidad: number; motivo: string; wasted: boolean };

export function MotivoDialog({
  titulo, descripcion, maxCantidad, requiereMotivo = true, textoConfirmar, pending, error,
  onConfirmar, onCerrar,
}: {
  titulo: string;
  descripcion: string;
  /** Si es mayor a 1, se puede elegir cuántas unidades anular. */
  maxCantidad?: number;
  /** Una mesa sin nada en la cocina se cancela sin motivo. */
  requiereMotivo?: boolean;
  textoConfirmar: string;
  pending: boolean;
  error: string;
  onConfirmar: (r: ResultadoMotivo) => void;
  onCerrar: () => void;
}) {
  const [cantidad, setCantidad] = useState(maxCantidad ?? 1);
  const [elegido, setElegido] = useState<string>("");
  const [otro, setOtro] = useState("");
  const [wasted, setWasted] = useState(false);

  const motivo = elegido === OTRO ? otro.trim() : elegido;
  const listo = !requiereMotivo || motivo.length >= 3;

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descripcion}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (listo) onConfirmar({ cantidad, motivo, wasted });
          }}
        >
          {maxCantidad != null && maxCantidad > 1 && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">Cuántos</span>
              <div className="flex items-center gap-2">
                <Button
                  type="button" variant="outline" size="icon" className="size-11"
                  aria-label="Uno menos" disabled={cantidad <= 1}
                  onClick={() => setCantidad((c) => Math.max(1, c - 1))}
                >
                  <Minus className="size-4" />
                </Button>
                <span className="figure w-8 text-center text-lg font-semibold" aria-live="polite">
                  {cantidad}
                </span>
                <Button
                  type="button" variant="outline" size="icon" className="size-11"
                  aria-label="Uno más" disabled={cantidad >= maxCantidad}
                  onClick={() => setCantidad((c) => Math.min(maxCantidad, c + 1))}
                >
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>
          )}

          {requiereMotivo && (
            <fieldset className="space-y-2">
              <legend className="ledger-label mb-1">Motivo</legend>
              <div className="grid grid-cols-2 gap-2">
                {[...MOTIVOS, OTRO].map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={elegido === m}
                    onClick={() => setElegido(m)}
                    className={cn(
                      "min-h-11 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      elegido === m
                        ? "border-brand bg-brand text-brand-foreground"
                        : "border-border hover:bg-accent",
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
              {elegido === OTRO && (
                <Input
                  autoFocus
                  value={otro}
                  onChange={(e) => setOtro(e.target.value)}
                  placeholder="¿Qué pasó?"
                  aria-label="Otro motivo"
                />
              )}
            </fieldset>
          )}

          {requiereMotivo && (
            // Si se llegó a preparar, es mercadería perdida: el dueño la quiere
            // ver aparte de lo que se anuló antes de tocar la plancha.
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" checked={wasted} onChange={(e) => setWasted(e.target.checked)} />
              Ya se había preparado (se tira)
            </label>
          )}

          {error && <div role="alert"><Notice tone="danger">{error}</Notice></div>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCerrar}>Volver</Button>
            <Button type="submit" variant="destructive" disabled={pending || !listo}>
              {pending ? "Anulando…" : textoConfirmar}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
