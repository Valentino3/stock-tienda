"use client";
import { useState, useTransition } from "react";
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
    <div>
      <button type="button" className="rounded border px-2 py-1 text-sm" onClick={() => setOpen(true)}>
        + Nuevo empleado
      </button>

      {open && (
        <div
          className="fixed inset-0 z-10 flex items-center justify-center bg-black/30"
          onClick={() => setOpen(false)}
        >
          <form
            onSubmit={submit}
            onClick={(e) => e.stopPropagation()}
            className="w-80 space-y-3 rounded bg-white p-4 shadow"
          >
            <h3 className="font-semibold">Nuevo empleado</h3>
            <input
              className="w-full rounded border p-2 text-sm"
              placeholder="Nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <input
              className="w-full rounded border p-2 text-sm"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <input
              className="w-full rounded border p-2 text-sm"
              type="password"
              placeholder="Contraseña (mínimo 8 caracteres)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="text-sm" onClick={() => setOpen(false)}>
                Cancelar
              </button>
              <button type="submit" disabled={pending} className="rounded bg-black px-3 py-1 text-sm text-white">
                Crear
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
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
  const [error, setError] = useState("");

  function handleClick() {
    startTransition(async () => {
      const res = await setUserActive(userId, banned);
      if ("error" in res && res.error) setError(res.error);
      else setError("");
    });
  }

  return (
    <span className="inline-flex items-center gap-1 justify-self-end">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={`text-xs hover:underline disabled:opacity-50 ${banned ? "text-green-700" : "text-red-600"}`}
      >
        {pending ? "..." : banned ? "Activar" : "Desactivar"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
