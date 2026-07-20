# UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle all 8 existing screens of stock-tienda with a shadcn/ui design system (sidebar nav, neutral palette + accent color, consistent components) and targeted UX upgrades, with zero changes to server actions, roles, or business logic.

**Architecture:** shadcn/ui components (copied into `src/components/ui/`) on top of the existing Tailwind v4 setup. Each screen task swaps existing hand-rolled markup for the new primitives while calling the exact same server actions/props already in place. Foundational tasks (design tokens, sidebar) come first; screen tasks are independent of each other after that.

**Tech Stack:** Next.js 16 App Router, Tailwind v4 (CSS-first config, no `tailwind.config.js`), shadcn/ui CLI v4.x (Radix-based `base` library), lucide-react (icons, bundled by shadcn), sonner (toasts).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-20-ui-redesign-design.md` — read before any task.
- **Zero behavior changes**: every server action call, prop name, validation rule, and role check (`requireUser`/`requireOwner`) stays exactly as it is today. This plan only touches JSX/CSS and purely-client presentational state (e.g. a search filter string).
- UI text in Spanish; code/identifiers/commits in English.
- Color semantics reserved app-wide: **red** = alert (stock bajo, diferencia ≠ 0, error), **green** = success/diferencia $0, **amber** = warning (anulada, pendiente). Never use red/green/amber for a normal/primary action button.
- Accent/primary color: **indigo** (`var(--color-indigo-600)` family) — distinct from the three semantic colors above.
- No new automated tests (this is a presentation-layer change over already-tested logic per the spec). Verification is `npx tsc --noEmit`, `npm run build`, `npm test` (must stay at the count from the last plan run) after every task, plus a manual click-through noted per task.
- Every shadcn CLI command in this plan was verified against the actually-installed CLI (`shadcn@4.13.1`) and current docs before being written down. If a command's output differs from what a step describes, stop and compare against `npx shadcn@latest <cmd> --help` / the context7 `shadcn/ui` docs before improvising.
- Commit after each task, conventional English messages.

---

### Task 1: shadcn/ui foundation — theme, base components, root layout fixes

**Files:**
- Create: `components.json` (generated), `src/lib/utils.ts` (generated), `src/components/ui/button.tsx`, `src/components/ui/input.tsx`, `src/components/ui/label.tsx`, `src/components/ui/card.tsx`, `src/components/ui/badge.tsx`, `src/components/ui/table.tsx`, `src/components/ui/dialog.tsx`, `src/components/ui/sheet.tsx`, `src/components/ui/sonner.tsx`, `src/components/ui/textarea.tsx`, `src/components/ui/alert-dialog.tsx`, `src/components/ui/separator.tsx` (all generated)
- Create: `src/lib/config.ts`
- Modify: `src/app/globals.css` (generated then patched), `src/app/layout.tsx`, `package.json` (deps added by CLI)

**Interfaces:**
- Produces: `BUSINESS_NAME` exported from `src/lib/config.ts`, all shadcn primitives importable from `@/components/ui/<name>`, `cn()` helper from `@/lib/utils`, `<Toaster />` mounted globally so any client component can `import { toast } from "sonner"` and call `toast(...)`/`toast.success(...)`/`toast.error(...)`.

- [ ] **Step 1: Run shadcn init**

This project already has Tailwind v4 configured (`@theme inline` in `src/app/globals.css`, no `tailwind.config.js`) and Next.js App Router with `src/`. Confirmed via `npx shadcn@latest info` that the CLI detects all of this correctly.

Run:
```bash
npx shadcn@latest init -y -t next
```

If it prompts interactively despite `-y` (older/newer CLI builds vary), answer: style → default, base color → **neutral**, CSS variables → **yes**.

Expected: creates `components.json` and `src/lib/utils.ts`, rewrites `src/app/globals.css` with `@theme inline` color tokens (`--background`, `--foreground`, `--primary`, `--card`, `--border`, etc. as `oklch()` values) and a `.dark` block, adds dependencies to `package.json` (`class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `tw-animate-css`, `@radix-ui/*` as needed).

- [ ] **Step 2: Verify/fix `components.json` base color**

Open `components.json`. Confirm `"tailwind": { "baseColor": "neutral", ... }`. If it's anything else, edit it to `"neutral"` by hand (this field only affects future component generation defaults, safe to edit).

- [ ] **Step 3: Set the accent color**

Open `src/app/globals.css`. In the `:root` block, shadcn generated a `--primary` (and `--primary-foreground`) pair, currently near-black/near-white (that's the "neutral" base color's default primary). Override them to the indigo accent decided in the design spec. Find these two lines in `:root` and replace their values:

```css
--primary: var(--color-indigo-600);
--primary-foreground: var(--color-indigo-50);
```

And in the `.dark` block, replace the same two variables with:

```css
--primary: var(--color-indigo-500);
--primary-foreground: var(--color-indigo-950);
```

(`--color-indigo-600` etc. are Tailwind v4's built-in palette variables, available automatically via `@import "tailwindcss"` — no need to define them.)

Also verify `--ring` (focus ring color) references `--primary` or is close to it — if shadcn generated `--ring: var(--primary)` leave it; if it's a hardcoded neutral value, change it to `--ring: var(--primary);` in both `:root` and `.dark` so focus rings pick up the new accent.

- [ ] **Step 4: Preserve the Geist font and fix the hardcoded body font**

The original `globals.css` (before shadcn touched it) mapped `--font-sans: var(--font-geist-sans)` and `--font-mono: var(--font-geist-mono)` inside `@theme inline`, and `src/app/layout.tsx` already loads Geist and exposes those CSS variables on `<html>`. shadcn's init may have overwritten the `@theme inline` block without these two lines, and/or left a hardcoded `font-family: Arial, Helvetica, sans-serif` on `body` from the pre-shadcn file — check both:

1. In the `@theme inline` block of `globals.css`, ensure these two lines are present (add them back if shadcn's generated block dropped them):
   ```css
   --font-sans: var(--font-geist-sans);
   --font-mono: var(--font-geist-mono);
   ```
2. Search `globals.css` for `font-family: Arial`. If present, delete that line — shadcn's own generated base layer already sets `body { @apply bg-background text-foreground; }`, and the `font-sans` theme variable (Tailwind's default `font-sans` utility, applied via `<body className="font-sans">` in the next step) is what should control the typeface, not a hardcoded CSS `font-family`.

- [ ] **Step 5: Fix root layout — language, metadata, font application, Toaster**

Read the current `src/app/layout.tsx` first (it was last touched in the original MVP build; shadcn's init does not modify this file). Apply these exact changes:

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { BUSINESS_NAME } from "@/lib/config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: BUSINESS_NAME,
  description: "Sistema de stock y ventas",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
```

- [ ] **Step 6: Create the business-name placeholder constant**

Create `src/lib/config.ts`:

```ts
// Nombre del negocio: placeholder hasta que el cliente defina su marca.
// Cambiar acá una vez que exista un nombre real — es la única fuente.
export const BUSINESS_NAME = "Mi Comercio";
```

- [ ] **Step 7: Install the base components**

Run:
```bash
npx shadcn@latest add button input label card badge table dialog sheet sonner textarea alert-dialog separator -y
```

Expected: creates the 12 files listed under **Files: Create** above in `src/components/ui/`, and adds any missing Radix packages to `package.json`.

If any single component name fails to resolve, run `npx shadcn@latest search @shadcn <name>` to find the correct current registry name and substitute it — do not skip the component, the later tasks depend on all 12.

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit`
Expected: clean (no errors from the new generated files or layout.tsx).

Run: `npm run build`
Expected: succeeds.

Run: `npm test`
Expected: all existing tests still pass (this task touches no domain code, so the count must be unchanged from before this plan started).

Run: `npm run dev`, open `http://localhost:3000/login` in a browser. Confirm the page text renders in the Geist sans-serif font (not the old Arial fallback) — open browser devtools, inspect `<body>`, computed `font-family` should start with `Geist`, not `Arial`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: add shadcn/ui design system foundation"
```

---

### Task 2: Sidebar navigation

**Files:**
- Create: `src/app/(app)/app-sidebar.tsx`
- Modify: `src/app/(app)/layout.tsx`, `src/app/(app)/logout-button.tsx`

**Interfaces:**
- Consumes: `requireUser()` from `@/lib/session` (unchanged), `BUSINESS_NAME` from `@/lib/config` (Task 1), shadcn `Sheet`/`Button`/`Separator` (Task 1).
- Produces: `AppSidebar` component with props `{ links: { href: string; label: string; icon: LucideIcon }[]; userName: string }`. Renders a fixed desktop sidebar (`lg:` breakpoint up) and a mobile hamburger + `Sheet` drawer with the same links below `lg`.

- [ ] **Step 1: Write the sidebar component**

Create `src/app/(app)/app-sidebar.tsx`:

```tsx
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
```

- [ ] **Step 2: Restyle the logout button**

Modify `src/app/(app)/logout-button.tsx`:

```tsx
"use client";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-destructive hover:text-destructive"
      onClick={async () => {
        await authClient.signOut();
        router.push("/login");
      }}
    >
      Salir
    </Button>
  );
}
```

- [ ] **Step 3: Wire the sidebar into the layout**

Modify `src/app/(app)/layout.tsx`:

```tsx
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
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed.

