"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Armazón de cualquier papel de 80 mm que se imprime desde una pantalla.
 *
 * Lo comparten el ticket no fiscal de una venta offline y la cuenta de una
 * mesa. Lo que resuelve es el aislamiento de la impresión: se monta como
 * overlay ENCIMA de la pantalla de trabajo, así que sin ayuda la hoja saldría
 * con el carrito y el buscador atrás. Marca el `body` con
 * `imprimiendo-ticket` y el @media print de globals.css deja solo esto.
 *
 * No usa Dialog de Radix a propósito: ese portal complica el aislamiento.
 */
export function HojaImprimible({
  titulo,
  onClose,
  children,
  accionExtra,
}: {
  /** Para el lector de pantalla; no se imprime. */
  titulo: string;
  onClose: () => void;
  children: React.ReactNode;
  accionExtra?: React.ReactNode;
}) {
  useEffect(() => {
    document.body.classList.add("imprimiendo-ticket");
    return () => document.body.classList.remove("imprimiendo-ticket");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="ticket-overlay fixed inset-0 z-50 grid place-items-center overflow-auto bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
    >
      <div className="w-full max-w-[80mm] space-y-3">
        <div className="ticket-hoja mx-auto w-full bg-white p-3 text-[11px] text-black shadow-xs">
          {children}
        </div>
        <div className="no-imprimir flex justify-end gap-2">
          {accionExtra}
          <Button type="button" variant="outline" onClick={onClose}>Cerrar</Button>
          <Button type="button" onClick={() => window.print()}>Imprimir</Button>
        </div>
      </div>
    </div>
  );
}
