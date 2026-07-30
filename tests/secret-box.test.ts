import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sealSecret, openSecret, masterKeyStatus, safeEquals, SecretBoxError } from "@/lib/crypto/secret-box";

// 32 bytes en base64, que es lo que exige ARCA_MASTER_KEY.
const KEY_A = Buffer.alloc(32, 1).toString("base64");
const KEY_B = Buffer.alloc(32, 2).toString("base64");

const PEM = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADAN\n-----END PRIVATE KEY-----\n";

beforeEach(() => {
  vi.stubEnv("ARCA_MASTER_KEY", KEY_A);
  vi.stubEnv("ARCA_MASTER_KEY_ID", "k1");
  vi.stubEnv("ARCA_MASTER_KEY_PREVIOUS", "");
  vi.stubEnv("ARCA_MASTER_KEY_PREVIOUS_ID", "");
});

afterEach(() => vi.unstubAllEnvs());

describe("secret-box", () => {
  it("round-trip con el mismo AAD", () => {
    const sealed = sealSecret(PEM, "7:arca.key");
    expect(openSecret(sealed, "7:arca.key")).toBe(PEM);
  });

  it("el ciphertext no contiene nada del plaintext", () => {
    const sealed = sealSecret(PEM, "7:arca.key");
    expect(sealed).not.toContain("BEGIN");
    expect(sealed).not.toContain("MIIEvQ");
  });

  it("formato versionado v1.<keyId>.<iv>.<tag>.<ct>", () => {
    const parts = sealSecret("hola", "7:arca.cert").split(".");
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe("v1");
    expect(parts[1]).toBe("k1");
  });

  it("IV distinto por cifrado: dos sobres del mismo plaintext difieren", () => {
    const a = sealSecret(PEM, "7:arca.key");
    const b = sealSecret(PEM, "7:arca.key");
    expect(a).not.toBe(b);
    expect(openSecret(a, "7:arca.key")).toBe(openSecret(b, "7:arca.key"));
  });

  // Ésta es la guarda anti cross-tenant: alguien con acceso de ESCRITURA a la DB
  // no puede trasplantar el blob de una tienda a la fila de otra.
  it("descifrar con el AAD de otra tienda falla", () => {
    const sealed = sealSecret(PEM, "7:arca.key");
    expect(() => openSecret(sealed, "8:arca.key")).toThrow(SecretBoxError);
    expect(() => openSecret(sealed, "8:arca.key")).toThrow("SECRET_DECRYPT_FAILED");
  });

  it("descifrar con el AAD de otra columna de la misma tienda falla", () => {
    const sealed = sealSecret(PEM, "7:arca.key");
    expect(() => openSecret(sealed, "7:arca.cert")).toThrow("SECRET_DECRYPT_FAILED");
  });

  it("descifrar con otra clave maestra falla, no devuelve basura", () => {
    const sealed = sealSecret(PEM, "7:arca.key");
    vi.stubEnv("ARCA_MASTER_KEY", KEY_B);
    expect(() => openSecret(sealed, "7:arca.key")).toThrow("SECRET_DECRYPT_FAILED");
  });

  it("ciphertext manipulado falla por el auth tag de GCM", () => {
    const sealed = sealSecret(PEM, "7:arca.key");
    const parts = sealed.split(".");
    const ct = Buffer.from(parts[4], "base64url");
    ct[0] ^= 0xff;
    parts[4] = ct.toString("base64url");
    expect(() => openSecret(parts.join("."), "7:arca.key")).toThrow("SECRET_DECRYPT_FAILED");
  });

  it("sobre con formato inválido falla limpio", () => {
    expect(() => openSecret("no-es-un-sobre", "7:arca.key")).toThrow("SECRET_DECRYPT_FAILED");
    expect(() => openSecret("v2.k1.a.b.c", "7:arca.key")).toThrow("SECRET_DECRYPT_FAILED");
  });

  describe("rotación de clave", () => {
    it("la clave anterior sigue descifrando lo viejo, la nueva cifra lo nuevo", () => {
      const viejo = sealSecret(PEM, "7:arca.key"); // cifrado con k1

      // Rotación: k2 pasa a ser la actual, k1 queda solo para descifrar.
      vi.stubEnv("ARCA_MASTER_KEY", KEY_B);
      vi.stubEnv("ARCA_MASTER_KEY_ID", "k2");
      vi.stubEnv("ARCA_MASTER_KEY_PREVIOUS", KEY_A);
      vi.stubEnv("ARCA_MASTER_KEY_PREVIOUS_ID", "k1");

      // Una DB a medio rotar sigue funcionando: el keyId embebido decide.
      expect(openSecret(viejo, "7:arca.key")).toBe(PEM);
      const nuevo = sealSecret(PEM, "7:arca.key");
      expect(nuevo.split(".")[1]).toBe("k2");
      expect(openSecret(nuevo, "7:arca.key")).toBe(PEM);
    });

    it("terminada la rotación, un sobre con la clave vieja ya no abre", () => {
      const viejo = sealSecret(PEM, "7:arca.key");
      vi.stubEnv("ARCA_MASTER_KEY", KEY_B);
      vi.stubEnv("ARCA_MASTER_KEY_ID", "k2");
      expect(() => openSecret(viejo, "7:arca.key")).toThrow("SECRET_DECRYPT_FAILED");
    });
  });

  describe("validación de la clave maestra", () => {
    it("sin ARCA_MASTER_KEY lanza MASTER_KEY_FALTANTE", () => {
      vi.stubEnv("ARCA_MASTER_KEY", "");
      expect(() => sealSecret("x", "7:arca.key")).toThrow("MASTER_KEY_FALTANTE");
    });

    it("clave de largo incorrecto lanza MASTER_KEY_INVALIDA", () => {
      vi.stubEnv("ARCA_MASTER_KEY", Buffer.alloc(16, 1).toString("base64"));
      expect(() => sealSecret("x", "7:arca.key")).toThrow("MASTER_KEY_INVALIDA");
    });

    it("masterKeyStatus no revela la clave y reporta el estado", () => {
      expect(masterKeyStatus()).toEqual({ configured: true, keyId: "k1", hasPrevious: false });
      vi.stubEnv("ARCA_MASTER_KEY", "");
      expect(masterKeyStatus()).toEqual({ configured: false, keyId: null, hasPrevious: false });
    });
  });

  it("safeEquals compara sin lanzar ante largos distintos", () => {
    expect(safeEquals("abc", "abc")).toBe(true);
    expect(safeEquals("abc", "abd")).toBe(false);
    expect(safeEquals("abc", "abcd")).toBe(false);
  });
});
