import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Cifrado simétrico de secretos guardados en la DB (certificado y clave privada
 * de ARCA, y los tokens de WSAA).
 *
 * AES-256-GCM con clave maestra en env. La clave es CRUDA (32 bytes en base64),
 * sin KDF: scrypt/PBKDF2 cuestan 100+ ms y decenas de MB POR DESCIFRADO, y en
 * serverless eso se paga en casi cada invocación. Los KDF existen para estirar
 * secretos memorizables por humanos; este lo genera `openssl rand` y vive en el
 * gestor de secretos de Vercel, así que estirarlo no compra nada y cuesta
 * latencia en cada factura.
 *
 * Formato guardado, autodescriptivo y versionado:
 *
 *     v1.<keyId>.<b64url(iv)>.<b64url(tag)>.<b64url(ciphertext)>
 *
 * El keyId embebido es lo que hace la rotación reanudable: una DB a medio rotar
 * sigue funcionando porque cada fila dice con qué clave se cifró.
 *
 * SI SE PIERDE LA CLAVE MAESTRA, todo lo cifrado es irrecuperable. Es el punto
 * del cifrado en reposo, no un defecto: la recuperación no es criptográfica,
 * el dueño vuelve a subir el .crt (se re-descarga del portal de ARCA) y el .key.
 */

const VERSION = "v1";
const IV_BYTES = 12; // estándar GCM; 16 forzaría una derivación GHASH no estándar
const KEY_BYTES = 32;

export class SecretBoxError extends Error {
  constructor(readonly code: "MASTER_KEY_FALTANTE" | "MASTER_KEY_INVALIDA" | "SECRET_DECRYPT_FAILED") {
    super(code);
    this.name = "SecretBoxError";
  }
}

type MasterKey = { id: string; key: Buffer };

function parseKey(raw: string | undefined, envName: string): Buffer | null {
  if (!raw || !raw.trim()) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(raw.trim(), "base64");
  } catch {
    throw new SecretBoxError("MASTER_KEY_INVALIDA");
  }
  if (buf.length !== KEY_BYTES) {
    // No incluimos el valor en el mensaje: es la clave maestra.
    console.error(`[secret-box] ${envName} debe ser base64 de exactamente 32 bytes (recibidos ${buf.length})`);
    throw new SecretBoxError("MASTER_KEY_INVALIDA");
  }
  return buf;
}

/**
 * Se resuelve PEREZOSAMENTE, no al importar el módulo: validar en el import
 * rompería `next build` en cualquier entorno sin la env seteada.
 */
function currentKey(): MasterKey {
  const key = parseKey(process.env.ARCA_MASTER_KEY, "ARCA_MASTER_KEY");
  if (!key) throw new SecretBoxError("MASTER_KEY_FALTANTE");
  return { id: process.env.ARCA_MASTER_KEY_ID?.trim() || "k1", key };
}

/** Clave anterior durante una rotación. Solo descifra, nunca cifra. */
function previousKey(): MasterKey | null {
  const key = parseKey(process.env.ARCA_MASTER_KEY_PREVIOUS, "ARCA_MASTER_KEY_PREVIOUS");
  if (!key) return null;
  return { id: process.env.ARCA_MASTER_KEY_PREVIOUS_ID?.trim() || "k0", key };
}

const b64url = (b: Buffer) => b.toString("base64url");

/**
 * Cifra `plain` atado a `aad`.
 *
 * El AAD (additional authenticated data) es lo que ata cada ciphertext a su
 * fila y su columna: usar `${storeId}:arca.key` significa que alguien con
 * acceso de ESCRITURA a la DB no puede copiar el blob de la tienda B a la fila
 * de la tienda A y que descifre. Es gratis y convierte toda una clase de
 * ataques de confusión de tenant en un fallo de descifrado.
 */
export function sealSecret(plain: string, aad: string): string {
  const { id, key } = currentKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, id, b64url(iv), b64url(cipher.getAuthTag()), b64url(ct)].join(".");
}

export function openSecret(sealed: string, aad: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) throw new SecretBoxError("SECRET_DECRYPT_FAILED");
  const [, keyId, ivB64, tagB64, ctB64] = parts;

  const candidates = [currentKey(), previousKey()].filter((k): k is MasterKey => k !== null);
  const match = candidates.find((k) => k.id === keyId);
  if (!match) throw new SecretBoxError("SECRET_DECRYPT_FAILED");

  try {
    const decipher = createDecipheriv("aes-256-gcm", match.key, Buffer.from(ivB64, "base64url"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    const out = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]);
    return out.toString("utf8");
  } catch {
    // Sin `cause`: el error de node:crypto puede arrastrar contexto del material
    // cifrado, y este error termina en logs que lee todo el equipo.
    throw new SecretBoxError("SECRET_DECRYPT_FAILED");
  }
}

/** Estado para la UI de config. Nunca devuelve la clave ni parte de ella. */
export function masterKeyStatus(): { configured: boolean; keyId: string | null; hasPrevious: boolean } {
  try {
    const { id } = currentKey();
    return { configured: true, keyId: id, hasPrevious: previousKey() !== null };
  } catch {
    return { configured: false, keyId: null, hasPrevious: false };
  }
}

/** Comparación en tiempo constante, para chequear fingerprints sin filtrar por timing. */
export function safeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
