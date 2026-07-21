"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";

export function SearchInput({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
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
    <Input
      placeholder="Buscar producto o SKU..."
      value={value}
      onChange={(e) => setValue(e.target.value)}
      className="max-w-sm"
    />
  );
}
