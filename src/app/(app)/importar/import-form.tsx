"use client";
import { useRef, useState, useTransition } from "react";
import type { ValidatedRow } from "@/domain/import";
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
        className="block text-sm"
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      {pending && !rows && !result && <p className="text-sm text-gray-500">Procesando…</p>}

      {rows && rows.length > 0 && (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs text-gray-500">
                  <th className="p-2">Fila</th>
                  <th className="p-2">Producto</th>
                  <th className="p-2">Variante</th>
                  <th className="p-2">SKU</th>
                  <th className="p-2">Precio</th>
                  <th className="p-2">Stock</th>
                  <th className="p-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.rowNumber} className={`border-b last:border-0 ${r.error ? "bg-red-50" : ""}`}>
                    <td className="p-2">{r.rowNumber}</td>
                    <td className="p-2">{r.product}</td>
                    <td className="p-2">{r.variant}</td>
                    <td className="p-2">{r.sku ?? ""}</td>
                    <td className="p-2">{r.price ?? ""}</td>
                    <td className="p-2">{r.stock}</td>
                    <td className="p-2">
                      {r.error ? (
                        <span className="text-red-600">{r.error}</span>
                      ) : (
                        <span className="rounded bg-gray-200 px-2 py-0.5 text-xs">
                          {r.action === "update" ? "actualizar" : "crear"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={pending || validCount === 0}
              onClick={handleConfirm}
              className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {pending
                ? "Confirmando…"
                : `Confirmar importación (${validCount} válidas, ${errorCount} con error se omiten)`}
            </button>
            <button type="button" disabled={pending} onClick={startOver} className="text-sm text-gray-500 hover:underline">
              Empezar de nuevo
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-green-600">
            {result.created} creados, {result.updated} actualizados, {result.skipped} omitidos
          </p>
          <button type="button" onClick={startOver} className="text-sm text-blue-600 hover:underline">
            Importar otro archivo
          </button>
        </div>
      )}
    </div>
  );
}
