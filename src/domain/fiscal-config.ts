import { and, eq, sql } from "drizzle-orm";
import {
  arcaAccessTickets, arcaCredentials, storeFiscalConfig,
  type ArcaAmbiente, type StoreFiscalConfig,
} from "@/db/schema";
import { openSecret, sealSecret } from "@/lib/crypto/secret-box";
import type { AccessTicket } from "@/lib/arca/types";
import { assertKeyMatchesCert, inspectCertificate, certVencido, type CertInfo } from "@/lib/arca/cert";
import { ArcaError } from "@/lib/arca/errors";

/**
 * Config fiscal, credenciales cifradas y cache del ticket de acceso.
 *
 * Regla estructural del módulo: hay DOS caminos de lectura de credenciales, y
 * están separados a propósito.
 *   - `getFiscalConfigResumen` — lo que ve la UI. No selecciona jamás las
 *     columnas cifradas, así que el camino de la UI no PUEDE filtrarlas.
 *   - `loadCredentials` — devuelve los PEM. La llama únicamente
 *     createArcaClient, y los PEM viven como locales de esa llamada.
 */

// El AAD ata cada ciphertext a su tienda Y a su columna: alguien con acceso de
// escritura a la DB no puede trasplantar el blob de una tienda a otra.
const aadCert = (storeId: number) => `${storeId}:arca.cert`;
const aadKey = (storeId: number) => `${storeId}:arca.key`;
const aadToken = (storeId: number) => `${storeId}:arca.token`;
const aadSign = (storeId: number) => `${storeId}:arca.sign`;

export async function getFiscalConfig(db: any, storeId: number): Promise<StoreFiscalConfig | null> {
  const [row] = await db.select().from(storeFiscalConfig).where(eq(storeFiscalConfig.storeId, storeId));
  return row ?? null;
}

/** Igual que getFiscalConfig pero lanza si falta o está incompleta. */
export async function requireFiscalConfig(db: any, storeId: number): Promise<StoreFiscalConfig> {
  const cfg = await getFiscalConfig(db, storeId);
  if (!cfg || !cfg.enabled || !cfg.cuit || !cfg.puntoVenta) throw new Error("FISCAL_NO_CONFIGURADO");
  return cfg;
}

export type SaveFiscalConfigInput = {
  storeId: number;
  cuit: string;
  razonSocial: string;
  domicilio: string;
  nombreFantasia?: string | null;
  condicionIva?: number;
  ingresosBrutos?: string | null;
  /** URL del logo para el remito. No es dato fiscal, pero vive con el resto
   *  del emisor porque el remito muestra los mismos datos que una factura. */
  logoUrl?: string | null;
  inicioActividades?: string | null;
  puntoVenta: number;
  ambiente?: ArcaAmbiente;
  defaultIvaId?: number;
  umbralConsumidorFinal?: number | null;
  empleadosPuedenEmitir?: boolean;
  enabled?: boolean;
};

export async function saveFiscalConfig(db: any, input: SaveFiscalConfigInput): Promise<void> {
  const valores = {
    cuit: input.cuit,
    razonSocial: input.razonSocial,
    domicilio: input.domicilio,
    nombreFantasia: input.nombreFantasia ?? null,
    condicionIva: input.condicionIva ?? 1,
    ingresosBrutos: input.ingresosBrutos ?? null,
    logoUrl: input.logoUrl ?? null,
    inicioActividades: input.inicioActividades ?? null,
    puntoVenta: input.puntoVenta,
    ambiente: input.ambiente ?? ("homologacion" as const),
    defaultIvaId: input.defaultIvaId ?? 5,
    umbralConsumidorFinal: input.umbralConsumidorFinal ?? null,
    empleadosPuedenEmitir: input.empleadosPuedenEmitir ?? false,
    enabled: input.enabled ?? false,
    updatedAt: new Date(),
  };

  await db.insert(storeFiscalConfig)
    .values({ storeId: input.storeId, ...valores })
    .onConflictDoUpdate({ target: storeFiscalConfig.storeId, set: valores });
}

