"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Menu,
  ShoppingCart,
  Package,
  Receipt,
  Wallet,
  Upload,
  BarChart3,
  HandCoins,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { BUSINESS_NAME } from "@/lib/config";
import { cn } from "@/lib/utils";
import { LogoutButton } from "./logout-button";

export type NavLink = { href: string; label: string };
export type NavGroup = { label: string; links: NavLink[] };

const ICONS: Record<string, LucideIcon> = {
  "/vender": ShoppingCart,
  "/productos": Package,
  "/ventas": Receipt,
  "/caja": Wallet,
  "/importar": Upload,
  "/reportes": BarChart3,
  "/comisiones": HandCoins,
  "/usuarios": Users,
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const chars = parts.slice(0, 2).map((p) => p[0]);
  return (chars.join("") || "·").toUpperCase();
}

function Logomark({ name }: { name: string }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand font-mono text-xs font-semibold tracking-tight text-brand-foreground">
      {initials(name)}
    </span>
  );
}

function Brand({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Logomark name={name} />
      <span className="truncate text-sm font-semibold tracking-tight">{name}</span>
    </div>
  );
}

function NavList({
  groups,
  pathname,
  onNavigate,
}: {
  groups: NavGroup[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <p className="ledger-label px-3 pb-1">{group.label}</p>
          {group.links.map((link) => {
            const Icon = ICONS[link.href];
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-brand-muted font-semibold text-brand"
                    : "font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                {Icon && <Icon className="size-4 shrink-0" strokeWidth={active ? 2.4 : 2} />}
                {link.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function UserFooter({ userName, role }: { userName: string; role: string }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{userName}</p>
        <p className="ledger-label">{role}</p>
      </div>
      <LogoutButton />
    </div>
  );
}

export function AppSidebar({
  groups,
  userName,
  roleLabel,
}: {
  groups: NavGroup[];
  userName: string;
  roleLabel: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:bg-card">
        <div className="px-5 py-4">
          <Brand name={BUSINESS_NAME} />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          <NavList groups={groups} pathname={pathname} />
        </div>
        <div className="border-t px-4 py-3">
          <UserFooter userName={userName} role={roleLabel} />
        </div>
      </aside>

      {/* Mobile top bar + drawer */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-card/90 px-3 py-2.5 backdrop-blur-sm lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Abrir menú">
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 gap-0 p-0">
            <SheetHeader className="flex-row items-center gap-2.5 border-b px-5 py-4">
              <Logomark name={BUSINESS_NAME} />
              <SheetTitle className="truncate text-sm font-semibold tracking-tight">
                {BUSINESS_NAME}
              </SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-3 py-4">
              <NavList groups={groups} pathname={pathname} onNavigate={() => setOpen(false)} />
            </div>
            <div className="border-t px-4 py-3">
              <UserFooter userName={userName} role={roleLabel} />
            </div>
          </SheetContent>
        </Sheet>
        <Brand name={BUSINESS_NAME} />
        <LogoutButton />
      </header>
    </>
  );
}
