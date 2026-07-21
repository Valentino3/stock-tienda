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
                  <TableHead>Set</TableHead>
                  <TableHead>Condición</TableHead>
                  <TableHead>Foil</TableHead>
                  <TableHead>Idioma</TableHead>
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
                    <TableCell>{r.setName ?? ""}</TableCell>
                    <TableCell>{r.condition ?? ""}</TableCell>
                    <TableCell>{r.foil ? "Sí" : ""}</TableCell>
                    <TableCell>{r.language ?? ""}</TableCell>
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
