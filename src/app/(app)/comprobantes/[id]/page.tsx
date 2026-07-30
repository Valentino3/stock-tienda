import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/db";
import { requireStore } from "@/lib/session";
import { getComprobanteView } from "@/domain/comprobante-view";
import { CBTE_LABEL, formatearNumeroComprobante, type CbteTipo } from "@/domain/fiscal-catalogs";
import { ComprobanteImprimible } from "@/components/comprobante/comprobante-imprimible";
import { Button } from "@/components/ui/button";
import { PrintButton } from "./print-button";
import { CompartirComprobante } from "./compartir-comprobante";

/**
 * El comprobante visto DESDE EL COMERCIO. Requiere sesión y está scopeado por
 * tienda. El mismo documento, visto por el cliente y sin sesión, se sirve en
 * `/c/[token]`.
 *
 * Formato por defecto: ticket de 80 mm, que es lo que hay en el mostrador.
 * `?formato=a4` para hoja completa.
 */
export default async function ComprobantePage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ formato?: string }>;
}) {
  const { id } = await params;
  const { formato } = await searchParams;
  // ⚠️ Scopeado por storeId: los ids son secuenciales y un `eq(id)` pelado
  // filtraría documentos fiscales de otro comercio.
  const { storeId } = await requireStore();

  const comprobanteId = Number(id);
  if (!Number.isInteger(comprobanteId)) notFound();

  const view = await getComprobanteView(db, storeId, comprobanteId);
  if (!view) notFound();

  const { comprobante: c, emisor } = view;
  const a4 = formato === "a4";
  const autorizado = c.estado === "autorizado";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button asChild variant="outline" size="sm">
          <Link href="/ventas">← Volver a Ventas</Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/comprobantes/${c.id}${a4 ? "" : "?formato=a4"}`}>
              {a4 ? "Ver como ticket" : "Ver como A4"}
            </Link>
          </Button>
          <PrintButton />
        </div>
      </div>

      {!autorizado && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm print:hidden">
          Este comprobante todavía no está autorizado por ARCA. No lo entregues al cliente.
        </p>
      )}

      {/* Compartir solo tiene sentido con un comprobante ya autorizado: mandarle
          al cliente un link a algo que ARCA todavía no aprobó es prometerle un
          documento que puede terminar rechazado. */}
      {autorizado && c.publicToken && (
        <CompartirComprobante
          token={c.publicToken}
          etiqueta={`${CBTE_LABEL[c.cbteTipo as CbteTipo] ?? "Comprobante"} ${formatearNumeroComprobante(c.ptoVta, c.numero)}`}
          comercio={emisor.nombreFantasia || emisor.razonSocial}
          total={c.impTotal}
        />
      )}

      <ComprobanteImprimible view={view} a4={a4} />
    </div>
  );
}
