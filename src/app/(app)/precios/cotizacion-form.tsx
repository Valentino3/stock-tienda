"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { money } from "@/lib/format";
import { PASOS_REDONDEO, precioDesdeUsd, esCotizacionValida } from "@/domain/pricing-usd";
import { guardarCotizacion } from "./actions";

/**
 * Cotización y reglas de conversión.
 *
 * Guardar acá NO cambia ningún precio: solo describe cómo se van a calcular.
 * El ejemplo en vivo es la pieza que más rinde de todo el formulario — es el
 * redondeo explicándose solo, con la cotización que el dueño está tipeando.
 */

const USD_EJEMPLO = 58.9;

export function CotizacionForm({ inicial }: {
  inicial: {
    usdRate: number | null;
    roundingMode: string;
    roundingStep: number;
    cashPct: number | null;
    wholesalePct: number | null;
  };
}) {
  const [pending, startTransition] = useTransition();
  const [usdRate, setUsdRate] = useState(inicial.usdRate != null ? String(inicial.usdRate) : "");
  const [mode, setMode] = useState(inicial.roundingMode);
  const [step, setStep] = useState(String(inicial.roundingStep));
  const [cashPct, setCashPct] = useState(inicial.cashPct != null ? String(inicial.cashPct) : "");
  const [wholesalePct, setWholesalePct] = useState(
    inicial.wholesalePct != null ? String(inicial.wholesalePct) : ""
  );

  const cotizacion = Number(usdRate);
  // El ejemplo se calcula con la MISMA función que escribe la base: si alguna
  // vez divergieran, el dueño vería un número en pantalla y otro en el catálogo.
  const ejemplo = esCotizacionValida(cotizacion)
    ? precioDesdeUsd(USD_EJEMPLO, cotizacion, { mode: mode as "nearest" | "up", step: Number(step) })
    : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await guardarCotizacion({
        usdRate: usdRate === "" ? null : Number(usdRate),
        roundingMode: mode,
        roundingStep: Number(step),
        cashPct: cashPct === "" ? null : Number(cashPct),
        wholesalePct: wholesalePct === "" ? null : Number(wholesalePct),
      });
      if ("error" in res) { toast.error(res.error); return; }
      toast.success("Cotización guardada. Todavía no se cambió ningún precio.");
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <div className="space-y-2">
          <Label htmlFor="usd-rate">Cotización del dólar</Label>
          <Input
            id="usd-rate" type="number" step="0.01" min="0" inputMode="decimal"
            value={usdRate} onChange={(e) => setUsdRate(e.target.value)} placeholder="1480"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="rounding-mode">Redondeo</Label>
            <Select id="rounding-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="nearest">Al más cercano</option>
              <option value="up">Siempre para arriba</option>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rounding-step">Múltiplo</Label>
            <Select id="rounding-step" value={step} onChange={(e) => setStep(e.target.value)}>
              {PASOS_REDONDEO.map((p) => (
                <option key={p} value={p}>{p === 1 ? "Al peso" : `De a ${p}`}</option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      {ejemplo != null && (
        <p className="figure rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
          US$ {USD_EJEMPLO} × {usdRate} = {money(USD_EJEMPLO * cotizacion)} →{" "}
          <strong>{money(ejemplo)}</strong>
        </p>
      )}

      <fieldset className="space-y-3 rounded-lg border border-border p-3">
        <legend className="px-1 text-xs font-medium text-muted-foreground">
          Listas de precio (vacío = no se tocan)
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="cash-pct">Efectivo menor</Label>
            <div className="flex items-center gap-2">
              <Input
                id="cash-pct" type="number" step="0.01" min="0" max="99.99" className="w-24"
                value={cashPct} onChange={(e) => setCashPct(e.target.value)} placeholder="—"
              />
              <span className="text-sm text-muted-foreground">% menos que el precio de venta</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="wholesale-pct">Mayorista</Label>
            <div className="flex items-center gap-2">
              <Input
                id="wholesale-pct" type="number" step="0.01" min="0" max="99.99" className="w-24"
                value={wholesalePct} onChange={(e) => setWholesalePct(e.target.value)} placeholder="—"
              />
              <span className="text-sm text-muted-foreground">% menos que el precio de venta</span>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Solo se recalculan las listas que el artículo ya tenía cargadas. A lo
          que hoy no tiene precio de efectivo o mayorista no se le inventa uno:
          eso cambiaría lo que la caja puede cobrar.
        </p>
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : "Guardar"}
      </Button>
    </form>
  );
}
