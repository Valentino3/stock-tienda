import { db } from "@/db";
import { assertSameOrigin, requireStoreOwner } from "@/lib/session";
import { getFiscalConfig, saveCredentials } from "@/domain/fiscal-config";
import { esClaveCifrada, pareceCertificado, pareceClavePrivada } from "@/lib/arca/cert";
import { arcaUserMessage } from "@/lib/arca/errors";
import { masterKeyStatus } from "@/lib/crypto/secret-box";
import type { ArcaAmbiente } from "@/db/schema";

/**
 * Subida del certificado y la clave privada de ARCA.
 *
 * Es un route handler y no una server action porque recibe archivos, siguiendo
 * el mismo patrón que src/app/(app)/importar/extract/route.ts: auth primero,
 * chequeo de config antes de consumir el body, `fail()` uniforme, y traducción
 * de errores a castellano accionable.
 *
 * NADA de lo que entra acá vuelve a salir: la respuesta lleva solo metadatos del
 * certificado. Los PEM se cifran y se guardan; no se escriben a disco (no hay),
 * no se loguean, no se devuelven.
 */

export const maxDuration = 30;

/** Un cert PEM pesa ~2 KB y una clave RSA-2048 ~1.7 KB. El tope se aplica ANTES
 *  de parsear: node-forge tuvo CVEs de DoS en el parser ASN.1. */
const MAX_BYTES = 32 * 1024;

const fail = (status: number, error: string) =>
  Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  let storeId: number;
  try {
    await assertSameOrigin();
    ({ storeId } = await requireStoreOwner());
  } catch {
    return fail(403, "No tenés permiso para hacer esto.");
  }

  if (!masterKeyStatus().configured) {
    console.error("[facturacion/credenciales] ARCA_MASTER_KEY no configurada");
    return fail(500, "Falta configurar la clave de cifrado del sistema. Avisale a quien administra el sistema.");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "No se pudo leer el formulario.");
  }

  const ambiente = (form.get("ambiente") as string) === "produccion" ? "produccion" : "homologacion";
  const certFile = form.get("cert");
  const keyFile = form.get("key");

  if (!(certFile instanceof File) || !(keyFile instanceof File)) {
    return fail(400, "Subí los dos archivos: el certificado (.crt) y la clave privada (.key).");
  }
  if (certFile.size > MAX_BYTES || keyFile.size > MAX_BYTES) {
    return fail(413, "Los archivos son demasiado grandes. Un certificado de ARCA pesa unos pocos KB.");
  }
  if (certFile.size === 0 || keyFile.size === 0) {
    return fail(400, "Alguno de los archivos está vacío.");
  }

  const certPem = (await certFile.text()).trim();
  const keyPem = (await keyFile.text()).trim();

  if (!pareceCertificado(certPem)) {
    return fail(400, "El archivo de certificado no es válido. Tiene que ser el .crt que descargaste del portal de ARCA, no el CSR.");
  }
  if (!pareceClavePrivada(keyPem)) {
    return fail(400, "El archivo de clave privada no es válido (.key).");
  }
  // No podemos pedir la passphrase del lado del server, y guardarla junto a la
  // clave anularía el punto de cifrarla.
  if (esClaveCifrada(keyPem)) {
    return fail(400, "Subí la clave privada sin contraseña.");
  }

  try {
    const cfg = await getFiscalConfig(db, storeId);
    const info = await saveCredentials(db, {
      storeId,
      ambiente: ambiente as ArcaAmbiente,
      certPem,
      keyPem,
      cuitEsperado: cfg?.cuit ?? null,
    });

    // Solo metadatos. Nunca los PEM.
    return Response.json({
      ok: true,
      subject: info.subject,
      commonName: info.commonName,
      cuit: info.cuit,
      notAfter: info.notAfter.toISOString(),
      fingerprint: info.fingerprintSha256,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    // El error crudo va al log del server, nunca al cliente.
    console.error("[facturacion/credenciales]", err instanceof Error ? err.message : err);
    const { status, message } = arcaUserMessage(err);
    const detalle = (err as { detalle?: string })?.detalle;
    return fail(status, detalle ? `${message} (${detalle})` : message);
  }
}
