"use client";
import { useState, useTransition } from "react";
import { voidSaleAction } from "./actions";

export function VoidButton({ saleId }: { saleId: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function handleClick(e: React.MouseEvent) {
    // Evita que el click "burbujee" hasta el <summary> padre y colapse/expanda
    // la fila de detalle en lugar de (o además de) anular la venta.
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("¿Anular esta venta? Esta acción no se puede deshacer.")) return;
    startTransition(async () => {
      const res = await voidSaleAction(saleId);
      if ("error" in res && res.error) setError(res.error);
      else setError("");
    });
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="text-xs text-red-600 hover:underline disabled:opacity-50"
      >
        {pending ? "Anulando…" : "Anular"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
