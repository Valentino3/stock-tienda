"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Label } from "@/components/ui/label";
import { APP_NAME } from "@/lib/config";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.slice(0, 2).map((p) => p[0]).join("") || "·").toUpperCase();
}

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
    else router.push("/"); // la raíz rutea por rol (super-admin vs tienda)
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="flex size-11 items-center justify-center rounded-lg bg-brand figure text-base font-semibold tracking-tight text-brand-foreground">
            {initials(APP_NAME)}
          </span>
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">{APP_NAME}</h1>
            <p className="text-sm text-muted-foreground">Ingresá con tu cuenta para continuar.</p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="vos@comercio.com"
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
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <Notice tone="danger" role="alert">
                {error}
              </Notice>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              {pending ? "Ingresando…" : "Entrar"}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Sistema de stock y ventas
        </p>
      </div>
    </main>
  );
}
