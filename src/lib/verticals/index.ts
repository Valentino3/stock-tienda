import type { NavGroup } from "@/app/(app)/app-sidebar";

/**
 * Rubros del comercio.
 *
 * REGLA DURA: esto solo se lee en la capa de presentación — navegación,
 * etiquetas, qué campos del catálogo se muestran. **Ningún archivo de plata
 * puede preguntar de qué rubro es la tienda.** Si `src/domain/sales.ts`,
 * `cash.ts`, `fiscal-*.ts` o `src/lib/offline/*` necesitaran saberlo, el
 * modelo está torcido y hay que arreglar el modelo, no agregar el `if`.
 *
 * La diferencia entre una casa de cartas y un restaurante es QUÉ se vende y
 * cómo se lo muestra. Cómo se cobra, cómo cierra la caja y cómo se factura es
 * idéntico, y esa es exactamente la razón por la que gastronomía entra acá y
 * no en un producto aparte.
 *
 * Es data pura: sin DB, sin React, sin imports de servidor. Se puede testear
 * en Node y se puede importar desde un componente de cliente.
 */

export type BusinessType = "retail" | "gastronomia";

/** Atributos de variante que existen en el schema pero no aplican a todo rubro. */
export type AtributoCatalogo = "setName" | "condition" | "foil" | "language";

export type EtiquetasVertical = {
  /** "Producto" / "Plato". Singular, para formularios y mensajes. */
  producto: string;
  /** "Productos" / "Menú". Es también el título de la sección de catálogo. */
  productos: string;
  /** Placeholder de ejemplo para el campo categoría. */
  ejemploCategoria: string;
};

export type ContextoNav = {
  isOwner: boolean;
  /** Cantidad de avisos abiertos, para el badge. */
  openAvisos: number;
};

export type VerticalConfig = {
  key: BusinessType;
  /** Nombre para mostrar en el panel de plataforma. */
  nombre: string;
  etiquetas: EtiquetasVertical;
  /**
   * Qué columnas TCG de product_variants se muestran. Las columnas existen
   * siempre en la base — no se borran, porque `foil` es NOT NULL y sacarla
   * costaría tocar el import, el catálogo offline y seis pantallas. Un rubro
   * que no las declara simplemente no las renderiza y guarda los defaults.
   */
  atributosCatalogo: readonly AtributoCatalogo[];
  /** Valores por defecto al crear un producto en este rubro. */
  defaultsProducto: { tracksStock: boolean };
  nav: (ctx: ContextoNav) => NavGroup[];
};

const NAV_ADMIN = (ctx: ContextoNav, extra: { importar: boolean; mesas?: boolean }): NavGroup[] =>
  ctx.isOwner
    ? [
        {
          label: "Administración",
          links: [
            ...(extra.mesas ? [{ href: "/mesas", label: "Mesas" }] : []),
            ...(extra.importar ? [{ href: "/importar", label: "Importar" }] : []),
            { href: "/reportes", label: "Reportes" },
            { href: "/comisiones", label: "Comisiones" },
            { href: "/facturacion", label: "Facturación" },
            { href: "/avisos", label: "Avisos", badge: ctx.openAvisos },
            { href: "/usuarios", label: "Usuarios" },
          ],
        },
      ]
    : [];

export const VERTICALS: Record<BusinessType, VerticalConfig> = {
  /**
   * Comercio que vende cosas de una góndola. Es lo que la app fue siempre, y
   * por eso incluye los atributos de cartas: los dos locales en producción son
   * de TCG. Separar 'tcg' de un 'retail' genérico es una mejora de UI para
   * cuando firme un comercio que no venda cartas — no un bloqueo.
   */
  retail: {
    key: "retail",
    nombre: "Comercio / retail",
    etiquetas: {
      producto: "Producto",
      productos: "Productos",
      ejemploCategoria: "Ej: Pokémon, Magic, Accesorios",
    },
    atributosCatalogo: ["setName", "condition", "foil", "language"],
    defaultsProducto: { tracksStock: true },
    nav: (ctx) => [
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
      ...NAV_ADMIN(ctx, { importar: true }),
    ],
  },

  /**
   * Restaurante, bar, cafetería. Un plato es una variante sin stock: se cobra,
   * se factura y se reporta igual que cualquier otra cosa.
   *
   * Salón va primero porque es la pantalla donde el mozo pasa el turno.
   * "Vender" sigue estando para el mostrador y el para llevar.
   */
  gastronomia: {
    key: "gastronomia",
    nombre: "Gastronomía",
    etiquetas: {
      producto: "Plato",
      productos: "Menú",
      ejemploCategoria: "Ej: Entradas, Principales, Bebidas",
    },
    atributosCatalogo: [],
    defaultsProducto: { tracksStock: false },
    nav: (ctx) => [
      {
        label: "Operación",
        links: [
          { href: "/salon", label: "Salón" },
          { href: "/cocina", label: "Cocina" },
          { href: "/vender", label: "Mostrador" },
          { href: "/productos", label: "Menú" },
          { href: "/ventas", label: "Ventas" },
          { href: "/clientes", label: "Clientes" },
          { href: "/caja", label: "Caja" },
        ],
      },
      // Sin "Importar": la carga masiva por Excel está pensada para catálogos
      // de miles de artículos, no para una carta de cincuenta platos.
      ...NAV_ADMIN(ctx, { importar: false, mesas: true }),
    ],
  },
};

/**
 * Resuelve el rubro de una tienda.
 *
 * El fallback es carga: si una fila tiene un `business_type` que este deploy no
 * conoce —un rollback, un rubro nuevo a medio salir, un dato tocado a mano— la
 * tienda tiene que renderizar retail y seguir vendiendo, no romper el shell en
 * medio del turno.
 */
export function verticalDe(businessType: string | null | undefined): VerticalConfig {
  return esRubroConocido(businessType) ? VERTICALS[businessType] : VERTICALS.retail;
}

/**
 * `Object.hasOwn` y no `in`: con `in`, "toString" y "constructor" dan true por
 * la cadena de prototipos. Una tienda guardada con business_type "toString"
 * haría que `verticalDe` devuelva `Object.prototype.toString` —una función sin
 * `.nav`— y reviente el shell de la app, que es justo lo que el fallback
 * existe para evitar.
 */
export function esRubroConocido(v: string | null | undefined): v is BusinessType {
  return typeof v === "string" && Object.hasOwn(VERTICALS, v);
}

/** Para el selector del panel de plataforma. */
export const RUBROS = Object.values(VERTICALS).map((v) => ({ key: v.key, nombre: v.nombre }));
