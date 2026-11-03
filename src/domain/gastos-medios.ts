/**
 * Medios de pago de un gasto fuera de la caja.
 *
 * Módulo puro, como pagos.ts: la pantalla de gastos lo necesita y no puede
 * importar gastos.ts sin arrastrar drizzle al navegador.
 *
 * "efectivo" acá es plata que NO sale del cajón (el dueño paga de su
 * bolsillo). Lo que se paga desde la caja se carga en Caja como gasto.
 */
export const MEDIOS_DE_GASTO = [
  { value: "transferencia", label: "Transferencia" },
  { value: "efectivo", label: "Efectivo (fuera de caja)" },
  { value: "tarjeta", label: "Tarjeta" },
  { value: "cheque", label: "Cheque" },
  { value: "debito_automatico", label: "Débito automático" },
  { value: "otro", label: "Otro" },
] as const;

export type MedioDeGasto = (typeof MEDIOS_DE_GASTO)[number]["value"];

export const esMedioDeGasto = (x: unknown): x is MedioDeGasto =>
  typeof x === "string" && MEDIOS_DE_GASTO.some((m) => m.value === x);

/** Con los que arranca un local la primera vez que entra a Gastos. */
export const RUBROS_INICIALES = [
  "Mercadería",
  "Bebidas",
  "Sueldos y jornales",
  "Cargas sociales",
  "Alquiler",
  "Servicios",
  "Impuestos",
  "Mantenimiento",
  "Limpieza",
  "Otros",
] as const;
