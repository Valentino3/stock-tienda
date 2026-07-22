import { cn } from "@/lib/utils";

/**
 * Etiqueta de sección estilo libro mayor (mayúscula con tracking). Opcionalmente
 * lleva contenido a la derecha (contador, acciones). Es la gramática de
 * sección elegida; usar consistente, no como adorno suelto.
 */
export function SectionLabel({
  children,
  aside,
  className,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <span className="ledger-label">{children}</span>
      {aside && <div className="flex items-center gap-2">{aside}</div>}
    </div>
  );
}

/** Sección de datos: etiqueta + contenido, con ritmo vertical consistente. */
export function Section({
  label,
  aside,
  children,
  className,
}: {
  label: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <SectionLabel aside={aside}>{label}</SectionLabel>
      {children}
    </section>
  );
}
