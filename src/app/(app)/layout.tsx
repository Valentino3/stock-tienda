import { requireUser } from "@/lib/session";
import { AppSidebar, type NavGroup } from "./app-sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const isOwner = user.role === "owner";

  const groups: NavGroup[] = [
    {
      label: "Operación",
      links: [
        { href: "/vender", label: "Vender" },
        { href: "/productos", label: "Productos" },
        { href: "/ventas", label: "Ventas" },
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
      />
      <main className="flex-1 px-4 py-6 lg:px-10 lg:py-8">
        <div className="mx-auto w-full max-w-6xl space-y-8">{children}</div>
      </main>
    </div>
  );
}
