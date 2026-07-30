import { notFound } from "next/navigation";
import { db } from "@/db";
import { getComprobanteViewPorToken } from "@/domain/comprobante-view";
import { ComprobanteImprimible } from "@/components/comprobante/comprobante-imprimible";
import { PrintButton } from "@/app/(app)/comprobantes/[id]/print-button";

/**
 * El comprobante visto POR EL CLIENTE, desde el link que le llegó por WhatsApp o
 * por mail.
 *
 * Ruta PÚBLICA a propósito: el comprador no tiene usuario en el sistema. La
 * credencial es el token de 32 bytes de la URL, y lo único que abre es este
 * comprobante — no da acceso a la tienda, ni a otras ventas, ni al cliente.
 *
 * Vive fuera del grupo `(app)` para no heredar su layout: nada de barra lateral
 * ni de navegación del comercio.
 */

// El comprobante es inmutable una vez autorizado, pero no se cachea en CDN: la
// URL lleva un token y no queremos copias en caches compartidas.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getComprobanteViewPorToken(db, token);
  if (!view) return { title: "Comprobante no encontrado" };
  return {
    title: `Comprobante ${view.emisor.razonSocial}`,
    // Un comprobante fiscal no va a un buscador.
    robots: { index: false, follow: false },
  };
}

export default async function ComprobantePublicoPage({
  params, searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ formato?: string }>;
}) {
  const { token } = await params;
  const { formato } = await searchParams;

  const view = await getComprobanteViewPorToken(db, token);
  // Mismo 404 para "no existe", "token mal" y "todavía no autorizado": no se le
  // confirma a nadie que un token es casi correcto.
  if (!view) notFound();

  const a4 = formato === "a4";

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-6">
      <div className="mx-auto w-full max-w-[210mm] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <p className="text-sm text-muted-foreground">
            Comprobante de <strong className="text-foreground">{view.emisor.nombreFantasia || view.emisor.razonSocial}</strong>
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={`/c/${token}${a4 ? "" : "?formato=a4"}`}
              className="inline-flex h-8 items-center rounded-lg border border-input px-3 text-sm shadow-xs transition-colors hover:bg-accent"
            >
              {a4 ? "Ver como ticket" : "Ver como A4"}
            </a>
            <PrintButton />
          </div>
        </div>

        <ComprobanteImprimible view={view} a4={a4} />

        <p className="pb-6 text-center text-xs text-muted-foreground print:hidden">
          Guardalo con «Imprimir → Guardar como PDF». Podés verificar el comprobante
          escaneando el código QR.
        </p>
      </div>
    </main>
  );
}
