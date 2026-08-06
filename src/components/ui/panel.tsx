import { cn } from "@/lib/utils";

/**
 * Superficie de datos: borde de 1px sobre el fondo casi-blanco, sin sombra.
 *
 * Existe porque la misma cadena de clases estaba copiada en 30 lugares de 24
 * archivos, y de esas 30 solo 10 llevaban `overflow-hidden` — las otras dejaban
 * asomar las esquinas cuadradas del encabezado de tabla por fuera del radio.
 * Eso se veía hoy en /reportes y /comisiones.
 *
 * No reemplaza a `Card`: `Card` es el bloque con header, footer y acciones de
 * shadcn. `Panel` es la caja pelada que envuelve una tabla o un formulario,
 * que es lo que este producto usa casi siempre.
 */
export function Panel({
  className,
  flush = false,
  ...props
}: React.ComponentProps<"div"> & {
  /**
   * El contenido llega hasta el borde: una tabla, una lista de filas. Recorta
   * al radio en vez de poner padding, que es justo lo que se olvidaba a mano.
   */
  flush?: boolean;
}) {
  return (
    <div
      data-slot="panel"
      className={cn(
        "rounded-xl border border-border bg-card",
        flush ? "overflow-hidden" : "p-4",
        className,
      )}
      {...props}
    />
  );
}
