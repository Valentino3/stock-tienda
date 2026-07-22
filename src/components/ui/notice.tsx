import { cn } from "@/lib/utils";

type Tone = "info" | "warn" | "success" | "danger";

const toneClass: Record<Tone, string> = {
  info: "border-brand/30 bg-brand-muted text-brand",
  warn: "border-chart-3/40 bg-chart-3/10 text-foreground",
  success: "border-success/30 bg-success/10 text-foreground",
  danger: "border-destructive/30 bg-destructive/10 text-foreground",
};

/** Aviso contextual. Fondo tenue + borde completo (nunca barra lateral). */
export function Notice({
  tone = "info",
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("rounded-xl border px-4 py-3 text-sm", toneClass[tone], className)}
    >
      {children}
    </div>
  );
}
