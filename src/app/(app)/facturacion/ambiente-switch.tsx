"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ArcaAmbiente } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { formatearCuit, normalizarDoc } from "@/domain/fiscal-catalogs";
import { cambiarAmbienteAction } from "./actions";

/**
 * Pasar a producción no es un radio button: a partir de ahí cada factura es un
 * comprobante fiscal real e irreversible. Se exige, en orden, tener el
 * certificado de producción cargado y escribir el CUIT para confirmar.
 */
export function AmbienteSwitch({
  ambiente,
  cuit,
  hayCertProduccion,
  produccionHabilitadaEnServidor,
}: {
  ambiente: ArcaAmbiente;
  cuit: string | null;
  hayCertProduccion: boolean;
  produccionHabilitadaEnServidor: boolean;
}) {
  const router = useRouter();
  const [confirmacion, setConfirmacion] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const cuitNormalizado = normalizarDoc(cuit);
  const confirmado = cuitNormalizado != null && normalizarDoc(confirmacion) === cuitNormalizado;

  function cambiar(destino: ArcaAmbiente) {
    setError("");
    startTransition(async () => {
      const res = await cambiarAmbienteAction(destino);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setConfirmacion("");
      toast.success(destino === "produccion" ? "Facturación en producción" : "Volviste a modo de prueba");
      router.refresh();
    });
  }

  if (ambiente === "produccion") {
    return (
      <section className="space-y-3">
        <p className="ledger-label">Ambiente</p>
        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          <p className="text-sm">
            Estás emitiendo <strong>comprobantes fiscales reales</strong> ante ARCA.
          </p>
          <p className="text-sm text-muted-foreground">
            Podés volver a modo de prueba si necesitás probar algo. Los comprobantes ya emitidos en
            producción no se tocan, y la numeración de cada ambiente sigue por separado.
          </p>
          {error && <Notice tone="danger">{error}</Notice>}
          <Button variant="outline" onClick={() => cambiar("homologacion")} disabled={pending}>
            Volver a modo de prueba
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <p className="ledger-label">Pasar a producción</p>
      <div className="space-y-4 rounded-xl border border-border bg-card p-5">
        <ol className="space-y-2 text-sm">
          <li className="flex gap-2">
            <span className={produccionHabilitadaEnServidor ? "text-success" : "text-destructive"}>
              {produccionHabilitadaEnServidor ? "✓" : "✗"}
            </span>
            <span>
              El servidor permite producción
              {!produccionHabilitadaEnServidor && (
                <span className="block text-xs text-muted-foreground">
                  Falta <code>ARCA_ALLOW_PRODUCCION</code>. Avisale a quien administra el sistema.
                  Es la guarda que impide que un entorno de prueba emita comprobantes reales.
                </span>
              )}
            </span>
          </li>
          <li className="flex gap-2">
            <span className={hayCertProduccion ? "text-success" : "text-destructive"}>
              {hayCertProduccion ? "✓" : "✗"}
            </span>
            <span>
              Certificado de producción cargado
              {!hayCertProduccion && (
                <span className="block text-xs text-muted-foreground">
                  Es un certificado <strong>distinto</strong> al de homologación, con su propia
                  delegación del servicio wsfe. Cambiá el ambiente para poder subirlo.
                </span>
              )}
            </span>
          </li>
          <li className="flex gap-2">
            <span className={confirmado ? "text-success" : "text-muted-foreground"}>
              {confirmado ? "✓" : "○"}
            </span>
            <span>Confirmación escrita</span>
          </li>
        </ol>

        <Notice tone="warn">
          A partir de que actives producción, <strong>cada factura que emitas es un comprobante
          fiscal real ante ARCA y no se puede borrar</strong> — solo se anula con una nota de crédito.
        </Notice>

        <div className="space-y-1.5">
          <Label htmlFor="confirmar-cuit">
            Escribí el CUIT del comercio para confirmar{cuitNormalizado && ` (${formatearCuit(cuitNormalizado)})`}
          </Label>
          <Input
            id="confirmar-cuit" inputMode="numeric" placeholder="30707429530"
            value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)}
            disabled={!cuitNormalizado}
          />
        </div>

        {error && <Notice tone="danger">{error}</Notice>}

        <Button
          onClick={() => cambiar("produccion")}
          disabled={pending || !confirmado || !hayCertProduccion || !produccionHabilitadaEnServidor}
        >
          {pending ? "Cambiando…" : "Activar producción"}
        </Button>
      </div>
    </section>
  );
}
