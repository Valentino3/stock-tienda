import { cn } from "@/lib/utils";

type Tone = "info" | "warn" | "success" | "danger";

const toneClass: Record<Tone, string> = {
  info: "border-brand/30 bg-brand-muted text-brand",
  warn: "border-warning/40 bg-warning/10 text-foreground",
  success: "border-success/30 bg-success/10 text-foreground",
  danger: "border-destructive/30 bg-destructive/10 text-foreground",
};

/**
 * Aviso contextual. Fondo tenue + borde completo (nunca barra lateral).
 *
 * Pasa el resto de los atributos al div para que quien lo usa pueda poner
 * `role="alert"` cuando el aviso aparece DESPUÉS de una acción del usuario —
 * un error al cerrar la caja tiene que anunciarse solo; una explicación que ya
 * estaba en la pantalla, no.
 */
export function Notice({
  tone = "info",
  children,
  className,
  ...props
}: React.ComponentProps<"div"> & { tone?: Tone }) {
  return (
    <div
      className={cn("rounded-xl border px-4 py-3 text-sm", toneClass[tone], className)}
      {...props}
    >
      {children}
    </div>
  );
}
