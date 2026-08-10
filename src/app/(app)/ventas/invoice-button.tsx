"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

export type ComprobanteResumen = {
  id: number;
  clase: "factura" | "nota_credito";
  estado: "pendiente" | "autorizado" | "rechazado" | "error";
  etiqueta: string;
  cae: string | null;
  caeVto: string | null;
  ambiente: "homologacion" | "produccion";
  observaciones: string;
  errorMsg: string | null;
};

/**
 * Emisión de la factura de una venta.
 *
 * Sin UI optimista a propósito: esto es plata y un comprobante autorizado no se
 * puede borrar. Se muestra lo que pasó, no lo que esperamos que pase.
 */
export function InvoiceButton({
  saleId,
  inicial,
  puedeEmitir,
  puedeAnular,
  ventaAnulada,
}: {
  saleId: number;
  inicial: ComprobanteResumen[];
  puedeEmitir: boolean;
  puedeAnular: boolean;
  ventaAnulada: boolean;
}) {
  const router = useRouter();
  const [comprobantes, setComprobantes] = useState(inicial);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const factura = comprobantes.find((c) => c.clase === "factura" && c.estado !== "rechazado")
    ?? comprobantes.find((c) => c.clase === "factura");
  const nota = comprobantes.find((c) => c.clase === "nota_credito" && c.estado !== "rechazado");

  function llamar(accion: "factura" | "nota_credito" | "consultar") {
    setError("");
    startTransition(async () => {
      try {
        const res = await fetch("/ventas/facturar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ saleId, accion }),
        });
        const data = await res.json().catch(() => ({}));

        if (data.comprobantes) setComprobantes(data.comprobantes);
        else if (data.comprobante) {
          setComprobantes((prev) => [
            data.comprobante,
            ...prev.filter((c) => c.id !== data.comprobante.id),
          ]);
        }

        if (!res.ok) {
          setError(data.error ?? "No se pudo completar la operación.");
          return;
        }
        toast.success(accion === "nota_credito" ? "Nota de crédito emitida" : accion === "consultar" ? "Consulta completada" : "Factura emitida");
        router.refresh();
      } catch {
        setError("No se pudo contactar al servidor. La venta quedó registrada; probá de nuevo.");
      }
    });
  }

  const necesitaConsulta = comprobantes.some((c) => c.estado === "error" || c.estado === "pendiente");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {factura && <EstadoBadge cbte={factura} />}
        {nota && <EstadoBadge cbte={nota} />}

        {factura?.estado === "autorizado" && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/comprobantes/${factura.id}`}>Ver / Imprimir</Link>
          </Button>
        )}

        {necesitaConsulta && (
          <Button variant="outline" size="sm" onClick={() => llamar("consultar")} disabled={pending}>
            {pending ? <><Loader2 className="size-3.5 animate-spin" /> Consultando…</> : "Consultar en ARCA"}
          </Button>
        )}

        {puedeEmitir && !ventaAnulada && (!factura || factura.estado === "rechazado") && (
          <Button variant="outline" size="sm" onClick={() => llamar("factura")} disabled={pending}>
            {pending
              ? <><Loader2 className="size-3.5 animate-spin" /> Emitiendo…</>
              : factura?.estado === "rechazado" ? "Reintentar factura" : "Emitir factura"}
          </Button>
        )}

        {puedeAnular && ventaAnulada && factura?.estado === "autorizado" && !nota && (
          <Button variant="outline" size="sm" onClick={() => llamar("nota_credito")} disabled={pending}>
            {pending ? <><Loader2 className="size-3.5 animate-spin" /> Emitiendo…</> : "Emitir nota de crédito"}
          </Button>
        )}
      </div>

      {factura?.estado === "autorizado" && factura.cae && (
        <p className="figure text-xs text-muted-foreground">
          CAE {factura.cae}
          {factura.caeVto && ` · vence ${new Date(`${factura.caeVto}T12:00:00`).toLocaleDateString("es-AR")}`}
        </p>
      )}

      {/* El texto de ARCA se muestra tal cual: es el error fiscal del propio
          contribuyente y ocultarlo vuelve el problema irresoluble. */}
      {factura?.observaciones && factura.estado === "autorizado" && (
        <Notice tone="warn" className="text-xs">
          Facturada con observaciones de ARCA: {factura.observaciones}
        </Notice>
      )}

      {factura?.estado === "rechazado" && factura.errorMsg && (
        <p className="text-sm text-destructive" role="alert">{factura.errorMsg}</p>
      )}

      {error && <Notice tone="danger" className="text-xs">{error}</Notice>}
    </div>
  );
}

function EstadoBadge({ cbte }: { cbte: ComprobanteResumen }) {
  const prueba = cbte.ambiente === "homologacion" ? "PRUEBA · " : "";

  if (cbte.estado === "autorizado") {
    return <Badge variant="success">{prueba}{cbte.etiqueta}</Badge>;
  }
  if (cbte.estado === "rechazado") {
    return <Badge variant="destructive">Rechazada por ARCA</Badge>;
  }
  if (cbte.estado === "error") {
    return <Badge variant="destructive">Sin verificar</Badge>;
  }
  return <Badge variant="secondary">Emitiendo…</Badge>;
}
