import { cn } from "@/lib/utils";

/**
 * Bloque de carga. Va con la FORMA de lo que se está esperando —el ancho de la
 * columna, la altura de la fila— y no como una barra genérica: un esqueleto que
 * no coincide con lo que llega después produce un salto peor que no haber
 * puesto nada.
 */
export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // aria-hidden: es decorativo. Quien avisa que la página está cargando es
      // el contenedor con aria-busy, no cada barrita.
      aria-hidden
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

/**
 * Filas de tabla en carga, con la misma altura y padding que `TableCell`.
 * Recibe los anchos de columna para que las barras caigan donde van a caer los
 * datos.
 */
export function SkeletonRows({
  filas = 5,
  anchos,
}: {
  filas?: number;
  /** Ancho de cada columna, en clases de Tailwind. Define cuántas columnas hay. */
  anchos: string[];
}) {
  return (
    <div role="status" aria-busy aria-label="Cargando">
      {Array.from({ length: filas }, (_, f) => (
        <div
          key={f}
          className="flex items-center gap-4 border-b border-border px-3 py-2.5 last:border-0"
          // Las últimas se desvanecen: sugiere que la lista sigue, en vez de
          // terminar en un corte duro que parece el final de los datos.
          style={{ opacity: 1 - f * (0.6 / filas) }}
        >
          {anchos.map((ancho, c) => (
            <Skeleton key={c} className={cn("h-4", ancho)} />
          ))}
        </div>
      ))}
    </div>
  );
}
