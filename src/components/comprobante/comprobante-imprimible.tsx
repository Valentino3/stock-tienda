import QRCode from "qrcode";
import type { ComprobanteView } from "@/domain/comprobante-view";
import {
  ALICUOTA_LABEL, CBTE_COD_IMPRESO, CBTE_LABEL, CBTE_LETRA, CONDICION_IVA_LABEL,
  DOC_LABEL, formatearCuit, formatearNumeroComprobante, esNotaCredito,
  type CbteTipo, type CondicionIva, type DocTipo,
} from "@/domain/fiscal-catalogs";
import { money } from "@/lib/format";

/**
 * El comprobante fiscal, tal como se imprime. Server component.
 *
 * Vive acá y no en una página porque lo usan DOS rutas con permisos distintos:
 * `/comprobantes/[id]` (el comercio, con sesión) y `/c/[token]` (el cliente, sin
 * sesión, desde el link que le llegó por WhatsApp o mail). El documento tiene que
 * ser byte por byte el mismo en las dos.
 *
 * Es HTML y no un PDF a propósito: la RG 1415 / 4291 / 4892 mandan el contenido y
 * el QR, no el contenedor. El "Imprimir → Guardar como PDF" del navegador da el
 * PDF gratis y maneja los saltos de página mejor que cualquier cosa que
 * escribiéramos. Además esta app no tiene almacenamiento de archivos.
 */
