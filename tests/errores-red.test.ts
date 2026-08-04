import { describe, it, expect } from "vitest";
import { esErrorDeRed } from "@/lib/errores-red";

/**
 * El riesgo de este clasificador es el falso positivo: si un error de dominio
 * se leyera como corte de red, el vendedor recibiría "reintentá" ante un
 * rechazo legítimo. Por eso hay tantos casos negativos como positivos.
 */
describe("esErrorDeRed", () => {
  it("reconoce códigos de socket y DNS de Node", () => {
    for (const code of ["ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN"]) {
      expect(esErrorDeRed(Object.assign(new Error("boom"), { code }))).toBe(true);
    }
  });

  it("reconoce los SQLSTATE de conexión de Postgres", () => {
    for (const code of ["08006", "57P01", "08003"]) {
      expect(esErrorDeRed(Object.assign(new Error("boom"), { code }))).toBe(true);
    }
  });

  it("desenvuelve la cadena de cause que arma drizzle", () => {
    const driver = Object.assign(new Error("connection terminated unexpectedly"), { code: "ECONNRESET" });
    const drizzleErr = Object.assign(new Error("Failed query"), { cause: driver });
    expect(esErrorDeRed(drizzleErr)).toBe(true);
  });

  it("reconoce el TypeError de fetch fallido que emite el driver de Neon", () => {
    expect(esErrorDeRed(new TypeError("fetch failed"))).toBe(true);
  });

  it("reconoce un abort por timeout", () => {
    expect(esErrorDeRed(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
  });

  it("NO marca como red los errores de dominio del repo", () => {
    for (const msg of [
      "NO_OPEN_SESSION", "INSUFFICIENT_STOCK", "EMPTY_SALE", "INVALID_QUANTITY",
      "VARIANT_NOT_FOUND", "CLIENT_REQUIRED", "CLIENT_NOT_FOUND",
      "SESSION_ALREADY_OPEN", "SESSION_NOT_OPEN", "ALREADY_VOIDED", "SALE_NOT_FOUND",
      "EMISION_EN_CURSO", "FORBIDDEN",
    ]) {
      expect(esErrorDeRed(new Error(msg))).toBe(false);
    }
  });

  it("NO marca como red una violación de unicidad ni un error de constraint", () => {
    expect(esErrorDeRed(Object.assign(new Error("duplicate key value"), { code: "23505" }))).toBe(false);
    expect(esErrorDeRed(Object.assign(new Error("null value in column"), { code: "23502" }))).toBe(false);
  });

  it("tolera null, undefined y valores que no son Error", () => {
    expect(esErrorDeRed(null)).toBe(false);
    expect(esErrorDeRed(undefined)).toBe(false);
    expect(esErrorDeRed("ECONNRESET")).toBe(false);
    expect(esErrorDeRed({})).toBe(false);
  });

  it("no entra en loop con una cadena de cause circular", () => {
    const a: { message: string; cause?: unknown } = { message: "a" };
    a.cause = a;
    expect(esErrorDeRed(a)).toBe(false);
  });
});
