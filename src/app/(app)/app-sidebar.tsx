"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { BUSINESS_NAME } from "@/lib/config";
import { LogoutButton } from "./logout-button";

export type NavLink = { href: string; label: string; icon: LucideIcon };

function NavList({ links, pathname, onNavigate }: { links: NavLink[]; pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {links.map((link) => {
        const Icon = link.icon;
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              active ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:bg-muted hover:text-foreground"
            }`}
          >
            <Icon className="size-4 shrink-0" />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppSidebar({ links, userName }: { links: NavLink[]; userName: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:w-60 lg:shrink-0 lg:flex-col lg:border-r lg:bg-card">
        <div className="p-4">
          <p className="font-semibold">{BUSINESS_NAME}</p>
        </div>
        <Separator />
        <div className="flex-1 p-3">
          <NavList links={links} pathname={pathname} />
        </div>
        <Separator />
        <div className="flex items-center justify-between p-4 text-sm">
          <span className="truncate text-muted-foreground">{userName}</span>
          <LogoutButton />
        </div>
      </aside>

      {/* Mobile top bar + drawer */}
      <header className="flex items-center justify-between border-b p-3 lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Abrir menú">
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64">
            <SheetHeader>
              <SheetTitle>{BUSINESS_NAME}</SheetTitle>
            </SheetHeader>
            <div className="px-4">
              <NavList links={links} pathname={pathname} onNavigate={() => setOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
        <span className="font-semibold">{BUSINESS_NAME}</span>
        <LogoutButton />
      </header>
    </>
  );
}
