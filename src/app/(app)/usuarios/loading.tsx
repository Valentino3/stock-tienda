import { Panel } from "@/components/ui/panel";
import { Skeleton, SkeletonRows } from "@/components/ui/skeleton";

/**
 * Carga de las pantallas de consulta.
 *
 * Hasta ahora no había ninguna: cada ruta es un Server Component que espera
 * todas sus consultas antes de mandar nada, así que navegar dejaba la pantalla
 * ANTERIOR congelada y después saltaba de golpe. En /reportes son cinco
 * consultas y en /ventas tres — el tiempo suficiente para que el dueño toque
 * dos veces creyendo que no anduvo.
 *
 * ⚠️ Va POR RUTA y no en `(app)/loading.tsx`, y esto no es prolijidad: el
 * límite de Suspense hace que la pantalla aparezca ANTES de que React hidrate.
 * En una pantalla de consulta eso no importa. En /caja y /vender sí — se puede
 * tipear en un input controlado antes de la hidratación, el valor queda en el
 * DOM pero no en el estado de React, y al hidratar se pisa con el vacío. Con
 * un `loading.tsx` global, cerrar la caja escribiendo rápido manda el efectivo
 * contado en cero. Los tests de navegador lo agarraron; una cajera apurada
 * también podía.
 *
 * Es genérico a propósito: encabezado más tabla es la forma de estas siete.
 * Un esqueleto calcado de cada pantalla se desincroniza en el primer cambio de
 * columnas, y un esqueleto que miente es peor que uno aproximado.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2 border-b border-border pb-4">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Panel flush>
        <SkeletonRows filas={6} anchos={["w-32", "w-16", "w-40", "w-24", "w-20"]} />
      </Panel>
    </div>
  );
}
