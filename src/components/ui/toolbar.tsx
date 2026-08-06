import { cn } from "@/lib/utils";
import { Panel } from "./panel";

/**
 * Barra de filtros. Es una superficie, no una fila suelta: el mockup del ERP
 * la trata como card y eso es lo que la separa de los datos que filtra.
 *
 * Estaba escrita a mano en /productos, /ventas, /reportes y /comisiones, con
 * padding distinto en cada una.
 *
 * Los campos van etiquetados (`Campo`) y no con placeholder: acá los filtros
 * se dejan puestos entre visitas, y un placeholder desaparece apenas hay valor
 * — el operador vuelve a la pantalla y no sabe por qué ve lo que ve.
 */
export function Toolbar({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <Panel
      className={cn("flex flex-wrap items-end gap-x-3 gap-y-2 p-3", className)}
      {...props}
    >
      {children}
    </Panel>
  );
}

/** Etiqueta arriba, control abajo. La etiqueta usa la gramática de sección. */
export function Campo({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label className="ledger-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Empuja lo que sigue al extremo derecho de la barra: el contador de
 * resultados, el botón de exportar.
 */
export function ToolbarFin({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("ml-auto flex items-end gap-2", className)} {...props} />;
}
