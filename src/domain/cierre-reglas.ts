/**
 * Reglas del cierre de caja que también necesita la pantalla.
 *
 * Módulo puro a propósito, como pagos.ts: la pantalla de caja es un client
 * component y no puede importar cash.ts sin arrastrar drizzle al navegador.
 */

/**
 * Desde cuánta diferencia (en más o en menos) el cierre exige un motivo. Un
 * redondeo de vuelto no necesita explicación; un faltante de mil pesos sí, y
 * es justo el registro que el dueño va a querer leer al día siguiente.
 */
export const UMBRAL_DIFERENCIA_CON_MOTIVO = 1000;

export type MesaAbiertaAlCerrar = { orderId: number; mesa: string | null; total: number; status: string };
