"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
      <div className="max-w-md space-y-2 rounded border p-4">
        <h2 className="font-semibold">Caja cerrada</h2>
        <p className="text-sm">Esperado: ${closedResult.expectedCash.toFixed(2)}</p>
        <p className="text-sm">Contado: ${closedResult.countedCash.toFixed(2)}</p>
        <p className={`text-sm font-semibold ${matches ? "text-green-600" : "text-red-600"}`}>
          Diferencia: ${closedResult.difference.toFixed(2)}
        </p>
      </div>
    );
  }

  if (!session) {
    return (
      <form onSubmit={submitOpen} className="max-w-xs space-y-3 rounded border p-4">
        <h2 className="font-semibold">Abrir caja</h2>
        <input
          type="number"
          step="0.01"
          min="0"
          required
          placeholder="Monto inicial"
          value={openingCash}
          onChange={(e) => setOpeningCash(e.target.value)}
          className="w-full rounded border p-2 text-sm"
        />
        {openError && <p className="text-xs text-red-600">{openError}</p>}
        <button disabled={pending} className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50">
          {pending ? "Abriendo…" : "Abrir caja"}
        </button>
      </form>
    );
  }

  return (
    <div className="max-w-md space-y-4">
      <div className="rounded border p-4">
        <h2 className="font-semibold">Caja abierta</h2>
        <p className="text-xs text-gray-500">
          Abierta el {session.openedAt.toLocaleString("es-AR")} por {openedByName ?? "—"}
        </p>
        <p className="text-xs text-gray-500">Monto inicial: ${session.openingCash.toFixed(2)}</p>
      </div>

      <div className="rounded border p-4">
        <h3 className="mb-2 text-sm font-semibold">Ventas de la sesión</h3>
        {totals.length === 0 ? (
          <p className="text-xs text-gray-500">Sin ventas todavía.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {totals.map((t) => (
              <li key={t.method}>
                {METHOD_LABEL[t.method] ?? t.method}: {t.count} venta(s) — ${t.total.toFixed(2)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={submitClose} className="space-y-2 rounded border p-4">
        <h3 className="text-sm font-semibold">Cerrar caja</h3>
        <input
          type="number"
          step="0.01"
          min="0"
          required
          placeholder="Efectivo contado"
          value={countedCash}
          onChange={(e) => setCountedCash(e.target.value)}
          className="w-full rounded border p-2 text-sm"
        />
        <textarea
          placeholder="Notas (opcional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="w-full rounded border p-2 text-sm"
        />
        {closeError && <p className="text-xs text-red-600">{closeError}</p>}
        <button disabled={pending} className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50">
          {pending ? "Cerrando…" : "Cerrar caja"}
        </button>
      </form>
    </div>
  );
}
