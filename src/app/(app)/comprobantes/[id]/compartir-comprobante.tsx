"use client";
import { useState } from "react";
import { Check, Copy, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/format";

/**
 * Compartir el comprobante con el cliente.
 *
 * WhatsApp va por `wa.me`, o sea abriendo la app del cajero con el mensaje ya
 * escrito — NO por la API de WhatsApp Business. La API manda sola desde el
 * server, pero exige verificación de Meta Business, número registrado y
 * plantillas aprobadas una por una: semanas de trámite para lo que acá se
 * resuelve con una URL.
 */
export function CompartirComprobante({
  token,
  etiqueta,
  comercio,
  total,
}: {
  token: string;
  etiqueta: string;
  comercio: string;
  total: number;
}) {
  const [copiado, setCopiado] = useState(false);

  // El link se arma en el cliente: `window.location.origin` da el host real
  // (producción, preview o localhost) sin necesidad de configurar una URL base.
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/c/${token}`;
  const mensaje = `${comercio}\n${etiqueta} por ${money(total)}\n\n${url}`;

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // clipboard falla sin HTTPS o sin permiso: se muestra el link para copiar
      // a mano en vez de dejar al usuario sin salida.
      toast.error("No se pudo copiar. El link está abajo.");
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-xs print:hidden">
      <p className="ledger-label">Enviar al cliente</p>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <MessageCircle className="size-4" />
            WhatsApp
          </a>
        </Button>

        <Button variant="outline" size="sm" onClick={copiar}>
          {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copiado ? "Copiado" : "Copiar link"}
        </Button>
      </div>

      <p className="break-all text-xs text-muted-foreground">{url}</p>
      <p className="text-xs text-muted-foreground">
        Cualquiera con el link puede ver este comprobante. No da acceso a nada más.
      </p>
    </div>
  );
}