// ---- credenciales ----

export type CredencialesResumen = {
  ambiente: ArcaAmbiente;
  certSubject: string | null;
  certCuit: string | null;
  certExpiresAt: Date | null;
  certFingerprint: string | null;
  updatedAt: Date;
};

/**
 * Metadatos del certificado para la UI. NO selecciona las columnas cifradas:
 * el camino de la UI no puede filtrar el certificado ni la clave privada.
 */
export async function getCredencialesResumen(
  db: any, storeId: number, ambiente: ArcaAmbiente,
): Promise<CredencialesResumen | null> {
  const [row] = await db.select({
    ambiente: arcaCredentials.ambiente,
    certSubject: arcaCredentials.certSubject,
    certCuit: arcaCredentials.certCuit,
    certExpiresAt: arcaCredentials.certExpiresAt,
    certFingerprint: arcaCredentials.certFingerprint,
    updatedAt: arcaCredentials.updatedAt,
  }).from(arcaCredentials)
    .where(and(eq(arcaCredentials.storeId, storeId), eq(arcaCredentials.ambiente, ambiente)));
  return row ?? null;
}

/**
 * Devuelve los PEM en claro. La ÚNICA función que descifra cert y key.
 * La llama solo createArcaClient.
 */
export async function loadCredentials(
  db: any, storeId: number, ambiente: ArcaAmbiente,
): Promise<{ certPem: string; keyPem: string }> {
  const [row] = await db.select().from(arcaCredentials)
    .where(and(eq(arcaCredentials.storeId, storeId), eq(arcaCredentials.ambiente, ambiente)));
  if (!row) throw new Error("FISCAL_NO_CONFIGURADO");

  return {
    certPem: openSecret(row.certPemEnc, aadCert(storeId)),
    keyPem: openSecret(row.keyPemEnc, aadKey(storeId)),
  };
}

/**
 * Valida y guarda el par certificado / clave privada.
 *
 * Toda la validación es pura y corre ANTES de escribir nada. Guardar un par
 * desapareado produciría un CMS que WSAA rechaza con un error opaco.
 */
export async function saveCredentials(db: any, input: {
  storeId: number;
  ambiente: ArcaAmbiente;
  certPem: string;
  keyPem: string;
  /** CUIT configurado, para chequear que el certificado sea del mismo contribuyente. */
  cuitEsperado?: string | null;
  ahora?: Date;
}): Promise<CertInfo> {
  const info = inspectCertificate(input.certPem);
  assertKeyMatchesCert(input.certPem, input.keyPem);

  if (certVencido(info, input.ahora ?? new Date())) throw new ArcaError("ARCA_CERT_VENCIDO");
  if (input.cuitEsperado && info.cuit && info.cuit !== input.cuitEsperado) {
    throw new ArcaError("ARCA_CERT_INVALIDO", `El certificado es del CUIT ${info.cuit}`);
  }

  const valores = {
    certPemEnc: sealSecret(input.certPem, aadCert(input.storeId)),
    keyPemEnc: sealSecret(input.keyPem, aadKey(input.storeId)),
    certSubject: info.subject,
    certCuit: info.cuit,
    certExpiresAt: info.notAfter,
    certFingerprint: info.fingerprintSha256,
    updatedAt: new Date(),
  };

  await db.insert(arcaCredentials)
    .values({ storeId: input.storeId, ambiente: input.ambiente, ...valores })
    .onConflictDoUpdate({
      target: [arcaCredentials.storeId, arcaCredentials.ambiente],
      set: valores,
    });

  // El ticket cacheado se emitió con el certificado ANTERIOR: si queda, la
  // próxima llamada usa credenciales que ya no corresponden.
  await borrarTicket(db, input.storeId, input.ambiente);

  return info;
}

export async function deleteCredentials(db: any, storeId: number, ambiente: ArcaAmbiente): Promise<void> {
  await db.delete(arcaCredentials)
    .where(and(eq(arcaCredentials.storeId, storeId), eq(arcaCredentials.ambiente, ambiente)));
  await borrarTicket(db, storeId, ambiente);
}

