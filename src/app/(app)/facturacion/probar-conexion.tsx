"use client";
import { useState, useTransition } from "react";
import { Check, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

type Paso = { nombre: string; ok: boolean; detalle: string };

/**
 * La herramienta más útil de la pantalla: convierte un "no anda" en una línea
 * concreta que falla. Cada paso reporta su propio resultado en vez de que un
 * error único tape cuál de los tres es el problema.
 */
export function ProbarConexion({ listo }: { listo: boolean }) {
  const [pasos, setPasos] = useState<Paso[] | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function probar() {
    setError("");
    setPasos(null);
    startTransition(async () => {
      try {
        const res = await fetch("/facturacion/probar", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error ?? "No se pudo probar la conexión.");
          return;
        }
        setPasos(data.pasos ?? []);
      } catch {
        setError("No se pudo contactar al servidor. Probá de nuevo.");
      }
    });
  }

  return (
    <section className="space-y-3">
      <p className="ledger-label">Probar conexión</p>
      <div className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Verifica contra ARCA que el certificado, la delegación del servicio y el punto de venta
            estén bien. No emite ningún comprobante.
          </p>
          <Button onClick={probar} disabled={pending || !listo} variant="outline">
            {pending ? <><Loader2 className="size-4 animate-spin" /> Probando…</> : "Probar conexión"}
          </Button>
        </div>

        {!listo && (
          <p className="text-xs text-muted-foreground">
            Primero cargá los datos del emisor, activá la facturación y subí el certificado.
          </p>
        )}

        {error && <Notice tone="danger">{error}</Notice>}

        {pasos && (
          <ul className="space-y-2.5 border-t pt-4">
            {pasos.map((p) => (
              <li key={p.nombre} className="flex items-start gap-2.5 text-sm">
                {p.ok
                  ? <Check className="mt-0.5 size-4 shrink-0 text-success" />
                  : <X className="mt-0.5 size-4 shrink-0 text-destructive" />}
                <span>
                  <span className="font-medium">{p.nombre}</span>
                  <span className="block text-xs text-muted-foreground">{p.detalle}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
