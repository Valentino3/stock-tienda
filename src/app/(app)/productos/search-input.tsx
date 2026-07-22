"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function SearchInput({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const router = useRouter();
  const pathname = usePathname();
  const mounted = useRef(false);

  useEffect(() => {
    // Skip the initial mount: otherwise a hard-loaded `?q=&page=N` URL would
    // get rewritten (dropping `page`) ~300ms after render. Only navigate on a
    // real user edit to the term — a new search legitimately resets to page 1.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const handle = setTimeout(() => {
      const params = new URLSearchParams();
      if (value.trim()) params.set("q", value.trim());
      // No se preserva `page` a propósito: una búsqueda nueva siempre
      // arranca en la página 1 (una página 3 de una búsqueda anterior
      // probablemente no tiene sentido para el término nuevo).
      router.push(params.toString() ? `${pathname}?${params}` : pathname);
    }, 300);
    return () => clearTimeout(handle);
  }, [value, pathname, router]);

  return (
    <div className="relative max-w-sm">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder="Buscar producto o SKU…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="pl-9"
      />
    </div>
  );
}
