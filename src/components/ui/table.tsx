"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

function Table({
  className,
  zebra = false,
  ...props
}: React.ComponentProps<"table"> & {
  /**
   * Franjas alternas. Solo para tablas anchas: /productos llega a 11 columnas
   * y sin franja el ojo se cambia de fila a mitad de camino. DESIGN.md prohíbe
   * "zebra pesada", no la zebra — de ahí que sea `muted/40` y no `muted`.
   */
  zebra?: boolean
}) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn(
          "w-full caption-bottom text-sm tabular-nums",
          zebra && "[&_tbody_tr:nth-child(even)]:bg-muted/40",
          className
        )}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      // Fondo tenue + borde FUERTE contra el cuerpo. Ese borde es el que
      // separa "los títulos" de "los datos"; las filas de adentro se separan
      // con el borde normal. Dos grises, una jerarquía.
      className={cn("bg-muted [&_tr]:border-b [&_tr]:border-border-strong", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      // Misma gramática que el encabezado, del otro lado: borde fuerte arriba
      // y fondo tenue. Cierra la tabla y hace que el total se lea como total
      // y no como una fila más que casualmente dice "Total".
      className={cn(
        "border-t border-border-strong bg-muted font-semibold [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      // El hover va a `accent`, que es un paso MÁS oscuro que el `muted` del
      // encabezado. Con el hover más claro que el encabezado, pasar el mouse
      // parecía apagar la fila en vez de señalarla.
      className={cn(
        "border-b transition-colors hover:bg-accent has-aria-expanded:bg-accent data-[state=selected]:bg-brand-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-9 px-3 text-left align-middle text-xs font-semibold tracking-wider whitespace-nowrap text-muted-foreground uppercase [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-3 py-2.5 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
