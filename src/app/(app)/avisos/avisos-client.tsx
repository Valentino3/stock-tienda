"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { resolveAviso } from "./actions";

export function ResolveButton({ id }: { id: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await resolveAviso(id);
          toast.success("Aviso resuelto");
          router.refresh();
        })
      }
    >
      {pending ? "…" : "Resuelto"}
    </Button>
  );
}
