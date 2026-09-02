import { describe, it, expect } from "vitest";
import { RUBROS, VERTICALS, esRubroConocido, verticalDe } from "@/lib/verticals";

/**
 * El registro de rubros es el contrato de la capa de presentación.
 *
 * El test que más importa es el primero: los dos locales en producción son
 * `retail`, y su navegación tiene que quedar EXACTAMENTE como estaba antes de
 * que existiera este registro. Si alguien reordena el array, esto grita.
 */

const NAV_RETAIL_DUENO = [
  {
    label: "Operación",
    links: [
      { href: "/vender", label: "Vender" },
      { href: "/productos", label: "Productos" },
      { href: "/ventas", label: "Ventas" },
      { href: "/clientes", label: "Clientes" },
      { href: "/caja", label: "Caja" },
    ],
  },
  {
    label: "Administración",
    links: [
      { href: "/importar", label: "Importar" },
      { href: "/precios", label: "Precios" },
      { href: "/reportes", label: "Reportes" },
      { href: "/comisiones", label: "Comisiones" },
      { href: "/facturacion", label: "Facturación" },
      { href: "/avisos", label: "Avisos", badge: 3 },
      { href: "/usuarios", label: "Usuarios" },
    ],
  },
];

describe("retail: nada cambia para las tiendas que ya están en producción", () => {
  it("la navegación del dueño es la misma de siempre", () => {
    expect(VERTICALS.retail.nav({ isOwner: true, openAvisos: 3 })).toEqual(NAV_RETAIL_DUENO);
  });

  it("el empleado no ve la sección de administración", () => {
    const nav = VERTICALS.retail.nav({ isOwner: false, openAvisos: 0 });
    expect(nav).toHaveLength(1);
    expect(nav[0].label).toBe("Operación");
  });

  it("el dueño ve Precios; el empleado no", () => {
    const empleado = VERTICALS.retail.nav({ isOwner: false, openAvisos: 0 });
    expect(empleado.flatMap((g) => g.links).some((l) => l.href === "/precios")).toBe(false);
  });

  it("conserva los atributos de carta", () => {
    expect(VERTICALS.retail.atributosCatalogo).toEqual(["setName", "condition", "foil", "language"]);
  });

  it("sus productos descuentan stock", () => {
    expect(VERTICALS.retail.defaultsProducto.tracksStock).toBe(true);
  });
});

describe("gastronomía", () => {
  it("no muestra atributos de carta", () => {
    expect(VERTICALS.gastronomia.atributosCatalogo).toEqual([]);
  });

  it("sus productos NO descuentan stock: un plato no tiene existencias", () => {
    expect(VERTICALS.gastronomia.defaultsProducto.tracksStock).toBe(false);
  });

  it("no ofrece Precios: un restaurante no cotiza su carta en dólares", () => {
    const nav = VERTICALS.gastronomia.nav({ isOwner: true, openAvisos: 0 });
    expect(nav.flatMap((g) => g.links).some((l) => l.href === "/precios")).toBe(false);
  });

  it("llama Menú a la sección de catálogo", () => {
    const nav = VERTICALS.gastronomia.nav({ isOwner: true, openAvisos: 0 });
    const operacion = nav.find((g) => g.label === "Operación");
    expect(operacion?.links.find((l) => l.href === "/productos")?.label).toBe("Menú");
    expect(VERTICALS.gastronomia.etiquetas.productos).toBe("Menú");
    expect(VERTICALS.gastronomia.etiquetas.producto).toBe("Plato");
  });

  it("Salón es lo primero: es donde el mozo pasa el turno", () => {
    const operacion = VERTICALS.gastronomia
      .nav({ isOwner: true, openAvisos: 0 })
      .find((g) => g.label === "Operación");
    expect(operacion?.links[0]).toEqual({ href: "/salon", label: "Salón" });
  });

  it("el ABM de mesas es del dueño", () => {
    const delEmpleado = VERTICALS.gastronomia
      .nav({ isOwner: false, openAvisos: 0 })
      .flatMap((g) => g.links.map((l) => l.href));
    const delDueno = VERTICALS.gastronomia
      .nav({ isOwner: true, openAvisos: 0 })
      .flatMap((g) => g.links.map((l) => l.href));

    expect(delEmpleado).not.toContain("/mesas");
    expect(delDueno).toContain("/mesas");
    // El empleado sí entra al salón: es su pantalla de trabajo.
    expect(delEmpleado).toContain("/salon");
  });

  it("retail no tiene salón ni mesas", () => {
    const hrefs = VERTICALS.retail
      .nav({ isOwner: true, openAvisos: 0 })
      .flatMap((g) => g.links.map((l) => l.href));
    expect(hrefs).not.toContain("/salon");
    expect(hrefs).not.toContain("/mesas");
  });

  it("no ofrece importar por Excel", () => {
    const hrefs = VERTICALS.gastronomia
      .nav({ isOwner: true, openAvisos: 0 })
      .flatMap((g) => g.links.map((l) => l.href));
    expect(hrefs).not.toContain("/importar");
  });

  it("conserva caja, ventas, clientes y facturación: se cobra igual que en cualquier rubro", () => {
    const hrefs = VERTICALS.gastronomia
      .nav({ isOwner: true, openAvisos: 0 })
      .flatMap((g) => g.links.map((l) => l.href));
    for (const href of ["/vender", "/ventas", "/clientes", "/caja", "/facturacion", "/reportes"]) {
      expect(hrefs).toContain(href);
    }
  });
});

describe("verticalDe", () => {
  it("resuelve los rubros conocidos", () => {
    expect(verticalDe("retail").key).toBe("retail");
    expect(verticalDe("gastronomia").key).toBe("gastronomia");
  });

  it("un rubro desconocido cae a retail en vez de romper el shell", () => {
    // Pasa de verdad: un rollback, un rubro nuevo a medio salir, un dato
    // tocado a mano. La tienda tiene que seguir vendiendo.
    expect(verticalDe("kiosco-espacial").key).toBe("retail");
    expect(verticalDe("").key).toBe("retail");
    expect(verticalDe(null).key).toBe("retail");
    expect(verticalDe(undefined).key).toBe("retail");
  });

  it("no se lo puede engañar con una propiedad heredada de Object", () => {
    expect(verticalDe("toString").key).toBe("retail");
    expect(verticalDe("constructor").key).toBe("retail");
  });
});

describe("invariantes del registro", () => {
  it("cada rubro se declara con su propia clave", () => {
    for (const [clave, config] of Object.entries(VERTICALS)) {
      expect(config.key).toBe(clave);
    }
  });

  it("todo rubro ofrece vender y cobrar", () => {
    for (const config of Object.values(VERTICALS)) {
      const hrefs = config.nav({ isOwner: true, openAvisos: 0 }).flatMap((g) => g.links.map((l) => l.href));
      expect(hrefs).toContain("/vender");
      expect(hrefs).toContain("/caja");
    }
  });

  it("esRubroConocido acepta los del registro y rechaza el resto", () => {
    expect(esRubroConocido("retail")).toBe(true);
    expect(esRubroConocido("gastronomia")).toBe(true);
    expect(esRubroConocido("peluqueria")).toBe(false);
    expect(esRubroConocido("toString")).toBe(false);
  });

  it("RUBROS lista todos los rubros para el selector del panel", () => {
    expect(RUBROS.map((r) => r.key).sort()).toEqual(Object.keys(VERTICALS).sort());
    expect(RUBROS.every((r) => r.nombre.length > 0)).toBe(true);
  });
});
