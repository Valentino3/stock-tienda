"use client";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * "Imprimir" del navegador. Su diálogo ya ofrece "Guardar como PDF", así que el
 * cliente se lleva su PDF sin que tengamos que generar ni almacenar ninguno.
 */
export function PrintButton() {
  return (
    <Button size="sm" onClick={() => window.print()}>
      <Printer className="size-4" />
      Imprimir
    </Button>
  );
}
