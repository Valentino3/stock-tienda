"use client";
import { useState } from "react";
import { PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Mismo tope que NOMBRE_LIBRE_MAX en src/domain/item-libre.ts. El dominio es el que manda. */
const NOMBRE_MAX = 120;

/**
 * Agregar al carrito algo que no está en el catálogo, con nombre, precio y
 * cantidad escritos a mano: "Torta por encargo", "Descorche".
 *
 * Queda registrado quién lo cargó (Reportes → Ítems libres), porque el precio
 * lo pone quien vende. Necesita conexión: sin servidor no hay quién resuelva
 * la variante interna del local.
 */
export function ItemLibreForm({
  onAgregar, offline,
}: {
  onAgregar: (datos: { nombre: string; precio: number; cantidad: number }) => void;
  offline: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [precio, setPrecio] = useState("");
  const [cantidad, setCantidad] = useState("1");

  const valorPrecio = Number(precio.replace(",", "."));
  const valorCantidad = Number(cantidad);
  const listo = nombre.trim().length > 0 && valorPrecio > 0 && Number.isInteger(valorCantidad) && valorCantidad > 0;

  if (!abierto) {
    return (
      <Button
        type="button" variant="outline" size="sm" disabled={offline}
        title={offline ? "Los ítems libres necesitan conexión" : undefined}
        onClick={() => setAbierto(true)}
      >
        <PencilLine className="mr-1 size-3" /> Ítem libre
      </Button>
    );
  }

  return (
    <form
      className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-[1fr_8rem_5rem_auto] sm:items-end"
      aria-label="Ítem libre"
      onSubmit={(e) => {
        e.preventDefault();
        if (!listo) return;
        onAgregar({ nombre: nombre.trim(), precio: Math.round(valorPrecio * 100) / 100, cantidad: valorCantidad });
        setNombre("");
        setPrecio("");
        setCantidad("1");
        setAbierto(false);
      }}
    >
      <div className="space-y-1">
        <Label htmlFor="libre-nombre">Qué se vende</Label>
        <Input
          id="libre-nombre" value={nombre} maxLength={NOMBRE_MAX} autoFocus
          placeholder="Torta por encargo" onChange={(e) => setNombre(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="libre-precio">Precio</Label>
        <Input
          id="libre-precio" inputMode="decimal" value={precio} placeholder="0"
          onChange={(e) => setPrecio(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="libre-cantidad">Cantidad</Label>
        <Input
          id="libre-cantidad" inputMode="numeric" value={cantidad}
          onChange={(e) => setCantidad(e.target.value.replace(/\D/g, ""))}
        />
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={() => setAbierto(false)}>Cancelar</Button>
        <Button type="submit" disabled={!listo}>Agregar</Button>
      </div>
    </form>
  );
}
