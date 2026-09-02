"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { money, number } from "@/lib/format";
import type { PriceRecalcTarget } from "@/db/schema";
import type { ResumenRecalculo } from "@/domain/pricing-recalc";
import { previsualizarRecalculo, confirmarRecalculo, revertirRecalculo } from "./actions";

/**
 * Previsualizar → confirmar → (deshacer).
 *
 * La previsualización no es un lujo: esto reescribe todos los precios del local
 * y no tiene deshacer por fila. Un cero de más en la cotización es un catálogo
 * diez veces más caro, y la única defensa real es leer "de $87.200 a $872.000"
 * antes de apretar.
 */

/** El primer valor no nulo de la cara: es el que la fila muestra. */
const valorDe = (c: PriceRecalcTarget["antes"]) => c.price ?? c.priceCash ?? c.priceWholesale;

function variacion(t: PriceRecalcTarget): string {
  const antes = valorDe(t.antes);
  const despues = valorDe(t.despues);
  if (antes == null || despues == null || antes === 0) return "—";
  const pct = (despues / antes - 1) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

export function RecalculoPanel({
  hayCotizacion,
  ultimoLote,
}: {
  hayCotizacion: boolean;
  ultimoLote: { id: string; confirmadoEn: Date | null; cambiados: number } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [resumen, setResumen] = useState<ResumenRecalculo | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  function previsualizar() {
    startTransition(async () => {
      const res = await previsualizarRecalculo();
      if ("error" in res) { toast.error(res.error); return; }
      setResumen(res.resumen);
    });
  }

  function aplicar() {
    if (!resumen) return;
    startTransition(async () => {
      const res = await confirmarRecalculo(resumen.batchId);
      setConfirmando(false);
      if ("error" in res) { toast.error(res.error); return; }
      setResumen(null);
      // El dueño es el único que puede caminar hasta la tablet que está por
      // salir a una feria. Si no se lo decimos acá, no se entera nunca.
      toast.success(`${resumen.changed} precios actualizados`, {
        description:
          "Si hay dispositivos vendiendo sin conexión, tienen que volver a descargar el catálogo: hasta entonces siguen cobrando los precios viejos.",
        duration: 12000,
      });
      router.refresh();
    });
  }

  function deshacer() {
    if (!ultimoLote) return;
    startTransition(async () => {
      const res = await revertirRecalculo(ultimoLote.id);
      if ("error" in res) { toast.error(res.error); return; }
      toast.success(
        res.salteados > 0
          ? `Precios restaurados. ${res.salteados} quedaron como estaban porque se editaron a mano después.`
          : "Precios restaurados."
      );
      router.refresh();
    });
  }

  if (!hayCotizacion) {
    return (
      <Notice tone="info">
        Cargá la cotización del dólar para poder actualizar precios.
      </Notice>
    );
  }

  return (
    <div className="space-y-4">
      {!resumen && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={previsualizar} disabled={pending}>
            {pending ? "Calculando…" : "Previsualizar cambios"}
          </Button>
          <span className="text-sm text-muted-foreground">
            No se cambia nada hasta que confirmes.
          </span>
        </div>
      )}

      {resumen && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Cambian" value={number(resumen.changed)} tone={resumen.changed ? "brand" : "default"} />
            <StatTile label="Ya estaban al día" value={number(resumen.unchanged)} hint="Mismo resultado" />
            <StatTile
              label="Sin precio en dólares"
              value={number(resumen.skipped)}
              hint="No se tocan"
            />
            <StatTile
              label="Con precio propio"
              value={number(resumen.overridden)}
              tone={resumen.overridden ? "destructive" : "default"}
              hint="No se mueven"
            />
          </div>

          {resumen.skipped > 0 && (
            <p className="text-sm text-muted-foreground">
              {number(resumen.skipped)} artículos no tienen precio en dólares y quedan
              como están.{" "}
              <Link href="/productos?usd=sin" className="underline underline-offset-2">
                Ver cuáles
              </Link>
            </p>
          )}

          {resumen.overridden > 0 && (
            <Notice tone="warn">
              {number(resumen.overridden)} variantes heredan el dólar de su producto
              pero tienen precio propio en pesos: el mostrador va a seguir cobrándoles
              lo mismo. Para que sigan la cotización, borrales el precio propio o
              cargales su propio precio en dólares.
            </Notice>
          )}

          {resumen.preview.length === 0 ? (
            <Notice tone="info">Con esta cotización no cambia ningún precio.</Notice>
          ) : (
            <>
              {/* Ordenado por variación y no alfabéticamente: un error de 10× en
                  una lista por nombre queda enterrado en la página 4. */}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Artículo</TableHead>
                    <TableHead className="text-right">USD</TableHead>
                    <TableHead className="text-right">Ahora</TableHead>
                    <TableHead className="text-right">Queda en</TableHead>
                    <TableHead className="text-right">Var.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resumen.preview.map((t) => (
                    <TableRow key={`${t.nivel}-${t.variantId ?? t.productId}`}>
                      <TableCell>
                        {t.nombre}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t.nivel === "producto" ? "producto" : "variante"}
                        </span>
                      </TableCell>
                      <TableCell className="figure text-right">US$ {t.usd}</TableCell>
                      <TableCell className="figure text-right text-muted-foreground">
                        {valorDe(t.antes) != null ? money(valorDe(t.antes)!) : "—"}
                      </TableCell>
                      <TableCell className="figure text-right font-medium">
                        {valorDe(t.despues) != null ? money(valorDe(t.despues)!) : "—"}
                      </TableCell>
                      <TableCell className="figure text-right">{variacion(t)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {resumen.changed > resumen.preview.length && (
                <p className="text-sm text-muted-foreground">
                  Se muestran los {resumen.preview.length} de mayor variación.
                </p>
              )}
            </>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setConfirmando(true)} disabled={pending || resumen.changed === 0}>
              Aplicar a {number(resumen.changed)} precios
            </Button>
            <Button type="button" variant="outline" onClick={() => setResumen(null)} disabled={pending}>
              Cancelar
            </Button>
          </div>

          <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Actualizar precios</AlertDialogTitle>
                <AlertDialogDescription>
                  Se van a reescribir {number(resumen.changed)} precios con la cotización{" "}
                  {money(resumen.usdRate)}. Las ventas y los comprobantes ya emitidos no
                  se tocan.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={aplicar} disabled={pending}>
                  {pending ? "Aplicando…" : "Sí, actualizar"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}

      {!resumen && ultimoLote && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            Última actualización: {number(ultimoLote.cambiados)} precios
            {ultimoLote.confirmadoEn && ` el ${ultimoLote.confirmadoEn.toLocaleString("es-AR")}`}.
          </span>
          <Button type="button" variant="outline" size="sm" onClick={deshacer} disabled={pending}>
            Deshacer
          </Button>
        </div>
      )}
    </div>
  );
}
