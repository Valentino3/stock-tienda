import { cn } from "@/lib/utils";

type Tone = "default" | "brand" | "success" | "destructive";

const toneText: Record<Tone, string> = {
  default: "text-foreground",
  brand: "text-brand",
  success: "text-success",
  destructive: "text-destructive",
};

/**
 * KPI estilo libro mayor: regla superior fina, etiqueta chica, cifra grande en
 * mono tabular. Sin sombra ni card con acento — la cifra hace el trabajo.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = "default",
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={cn("border-t-2 border-foreground/80 pt-3", className)}>
      <p className="ledger-label">{label}</p>
      <p className={cn("figure mt-2 text-3xl font-semibold tabular-nums", toneText[tone])}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
