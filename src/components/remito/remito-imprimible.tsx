import { money, number } from "@/lib/format";
import type { Remito } from "@/domain/cash-close";

/**
 * Remito: el respaldo interno de una venta.
 *
 * NO es el remito R de la RG 1415 —ese viaja con la mercadería y normalmente
 * va sin precios— ni un comprobante fiscal. Es el papel que el comercio
 * archiva, con precios y totales.
 *
 * ⚠️ El pie es innegociable. Un papel con precios, un número y sin datos
 * fiscales se confunde con un recibo apenas sale por la impresora, y ahí el
 * problema deja de ser interno.
 *
 * **Sin numeración propia**: usa el número de venta. Una segunda secuencia
 * compraría un índice único nuevo, una carrera nueva y la posibilidad de un
 * remito cuyo número no coincida con su venta — que es justo la confusión que
 * este documento viene a eliminar. La numeración correlativa sin huecos existe
 * en este repo solo donde ARCA la exige.
 *
 * Presentacional puro: recibe la proyección de `getCashSessionClose` y no
 * consulta nada. Sobre 300 remitos, cualquier lógica acá se paga 300 veces.
 */

const METODO: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  cuenta: "Cuenta corriente",
};

const LISTA: Record<string, string> = {
  venta: "",
  efectivo: "efvo. menor",
  mayorista: "mayorista",
};

export function RemitoImprimible({ remito, nombreTienda }: { remito: Remito; nombreTienda: string }) {
  return (
    // `break-inside-avoid` a nivel REMITO y nunca a nivel línea: sobre ~900
    // nodos, pedirle al navegador que evalúe el corte de página en cada
    // renglón es donde el trabajo de impresión se arrastra.
    <article className="break-inside-avoid rounded-lg border border-black/30 p-3 text-[11px] text-black">
      <header className="flex items-baseline justify-between gap-3 border-b border-black/30 pb-1">
        <div>
          <p className="font-bold">{nombreTienda}</p>
          <p className="text-[10px]">Comprobante interno de venta</p>
        </div>
        <div className="text-right">
          <p className="figure font-bold">Venta #{remito.saleId}</p>
          <p className="figure text-[10px]">{remito.createdAt.toLocaleString("es-AR")}</p>
        </div>
      </header>

      {remito.voided && (
        <p className="my-1 border border-black px-1 py-0.5 text-center text-[10px] font-bold">
          ANULADA{remito.voidedReason ? ` — ${remito.voidedReason}` : ""}
        </p>
      )}

      <p className="mt-1 text-[10px]">
        {remito.sellerName} · {METODO[remito.paymentMethod] ?? remito.paymentMethod}
        {remito.clientName && ` · ${remito.clientName}`}
        {remito.posteriorAlCierre && " · sincronizada después del cierre"}
      </p>

      <table className="mt-1 w-full">
        <tbody>
          {remito.lineas.map((l, i) => (
            <tr key={i} className="align-top">
              <td className="py-0.5">
                {l.productName}
                {l.variantName ? ` — ${l.variantName}` : ""}
                <br />
                <span className="figure text-[10px]">
                  {number(l.quantity)} × {money(l.unitPrice)}
                  {LISTA[l.priceList] && ` (${LISTA[l.priceList]})`}
                  {l.discountAmount > 0 && ` − ${money(l.discountAmount)} desc.`}
                </span>
              </td>
              <td className="figure py-0.5 text-right whitespace-nowrap">{money(l.neto)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {remito.discountAmount > 0 && (
        <p className="figure mt-1 text-right text-[10px]">
          Descuento general: −{money(remito.discountAmount)}
        </p>
      )}

      <div className="mt-1 flex justify-between border-t border-black/30 pt-1 font-bold">
        <span>Total</span>
        <span className="figure">{money(remito.total)}</span>
      </div>

      <p className="mt-1 text-center text-[9px]">Documento no válido como factura.</p>
    </article>
  );
}
