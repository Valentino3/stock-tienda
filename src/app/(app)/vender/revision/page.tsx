import { requireStore } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { RevisionClient } from "./revision-client";

/**
 * Todo el contenido sale del dispositivo (IndexedDB), así que el server
 * component solo hace de puerta: exige sesión y arma el encabezado. Eso es lo
 * que permite que la pantalla también abra sin conexión — el service worker
 * cachea /vender y sus subrutas.
 */
export default async function RevisionPage() {
  await requireStore();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Revisión de ventas sin conexión"
        description="Qué falta sincronizar y qué el servidor no pudo registrar."
      />
      <RevisionClient />
    </div>
  );
}
