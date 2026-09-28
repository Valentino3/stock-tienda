import type { LineaRemito, Remito } from "./cash-close";
import { PAYMENT_METHODS, type PaymentMethod } from "./pagos";
import { number } from "@/lib/format";

/**
 * Cómo se resume una venta en una fila: qué se llevó y con qué pagó.
 *
 * Puro y sin drizzle (solo `import type` del cierre), para que lo usen igual
 * la lista de `/caja`, la hoja impresa y el Excel: si cada uno resumiera a su
 * manera, la misma venta diría cosas distintas según dónde se la mire.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * "2× Remera, 1× Gorra".
 *
 * Agrupa por producto y no por variante: en una fila lo que se busca es qué se
 * llevó, no el talle. Las variantes están en el detalle desplegado. El orden
 * es el de la venta, que es el orden en que el cajero lo cargó.
 */
export function resumirLineas(lineas: LineaRemito[], max = 3): { texto: string; resto: number } {
  const porProducto = new Map<string, number>();
  for (const l of lineas) porProducto.set(l.productName, (porProducto.get(l.productName) ?? 0) + l.quantity);
  const grupos = [...porProducto];
  const texto = grupos.slice(0, max).map(([nombre, cant]) => `${number(cant)}× ${nombre}`).join(", ");
  return { texto, resto: Math.max(0, grupos.length - max) };
}

/**
 * El monto de cada medio en columnas fijas, para el Excel. `null` es "no se
 * usó ese medio", que es distinto de "se cobró $0" y en la planilla se ve como
 * celda vacía.
 */
export function montosPorMedio(pagos: Remito["pagos"]): Record<PaymentMethod, number | null> {
  const out = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.value, null])) as Record<PaymentMethod, number | null>;
  for (const p of pagos) {
    const k = p.method as PaymentMethod;
    if (k in out) out[k] = round2((out[k] ?? 0) + p.amount);
  }
  return out;
}

/**
 * El pie de la lista. Las anuladas van aparte y fuera del total, igual que en
 * el arqueo: si sumaran, el total de la lista no cuadraría contra la caja.
 */
export function totalesDelListado(remitos: Remito[]) {
  const vivas = remitos.filter((r) => !r.voided);
  const anuladas = remitos.filter((r) => r.voided);
  return {
    ventas: vivas.length,
    total: round2(vivas.reduce((a, r) => a + r.total, 0)),
    anuladas: { count: anuladas.length, total: round2(anuladas.reduce((a, r) => a + r.total, 0)) },
  };
}
