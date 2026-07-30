import type {
  AccessTicket, ArcaAmbiente, ArcaAuth, FeCaeRequest, FeCaeResponse,
  FeCompConsultarResponse, FeDummyResponse,
} from "@/lib/arca/types";
import { ArcaError, esTokenInvalido } from "@/lib/arca/errors";
import { loginCms } from "@/lib/arca/wsaa";
import {
  feCAESolicitar, feCompConsultar, feCompUltimoAutorizado, feDummy,
} from "@/lib/arca/wsfev1";
import type { SoapTransport } from "@/lib/arca/soap";
import type { TicketStore } from "@/domain/fiscal-config";

/**
 * Ensamblador del cliente de ARCA. Es el único lugar del sistema donde el
 * certificado y la clave privada existen en claro, y viven como locales de esta
 * llamada: el objeto devuelto NO expone ningún secreto. Eso es estructural, no
 * una convención — nada aguas abajo puede filtrar lo que no puede alcanzar.
 */

export type ArcaClient = {
  ambiente: ArcaAmbiente;
  cuit: string;
  ptoVta: number;
  dummy(): Promise<FeDummyResponse>;
  lastAuthorized(cbteTipo: number): Promise<number>;
  authorize(req: FeCaeRequest): Promise<FeCaeResponse>;
  consult(cbteTipo: number, numero: number): Promise<FeCompConsultarResponse | null>;
};

export type CrearClienteInput = {
  ambiente: ArcaAmbiente;
  cuit: string;
  ptoVta: number;
  certPem: string;
  keyPem: string;
  tickets: TicketStore;
  transport?: SoapTransport;
  /** Espera entre reintentos mientras otra invocación renueva el ticket. */
  esperaMs?: (intento: number) => Promise<void>;
};

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createArcaClient(input: CrearClienteInput): ArcaClient {
  const { ambiente, cuit, ptoVta, tickets, transport } = input;
  const esperar = input.esperaMs ?? (() => dormir(500));

  /**
   * Devuelve un ticket vigente, renovándolo si hace falta.
   *
   * El camino común (ticket fresco) no toca el lease en absoluto.
   */
  async function obtenerTicket(): Promise<AccessTicket> {
    const cacheado = await tickets.get();
    if (cacheado) return cacheado;

    if (await tickets.tryAcquireLease()) {
      try {
        const nuevo = await loginCms({ ambiente, certPem: input.certPem, keyPem: input.keyPem }, transport);
        await tickets.set(nuevo);
        return nuevo;
      } catch (err) {
        // Se libera el lease YA en vez de esperar a que venza: así el próximo
        // intento reintenta enseguida en lugar de comerse los 60 segundos.
        await tickets.releaseLease().catch(() => {});

        // ⚠️ El caso que evita dejar a una tienda sin facturar por 12 horas: si
        // el lease venció mientras la llamada seguía en vuelo, dos logins
        // compiten y el perdedor recibe "ya posee un TA valido". No es una
        // falla: el ganador acaba de escribir el ticket.
        if (err instanceof ArcaError && err.code === "ARCA_TA_EN_RENOVACION") {
          const delGanador = await tickets.get();
          if (delGanador) return delGanador;
        }
        throw err;
      }
    }

    // Otra invocación está renovando (o acaba de hacerlo). Se espera un poco.
    for (let intento = 0; intento < 6; intento++) {
      await esperar(intento);
      const listo = await tickets.get();
      if (listo) return listo;
    }
    throw new ArcaError("ARCA_TA_EN_RENOVACION");
  }

  async function auth(): Promise<ArcaAuth> {
    const ta = await obtenerTicket();
    return { token: ta.token, sign: ta.sign, cuit };
  }

  /** Marca el ticket cacheado como vencido para forzar un login nuevo. */
  async function invalidarTicket(): Promise<void> {
    await tickets.set({ token: "", sign: "", generatedAt: new Date(0), expiresAt: new Date(0) });
  }

  /**
   * Ejecuta una llamada autenticada. Si ARCA responde que el token no sirve,
   * invalida el ticket, re-loguea UNA vez y reintenta UNA vez. Más que eso sería
   * un bucle de reintentos contra un servicio del Estado.
   *
   * El token vencido llega de dos formas según el método: como resultado
   * rechazado con Errors (FECAESolicitar) o como excepción (los demás). Se
   * cubren las dos.
   */
  async function conReintentoDeToken<T>(
    fn: (a: ArcaAuth) => Promise<T>,
    tokenInvalidoEnResultado: (r: T) => boolean = () => false,
  ): Promise<T> {
    try {
      const primero = await fn(await auth());
      if (!tokenInvalidoEnResultado(primero)) return primero;
    } catch (err) {
      const esTokenErr = err instanceof ArcaError
        && err.code === "ARCA_SOAP_FAULT"
        && esTokenInvalido([{ code: 0, msg: err.detalle ?? "" }]);
      if (!esTokenErr) throw err;
    }

    await invalidarTicket();
    return fn(await auth());
  }

  return {
    ambiente,
    cuit,
    ptoVta,

    // FEDummy es el health check y NO lleva autenticación: sirve para saber si
    // ARCA está arriba incluso cuando el certificado está mal.
    dummy: () => feDummy({ ambiente, transport }),

    lastAuthorized: (cbteTipo) => conReintentoDeToken(
      (a) => feCompUltimoAutorizado({ ambiente, auth: a, transport }, { ptoVta, cbteTipo }),
    ),

    authorize: (req) => conReintentoDeToken(
      (a) => feCAESolicitar({ ambiente, auth: a, transport }, req),
      (r) => r.resultado === "R" && esTokenInvalido(r.errores),
    ),

    consult: (cbteTipo, numero) => conReintentoDeToken(
      (a) => feCompConsultar({ ambiente, auth: a, transport }, { ptoVta, cbteTipo, cbteNro: numero }),
    ),
  };
}

/**
 * Arma el cliente desde la DB. Es la función que usan los route handlers.
 *
 * Se importa perezosamente fiscal-config para no arrastrar el esquema de la DB a
 * los tests puros del protocolo.
 */
export async function createArcaClientForStore(
  db: any, storeId: number, opts: { transport?: SoapTransport } = {},
): Promise<ArcaClient> {
  const { requireFiscalConfig, loadCredentials, crearTicketStore } = await import("@/domain/fiscal-config");
  const cfg = await requireFiscalConfig(db, storeId);
  const { certPem, keyPem } = await loadCredentials(db, storeId, cfg.ambiente);

  return createArcaClient({
    ambiente: cfg.ambiente,
    cuit: cfg.cuit,
    ptoVta: cfg.puntoVenta,
    certPem,
    keyPem,
    tickets: crearTicketStore(db, storeId, cfg.ambiente, cfg.cuit),
    transport: opts.transport,
  });
}
