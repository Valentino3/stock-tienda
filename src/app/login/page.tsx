"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await authClient.signIn.email({ email, password });
    if (error) setError("Email o contraseña incorrectos");
    else router.push("/vender");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-lg border p-6">
        <h1 className="text-xl font-bold">Ingresar</h1>
        <input className="w-full rounded border p-2" type="email" placeholder="Email"
          value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="w-full rounded border p-2" type="password" placeholder="Contraseña"
          value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full rounded bg-black p-2 text-white" type="submit">Entrar</button>
      </form>
    </main>
  );
}
