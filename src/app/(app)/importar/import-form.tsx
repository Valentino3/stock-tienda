"use client";
import { useRef, useState, useTransition } from "react";
import { Upload, FileSpreadsheet, Sparkles } from "lucide-react";
import type { ValidatedRow } from "@/domain/import";
import type { BatchSummary } from "@/domain/import-batches";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { money, number } from "@/lib/format";
import { compressImage } from "@/lib/compress-image";
import { MAX_UPLOAD_BYTES, tooLargeMessage } from "@/lib/import-limits";
import { confirmImport } from "./actions";

type Result = { created: number; updated: number; skipped: number };
type Mode = "excel" | "ai";

/** Cómo se leyó la planilla. Solo lo devuelve el import de Excel. */
type Mapping = {
  detected: { field: string; label: string; column: string }[];
  ignored: string[];
  usedLegacy: boolean;
  headerRow: number;
  hasStock: boolean;
  matchByName: boolean;
};
type Batch = BatchSummary & { mapping?: Mapping };

const ENDPOINT: Record<Mode, string> = { excel: "/importar/parse", ai: "/importar/extract" };

export function ImportForm() {
  const [mode, setMode] = useState<Mode>("excel");
  const [batch, setBatch] = useState<Batch | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setBatch(null);
    setError("");
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function switchMode(next: Mode) {
    setMode(next);
    reset();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setError("");
    setResult(null);
    setBatch(null);

    startTransition(async () => {
      try {
        // Las fotos se comprimen acá: una foto de celular pesa más que el
        // máximo que acepta el servidor y subirla cruda daba 413.
        const file = picked.type.startsWith("image/") ? await compressImage(picked) : picked;
        if (file.size > MAX_UPLOAD_BYTES) {
          const kind = file.type === "application/pdf" ? "pdf" : mode === "ai" ? "image" : "xlsx";
          setError(tooLargeMessage(kind, file.size));
          return;
        }

        const body = new FormData();
        body.set("file", file);
        const res = await fetch(ENDPOINT[mode], { method: "POST", body });

        if (!res.ok) {
          setError(await errorFor(res));
          return;
        }
        setBatch((await res.json()) as Batch);
      } catch (err) {
        // Sin este catch, un 413 o una caída de red rechazaban la promesa sin
        // manejo y rompían la pantalla en vez de mostrar el problema.
        console.error("[importar] subida falló", err);
        setError("No se pudo subir el archivo. Revisá tu conexión y probá de nuevo.");
      }
    });
  }

  function handleConfirm() {
    if (!batch) return;
    setError("");
    startTransition(async () => {
      try {
        const res = await confirmImport(batch.batchId);
        setResult(res);
        setBatch(null);
      } catch (err) {
        console.error("[importar] confirmación falló", err);
        setError("No se pudo confirmar la importación. Volvé a subir el archivo.");
      }
    });
  }

  const hidden = batch ? batch.total - batch.preview.length : 0;

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
        {mode === "ai" && (
          <span className="text-xs text-muted-foreground">
            Las fotos se comprimen solas. Los PDF tienen que pesar menos de 4 MB.
          </span>
        )}
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

      {pending && !batch && !result && (
        <p className="text-sm text-muted-foreground">
          {mode === "ai" ? "Leyendo el documento con IA…" : "Procesando…"}
        </p>
      )}

      {batch && batch.total > 0 && (
        <div className="space-y-4 pb-20">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success" className="font-mono">{number(batch.valid)} válidas</Badge>
            {batch.errors > 0 && (
              <Badge variant="destructive" className="font-mono">{number(batch.errors)} con error</Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {mode === "ai"
                ? "“Actualizar” suma al stock existente; “Crear” da de alta el producto. Revisá antes de confirmar."
                : "Las filas con error se omiten al confirmar."}
            </span>
          </div>

          {batch.mapping && <MappingSummary mapping={batch.mapping} />}

          <div className="max-h-[60vh] overflow-auto rounded-xl border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fila</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Variante</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Precio venta</TableHead>
                  <TableHead className="text-right">Efvo. menor</TableHead>
                  <TableHead className="text-right">Mayorista</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead className="text-right">{mode === "ai" ? "Cantidad" : "Stock"}</TableHead>
                  <TableHead>Set</TableHead>
                  <TableHead>Condición</TableHead>
                  <TableHead>Foil</TableHead>
                  <TableHead>Idioma</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batch.preview.map((r: ValidatedRow) => (
                  <TableRow key={r.rowNumber} className={r.error ? "bg-destructive/10 hover:bg-destructive/15" : ""}>
                    <TableCell className="figure text-muted-foreground">{r.rowNumber}</TableCell>
                    <TableCell className="font-medium">{r.product}</TableCell>
                    <TableCell>{r.variant}</TableCell>
                    <TableCell className="figure text-muted-foreground">{r.sku ?? ""}</TableCell>
                    <TableCell className="text-right font-mono">{r.price != null ? money(r.price) : ""}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{r.priceCash != null ? money(r.priceCash) : ""}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">{r.priceWholesale != null ? money(r.priceWholesale) : ""}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {r.costArs != null ? money(r.costArs) : ""}
                      {r.costUsd != null && <span className="block text-xs">US$ {number(r.costUsd)}</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.supplier ?? ""}</TableCell>
                    <TableCell className="text-right font-mono">
                      {r.stock === null
                        ? <span className="text-xs text-muted-foreground">sin cambio</span>
                        : number(r.stock)}
                    </TableCell>
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

          {hidden > 0 && (
            <p className="text-xs text-muted-foreground">
              Mostrando las primeras {number(batch.preview.length)} de {number(batch.total)} filas.
              Al confirmar se procesan todas.
            </p>
          )}

          <div className="fixed inset-x-0 bottom-0 flex items-center gap-3 border-t border-border bg-background/95 p-4 backdrop-blur-sm lg:sticky lg:inset-x-auto lg:rounded-xl lg:border">
            <Button size="lg" disabled={pending || batch.valid === 0} onClick={handleConfirm}>
              {pending
                ? "Confirmando…"
                : `Confirmar importación (${number(batch.valid)} válidas${batch.errors > 0 ? `, ${number(batch.errors)} se omiten` : ""})`}
            </Button>
            <Button variant="ghost" disabled={pending} onClick={reset}>
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
          <Button variant="link" className="px-0" onClick={reset}>
            Importar otro documento
          </Button>
        </Notice>
      )}
    </div>
  );
}

/**
 * Cómo se interpretó la planilla. Se muestra ANTES de la tabla porque las dos
 * advertencias que trae —que no se toca el stock, y que se matchea por nombre—
 * cambian qué va a pasar al confirmar, y no se deducen mirando las filas.
 */
function MappingSummary({ mapping }: { mapping: Mapping }) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-medium">Columnas reconocidas</span>
        {mapping.usedLegacy && (
          <span className="text-xs text-muted-foreground">
            (sin encabezados reconocibles: se leyó con el orden de la plantilla)
          </span>
        )}
        {!mapping.usedLegacy && mapping.headerRow > 1 && (
          <span className="text-xs text-muted-foreground">
            (encabezados detectados en la fila {number(mapping.headerRow)})
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {mapping.detected.map((d) => (
          <Badge key={d.field} variant="secondary" className="font-normal">
            {d.column} <span className="mx-1 text-muted-foreground">→</span> {d.label}
          </Badge>
        ))}
      </div>

      {mapping.ignored.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Sin usar: {mapping.ignored.join(", ")}
        </p>
      )}

      {!mapping.hasStock && (
        <Notice tone="warn">
          La planilla no tiene columna <strong>Stock</strong>, así que el stock actual no se
          modifica. Se actualizan solo precios, costos y proveedor.
        </Notice>
      )}

      {mapping.matchByName && (
        <p className="text-xs text-muted-foreground">
          Sin columna <strong>SKU</strong>: los productos se reconocen por nombre exacto. Si un
          nombre no coincide con uno ya cargado, se crea uno nuevo.
        </p>
      )}
    </div>
  );
}

/** Traduce la respuesta de error del endpoint a algo que el usuario pueda accionar. */
async function errorFor(res: Response): Promise<string> {
  // 413 lo puede emitir la plataforma antes de llegar al handler, y en ese caso
  // el body no es JSON nuestro.
  if (res.status === 413) {
    return "El archivo es demasiado grande para el servidor (máximo 4 MB). Sacá una foto en vez de usar el PDF, o dividí la planilla.";
  }
  if (res.status === 504) {
    return "El documento tardó demasiado en procesarse. Probá con una imagen más chica o menos páginas.";
  }
  try {
    const data = await res.json();
    if (typeof data?.error === "string") return data.error;
  } catch {
    // body vacío o HTML de la plataforma: cae al genérico de abajo
  }
  return `No se pudo procesar el archivo (error ${res.status}).`;
}
