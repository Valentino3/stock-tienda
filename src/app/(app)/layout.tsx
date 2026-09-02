import { eq } from "drizzle-orm";
import { db } from "@/db";
import { stores } from "@/db/schema";
import { requireStore } from "@/lib/session";
import { APP_NAME } from "@/lib/config";
import { countOpenNotifications } from "@/domain/notifications";
import { verticalDe } from "@/lib/verticals";
import { BarraOffline } from "@/components/offline/barra-offline";
import { AppSidebar, type NavGroup } from "./app-sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStore();
  const isOwner = user.role === "owner";
  const [store] = await db.select({ name: stores.name, esPrueba: stores.esPrueba })
    .from(stores).where(eq(stores.id, user.storeId));
  const storeName = store?.name ?? APP_NAME;
  const openAvisos = isOwner ? await countOpenNotifications(db, user.storeId) : 0;

  // La navegación la decide el rubro. Ver src/lib/verticals/index.ts.
  const groups: NavGroup[] = verticalDe(user.businessType).nav({ isOwner, openAvisos });

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <AppSidebar
        groups={groups}
        userName={user.name}
        roleLabel={isOwner ? "Dueño" : "Empleado"}
        storeName={storeName}
      />
      {/* `min-w-0` no es decorativo: un hijo de flex arranca en
          `min-width: auto`, o sea que se niega a achicarse por debajo de su
          contenido. Sin esto, la tabla de /productos —hasta 11 columnas— empuja
          el <main>, el <main> empuja al documento, y en vez de scrollear
          adentro de su panel aparece una barra horizontal en TODA la página que
          también corre la barra lateral. Se veía a 1440px. */}
      <main className="min-w-0 flex-1 px-4 py-6 lg:px-10 lg:py-8">
        <div className="mx-auto w-full max-w-6xl space-y-8">
          {/* Permanente y arriba de todo, no un badge discreto: el riesgo real
              es que alguien cobre una venta de verdad creyendo que esta en su
              tienda. Que moleste un poco es el punto. */}
          {store?.esPrueba && (
            <div
              role="status"
              className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm font-medium text-warning"
            >
              TIENDA DE PRUEBA. Nada de lo que hagas acá es real: no es plata de
              ningún local y se puede borrar en cualquier momento. Facturar en
              producción está bloqueado.
            </div>
          )}
          <BarraOffline />
          {children}
        </div>
      </main>
    </div>
  );
}