export async function ComprobanteImprimible({
  view,
  a4 = false,
}: {
  view: ComprobanteView;
  a4?: boolean;
}) {
  const { comprobante: c, emisor, qrUrl, asociado } = view;
  const letra = CBTE_LETRA[c.cbteTipo as CbteTipo] ?? "B";
  const esFacturaA = letra === "A";
  const esPrueba = c.ambiente === "homologacion";

  // SVG inline: sin canvas, sin binarios que guardar, y escala perfecto al
  // imprimir.
  const qrSvg = qrUrl
    ? await QRCode.toString(qrUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M" })
    : null;

  return (
<article
  className={`relative mx-auto bg-white text-black shadow-xs print:shadow-none ${
    a4 ? "w-full max-w-[210mm] p-8 text-sm" : "w-full max-w-[80mm] p-3 text-[11px]"
  }`}
>
  {/* Guarda innegociable: un comprobante de prueba que parece real termina
      en manos de un cliente. */}
  {esPrueba && (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
      <span className="-rotate-45 text-center text-lg font-bold tracking-widest text-destructive/25">
        COMPROBANTE DE PRUEBA
        <br />
        SIN VALIDEZ FISCAL
      </span>
    </div>
  )}

  {/* Emisor + recuadro de letra */}
  <header className={`border-b border-black pb-3 ${a4 ? "flex items-start justify-between gap-6" : "space-y-2 text-center"}`}>
    <div className={a4 ? "flex-1" : ""}>
      <p className="text-base font-bold">{emisor.razonSocial}</p>
      {emisor.nombreFantasia && <p className="text-xs">{emisor.nombreFantasia}</p>}
      <p className="text-xs">{emisor.domicilio}</p>
      <p className="text-xs">CUIT {formatearCuit(emisor.cuit)}</p>
      <p className="text-xs">
        {CONDICION_IVA_LABEL[emisor.condicionIva as CondicionIva] ?? "IVA Responsable Inscripto"}
      </p>
      {emisor.ingresosBrutos && <p className="text-xs">Ingresos Brutos: {emisor.ingresosBrutos}</p>}
      {emisor.inicioActividades && (
        <p className="text-xs">
          Inicio de actividades: {new Date(`${emisor.inicioActividades}T12:00:00`).toLocaleDateString("es-AR")}
        </p>
      )}
    </div>

    <div className={a4 ? "text-right" : "border-t border-black pt-2"}>
      <div className={`mx-auto flex size-10 items-center justify-center border-2 border-black text-2xl font-bold ${a4 ? "" : "mb-1"}`}>
        {letra}
      </div>
      <p className="text-[10px]">COD. {CBTE_COD_IMPRESO[c.cbteTipo as CbteTipo] ?? "06"}</p>
      <p className="mt-1 text-sm font-bold uppercase">
        {CBTE_LABEL[c.cbteTipo as CbteTipo] ?? "Comprobante"}
      </p>
      <p className="font-mono text-sm">{formatearNumeroComprobante(c.ptoVta, c.numero)}</p>
      <p className="text-xs">
        Fecha: {new Date(`${c.cbteFch}T12:00:00`).toLocaleDateString("es-AR")}
      </p>
    </div>
  </header>

  {/* Receptor */}
  <section className="border-b border-black py-3 text-xs">
    <p className="font-semibold">{c.receptorNombre}</p>
    <p>
      {DOC_LABEL[c.docTipo as DocTipo] ?? "Doc."}:{" "}
      {c.docTipo === 80 ? formatearCuit(c.docNro) : c.docNro === "0" ? "—" : c.docNro}
    </p>
    <p>{CONDICION_IVA_LABEL[c.condIvaReceptor as CondicionIva] ?? "Consumidor Final"}</p>
    {c.receptorDomicilio && <p>{c.receptorDomicilio}</p>}
  </section>

  {/* Comprobante asociado (notas de crédito) */}
  {asociado && (
    <section className="border-b border-black py-2 text-xs">
      <p className="font-semibold">Comprobante asociado</p>
      <p>
        {CBTE_LABEL[asociado.cbteTipo as CbteTipo] ?? "Comprobante"}{" "}
        {formatearNumeroComprobante(asociado.ptoVta, asociado.numero)} del{" "}
        {new Date(`${asociado.cbteFch}T12:00:00`).toLocaleDateString("es-AR")}
      </p>
    </section>
  )}

  {/* Detalle */}
  <section className="border-b border-black py-3">
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-black text-left">
          <th className="pb-1 font-semibold">Descripción</th>
          <th className="pb-1 text-right font-semibold">Cant.</th>
          {/* En la Factura A el precio unitario va SIN IVA y el IVA se
              discrimina; en la B los precios llevan IVA incluido y el IVA
              NO se desglosa. */}
          <th className="pb-1 text-right font-semibold">{esFacturaA ? "P. unit. s/IVA" : "P. unit."}</th>
          {esFacturaA && <th className="pb-1 text-right font-semibold">IVA</th>}
          <th className="pb-1 text-right font-semibold">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        {c.lineas.map((l, i) => {
          const unitarioSinIva = l.cantidad > 0 ? l.baseImp / l.cantidad : 0;
          return (
            <tr key={i} className="align-top">
              <td className="py-1 pr-2">
                {l.descripcion}
                {l.descuentoLinea > 0 && (
                  <span className="block text-[10px]">Bonificación: −{money(l.descuentoLinea)}</span>
                )}
              </td>
              <td className="py-1 text-right">{l.cantidad}</td>
              <td className="py-1 text-right">
                {money(esFacturaA ? unitarioSinIva : l.precioUnitario)}
              </td>
              {esFacturaA && (
                <td className="py-1 text-right">
                  {ALICUOTA_LABEL[l.ivaId] ?? ""}
                  <span className="block">{money(l.importeIva)}</span>
                </td>
              )}
              <td className="py-1 text-right">{money(esFacturaA ? l.baseImp : l.netoAsignado)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </section>

  {/* Totales */}
  <section className="border-b border-black py-3 text-xs">
    <dl className="ml-auto w-full max-w-[16rem] space-y-0.5">
      {esFacturaA ? (
        <>
          <Fila label="Importe neto gravado" valor={money(c.impNeto)} />
          {c.impTotConc > 0 && <Fila label="Importe no gravado" valor={money(c.impTotConc)} />}
          {c.impOpEx > 0 && <Fila label="Importe exento" valor={money(c.impOpEx)} />}
          {c.ivaDesglose.map((b) => (
            <Fila key={b.id} label={`IVA ${ALICUOTA_LABEL[b.id] ?? ""}`} valor={money(b.importe)} />
          ))}
          {c.impTrib > 0 && <Fila label="Otros tributos" valor={money(c.impTrib)} />}
        </>
      ) : null}
      <Fila label="Total" valor={money(c.impTotal)} destacado />
    </dl>
  </section>

  {/* Pie fiscal: CAE, vencimiento y QR */}
  <footer className={`pt-3 text-xs ${a4 ? "flex items-end justify-between gap-6" : "space-y-2 text-center"}`}>
    <div className={a4 ? "" : "order-2"}>
      {c.cae ? (
        <>
          <p className="font-semibold">CAE N° {c.cae}</p>
          {c.caeVto && (
            <p>Vencimiento del CAE: {new Date(`${c.caeVto}T12:00:00`).toLocaleDateString("es-AR")}</p>
          )}
          <p className="mt-1">Comprobante Autorizado</p>
        </>
      ) : (
        <p className="font-semibold">Sin CAE — comprobante no autorizado</p>
      )}
    </div>

    {qrSvg && (
      <div
        className={`${a4 ? "size-24" : "mx-auto size-24"} [&>svg]:size-full`}
        // El QR es un SVG generado en el server a partir de una URL que
        // armamos nosotros: no hay entrada del usuario en ese string.
        dangerouslySetInnerHTML={{ __html: qrSvg }}
      />
    )}
  </footer>

  {esNotaCredito(c.cbteTipo) && (
    <p className="pt-2 text-center text-[10px] font-semibold">
      La presente nota de crédito anula el comprobante asociado.
    </p>
  )}
</article>
  );
}

function Fila({ label, valor, destacado }: { label: string; valor: string; destacado?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${destacado ? "border-t border-black pt-1 text-sm font-bold" : ""}`}>
      <dt>{label}</dt>
      <dd className="font-mono">{valor}</dd>
    </div>
  );
}
