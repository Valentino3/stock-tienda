import { eq } from "drizzle-orm";
import { db } from "@/db";
import { stores } from "@/db/schema";
import { requireStore } from "@/lib/session";
import { APP_NAME } from "@/lib/config";
import { countOpenNotifications } from "@/domain/notifications";
import { AppSidebar, type NavGroup } from "./app-sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStore();
  const isOwner = user.role === "owner";
  const [store] = await db.select({ name: stores.name }).from(stores).where(eq(stores.id, user.storeId));
  const storeName = store?.name ?? APP_NAME;
  const openAvisos = isOwner ? await countOpenNotifications(db, user.storeId) : 0;

  const groups: NavGroup[] = [
    {
      label: "Operación",
      links: [
        { href: "/vender", label: "Vender" },
        { href: "/productos", label: "Productos" },
        { href: "/ventas", label: "Ventas" },
        { href: "/clientes", label: "Clientes" },
        { href: "/caja", label: "Caja" },
      ],
    },
    ...(isOwner
      ? [
          {
            label: "Administración",
            links: [
              { href: "/importar", label: "Importar" },
              { href: "/reportes", label: "Reportes" },
              { href: "/comisiones", label: "Comisiones" },
              { href: "/facturacion", label: "Facturación" },
              { href: "/avisos", label: "Avisos", badge: openAvisos },
              { href: "/usuarios", label: "Usuarios" },
            ],
          },
        ]
      : []),
  ];

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <AppSidebar
        groups={groups}
        userName={user.name}
        roleLabel={isOwner ? "Dueño" : "Empleado"}
        storeName={storeName}
      />
      <main className="flex-1 px-4 py-6 lg:px-10 lg:py-8">
        <div className="mx-auto w-full max-w-6xl space-y-8">{children}</div>
      </main>
    </div>
  );
}