Run: `npm run dev`, log in, resize the browser below and above the `lg` breakpoint (1024px). Below: hamburger + drawer with working links and a working "Salir". Above: fixed left sidebar, current page highlighted (test by navigating to a couple of links), owner sees 7 links, note down (for manual re-check after Task 2 is merged with an employee account) that employee should see only 4 — this exact gating logic is unchanged from before, just re-verify visually once an employee account exists.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: replace top nav with responsive sidebar"
```

---

### Task 3: Login screen

**Files:**
- Modify: `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `authClient.signIn.email` (unchanged), shadcn `Card`/`Input`/`Label`/`Button` (Task 1), `BUSINESS_NAME` (Task 1).

- [ ] **Step 1: Restyle**

Replace `src/app/login/page.tsx` in full:

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BUSINESS_NAME } from "@/lib/config";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const { error } = await authClient.signIn.email({ email, password });
    setPending(false);
    if (error) setError("Email o contraseña incorrectos");
    else router.push("/vender");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{BUSINESS_NAME}</CardTitle>
          <CardDescription>Ingresá con tu cuenta para continuar.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Ingresando…" : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: succeed.

Run: `npm run dev`, open `/login`, submit wrong credentials (see inline error), then correct credentials (redirects to `/vender`).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: restyle login screen with shadcn card"
```

---

### Task 4: Vender screen

**Files:**
- Modify: `src/app/(app)/vender/sale-form.tsx`, `src/app/(app)/vender/page.tsx`

**Interfaces:**
- Consumes: `searchVariants`, `submitSale` from `./actions` (unchanged, exact same signatures/return shapes as today), shadcn `Card`/`Input`/`Button`/`Table`/`Separator` (Task 1), `toast` from `sonner`.
- No new exports — same default `SaleForm`/`VenderPage` components.

- [ ] **Step 1: Restyle the sale form (register-style two-column layout, +/- steppers, toast feedback)**

Replace `src/app/(app)/vender/sale-form.tsx` in full:

```tsx
"use client";
import { useEffect, useState, useTransition } from "react";
import { Minus, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { searchVariants, submitSale } from "./actions";

type SearchResult = Awaited<ReturnType<typeof searchVariants>>[number];
type PaymentMethod = "efectivo" | "transferencia" | "tarjeta";
type CartItem = {
  variantId: number;
  productName: string;
  variantName: string;
  price: number;
  quantity: number;
};

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "tarjeta", label: "Tarjeta" },
];

function label(item: { productName: string; variantName: string }) {
  return item.variantName ? `${item.productName} — ${item.variantName}` : item.productName;
}

