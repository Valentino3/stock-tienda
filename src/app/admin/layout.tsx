import { redirect, unstable_rethrow } from "next/navigation";
import { requireSuperAdmin } from "@/lib/session";
import { APP_NAME } from "@/lib/config";
import { LogoutButton } from "../(app)/logout-button";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let name: string;
  try {
    ({ name } = await requireSuperAdmin());
  } catch (err) {
    unstable_rethrow(err);
    redirect("/vender"); // logueado pero no super-admin → a su tienda
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b bg-card px-6 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md bg-brand figure text-xs font-semibold text-brand-foreground">
            {APP_NAME.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <p className="text-sm font-semibold tracking-tight">{APP_NAME}</p>
            <p className="ledger-label">Plataforma</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="truncate text-sm text-muted-foreground">{name}</span>
          <LogoutButton />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-8 lg:px-8">{children}</main>
    </div>
  );
}
