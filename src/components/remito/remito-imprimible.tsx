/* eslint-disable @next/next/no-img-element */
import { money, number } from "@/lib/format";
import type { EmisorRemito, Remito } from "@/domain/cash-close";

/**
 * Remito, con el formato que ya usa el comercio.
 *
 * Hoja A4: encabezado con los datos del emisor a la izquierda y la letra R con
 * el número a la derecha, bloque de cliente y condición de venta, tabla de
 * ítems, y el TOTAL anclado abajo. El logo va centrado en el cuerpo, que es lo
 * que llena el vacío entre la última línea y el total.
 *
 * NO es el remito R de la RG 1415 —ese viaja con la mercadería y suele ir sin
 * precios— ni un comprobante fiscal. Es el respaldo del comercio, y por eso
 * lleva importes.
 *
 * ⚠️ El pie es innegociable. Un papel con precios, un número y una letra en
 * recuadro se confunde con un comprobante apenas sale por la impresora.
 *
 * Presentacional puro: recibe la proyección de `getCashSessionClose` o de
 * `getRemito` y no consulta nada. En el paquete de un cierre esto se renderiza
 * una vez por venta, así que cualquier lógica acá se paga por cada una.
 */

const METODO: Record<string, string> = {
  efectivo: "efectivo",
  transferencia: "transferencia",
  tarjeta: "tarjeta",
  cuenta: "cuenta corriente",
};

const LISTA: Record<string, string> = {
  venta: "",
  efectivo: "efvo. menor",
  mayorista: "mayorista",
};

/** `0001-00001829`. Punto de venta de cuatro dígitos, correlativo de ocho. */
function formatearNumero(puntoVenta: number, numero: number | null, saleId: number) {
  const pv = String(puntoVenta).padStart(4, "0");
  // Sin número propio (ventas anteriores a la feature) el papel referencia la
  // venta en vez de inventar un correlativo que nadie entregó.
  return numero == null ? `${pv}-s/n (venta #${saleId})` : `${pv}-${String(numero).padStart(8, "0")}`;
}

/** Código del ítem: el SKU si lo tiene, si no el id de variante con ceros. */
function codigo(sku: string | null, variantId: number) {
  return sku?.trim() || String(variantId).padStart(10, "0");
}

const Regla = () => <div className="my-1 border-t border-dashed border-black/60" />;

export function RemitoImprimible({ remito, emisor }: { remito: Remito; emisor: EmisorRemito }) {
  return (
    // `break-inside-avoid` a nivel remito y nunca a nivel línea: sobre cientos
    // de nodos, pedirle al navegador que evalúe el corte en cada renglón es
    // donde el trabajo de impresión se arrastra.
    <article className="flex min-h-[247mm] break-inside-avoid flex-col bg-white p-6 text-[11px] text-black">
      <p className="text-right">fecha : {remito.createdAt.toLocaleString("es-AR")}</p>
      <Regla />

      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-[13px]">{emisor.nombre}</p>
          {emisor.cuit && <p className="figure">CUIT: {emisor.cuit}</p>}
          {emisor.domicilio && <p>Domicilio: {emisor.domicilio}</p>}
        </div>
        <div className="min-w-[16rem] text-right">
          {/* La letra en recuadro y arriba del numero, como en el papel que ya
              usan. R de remito: no es una letra de ARCA, y por eso el pie lo
              aclara. */}
          <p className="mx-auto w-10 border border-black text-center text-2xl leading-tight font-semibold">R</p>
          <p className="figure mt-1 text-[13px]">
            NRO : {formatearNumero(emisor.puntoVenta, remito.numero, remito.saleId)}
          </p>
        </div>
      </div>
      <Regla />

      <div className="flex items-start justify-between gap-6">
        <div>
          <p>CLIENTE : {remito.clientName ?? "Consumidor Final"}</p>
          {remito.clientDoc && <p className="figure">CUIT : {remito.clientDoc}</p>}
        </div>
        <p>condición de venta : {METODO[remito.paymentMethod] ?? remito.paymentMethod}</p>
      </div>
      <Regla />

      {remito.voided && (
        <p className="my-2 border border-black px-2 py-1 text-center font-bold">
          ANULADA{remito.voidedReason ? ` — ${remito.voidedReason}` : ""}
        </p>
      )}

      <table className="mt-1 w-full">
        <thead>
          <tr className="text-left align-bottom">
            <th className="w-[8rem] pb-1 font-normal">CÓDIGO :</th>
            <th className="pb-1 font-normal">DESCRIPCIÓN :</th>
            <th className="w-[6rem] pb-1 text-right font-normal">CANTIDAD:</th>
            <th className="w-[7rem] pb-1 text-right font-normal">SUBTOTAL</th>
          </tr>
        </thead>
        <tbody>
          {remito.lineas.map((l, i) => (
            <tr key={i} className="align-top">
              <td className="figure py-0.5">{codigo(l.sku, l.variantId)}</td>
              <td className="py-0.5">
                {l.productName}
                {l.variantName ? ` — ${l.variantName}` : ""}
                {(LISTA[l.priceList] || l.discountAmount > 0) && (
                  <span className="block text-[10px]">
                    {LISTA[l.priceList]}
                    {LISTA[l.priceList] && l.discountAmount > 0 && " · "}
                    {l.discountAmount > 0 && `bonificación ${money(l.discountAmount)}`}
                  </span>
                )}
              </td>
              <td className="figure py-0.5 text-right">{number(l.quantity)}</td>
              <td className="figure py-0.5 text-right">{money(l.neto)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* El cuerpo se estira para empujar el total al pie de la hoja, que es
          como sale hoy. El logo vive en ese espacio en vez de dejarlo en blanco. */}
      <div className="flex flex-1 items-center justify-center py-6">
        {emisor.logoUrl && (
          <img
            src={emisor.logoUrl}
            alt=""
            className="max-h-40 max-w-[45%] object-contain"
          />
        )}
      </div>

      {remito.discountAmount > 0 && (
        <p className="figure text-right">Descuento general: −{money(remito.discountAmount)}</p>
      )}
      <Regla />
      <p className="figure text-right text-xl">TOTAL: {money(remito.total)}</p>
      <Regla />

      <p className="mt-1 text-center text-[9px]">
        Documento no válido como factura. Vendedor: {remito.sellerName}
      </p>
    </article>
  );
}