export function SaleForm() {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("efectivo");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => {
      if (term.trim().length < 2) {
        setResults([]);
      } else {
        searchVariants(term).then(setResults);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [term]);

  function addToCart(r: SearchResult) {
    setCart((prev) => {
      const existing = prev.find((i) => i.variantId === r.variantId);
      if (existing) {
        return prev.map((i) =>
          i.variantId === r.variantId ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [
        ...prev,
        {
          variantId: r.variantId,
          productName: r.productName,
          variantName: r.variantName,
          price: r.price ?? r.basePrice,
          quantity: 1,
        },
      ];
    });
    setTerm("");
    setResults([]);
  }

  function updateQuantity(variantId: number, quantity: number) {
    setCart((prev) => prev.map((i) => (i.variantId === variantId ? { ...i, quantity } : i)));
  }

  function step(variantId: number, delta: number) {
    setCart((prev) =>
      prev.map((i) =>
        i.variantId === variantId ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i
      )
    );
  }

  function removeItem(variantId: number) {
    setCart((prev) => prev.filter((i) => i.variantId !== variantId));
  }

  const total = cart.reduce((acc, i) => acc + i.price * i.quantity, 0);

  function confirmSale() {
    setError("");
    startTransition(async () => {
      const res = await submitSale({
        paymentMethod,
        items: cart.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
      });
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      if ("ok" in res && res.ok) {
        toast.success(`Venta #${res.saleId} registrada — $${res.total.toFixed(2)}`);
        setCart([]);
      }
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Buscar producto</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <Input
              placeholder="Buscar producto o SKU..."
              value={term}
              onChange={(e) => setTerm(e.target.value)}
            />
            {results.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
                {results.map((r) => (
                  <li key={r.variantId}>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => addToCart(r)}
                    >
                      {label(r)} · ${(r.price ?? r.basePrice).toFixed(2)} · stock {r.stock}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {cart.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">El carrito está vacío.</p>
          ) : (
            <Table className="mt-4">
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="w-32 text-center">Cant.</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cart.map((item) => (
                  <TableRow key={item.variantId}>
                    <TableCell>{label(item)}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-7"
                          onClick={() => step(item.variantId, -1)}
                        >
                          <Minus className="size-3" />
                        </Button>
                        <span className="w-8 text-center text-sm">{item.quantity}</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="size-7"
                          onClick={() => step(item.variantId, 1)}
                        >
                          <Plus className="size-3" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">${(item.price * item.quantity).toFixed(2)}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive"
                        onClick={() => removeItem(item.variantId)}
                        aria-label="Quitar"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cobro</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="text-2xl font-semibold">${total.toFixed(2)}</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {PAYMENT_METHODS.map((m) => (
              <Button
                key={m.value}
                type="button"
                variant={paymentMethod === m.value ? "default" : "outline"}
                size="sm"
                onClick={() => setPaymentMethod(m.value)}
              >
                {m.label}
              </Button>
            ))}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button
            type="button"
            className="w-full"
            size="lg"
            disabled={pending || cart.length === 0}
            onClick={confirmSale}
          >
            {pending ? "Confirmando…" : "Confirmar venta"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

Quantity input is now unused as a raw `<input>`; the stepper (`step`) function replaces `updateQuantity` in the UI, but keep `updateQuantity` deleted (not referenced anymore — the version above already omits it from the returned JSX; confirm there's no leftover unused function after pasting, `updateQuantity` should not exist in the final file since `step` replaced its only call site).

- [ ] **Step 2: Restyle the page wrapper (no-session gate)**

Modify `src/app/(app)/vender/page.tsx`:

```tsx
import Link from "next/link";
import { db } from "@/db";
import { getOpenSession } from "@/domain/cash";
import { requireUser } from "@/lib/session";
import { SaleForm } from "./sale-form";

export default async function VenderPage() {
  await requireUser();
  const session = await getOpenSession(db);

  if (!session) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight">Vender</h1>
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          No hay caja abierta.{" "}
          <Link href="/caja" className="font-medium underline underline-offset-4">
            Abrí la caja
          </Link>{" "}
          antes de vender.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Vender</h1>
      <SaleForm />
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: succeed, no unused-variable lint errors (specifically confirm `updateQuantity` isn't left dangling).

Run: `npm run dev`, with an open cash session: search a product, add to cart, use +/- to change quantity, confirm a sale, see a toast notification (not inline text) with the sale number and total. Try selling more than available stock, confirm the inline error still shows (that message is not moved to a toast — it needs to stay visible next to the button since the user needs to act on it, e.g. reduce quantity).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: restyle Vender screen with register-style layout and toasts"
```

---

### Task 5: Productos screen

**Files:**
- Create: `src/app/(app)/productos/product-list.tsx`
- Modify: `src/app/(app)/productos/page.tsx`, `src/app/(app)/productos/product-form.tsx`, `src/app/(app)/productos/variant-row.tsx`

**Interfaces:**
- Consumes: `saveProduct`, `saveVariant`, `restock`, `adjustStock`, `toggleProductActive`, `toggleVariantActive` from `./actions` (all unchanged), `ProductWithVariants` type (unchanged, still exported from `page.tsx`).
- Produces: `ProductList` client component with props `{ products: ProductWithVariants[]; isOwner: boolean }` — owns the search-filter state, renders the filtered list.

**Design decision (binding for this task):** the product-level create/edit form (today a hand-rolled `fixed inset-0` overlay in `ProductForm`) and the variant-level "Editar" (name/SKU/price, today an inline row that pushes layout) both convert to shadcn `Dialog`. The variant's "Reponer" and "Ajustar" stay as quick inline expanding rows (single/double-field, high-frequency actions for an owner doing rapid stock corrections — wrapping those in a modal would add friction the spec's UX goals argue against, not reduce it).

- [ ] **Step 1: Extract search + list into a client component**

Create `src/app/(app)/productos/product-list.tsx`:

```tsx
"use client";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import type { ProductWithVariants } from "./page";
import { ProductForm } from "./product-form";
import { VariantRow } from "./variant-row";

export function ProductList({ products, isOwner }: { products: ProductWithVariants[]; isOwner: boolean }) {
  const [term, setTerm] = useState("");

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(t) ||
        p.variants.some((v) => v.sku?.toLowerCase().includes(t) || v.name.toLowerCase().includes(t))
    );
  }, [products, term]);

  return (
    <div className="space-y-4">
      <Input
        placeholder="Buscar producto o SKU..."
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        className="max-w-sm"
      />

      {filtered.length === 0 && <p className="text-sm text-muted-foreground">Sin resultados.</p>}

      <div className="space-y-4">
        {filtered.map((product) => (
          <div key={product.id} className={`rounded-lg border p-4 ${!product.active ? "opacity-60" : ""}`}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">{product.name}</h2>
                <p className="text-xs text-muted-foreground">
                  Precio base: ${product.basePrice.toFixed(2)} · Umbral stock bajo: {product.lowStockThreshold}
                  {!product.active && " · Inactivo"}
                </p>
              </div>
              {isOwner && <ProductForm product={product} />}
            </div>
            <div className="mt-3 divide-y">
              {product.variants.map((variant) => (
                <VariantRow
                  key={variant.id}
                  variant={variant}
                  basePrice={product.basePrice}
                  lowStockThreshold={product.lowStockThreshold}
                  isOwner={isOwner}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Simplify the page to fetch + delegate**

Modify `src/app/(app)/productos/page.tsx` (keep `getProducts`/`ProductWithVariants` exactly as-is, only replace the JSX return and the "+ Nuevo producto" trigger placement):

```tsx
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { products, productVariants } from "@/db/schema";
import type { Product, ProductVariant } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { ProductForm } from "./product-form";
import { ProductList } from "./product-list";

export type ProductWithVariants = Product & { variants: ProductVariant[] };

async function getProducts(): Promise<ProductWithVariants[]> {
  // db.query.* relational API no está disponible (no hay relations() para
  // estas tablas de dominio): join manual + agrupado en JS.
  const rows = await db
    .select({ product: products, variant: productVariants })
    .from(products)
    .leftJoin(productVariants, eq(productVariants.productId, products.id))
    .orderBy(products.name, productVariants.id);

  const byId = new Map<number, ProductWithVariants>();
  for (const row of rows) {
    let entry = byId.get(row.product.id);
    if (!entry) {
      entry = { ...row.product, variants: [] };
      byId.set(row.product.id, entry);
    }
    if (row.variant) entry.variants.push(row.variant);
  }
  return [...byId.values()];
}

export default async function ProductosPage() {
  const user = await requireUser();
  const isOwner = user.role === "owner";
  const productList = await getProducts();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Productos</h1>
        {isOwner && <ProductForm />}
      </div>

      {productList.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay productos cargados.</p>
      ) : (
        <ProductList products={productList} isOwner={isOwner} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Convert ProductForm's modal to shadcn Dialog**

Replace `src/app/(app)/productos/product-form.tsx` in full:

```tsx
"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveProduct, saveVariant, toggleProductActive } from "./actions";
import type { Product } from "@/db/schema";

type Props = { product?: Product };

export function ProductForm({ product }: Props) {
  const isEdit = !!product;
  const [open, setOpen] = useState(false);
  const [addingVariant, setAddingVariant] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(product?.name ?? "");
  const [basePrice, setBasePrice] = useState(product ? String(product.basePrice) : "");
  const [lowStockThreshold, setLowStockThreshold] = useState(product ? String(product.lowStockThreshold) : "3");

  const [vName, setVName] = useState("");
  const [vSku, setVSku] = useState("");
  const [vPrice, setVPrice] = useState("");
  const [vError, setVError] = useState("");

  function submitProduct(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveProduct({
        id: product?.id,
        name,
        basePrice: Number(basePrice),
        lowStockThreshold: Number(lowStockThreshold),
      });
      if ("error" in res && res.error) setError(res.error);
      else {
        setError("");
        setOpen(false);
      }
    });
  }

  function submitVariant(e: React.FormEvent) {
    e.preventDefault();
    if (!product) return;
    startTransition(async () => {
      const res = await saveVariant({
        productId: product.id,
        name: vName,
        sku: vSku || null,
        price: vPrice === "" ? null : Number(vPrice),
      });
      if ("error" in res && res.error) setVError(res.error);
      else {
        setVError("");
        setVName("");
        setVSku("");
        setVPrice("");
        setAddingVariant(false);
      }
    });
  }

  function toggleActive() {
    if (!product) return;
    startTransition(async () => {
      await toggleProductActive(product.id, !product.active);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant={isEdit ? "outline" : "default"} size="sm">
              {isEdit ? "Editar" : "+ Nuevo producto"}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{isEdit ? "Editar producto" : "Nuevo producto"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={submitProduct} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="product-name">Nombre</Label>
                <Input id="product-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="product-price">Precio base</Label>
                <Input
                  id="product-price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={basePrice}
                  onChange={(e) => setBasePrice(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="product-threshold">Umbral stock bajo</Label>
                <Input
                  id="product-threshold"
                  type="number"
                  min="0"
                  value={lowStockThreshold}
                  onChange={(e) => setLowStockThreshold(e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={pending}>
                  Guardar
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {isEdit && (
          <>
            <Button variant="link" size="sm" onClick={() => setAddingVariant((v) => !v)}>
              + Variante
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={toggleActive}>
              {product.active ? "Desactivar" : "Activar"}
            </Button>
          </>
        )}
      </div>

      {addingVariant && product && (
        <form onSubmit={submitVariant} className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <div className="space-y-1">
            <Label className="text-xs">Nombre variante</Label>
            <Input className="h-8" value={vName} onChange={(e) => setVName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">SKU</Label>
            <Input className="h-8" value={vSku} onChange={(e) => setVSku(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Precio (opcional)</Label>
            <Input className="h-8 w-32" type="number" step="0.01" value={vPrice} onChange={(e) => setVPrice(e.target.value)} />
          </div>
          {vError && <p className="text-xs text-destructive">{vError}</p>}
          <Button type="submit" size="sm" disabled={pending}>
            Agregar
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAddingVariant(false)}>
            Cancelar
          </Button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Restyle VariantRow — Dialog for edit, badges, inline panels for restock/adjust**

Replace `src/app/(app)/productos/variant-row.tsx` in full:

```tsx
"use client";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveVariant, restock, adjustStock, toggleVariantActive } from "./actions";
import type { ProductVariant } from "@/db/schema";

type Props = {
  variant: ProductVariant;
  basePrice: number;
  lowStockThreshold: number;
  isOwner: boolean;
};

type Panel = null | "restock" | "adjust";

export function VariantRow({ variant, basePrice, lowStockThreshold, isOwner }: Props) {
  const [editOpen, setEditOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(variant.name);
  const [sku, setSku] = useState(variant.sku ?? "");
  const [price, setPrice] = useState(variant.price != null ? String(variant.price) : "");
  const [qty, setQty] = useState("1");
  const [newStock, setNewStock] = useState(String(variant.stock));
  const [reason, setReason] = useState("");

  // VariantRow is keyed by variant.id and reused across revalidatePath
  // re-renders, so the mount-time useState above can go stale (e.g. after a
  // restock while this row's "Ajustar" panel was left open). Re-sync
  // `newStock` whenever the live stock prop changes by adjusting state
  // during render (the React-recommended alternative to an effect for this:
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes),
  // so the adjust input never submits a stale value that would silently
  // revert stock via adjustStock's delta computation.
  const [prevStock, setPrevStock] = useState(variant.stock);
  if (variant.stock !== prevStock) {
    setPrevStock(variant.stock);
    setNewStock(String(variant.stock));
  }

  const effectivePrice = variant.price ?? basePrice;
  const lowStock = variant.stock <= lowStockThreshold;

  function openAdjust() {
    setNewStock(String(variant.stock));
    setPanel((p) => (p === "adjust" ? null : "adjust"));
  }

  function closePanel() {
    setPanel(null);
    setError("");
  }

  function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await saveVariant({
        id: variant.id,
        productId: variant.productId,
        name,
        sku: sku || null,
        price: price === "" ? null : Number(price),
      });
      if ("error" in res && res.error) setError(res.error);
      else {
        setError("");
        setEditOpen(false);
      }
    });
  }

  function submitRestock(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await restock(variant.id, Number(qty));
      if ("error" in res && res.error) setError(res.error);
      else closePanel();
    });
  }

  function submitAdjust(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await adjustStock(variant.id, Number(newStock), reason);
      if ("error" in res && res.error) setError(res.error);
      else closePanel();
    });
  }

  function toggleActive() {
    startTransition(async () => {
      await toggleVariantActive(variant.id, !variant.active);
    });
  }

  return (
    <div className={`py-2 text-sm ${!variant.active ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-3">
        {variant.name && <span className="font-medium">{variant.name}</span>}
        {variant.sku && <span className="text-muted-foreground">SKU: {variant.sku}</span>}
        <span>${effectivePrice.toFixed(2)}</span>
        {lowStock ? (
          <Badge variant="destructive">Stock: {variant.stock}</Badge>
        ) : (
          <span className="text-muted-foreground">Stock: {variant.stock}</span>
        )}
        {!variant.active && <Badge variant="outline">Inactivo</Badge>}

        {isOwner && (
          <div className="ml-auto flex gap-1">
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogTrigger asChild>
                <Button variant="link" size="sm">
                  Editar
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Editar variante</DialogTitle>
                </DialogHeader>
                <form onSubmit={submitEdit} className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor={`variant-name-${variant.id}`}>Nombre variante</Label>
                    <Input id={`variant-name-${variant.id}`} value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`variant-sku-${variant.id}`}>SKU</Label>
                    <Input id={`variant-sku-${variant.id}`} value={sku} onChange={(e) => setSku(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`variant-price-${variant.id}`}>Precio (opcional)</Label>
                    <Input
                      id={`variant-price-${variant.id}`}
                      type="number"
                      step="0.01"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                    />
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                      Cancelar
                    </Button>
                    <Button type="submit" disabled={pending}>
                      Guardar
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
            <Button variant="link" size="sm" onClick={() => setPanel(panel === "restock" ? null : "restock")}>
              Reponer
            </Button>
            <Button variant="link" size="sm" onClick={openAdjust}>
              Ajustar
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={toggleActive}>
              {variant.active ? "Desactivar" : "Activar"}
            </Button>
          </div>
        )}
      </div>

      {panel === "restock" && (
        <form onSubmit={submitRestock} className="mt-2 flex items-end gap-2 rounded-md border p-3">
          <div className="space-y-1">
            <Label className="text-xs">Cantidad a reponer</Label>
            <Input className="h-8 w-24" type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            Reponer
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={closePanel}>
            Cancelar
          </Button>
        </form>
      )}

      {panel === "adjust" && (
        <form onSubmit={submitAdjust} className="mt-2 flex flex-wrap items-end gap-2 rounded-md border p-3">
          <div className="space-y-1">
            <Label className="text-xs">Nuevo stock</Label>
            <Input className="h-8 w-24" type="number" min="0" value={newStock} onChange={(e) => setNewStock(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Motivo</Label>
            <Input className="h-8" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button type="submit" size="sm" disabled={pending}>
            Ajustar
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={closePanel}>
            Cancelar
          </Button>
        </form>
      )}

      {error && panel === null && !editOpen && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
```

Note the last line: the shared `error` state is now only rendered outside a panel/dialog when neither is open, to avoid the error briefly flashing under the row right as a dialog/panel closes on success. Each panel/dialog shows its own error inline above its submit button while open (already the case for the Dialog form above; the restock/adjust panels don't currently render `error` inline at all in the previous version either — leave that as-is, this is a pre-existing minor gap, not something to fix silently as a side effect of this restyle. Do not add scope here.)

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: succeed. `ProductWithVariants` is imported as a type into `product-list.tsx` from `./page` — confirm this doesn't create a circular runtime import problem (it's a type-only import via `import type`, so it's erased at compile time and safe).

Run: `npm run dev`, as owner: search the product list, open "+ Nuevo producto" (Dialog), create a product, edit a variant's SKU/price via its "Editar" Dialog, reponer/ajustar stock via the inline panels, confirm a low-stock variant shows a red badge.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: restyle Productos screen with dialogs, badges, and search"
```

---

### Task 6: Ventas screen

**Files:**
- Modify: `src/app/(app)/ventas/page.tsx`, `src/app/(app)/ventas/void-button.tsx`

**Interfaces:**
- Consumes: `voidSaleAction` from `./actions` (unchanged).
- No new exports.

- [ ] **Step 1: Replace the native `confirm()` with an AlertDialog + toast**

Replace `src/app/(app)/ventas/void-button.tsx` in full:

```tsx
"use client";
import { useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { voidSaleAction } from "./actions";

export function VoidButton({ saleId }: { saleId: number }) {
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const res = await voidSaleAction(saleId);
      if ("error" in res && res.error) toast.error(res.error);
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={pending}>
          {pending ? "Anulando…" : "Anular"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Anular esta venta?</AlertDialogTitle>
          <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>Anular venta</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 2: Restyle the page — Table, badges, date shortcuts**

Replace `src/app/(app)/ventas/page.tsx` in full:

```tsx
import Link from "next/link";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { sales, saleItems, productVariants, products, user } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { VoidButton } from "./void-button";

const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
};

type Params = { from?: string; to?: string; seller?: string };

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default async function VentasPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const currentUser = await requireUser();
  const isOwner = currentUser.role === "owner";

  const conditions = [];
  if (params.from) conditions.push(gte(sales.createdAt, new Date(`${params.from}T00:00:00`)));
  if (params.to) {
    const exclusiveEnd = new Date(new Date(`${params.to}T00:00:00`).getTime() + 24 * 60 * 60 * 1000);
    conditions.push(lt(sales.createdAt, exclusiveEnd));
  }
  if (!isOwner) conditions.push(eq(sales.sellerId, currentUser.id));
  else if (params.seller) conditions.push(eq(sales.sellerId, params.seller));

  const rows = await db
    .select({ sale: sales, sellerName: user.name })
    .from(sales)
    .innerJoin(user, eq(sales.sellerId, user.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(sales.createdAt));

  const saleIds = rows.map((r) => r.sale.id);
  const itemRows = saleIds.length
    ? await db
        .select({
          id: saleItems.id,
          saleId: saleItems.saleId,
          quantity: saleItems.quantity,
          unitPrice: saleItems.unitPrice,
          productName: products.name,
          variantName: productVariants.name,
        })
        .from(saleItems)
        .innerJoin(productVariants, eq(saleItems.variantId, productVariants.id))
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(inArray(saleItems.saleId, saleIds))
    : [];

  const itemsBySale = new Map<number, typeof itemRows>();
  for (const item of itemRows) {
    const list = itemsBySale.get(item.saleId) ?? [];
    list.push(item);
    itemsBySale.set(item.saleId, list);
  }

  const sellers = isOwner
    ? await db.select({ id: user.id, name: user.name }).from(user).orderBy(user.name)
    : [];

  const hasFilters = Boolean(params.from || params.to || params.seller);

  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Ventas</h1>

      <div className="flex flex-wrap items-end gap-3">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Desde</span>
            <input
              type="date"
              name="from"
              defaultValue={params.from ?? ""}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Hasta</span>
            <input
              type="date"
              name="to"
              defaultValue={params.to ?? ""}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            />
          </label>
          {isOwner && (
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Vendedor</span>
              <select
                name="seller"
                defaultValue={params.seller ?? ""}
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
              >
                <option value="">Todos</option>
                {sellers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button type="submit" variant="outline" size="sm">
            Filtrar
          </Button>
          {hasFilters && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/ventas">Limpiar</Link>
            </Button>
          )}
        </form>

        <div className="ml-auto flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/ventas?from=${isoDate(today)}&to=${isoDate(today)}`}>Hoy</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/ventas?from=${isoDate(weekAgo)}&to=${isoDate(today)}`}>Esta semana</Link>
          </Button>
        </div>
      </div>

      {rows.length === 0 && <p className="text-sm text-muted-foreground">No hay ventas para el filtro seleccionado.</p>}

      {rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>N°</TableHead>
              <TableHead>Vendedor</TableHead>
              <TableHead>Medio de pago</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ sale, sellerName }) => (
              <TableRow key={sale.id} className={sale.voided ? "opacity-60" : ""}>
                <TableCell colSpan={6} className="p-0">
                  <details>
                    <summary className={`grid cursor-pointer grid-cols-6 gap-2 px-4 py-3 text-sm ${sale.voided ? "line-through" : ""}`}>
                      <span>{sale.createdAt.toLocaleString("es-AR")}</span>
                      <span>#{sale.id}</span>
                      <span>{sellerName}</span>
                      <span>{PAYMENT_LABELS[sale.paymentMethod] ?? sale.paymentMethod}</span>
                      <span className="text-right">${sale.total.toFixed(2)}</span>
                      <span>
                        {sale.voided ? (
                          <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                            Anulada
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-green-300 bg-green-50 text-green-800">
                            Activa
                          </Badge>
                        )}
                      </span>
                    </summary>
                    <div className="space-y-2 border-t bg-muted/30 px-4 py-3 pl-8 text-sm">
                      <ul className="space-y-1">
                        {(itemsBySale.get(sale.id) ?? []).map((item) => (
                          <li key={item.id}>
                            {item.productName}
                            {item.variantName ? ` — ${item.variantName}` : ""} × {item.quantity} — $
                            {item.unitPrice.toFixed(2)} c/u = ${(item.quantity * item.unitPrice).toFixed(2)}
                          </li>
                        ))}
                      </ul>
                      {isOwner && !sale.voided && <VoidButton saleId={sale.id} />}
                    </div>
                  </details>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: succeed.

Run: `npm run dev`, as owner: click "Hoy"/"Esta semana" shortcuts (URL updates with `from`/`to`, list filters accordingly), expand a sale, click "Anular" (AlertDialog appears, not a native browser confirm), confirm it, see the row grey out with an "Anulada" badge. As employee: confirm the seller filter/select is absent and only own sales show (this scoping logic is unchanged, just re-confirm visually).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: restyle Ventas screen with table, badges, and date shortcuts"
```

---

### Task 7: Caja screen

**Files:**
- Modify: `src/app/(app)/caja/caja-client.tsx`, `src/app/(app)/caja/page.tsx`

**Interfaces:**
- Consumes: `openSession`, `closeSession` from `./actions` (unchanged). Same `Props` shape (`session`, `openedByName`, `totals`) passed from `page.tsx`.

- [ ] **Step 1: Restyle the client component — status card, colored difference**

Replace `src/app/(app)/caja/caja-client.tsx` in full:

```tsx
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { openSession, closeSession } from "./actions";

const METHOD_LABEL: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
};

type SessionInfo = { id: number; openedAt: Date; openingCash: number };
type MethodTotal = { method: string; count: number; total: number };
type ClosedResult = { expectedCash: number; countedCash: number; difference: number };

type Props = {
  session: SessionInfo | null;
  openedByName: string | null;
  totals: MethodTotal[];
};

export function CajaClient({ session, openedByName, totals }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [openingCash, setOpeningCash] = useState("");
  const [openError, setOpenError] = useState("");

  const [countedCash, setCountedCash] = useState("");
  const [notes, setNotes] = useState("");
  const [closeError, setCloseError] = useState("");
  const [closedResult, setClosedResult] = useState<ClosedResult | null>(null);

  function submitOpen(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await openSession(Number(openingCash));
      if ("error" in res && res.error) {
        setOpenError(res.error);
        return;
      }
      setOpenError("");
      setOpeningCash("");
      router.refresh();
    });
  }

  function submitClose(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await closeSession(Number(countedCash), notes);
      if ("error" in res && res.error) {
        setCloseError(res.error);
        return;
      }
      if ("ok" in res && res.ok) {
        setCloseError("");
        setClosedResult({
          expectedCash: res.expectedCash ?? 0,
          countedCash: Number(countedCash),
          difference: res.difference ?? 0,
        });
        router.refresh();
      }
    });
  }

  if (closedResult) {
    const matches = closedResult.difference === 0;
    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle className="text-base">Caja cerrada</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>Esperado: ${closedResult.expectedCash.toFixed(2)}</p>
          <p>Contado: ${closedResult.countedCash.toFixed(2)}</p>
          <p className={`text-lg font-semibold ${matches ? "text-green-600" : "text-destructive"}`}>
            Diferencia: ${closedResult.difference.toFixed(2)}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!session) {
    return (
      <Card className="max-w-xs">
        <CardHeader>
          <CardTitle className="text-base">Abrir caja</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitOpen} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="opening-cash">Monto inicial</Label>
              <Input
                id="opening-cash"
                type="number"
                step="0.01"
                min="0"
                required
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
              />
            </div>
            {openError && <p className="text-sm text-destructive">{openError}</p>}
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Abriendo…" : "Abrir caja"}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-md space-y-4">
      <Card className="border-l-4 border-l-green-500">
        <CardHeader>
          <CardTitle className="text-base">Caja abierta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>Abierta el {session.openedAt.toLocaleString("es-AR")} por {openedByName ?? "—"}</p>
          <p>Monto inicial: ${session.openingCash.toFixed(2)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ventas de la sesión</CardTitle>
        </CardHeader>
        <CardContent>
          {totals.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin ventas todavía.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {totals.map((t) => (
                <li key={t.method}>
                  {METHOD_LABEL[t.method] ?? t.method}: {t.count} venta(s) — ${t.total.toFixed(2)}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cerrar caja</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitClose} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="counted-cash">Efectivo contado</Label>
              <Input
                id="counted-cash"
                type="number"
                step="0.01"
                min="0"
                required
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notas (opcional)</Label>
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {closeError && <p className="text-sm text-destructive">{closeError}</p>}
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Cerrando…" : "Cerrar caja"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

(`notes` used a `<textarea>` before; `Input` is used here for visual consistency since notes are typically short — if the implementer finds multi-line notes are actually needed, swap in the generated `src/components/ui/textarea.tsx` `Textarea` component instead, same props shape.)

- [ ] **Step 2: Restyle the page heading**

Modify `src/app/(app)/caja/page.tsx` — only the returned JSX's heading class changes, data-fetching logic stays identical:

```tsx
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { sales, user } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { getOpenSession } from "@/domain/cash";
import { CajaClient } from "./caja-client";

export default async function CajaPage() {
  await requireUser();
  const session = await getOpenSession(db);

  if (!session) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Caja</h1>
        <CajaClient session={null} openedByName={null} totals={[]} />
      </div>
    );
  }

  const [openedByUser] = await db.select({ name: user.name }).from(user).where(eq(user.id, session.openedBy));

  const totals = await db
    .select({
      method: sales.paymentMethod,
      count: sql<number>`count(*)`.mapWith(Number),
      total: sql<number>`coalesce(sum(${sales.total}), 0)`.mapWith(Number),
    })
    .from(sales)
    .where(and(eq(sales.cashSessionId, session.id), eq(sales.voided, false)))
    .groupBy(sales.paymentMethod);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Caja</h1>
      <CajaClient
        session={{ id: session.id, openedAt: session.openedAt, openingCash: session.openingCash }}
        openedByName={openedByUser?.name ?? null}
        totals={totals}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: succeed.

Run: `npm run dev`: open a cash session, make a sale, close the session with a matching count (green difference) and then open+close again with a mismatched count (red difference) to see both color states.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: restyle Caja screen with status cards and colored difference"
```

---

### Task 8: Importar screen

**Files:**
- Modify: `src/app/(app)/importar/import-form.tsx`, `src/app/(app)/importar/page.tsx`

**Interfaces:**
- Consumes: `parseAndValidate`, `confirmImport` from `./actions` (unchanged), `ValidatedRow` type (unchanged).

- [ ] **Step 1: Restyle the form — Table, badges, sticky confirm bar**

Replace `src/app/(app)/importar/import-form.tsx` in full:

```tsx
"use client";
import { useRef, useState, useTransition } from "react";
import type { ValidatedRow } from "@/domain/import";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { parseAndValidate, confirmImport } from "./actions";

type Result = { created: number; updated: number; skipped: number };

export function ImportForm() {
  const [rows, setRows] = useState<ValidatedRow[] | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validCount = rows?.filter((r) => !r.error).length ?? 0;
  const errorCount = rows?.filter((r) => r.error).length ?? 0;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setResult(null);
    setRows(null);
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      const res = await parseAndValidate(formData);
      if (res.error) {
        setError(res.error);
        return;
      }
      setRows(res.rows ?? []);
    });
  }

  function handleConfirm() {
    if (!rows) return;
    setError("");
    startTransition(async () => {
      try {
        const res = await confirmImport(rows);
        setResult(res);
        setRows(null);
      } catch {
        setError("No se pudo confirmar la importación");
      }
    });
  }

  function startOver() {
    setRows(null);
    setError("");
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="max-w-3xl space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx"
        disabled={pending}
        onChange={handleFileChange}
        className="block text-sm file:mr-3 file:rounded-md file:border file:bg-secondary file:px-3 file:py-1.5 file:text-sm"
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {pending && !rows && !result && <p className="text-sm text-muted-foreground">Procesando…</p>}

      {rows && rows.length > 0 && (
        <div className="space-y-3 pb-20">
          <div className="max-h-[60vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fila</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Variante</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Precio</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.rowNumber} className={r.error ? "bg-destructive/10" : ""}>
                    <TableCell>{r.rowNumber}</TableCell>
                    <TableCell>{r.product}</TableCell>
                    <TableCell>{r.variant}</TableCell>
                    <TableCell>{r.sku ?? ""}</TableCell>
                    <TableCell>{r.price ?? ""}</TableCell>
                    <TableCell>{r.stock}</TableCell>
                    <TableCell>
                      {r.error ? (
                        <span className="text-sm text-destructive">{r.error}</span>
                      ) : (
                        <Badge variant="secondary">{r.action === "update" ? "actualizar" : "crear"}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="fixed inset-x-0 bottom-0 flex items-center gap-3 border-t bg-background p-4 lg:sticky lg:inset-x-auto">
            <Button disabled={pending || validCount === 0} onClick={handleConfirm}>
              {pending
                ? "Confirmando…"
                : `Confirmar importación (${validCount} válidas, ${errorCount} con error se omiten)`}
            </Button>
            <Button variant="ghost" disabled={pending} onClick={startOver}>
              Empezar de nuevo
            </Button>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-green-600">
            {result.created} creados, {result.updated} actualizados, {result.skipped} omitidos
          </p>
          <Button variant="link" className="px-0" onClick={startOver}>
            Importar otro archivo
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Restyle the page**

Modify `src/app/(app)/importar/page.tsx`:

```tsx
import { redirect, unstable_rethrow } from "next/navigation";
import { requireOwner } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { ImportForm } from "./import-form";

export default async function ImportarPage() {
  try {
    await requireOwner();
  } catch (err) {
    unstable_rethrow(err);
    redirect("/vender");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Importar productos</h1>
        <Button asChild variant="outline" size="sm">
          <a href="/importar/template">Descargar plantilla</a>
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Subí un archivo .xlsx con columnas Producto, Variante, SKU, Precio y Stock.
      </p>
      <ImportForm />
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: succeed.

Run: `npm run dev`: download the template, upload it back, confirm the preview table renders with badges, scroll the preview and confirm the "Confirmar importación" bar stays visible/reachable, confirm the import.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: restyle Importar screen with table preview and sticky confirm bar"
```

---

### Task 9: Reportes screen

**Files:**
- Modify: `src/app/(app)/reportes/page.tsx`

**Interfaces:**
- Consumes: `getSalesReport`, `getTopProducts`, `getLowStock`, `getCashSessionHistory` from `@/domain/reports` (unchanged, same call signatures).

- [ ] **Step 1: Restyle — summary cards + shadcn tables (still no charts, per the spec)**

Replace `src/app/(app)/reportes/page.tsx` in full:

```tsx
import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";
import { db } from "@/db";
import { requireOwner } from "@/lib/session";
import { getSalesReport, getTopProducts, getLowStock, getCashSessionHistory } from "@/domain/reports";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PAYMENT_LABELS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
};

function money(n: number | null | undefined) {
  return `$${(n ?? 0).toFixed(2)}`;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

type Params = { from?: string; to?: string };

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  try {
    await requireOwner();
  } catch (err) {
    unstable_rethrow(err);
    redirect("/vender");
  }

  const params = await searchParams;

  const now = new Date();
  const defaultTo = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const defaultFrom = new Date(defaultTo);
  defaultFrom.setDate(defaultFrom.getDate() - 30);
  defaultFrom.setHours(0, 0, 0, 0);

  const from = params.from ? new Date(`${params.from}T00:00:00`) : defaultFrom;
  const to = params.to
    ? new Date(new Date(`${params.to}T00:00:00`).getTime() + 24 * 60 * 60 * 1000 - 1)
    : defaultTo;

  const fromValue = params.from ?? defaultFrom.toISOString().slice(0, 10);
  const toValue = params.to ?? defaultTo.toISOString().slice(0, 10);

  const [{ byDay, byMethod }, topProducts, lowStock, cashHistory] = await Promise.all([
    getSalesReport(db, { from, to }),
    getTopProducts(db, { from, to, limit: 10 }),
    getLowStock(db),
    getCashSessionHistory(db, { limit: 30 }),
  ]);

  const totalPeriodo = byDay.reduce((acc: number, r: { total: number }) => acc + r.total, 0);
  const cierresConDiferencia = cashHistory.filter(
    (s: { difference: number | null }) => s.difference !== null && s.difference !== 0
  ).length;

  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold tracking-tight">Reportes</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total del período</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{money(totalPeriodo)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Productos con stock bajo</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-semibold ${lowStock.length > 0 ? "text-destructive" : ""}`}>
              {lowStock.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Cierres con diferencia</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-semibold ${cierresConDiferencia > 0 ? "text-destructive" : "text-green-600"}`}>
              {cierresConDiferencia}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Desde</span>
            <input
              type="date"
              name="from"
              defaultValue={fromValue}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Hasta</span>
            <input
              type="date"
              name="to"
              defaultValue={toValue}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
            />
          </label>
          <Button type="submit" variant="outline" size="sm">
            Filtrar
          </Button>
          {(params.from || params.to) && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/reportes">Limpiar</Link>
            </Button>
          )}
        </form>
        <div className="ml-auto flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/reportes?from=${isoDate(today)}&to=${isoDate(today)}`}>Hoy</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/reportes?from=${isoDate(weekAgo)}&to=${isoDate(today)}`}>Esta semana</Link>
          </Button>
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Ventas por día</h2>
        {byDay.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin ventas en el rango seleccionado.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Cantidad</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byDay.map((row: { day: string; count: number; total: number }) => (
                <TableRow key={row.day}>
                  <TableCell>{row.day}</TableCell>
                  <TableCell>{row.count}</TableCell>
                  <TableCell className="text-right">{money(row.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Totales por medio de pago</h2>
        {byMethod.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin ventas en el rango seleccionado.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Medio de pago</TableHead>
                <TableHead>Cantidad</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byMethod.map((row: { method: string; count: number; total: number }) => (
                <TableRow key={row.method}>
                  <TableCell>{PAYMENT_LABELS[row.method] ?? row.method}</TableCell>
                  <TableCell>{row.count}</TableCell>
                  <TableCell className="text-right">{money(row.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Top 10 productos</h2>
        {topProducts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin ventas en el rango seleccionado.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Variante</TableHead>
                <TableHead>Unidades vendidas</TableHead>
                <TableHead className="text-right">Ingresos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topProducts.map(
                (row: { productName: string; variantName: string; unitsSold: number; revenue: number }, i: number) => (
                  <TableRow key={i}>
                    <TableCell>{row.productName}</TableCell>
                    <TableCell>{row.variantName || "—"}</TableCell>
                    <TableCell>{row.unitsSold}</TableCell>
                    <TableCell className="text-right">{money(row.revenue)}</TableCell>
                  </TableRow>
                )
              )}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Stock bajo</h2>
        {lowStock.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay productos con stock bajo.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Variante</TableHead>
                <TableHead>Stock</TableHead>
                <TableHead>Umbral</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lowStock.map(
                (row: { productName: string; variantName: string; stock: number; threshold: number }, i: number) => (
                  <TableRow key={i}>
                    <TableCell>{row.productName}</TableCell>
                    <TableCell>{row.variantName || "—"}</TableCell>
                    <TableCell>
                      <Badge variant="destructive">{row.stock}</Badge>
                    </TableCell>
                    <TableCell>{row.threshold}</TableCell>
                  </TableRow>
                )
              )}
            </TableBody>
          </Table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Cierres de caja</h2>
        {cashHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay cierres de caja registrados.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Esperado</TableHead>
                <TableHead>Contado</TableHead>
                <TableHead className="text-right">Diferencia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cashHistory.map(
                (session: {
                  id: number;
                  closedAt: Date | null;
                  expectedCash: number | null;
                  countedCash: number | null;
                  difference: number | null;
                }) => (
                  <TableRow key={session.id}>
                    <TableCell>{session.closedAt?.toLocaleString("es-AR") ?? "—"}</TableCell>
                    <TableCell>{money(session.expectedCash)}</TableCell>
                    <TableCell>{money(session.countedCash)}</TableCell>
                    <TableCell
                      className={`text-right ${session.difference && session.difference !== 0 ? "font-semibold text-destructive" : ""}`}
                    >
                      {money(session.difference)}
                    </TableCell>
                  </TableRow>
                )
              )}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: succeed.

Run: `npm run dev`, open `/reportes` as owner: confirm the three summary cards show sensible numbers, tables render with the new style, "Hoy"/"Esta semana" shortcuts work, stock bajo shows red badges.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: restyle Reportes screen with summary cards and styled tables"
```

---

### Task 10: Usuarios screen

**Files:**
- Modify: `src/app/(app)/usuarios/page.tsx`, `src/app/(app)/usuarios/user-form.tsx`

**Interfaces:**
- Consumes: `createEmployee`, `setUserActive` from `./actions` (unchanged).

- [ ] **Step 1: Convert create-employee modal to Dialog, deactivate to AlertDialog + toast**

Replace `src/app/(app)/usuarios/user-form.tsx` in full:

```tsx
"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createEmployee, setUserActive } from "./actions";

export function UserForm() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await createEmployee({ name, email, password });
      if ("error" in res && res.error) {
        setError(res.error);
      } else {
        setError("");
        setOpen(false);
        setName("");
        setEmail("");
        setPassword("");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">+ Nuevo empleado</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo empleado</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="new-employee-name">Nombre</Label>
            <Input id="new-employee-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-employee-email">Email</Label>
            <Input
              id="new-employee-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-employee-password">Contraseña (mínimo 8 caracteres)</Label>
            <Input
              id="new-employee-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              Crear
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ToggleActiveButton({
  userId,
  banned,
}: {
  userId: string;
  banned: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const res = await setUserActive(userId, banned);
      if ("error" in res && res.error) toast.error(res.error);
    });
  }

  if (banned) {
    // Reactivating is non-destructive — no confirmation needed.
    return (
      <Button variant="link" size="sm" className="text-green-700" disabled={pending} onClick={handleConfirm}>
        {pending ? "..." : "Activar"}
      </Button>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="link" size="sm" className="text-destructive" disabled={pending}>
          {pending ? "..." : "Desactivar"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Desactivar este usuario?</AlertDialogTitle>
          <AlertDialogDescription>No va a poder iniciar sesión hasta que lo reactives.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>Desactivar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 2: Restyle the page — Table, badges**

Replace `src/app/(app)/usuarios/page.tsx` in full:

```tsx
import { redirect, unstable_rethrow } from "next/navigation";
import { db } from "@/db";
import { user } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserForm, ToggleActiveButton } from "./user-form";

export default async function UsuariosPage() {
  try {
    await requireOwner();
  } catch (err) {
    unstable_rethrow(err);
    redirect("/vender");
  }

  const users = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      banned: user.banned,
    })
    .from(user)
    .orderBy(user.name);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Usuarios</h1>
        <UserForm />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Rol</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell>{u.name}</TableCell>
              <TableCell>{u.email}</TableCell>
              <TableCell>
                <Badge variant={u.role === "owner" ? "default" : "secondary"}>
                  {u.role === "owner" ? "Dueño" : "Empleado"}
                </Badge>
              </TableCell>
              <TableCell>
                {u.banned ? (
                  <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-800">
                    Desactivado
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-green-300 bg-green-50 text-green-800">
                    Activo
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-right">
                <ToggleActiveButton userId={u.id} banned={Boolean(u.banned)} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run build`
Expected: succeed.

Run: `npm run dev`, as owner: create an employee via the Dialog, deactivate a user (AlertDialog confirmation, not a plain click), reactivate them (no confirmation, direct), confirm badges render for role/estado. Try deactivating your own owner account and confirm the existing self-deactivation guard still returns its error (now surfaced as a toast).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: restyle Usuarios screen with dialogs, alert-dialog, and badges"
```

---

## Self-Review (done while writing this plan)

- **Spec coverage:** sistema de componentes (Task 1), navegación sidebar (Task 2), color/tipografía (Task 1), las 8 pantallas listadas en "Mejoras de UX por pantalla" each have their own task (Tasks 3–10) with every bullet from that spec section addressed (Vender: layout dos columnas + steppers + toast; Productos: Dialog + badge + buscador; Ventas: badges + atajos de fecha; Caja: card con color + diferencia coloreada; Importar: tabla + barra fija; Reportes: tablas + tarjetas resumen, sin gráficos; Usuarios: badges + confirmación). Fuera de alcance items (marca real, dark mode, gráficos, cambios de comportamiento de servidor) are correctly not touched by any task.
- **Placeholder scan:** no TBD/TODO; the one deliberately-flagged ambiguity (Notes field `Input` vs `Textarea` in Task 7) is resolved with an explicit default and an explicit, bounded escape hatch, not an open placeholder.
- **Type consistency:** `ProductWithVariants` stays exported from `page.tsx` and is `import type`-consumed by the new `product-list.tsx`, matching Task 5's Interfaces block. All server action names/signatures referenced across tasks (`saveProduct`, `saveVariant`, `restock`, `adjustStock`, `toggleProductActive`, `toggleVariantActive`, `voidSaleAction`, `openSession`, `closeSession`, `parseAndValidate`, `confirmImport`, `createEmployee`, `setUserActive`, `searchVariants`, `submitSale`) are used with the exact same call shapes as the current, unmodified files — none of this plan's tasks touch any `actions.ts` file.
