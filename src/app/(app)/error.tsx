"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Algo se rompió en el servidor mientras se armaba la pantalla.
 *
 * Sin este archivo, un throw en cualquier Server Component cae en la página de
 * error por defecto de Next: Times New Roman, sin barra lateral, sin nombre del
 * local. Alguien que está cobrando ve eso y asume que perdió la venta.
 *
 * "Reintentar" antes que "Volver": la mayoría de estos errores son la base o la
 * red por un segundo, y volver a pedir la misma pantalla alcanza. El texto no
 * muestra el mensaje técnico —Next lo esconde en producción igual— pero sí deja
 * claro que lo cobrado está guardado, que es la única pregunta que importa
 * frente a un cliente.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] error de pantalla", error);
  }, [error]);

  return (
    <EmptyState
      icon={TriangleAlert}
      titulo="No se pudo cargar esta pantalla"
      detalle="Las ventas y la caja que ya se guardaron no se tocan. Probá de nuevo; si sigue, cerrá sesión y volvé a entrar."
      accion={
        <Button onClick={reset} size="sm">
          <RotateCcw className="size-4" />
          Reintentar
        </Button>
      }
    />
  );
}
