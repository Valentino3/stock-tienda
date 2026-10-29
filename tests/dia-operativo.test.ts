import { describe, it, expect } from "vitest";
import { diaOperativo } from "@/lib/dates";

/**
 * El día de un restaurante no termina a medianoche: lo agotado a las 23:30
 * tiene que seguir agotado a la 1:00, y volver recién a la mañana.
 */
describe("diaOperativo", () => {
  it("antes de las 6 de la mañana sigue siendo el día anterior", () => {
    // 23:30 y 05:59 hora argentina (UTC-3) del jueves 29.
    expect(diaOperativo(new Date("2026-10-30T02:30:00Z"))).toBe("2026-10-29");
    expect(diaOperativo(new Date("2026-10-30T08:59:00Z"))).toBe("2026-10-29");
  });

  it("desde las 6 de la mañana es el día nuevo", () => {
    expect(diaOperativo(new Date("2026-10-30T09:00:00Z"))).toBe("2026-10-30");
    expect(diaOperativo(new Date("2026-10-30T20:00:00Z"))).toBe("2026-10-30");
  });
});
