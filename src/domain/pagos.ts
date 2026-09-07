/**
 * Los pagos de una venta.
 *
 * Una venta puede cobrarse con varios medios a la vez —$5000 en efectivo y
 * $3000 con tarjeta, o dejando una parte fiada— y esas partes viven en
 * `sale_payments`, que es la ÚNICA fuente de verdad de la plata por medio.
 * `sales.payment_method` sigue existiendo como medio predominante, para
 * mostrar y para que todo lo que ya lo leía siga funcionando; no se usa para
 * sumar plata.
 *
 * Este módulo es puro y no importa drizzle a propósito: el punto de venta es
 * un client component y necesita las mismas reglas que el servidor sin
 * arrastrarse la base al bundle.
 */

export type PaymentMethod = "efectivo" | "transferencia" | "tarjeta" | "cuenta";

export type Pago = { method: PaymentMethod; amount: number };

export const PAYMENT_METHODS: readonly { value: PaymentMethod; label: string }[] = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "cuenta", label: "Cuenta" },
];

export const METODO_LABEL: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  cuenta: "Cuenta",
};

export const esMetodoValido = (x: unknown): x is PaymentMethod =>
  typeof x === "string" && x in METODO_LABEL;

/**
 * Desempate del medio predominante cuando dos pagos empatan en monto.
 *
 * Fijo y no "el primero que vino": el predominante se guarda en una columna y
 * tiene que ser el mismo si la misma venta se arma dos veces.
 */
const PRIORIDAD: readonly PaymentMethod[] = ["efectivo", "tarjeta", "transferencia", "cuenta"];

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Consolida los pagos: suma los que repiten medio y descarta los que quedan en
 * cero.
 *
 * Dos líneas de tarjeta son indistinguibles entre sí (el enum no guarda cupón
 * ni últimos cuatro dígitos), así que sumarlas no pierde información y deja un
 * pago por medio — que es lo que hace que `porMedio` signifique algo y que el
 * índice único de la tabla pueda ser el backstop.
 */
export function normalizarPagos(pagos: Pago[]): Pago[] {
  const porMedio = new Map<PaymentMethod, number>();
  for (const p of pagos) {
    porMedio.set(p.method, round2((porMedio.get(p.method) ?? 0) + p.amount));
  }
  return [...porMedio.entries()]
    .filter(([, amount]) => amount !== 0)
    .map(([method, amount]) => ({ method, amount }))
    .sort((a, b) => PRIORIDAD.indexOf(a.method) - PRIORIDAD.indexOf(b.method));
}

export function sumaPagos(pagos: Pago[]): number {
  return round2(pagos.reduce((acc, p) => acc + p.amount, 0));
}

/** El medio de mayor monto. Es lo que se guarda en `sales.payment_method`. */
export function medioPrincipal(pagos: Pago[]): PaymentMethod {
  if (pagos.length === 0) throw new Error("PAYMENTS_EMPTY");
  return [...pagos].sort(
    (a, b) => b.amount - a.amount || PRIORIDAD.indexOf(a.method) - PRIORIDAD.indexOf(b.method),
  )[0].method;
}

/** Cuánto de la venta quedó fiado. 0 si no hay parte a cuenta. */
export function montoACuenta(pagos: Pago[]): number {
  return round2(pagos.filter((p) => p.method === "cuenta").reduce((a, p) => a + p.amount, 0));
}

/** "Efectivo + Tarjeta", para las pantallas que hoy muestran un solo medio. */
export function etiquetaPagos(pagos: Pago[]): string {
  return pagos.map((p) => METODO_LABEL[p.method]).join(" + ");
}
