"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/format";
import type { VentaEnCola } from "@/lib/offline/db";

const METODO: Record<VentaEnCola["paymentMethod"], string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  cuenta: "Cuenta corriente",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function descuentoDe(base: number, d?: { kind: "amount" | "percent"; value: number }): number {
  if (!d || !(d.value > 0)) return 0;
  const bruto = d.kind === "percent" ? (base * d.value) / 100 : d.value;
  return round2(Math.min(Math.max(bruto, 0), base));
}

/**
 * Comprobante no fiscal para una venta cobrada sin conexión.
 *
 * Existe porque hasta ahora una venta común no imprimía NADA: la pantalla
 * mostraba un toast y listo. Con conexión eso se tolera —el cliente puede
 * pedir la factura después—, pero en una feria el comprador se va con la
 * mercadería y sin ningún papel.
 *
 * No es un comprobante fiscal y lo dice explícitamente: la factura ARCA se
 * emite al volver la conexión, desde /ventas.
 *
 * No usa Dialog de Radix a propósito: ese portal complica aislar la impresión.
 * Con un overlay propio y una clase en el body, el @media print de globals.css
 * deja solo el ticket en la hoja.
 */
export function TicketOffline({ venta, onClose }: { venta: VentaEnCola | null; onClose: () => void }) {
  useEffect(() => {
    if (!venta) return;
    document.body.classList.add("imprimiendo-ticket");
    return () => document.body.classList.remove("imprimiendo-ticket");
  }, [venta]);

  useEffect(() => {
    if (!venta) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [venta, onClose]);

  if (!venta) return null;

  const lineas = venta.items.map((i) => {
    const bruto = round2(i.unitPrice * i.quantity);
    const desc = descuentoDe(bruto, i.discount);
    return { ...i, bruto, desc, neto: round2(bruto - desc) };
  });
  const subtotal = round2(lineas.reduce((a, l) => a + l.neto, 0));
  const descGeneral = descuentoDe(subtotal, venta.saleDiscount);

  return (
    <div
      className="ticket-overlay fixed inset-0 z-50 grid place-items-center overflow-auto bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Comprobante de la venta"
    >
      <div className="w-full max-w-[80mm] space-y-3">
        <div className="ticket-hoja mx-auto w-full bg-white p-3 text-[11px] text-black shadow-xs">
          <p className="text-center font-semibold uppercase">Comprobante no fiscal</p>
          <p className="mt-1 text-center text-[10px]">
            {new Date(venta.capturadoEn).toLocaleString("es-AR")}
          </p>
          <p className="text-center text-[10px]">Venta sin conexión</p>

          <hr className="my-2 border-black/30" />

          <table className="w-full">
            <tbody>
              {lineas.map((l) => (
                <tr key={l.variantId} className="align-top">
                  <td className="py-0.5">
                    {l.productName}{l.variantName ? ` — ${l.variantName}` : ""}
                    <br />
                    <span className="text-[10px]">
                      {l.quantity} × {money(l.unitPrice)}
                      {l.desc > 0 && ` − ${money(l.desc)}`}
                    </span>
                  </td>
                  <td className="py-0.5 text-right whitespace-nowrap">{money(l.neto)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <hr className="my-2 border-black/30" />

          {descGeneral > 0 && (
            <div className="flex justify-between">
              <span>Subtotal</span><span>{money(subtotal)}</span>
            </div>
          )}
          {descGeneral > 0 && (
            <div className="flex justify-between">
              <span>Descuento</span><span>− {money(descGeneral)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-semibold">
            <span>Total</span><span>{money(venta.total)}</span>
          </div>
          <p className="mt-1">{METODO[venta.paymentMethod]}</p>

          <p className="mt-3 text-center text-[9px] leading-tight">
            Documento no válido como factura. La factura electrónica se emite
            al restablecerse la conexión.
          </p>
        </div>

        <div className="no-imprimir flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cerrar</Button>
          <Button type="button" onClick={() => window.print()}>Imprimir</Button>
        </div>
      </div>
    </div>
  );
}
