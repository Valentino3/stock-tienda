/**
 * Búsqueda de productos sobre el catálogo guardado en el dispositivo.
 *
 * No intenta replicar el trigram de Postgres (src/domain/catalog.ts): sin
 * conexión no hay índice ni servidor, y sobre 10-20k filas en memoria un
 * filtro por tokens alcanza y sobra. Lo que sí replica es la FORMA del
 * resultado y el límite de 20, para que la pantalla de venta no distinga de
 * dónde vino cada fila.
 */

export type VarianteCatalogo = {
  variantId: number;
  productName: string;
  variantName: string | null;
  sku: string | null;
  stock: number;
  /**
   * Opcional a propósito: un dispositivo que venía de una versión anterior
   * tiene filas de catálogo sin este campo. SIEMPRE leerlo como
   * `tracksStock !== false`, nunca `=== true` — ver src/lib/offline/db.ts.
   */
  tracksStock?: boolean;
  price: number | null;
  /**
   * Listas alternativas. Opcionales por el mismo motivo que `tracksStock`: un
   * dispositivo que venía de la v4 tiene filas sin estos campos. Se leen
   * SIEMPRE con `!= null` y nunca con `||`: un artículo en promo a $0 es un
   * precio válido, y con `||` se cobraría al precio de lista.
   */
  priceCash?: number | null;
  priceWholesale?: number | null;
  basePrice: number;
  setName: string | null;
  condition: string | null;
  foil: boolean;
  language: string | null;
};

export const LIMITE_RESULTADOS = 20;
export const MIN_CARACTERES = 2;

/**
 * Minúsculas y sin acentos: en el mostrador nadie escribe "Pokémon" con
 * tilde, y el `ilike` del servidor con collation por defecto tampoco distingue.
 */
export function normalizar(s: string): string {
  // ̀-ͯ = marcas diacríticas combinantes, lo que NFD separa de la letra.
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function textoBuscable(v: VarianteCatalogo): string {
  return normalizar([v.productName, v.variantName, v.sku, v.setName].filter(Boolean).join(" "));
}

/** Índice precalculado: normalizar 20k filas en cada tecla sería inusable. */
export type CatalogoIndexado = { variante: VarianteCatalogo; texto: string; sku: string }[];

export function indexarCatalogo(variantes: VarianteCatalogo[]): CatalogoIndexado {
  return variantes.map((variante) => ({
    variante,
    texto: textoBuscable(variante),
    sku: normalizar(variante.sku ?? ""),
  }));
}

/**
 * Todos los tokens tienen que aparecer, en cualquier orden: "remera m" encuentra
 * "Remera talle M". Ordena por SKU exacto, después por lo que arranca con el
 * término, después el resto — el escaneo de un código de barras tiene que caer
 * primero, siempre.
 */
export function buscarEnCatalogo(
  indice: CatalogoIndexado,
  term: string,
  limite = LIMITE_RESULTADOS,
): VarianteCatalogo[] {
  const t = normalizar(term);
  if (t.length < MIN_CARACTERES) return [];

  const tokens = t.split(/\s+/).filter(Boolean);
  const encontrados: { v: VarianteCatalogo; puntaje: number }[] = [];

  for (const fila of indice) {
    if (!tokens.every((tok) => fila.texto.includes(tok))) continue;
    const puntaje = fila.sku && fila.sku === t ? 0 : fila.texto.startsWith(t) ? 1 : 2;
    encontrados.push({ v: fila.variante, puntaje });
    // Corte temprano solo cuando ya hay de sobra y ninguno puede mejorar el
    // orden: si apareció un SKU exacto ya está resuelto.
    if (puntaje === 0 && encontrados.length >= limite) break;
  }

  return encontrados
    .sort((a, b) => a.puntaje - b.puntaje || a.v.productName.localeCompare(b.v.productName))
    .slice(0, limite)
    .map((e) => e.v);
}

/** Precio efectivo: el de la variante pisa al del producto. Igual que el servidor. */
export const precioDe = (v: VarianteCatalogo): number => v.price ?? v.basePrice;
