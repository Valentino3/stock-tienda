"use client";
import { useRef, useState, useTransition } from "react";
import { Upload, FileSpreadsheet, Sparkles } from "lucide-react";
import type { ValidatedRow } from "@/domain/import";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { money, number } from "@/lib/format";
import { parseAndValidate, extractFromDocument, confirmImport } from "./actions";

type Result = { created: number; updated: number; skipped: number };
type Mode = "excel" | "ai";

export function ImportForm() {
  const [mode, setMode] = useState<Mode>("excel");
  const [rows, setRows] = useState<ValidatedRow[] | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validCount = rows?.filter((r) => !r.error).length ?? 0;
  const errorCount = rows?.filter((r) => r.error).length ?? 0;

  function switchMode(next: Mode) {
    setMode(next);
    setRows(null);
    setError("");
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setResult(null);
    setRows(null);
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      const res = mode === "ai" ? await extractFromDocument(formData) : await parseAndValidate(formData);
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
        const res = await confirmImport(rows, mode === "ai" ? "add" : "absolute");
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
    <div className="max-w-4xl space-y-5">
      <div className="inline-flex rounded-lg border border-border p-1">
        {([
          { m: "excel" as const, icon: FileSpreadsheet, label: "Planilla Excel" },
          { m: "ai" as const, icon: Sparkles, label: "Documento con IA" },
        ]).map(({ m, icon: Icon, label }) => (
          <button
            key={m}
            type="button"
            onClick={() => switchMode(m)}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              mode === m ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-card px-6 py-10 text-center transition-colors hover:border-brand/50 hover:bg-accent">
        <Upload className="size-6 text-muted-foreground" />
        <span className="text-sm font-medium">
          {mode === "ai" ? "Elegí una foto o PDF de la factura" : "Elegí o soltá tu archivo .xlsx"}
        </span>
        <span className="text-xs text-muted-foreground">
          {mode === "ai"
            ? "La IA extrae productos, cantidad y precio. El stock se SUMA al existente."
            : "Se valida cada fila antes de confirmar. El stock reemplaza al valor actual."}
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept={mode === "ai" ? "image/*,application/pdf" : ".xlsx"}
          disabled={pending}
          onChange={handleFileChange}
          className="sr-only"
        />
      </label>

      {error && <Notice tone="danger">{error}</Notice>}

      {pending && !rows && !result && (
        <p className="text-sm text-muted-foreground">
          {mode === "ai" ? "Leyendo el documento con IA…" : "Procesando…"}
        </p>
      )}

      {rows && rows.length > 0 && (
        <div className="space-y-4 pb-20">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success" className="font-mono">{number(validCount)} válidas</Badge>
            {errorCount > 0 && (
              <Badge variant="destructive" className="font-mono">{number(errorCount)} con error</Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {mode === "ai"
                ? "“Actualizar” suma al stock existente; “Crear” da de alta el producto. Revisá antes de confirmar."
                : "Las filas con error se omiten al confirmar."}
            </span>
          </div>

          <div className="max-h-[60vh] overflow-auto rounded-xl border border-border bg-card shadow-xs">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fila</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Variante</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead className="text-right">{mode === "ai" ? "Cantidad" : "Stock"}</TableHead>
                  <TableHead>Set</TableHead>
                  <TableHead>Condición</TableHead>
                  <TableHead>Foil</TableHead>
                  <TableHead>Idioma</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.rowNumber} className={r.error ? "bg-destructive/10 hover:bg-destructive/15" : ""}>
                    <TableCell className="figure text-muted-foreground">{r.rowNumber}</TableCell>
                    <TableCell className="font-medium">{r.product}</TableCell>
                    <TableCell>{r.variant}</TableCell>
                    <TableCell className="figure text-muted-foreground">{r.sku ?? ""}</TableCell>
                    <TableCell className="text-right font-mono">{r.price != null ? money(r.price) : ""}</TableCell>
                    <TableCell className="text-right font-mono">{number(r.stock)}</TableCell>
                    <TableCell className="text-muted-foreground">{r.setName ?? ""}</TableCell>
                    <TableCell className="text-muted-foreground">{r.condition ?? ""}</TableCell>
                    <TableCell>{r.foil ? "Sí" : ""}</TableCell>
                    <TableCell className="text-muted-foreground">{r.language ?? ""}</TableCell>
                    <TableCell>
                      {r.error ? (
                        <span className="text-sm text-destructive">{r.error}</span>
                      ) : (
                        <Badge variant={r.action === "update" ? "brand" : "secondary"}>
                          {r.action === "update" ? "Actualizar" : "Crear"}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="fixed inset-x-0 bottom-0 flex items-center gap-3 border-t border-border bg-background/95 p-4 backdrop-blur-sm lg:sticky lg:inset-x-auto lg:rounded-xl lg:border">
            <Button size="lg" disabled={pending || validCount === 0} onClick={handleConfirm}>
              {pending
                ? "Confirmando…"
                : `Confirmar importación (${validCount} válidas${errorCount > 0 ? `, ${errorCount} se omiten` : ""})`}
            </Button>
            <Button variant="ghost" disabled={pending} onClick={startOver}>
              Empezar de nuevo
            </Button>
          </div>
        </div>
      )}

      {result && (
        <Notice tone="success" className="space-y-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span><span className="figure font-semibold text-foreground">{number(result.created)}</span> creados</span>
            <span><span className="figure font-semibold text-foreground">{number(result.updated)}</span> actualizados</span>
            <span><span className="figure font-semibold text-foreground">{number(result.skipped)}</span> omitidos</span>
          </div>
          <Button variant="link" className="px-0" onClick={startOver}>
            Importar otro documento
          </Button>
        </Notice>
      )}
    </div>
  );
}
