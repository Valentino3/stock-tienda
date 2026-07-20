import { ShoppingCart, Package, Receipt, Wallet, Upload, BarChart3, Users } from "lucide-react";
import { requireUser } from "@/lib/session";
import { AppSidebar, type NavLink } from "./app-sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const links: NavLink[] = [
    { href: "/vender", label: "Vender", icon: ShoppingCart },
    { href: "/productos", label: "Productos", icon: Package },
    { href: "/ventas", label: "Ventas", icon: Receipt },
    { href: "/caja", label: "Caja", icon: Wallet },
    ...(user.role === "owner"
      ? [
          { href: "/importar", label: "Importar", icon: Upload },
          { href: "/reportes", label: "Reportes", icon: BarChart3 },
          { href: "/usuarios", label: "Usuarios", icon: Users },
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
