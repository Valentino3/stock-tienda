"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { money } from "@/lib/format";
import { commissionFromPercent } from "@/lib/commission";
import { saveCommission, removeCommission } from "./actions";

type Employee = { id: string; name: string };
type Mode = "monto" | "percent";


export function CommissionForm({
  employees,
  salesByEmployee,
  defaultFrom,
  defaultTo,
}: {
  employees: Employee[];
  salesByEmployee: Record<string, number>;
  defaultFrom: string;
  defaultTo: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>("monto");
  const [employeeId, setEmployeeId] = useState("");
  const [amount, setAmount] = useState("");
  const [base, setBase] = useState("");
  const [percent, setPercent] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  // Al elegir empleado en modo %, autocompletar la base con lo que vendió en el
  // período (editable). El monto final se calcula base × % / 100.
  function onEmployee(id: string) {
    setEmployeeId(id);
    if (mode === "percent" && !base) {
      const total = salesByEmployee[id];
      if (total) setBase(String(total));
    }
  }

  const baseNum = Number(base) || 0;
  const percentNum = Number(percent) || 0;
  const computed = commissionFromPercent(baseNum, percentNum);
  const finalAmount = mode === "percent" ? computed : Number(amount) || 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const composedNote =
      mode === "percent" && !note.trim()
        ? `${percentNum}% de ${money(baseNum)}`
        : note;
    startTransition(async () => {
      const res = await saveCommission({
        employeeId,
        amount: finalAmount,
        note: composedNote,
        periodFrom: defaultFrom,
        periodTo: defaultTo,
      });
      if ("error" in res && res.error) {
        setError(res.error);
        return;
      }
      setError("");
      setEmployeeId("");
      setAmount("");
      setBase("");
      setPercent("");
      setNote("");
      toast.success("Comisión registrada");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="inline-flex rounded-lg border border-border p-1">
        {([
          { m: "monto" as const, label: "Monto fijo" },
          { m: "percent" as const, label: "Porcentaje" },
        ]).map(({ m, label }) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              mode === m ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="ledger-label">Empleado</span>
          <Select value={employeeId} onChange={(e) => onEmployee(e.target.value)} className="w-48" required>
            <option value="">Elegí…</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </Select>
        </label>

        {mode === "monto" ? (
          <label className="flex flex-col gap-1.5">
            <span className="ledger-label">Monto</span>
            <Input type="number" step="0.01" min="0" required placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32" />
          </label>
        ) : (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="ledger-label">Base</span>
              <Input type="number" step="0.01" min="0" required placeholder="0,00" value={base} onChange={(e) => setBase(e.target.value)} className="w-36" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="ledger-label">%</span>
              <Input type="number" step="0.01" min="0" max="100" required placeholder="0" value={percent} onChange={(e) => setPercent(e.target.value)} className="w-24" />
            </label>
            <div className="flex flex-col gap-1.5">
              <span className="ledger-label">Comisión</span>
              <span className="figure flex h-9 items-center text-lg font-semibold text-brand">{money(computed)}</span>
            </div>
          </>
        )}

        <label className="flex min-w-44 flex-1 flex-col gap-1.5">
          <span className="ledger-label">Nota (opcional)</span>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === "percent" ? "Se autocompleta con el cálculo" : "Ej: comisión julio"} />
        </label>

        <Button type="submit" size="sm" disabled={pending || (mode === "percent" && finalAmount <= 0)}>
          {pending ? "Guardando…" : "Anotar comisión"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </form>
  );
}

export function DeleteCommissionButton({ id }: { id: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-destructive"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            await removeCommission(id);
            router.refresh();
          } catch {
            toast.error("No se pudo borrar la comisión");
          }
        })
      }
    >
      {pending ? "…" : "Borrar"}
    </Button>
  );
}
