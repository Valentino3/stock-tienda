"use client";
import { HojaImprimible } from "@/components/ticket/hoja-imprimible";
import { money, number } from "@/lib/format";
import type { OrderItem } from "@/db/schema";

/**
 * La cuenta de la mesa: el papel que se lleva a la mesa antes de cobrar.
 *
 * NO es un comprobante. Es el detalle de lo consumido para que el cliente lo
 * revise y decida cómo paga. La factura se emite después, desde /ventas, y
 * recién cuando el cobro ya ocurrió.
 *
 * Lo dice explícitamente en el pie: un papel con precios y totales que no
 * aclara qué es se parece demasiado a un comprobante, y eso es un problema
 * con el cliente y con ARCA.
 */
export function CuentaImprimible({
  titulo, items, comensales, onClose,
}: {
  /** "Mesa 4" o "Pedido #12". */
  titulo: string;
  /** Solo los impagos: lo ya cobrado tiene su propio comprobante. */
  items: OrderItem[];
  comensales: number | null;
  onClose: () => void;
}) {
  const total = items.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
  const porComensal = comensales && comensales > 1 ? total / comensales : null;

  return (
    <HojaImprimible titulo={`Cuenta de ${titulo}`} onClose={onClose}>
      <p className="text-center font-semibold uppercase">{titulo}</p>
      <p className="mt-1 text-center text-[10px]">{new Date().toLocaleString("es-AR")}</p>
      {comensales != null && (
        <p className="text-center text-[10px]">
          {comensales} {comensales === 1 ? "comensal" : "comensales"}
        </p>
      )}

      <hr className="my-2 border-black/30" />

      <table className="w-full">
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="align-top">
              <td className="py-0.5">
                {i.nameSnapshot}
                <br />
                <span className="text-[10px]">
                  {number(i.quantity)} × {money(i.unitPrice)}
                  {i.notes && ` · ${i.notes}`}
                </span>
              </td>
              <td className="py-0.5 text-right whitespace-nowrap">
                {money(i.quantity * i.unitPrice)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <hr className="my-2 border-black/30" />

      <div className="flex justify-between text-sm font-semibold">
        <span>Total</span><span>{money(total)}</span>
      </div>
      {porComensal != null && (
        // La pregunta más frecuente de la mesa. Sale gratis calcularla acá.
        <div className="mt-1 flex justify-between text-[10px]">
          <span>Por comensal</span><span>{money(Math.ceil(porComensal))}</span>
        </div>
      )}

      <p className="mt-3 text-center text-[9px] leading-tight">
        Detalle de consumo. No es factura ni comprobante fiscal.
      </p>
    </HojaImprimible>
  );
}
