import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Select nativo con la caja de `<Input>`.
 *
 * Nativo y no el de Radix a propósito: en el celular del mozo y en la tablet
 * del mostrador, el selector del sistema operativo es más rápido y más grande
 * que cualquier lista que dibujemos.
 *
 * Lo que resuelve es que había diez copias a mano de la misma cadena de clases
 * —en /clientes, /comisiones, /facturacion, /ventas, /vender, /salon y /admin—
 * y ninguna coincidía con `<Input>`: todas llevaban `shadow-xs` de más y
 * `text-sm` plano en vez de `text-base md:text-sm`. Ese `text-base` no es
 * cosmético: abajo de 16px, Safari en iPhone hace zoom al enfocar el campo y
 * te deja la pantalla corrida en medio de una venta.
 */
export function Select({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    // OJO: `className` va al ENVOLTORIO, no al `<select>`. Como el chevron se
    // posiciona contra este div, el ancho tiene que vivir acá — si fuera al
    // control, un `w-44` dejaría el contenedor al 100% y la flecha flotando
    // lejos del campo. Lo que se pasa desde afuera es siempre layout (ancho,
    // margen); el aspecto del control lo fija el sistema.
    <div className={cn("relative w-full", className)}>
      <select
        data-slot="select"
        className="h-9 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent py-1 pr-8 pl-3 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm"
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </div>
  );
}
