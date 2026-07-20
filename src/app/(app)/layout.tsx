import { requireUser } from "@/lib/session";
import { AppSidebar, type NavLink } from "./app-sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const links: NavLink[] = [
    { href: "/vender", label: "Vender" },
    { href: "/productos", label: "Productos" },
    { href: "/ventas", label: "Ventas" },
    { href: "/caja", label: "Caja" },
    ...(user.role === "owner"
      ? [
          { href: "/importar", label: "Importar" },
          { href: "/reportes", label: "Reportes" },
          { href: "/usuarios", label: "Usuarios" },
        ]
      : []),
  ];

  return (
    <div className="flex min-h-screen">
      <AppSidebar links={links} userName={user.name} />
      <main className="flex-1 p-4 lg:p-8">{children}</main>
    </div>
  );
}
