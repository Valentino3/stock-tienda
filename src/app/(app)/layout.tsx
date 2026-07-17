import Link from "next/link";
import { requireUser } from "@/lib/session";
import { LogoutButton } from "./logout-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const links = [
    { href: "/vender", label: "Vender" },
    { href: "/productos", label: "Productos" },
    { href: "/ventas", label: "Ventas" },
    { href: "/caja", label: "Caja" },
    ...(user.role === "owner" ? [
      { href: "/importar", label: "Importar" },
      { href: "/reportes", label: "Reportes" },
      { href: "/usuarios", label: "Usuarios" },
    ] : []),
  ];
  return (
    <div className="min-h-screen">
      <nav className="flex flex-wrap items-center gap-3 border-b px-4 py-2">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="text-sm font-medium hover:underline">{l.label}</Link>
        ))}
        <span className="ml-auto text-sm text-gray-500">{user.name}</span>
        <LogoutButton />
      </nav>
      <main className="p-4">{children}</main>
    </div>
  );
}
