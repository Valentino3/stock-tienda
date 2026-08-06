import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Estado vacío.
 *
 * Había dos tratamientos y medio repartidos en 19 lugares —panel punteado con
 * cuatro paddings distintos, y párrafo gris pelado— y /reportes usaba los dos
 * en la misma pantalla, en secciones del mismo peso visual.
 *
 * La distinción que importa es `filtrado`: "todavía no hay clientes" y "ningún
 * artículo con estos filtros" son mensajes distintos con acciones distintas, y
 * hoy la app no los separa en ninguna pantalla. Mostrar "no hay nada" cuando en
 * realidad hay 400 productos y el filtro está mal puesto es el peor caso.
 *
 * El texto se escribe en el idioma del negocio, no "sin datos" (DESIGN.md).
 */
export function EmptyState({
  icon: Icon,
  titulo,
  detalle,
  accion,
  filtrado = false,
  className,
}: {
  icon?: LucideIcon;
  titulo: string;
  /** Una línea de contexto. Opcional: en una sección chica sobra. */
  detalle?: string;
  /** Botón o enlace. En `filtrado` suele ser "Limpiar filtros". */
  accion?: React.ReactNode;
  /** Hay datos, pero el filtro los dejó afuera. */
  filtrado?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border bg-card/50 px-4 py-10 text-center",
        // Vacío de verdad = punteado: el mismo idioma de "acá todavía no hay
        // nada" que usan el plano sin mesas y el chip de agregar filtro.
        // Filtrado = borde sólido: los datos existen, lo que falta es
        // destapar el filtro, y eso no es un hueco por llenar.
        filtrado ? "border-border" : "border-dashed border-border",
        className,
      )}
    >
      {Icon && (
        <span
          className={cn(
            "flex size-9 items-center justify-center rounded-lg text-muted-foreground/70",
            filtrado ? "border border-dashed border-border" : "bg-muted",
          )}
        >
          <Icon className="size-4.5" aria-hidden />
        </span>
      )}
      <p className="text-sm font-medium">{titulo}</p>
      {detalle && <p className="max-w-prose text-sm text-muted-foreground">{detalle}</p>}
      {accion && <div className="mt-1">{accion}</div>}
    </div>
  );
}