// ---- cache del ticket de acceso (TA) ----

/**
 * Puerto que consume createArcaClient. El dominio provee la implementación
 * sobre la DB; el cliente solo sabe pedir y guardar.
 */
export type TicketStore = {
  get(): Promise<AccessTicket | null>;
  set(ticket: AccessTicket): Promise<void>;
  /** Intenta tomar el lease de renovación. `false` si otro lo tiene o ya está fresco. */
  tryAcquireLease(): Promise<boolean>;
  releaseLease(): Promise<void>;
};

/** Margen de expiración: cubre desfasaje de reloj más la llamada que sigue. */
const MARGEN_MS = 10 * 60_000;
const LEASE_SEGUNDOS = 60;

export function crearTicketStore(
  db: any, storeId: number, ambiente: ArcaAmbiente, cuit: string, service = "wsfe",
): TicketStore {
  const clave = and(
    eq(arcaAccessTickets.storeId, storeId),
    eq(arcaAccessTickets.ambiente, ambiente),
    eq(arcaAccessTickets.service, service),
  );

  return {
    async get() {
      const [row] = await db.select().from(arcaAccessTickets).where(clave);
      if (!row) return null;
      if (row.expiresAt.getTime() - MARGEN_MS <= Date.now()) return null;
      try {
        return {
          token: openSecret(row.token, aadToken(storeId)),
          sign: openSecret(row.sign, aadSign(storeId)),
          generatedAt: row.generatedAt,
          expiresAt: row.expiresAt,
        };
      } catch {
        // Ticket ilegible (rotación de clave a medias): se trata como ausente y
        // se renueva, en vez de dejar la tienda sin facturar.
        return null;
      }
    },

    async set(ticket) {
      const valores = {
        cuit,
        token: sealSecret(ticket.token, aadToken(storeId)),
        sign: sealSecret(ticket.sign, aadSign(storeId)),
        generatedAt: ticket.generatedAt,
        expiresAt: ticket.expiresAt,
        lockedUntil: null,
        updatedAt: new Date(),
      };
      await db.insert(arcaAccessTickets)
        .values({ storeId, ambiente, service, ...valores })
        .onConflictDoUpdate({
          target: [arcaAccessTickets.storeId, arcaAccessTickets.ambiente, arcaAccessTickets.service],
          set: valores,
        });
    },

    /**
     * UPDATE condicional atómico que chequea frescura y toma el lease a la vez.
     *
     * Es un lease de columna y NO un advisory lock a propósito: un advisory lock
     * mantendría abierta una transacción de Postgres durante una llamada HTTP de
     * varios segundos a un endpoint del Estado, a través de un pool serverless.
     */
    async tryAcquireLease() {
      // Fila bootstrap: hace segura también la primerísima request.
      await db.insert(arcaAccessTickets).values({
        storeId, ambiente, service, cuit,
        token: "", sign: "",
        generatedAt: new Date(0), expiresAt: new Date(0),
      }).onConflictDoNothing();

      const res = await db.execute(sql`
        UPDATE arca_access_tickets
           SET locked_until = now() + interval '${sql.raw(String(LEASE_SEGUNDOS))} seconds',
               updated_at = now()
         WHERE store_id = ${storeId} AND ambiente = ${ambiente} AND service = ${service}
           AND expires_at <= now() + interval '${sql.raw(String(Math.floor(MARGEN_MS / 1000)))} seconds'
           AND (locked_until IS NULL OR locked_until < now())
        RETURNING store_id
      `);
      return (res.rows?.length ?? 0) > 0;
    },

    async releaseLease() {
      await db.update(arcaAccessTickets).set({ lockedUntil: null }).where(clave);
    },
  };
}

async function borrarTicket(db: any, storeId: number, ambiente: ArcaAmbiente): Promise<void> {
  await db.delete(arcaAccessTickets)
    .where(and(eq(arcaAccessTickets.storeId, storeId), eq(arcaAccessTickets.ambiente, ambiente)));
}
