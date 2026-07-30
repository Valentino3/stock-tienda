import forge from "node-forge";
import { ArcaError } from "@/lib/arca/errors";
import { normalizarDoc } from "@/domain/fiscal-catalogs";

/**
 * Inspección y validación del par certificado / clave privada. Módulo PURO.
 *
 * Todo esto corre ANTES de guardar nada: un par desapareado produce un CMS que
 * WSAA rechaza con un error opaco, y diagnosticarlo después cuesta horas.
 */

export type CertInfo = {
  subject: string;
  commonName: string | null;
  /** CUIT sacado del atributo serialNumber del subject ("CUIT 20111111112"). */
  cuit: string | null;
  notBefore: Date;
  notAfter: Date;
  fingerprintSha256: string;
};

const PEM_CERT = /-----BEGIN CERTIFICATE-----/;
const PEM_KEY = /-----BEGIN (RSA |EC )?PRIVATE KEY-----/;
const PEM_KEY_CIFRADA = /Proc-Type:\s*4,ENCRYPTED|-----BEGIN ENCRYPTED PRIVATE KEY-----/;

export function pareceCertificado(pem: string): boolean {
  return PEM_CERT.test(pem);
}

export function pareceClavePrivada(pem: string): boolean {
  return PEM_KEY.test(pem);
}

/**
 * Una clave con contraseña no sirve: no podemos pedir la passphrase del lado
 * del server, y guardarla al lado de la clave anularía el punto de cifrarla.
 */
export function esClaveCifrada(pem: string): boolean {
  return PEM_KEY_CIFRADA.test(pem);
}

export function inspectCertificate(certPem: string): CertInfo {
  let cert: forge.pki.Certificate;
  try {
    cert = forge.pki.certificateFromPem(certPem);
  } catch {
    throw new ArcaError("ARCA_CERT_INVALIDO");
  }

  const subject = cert.subject.attributes
    .map((a) => `${a.shortName ?? a.name}=${a.value as string}`)
    .join(", ");
  const commonName = (cert.subject.getField("CN")?.value as string | undefined) ?? null;
  // getField(string) de node-forge busca solo por shortName, y serialNumber no
  // tiene uno. Hay que pedirlo por OID (2.5.4.5), que es donde ARCA pone el CUIT.
  const serialNumber = (cert.subject.getField({ type: "2.5.4.5" })?.value as string | undefined) ?? null;

  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const md = forge.md.sha256.create();
  md.update(der);

  return {
    subject,
    commonName,
    cuit: extraerCuit(serialNumber),
    notBefore: cert.validity.notBefore,
    notAfter: cert.validity.notAfter,
    fingerprintSha256: md.digest().toHex(),
  };
}

/** ARCA pone el CUIT en serialNumber como "CUIT 20111111112". */
function extraerCuit(serialNumber: string | null): string | null {
  const d = normalizarDoc(serialNumber);
  return d && d.length === 11 ? d : null;
}

/**
 * Verifica que la clave privada corresponda al certificado, comparando módulo y
 * exponente público. Esta guarda es la que evita el error opaco de WSAA cuando
 * alguien sube el .key de otro certificado.
 */
export function assertKeyMatchesCert(certPem: string, keyPem: string): void {
  let certKey: forge.pki.rsa.PublicKey;
  let privKey: forge.pki.rsa.PrivateKey;
  try {
    certKey = forge.pki.certificateFromPem(certPem).publicKey as forge.pki.rsa.PublicKey;
    privKey = forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey;
  } catch {
    throw new ArcaError("ARCA_CERT_INVALIDO");
  }

  if (!certKey?.n || !privKey?.n) throw new ArcaError("ARCA_CERT_INVALIDO");
  if (certKey.n.compareTo(privKey.n) !== 0 || certKey.e.compareTo(privKey.e) !== 0) {
    throw new ArcaError("ARCA_CERT_INVALIDO");
  }
}

export function certVencido(info: CertInfo, ahora: Date = new Date()): boolean {
  return info.notAfter.getTime() <= ahora.getTime();
}

/** Días que faltan para que venza. Negativo si ya venció. */
export function diasParaVencer(info: CertInfo, ahora: Date = new Date()): number {
  return Math.floor((info.notAfter.getTime() - ahora.getTime()) / 86_400_000);
}
