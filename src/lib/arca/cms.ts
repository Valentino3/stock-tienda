import forge from "node-forge";
import { ArcaError } from "@/lib/arca/errors";

/**
 * Firma CMS / PKCS#7 SignedData del TRA. Módulo PURO: no hace I/O.
 *
 * ¿Por qué node-forge y no node:crypto? node:crypto expone `createSign` (firma
 * cruda sobre un digest) y `X509Certificate` (solo parseo), pero NO expone
 * codificador ASN.1 ni API de CMS/SignedData: las funciones CMS de OpenSSL no
 * están bindeadas. Hacerlo a mano implica emitir DER byte-exacto para
 * ContentInfo -> SignedData -> SignerInfo incluidos los signedAttrs
 * (contentType, messageDigest, signingTime), y si un byte queda mal WSAA
 * responde un error opaco. Son ~400 líneas de ASN.1 imposibles de depurar.
 *
 * node-forge produce exactamente lo que embarcan todos los clientes AFIP del
 * ecosistema, y está probado contra WSAA en particular.
 */

/**
 * Devuelve el CMS SignedData en base64, con el certificado embebido y el
 * contenido adjunto — que es lo que espera LoginCms.
 */
export function signCms(input: { tra: string; certPem: string; keyPem: string }): string {
  try {
    const cert = forge.pki.certificateFromPem(input.certPem);
    const key = forge.pki.privateKeyFromPem(input.keyPem);

    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(input.tra, "utf8");
    p7.addCertificate(cert);
    p7.addSigner({
      key,
      certificate: cert,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        // messageDigest y signingTime se completan solos al firmar; tienen que
        // estar declarados o el SignerInfo sale sin signedAttrs y WSAA lo rechaza.
        { type: forge.pki.oids.messageDigest },
        { type: forge.pki.oids.signingTime },
      ],
    });
    p7.sign({ detached: false });

    const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
    return forge.util.encode64(der);
  } catch (err) {
    // Sin `cause` A PROPÓSITO: los errores de node-forge pueden arrastrar
    // material de la clave privada, y esto termina en logs que lee el equipo.
    console.error("[arca/cms] falló la firma CMS:", err instanceof Error ? err.name : typeof err);
    throw new ArcaError("CMS_SIGN_FAILED");
  }
}
