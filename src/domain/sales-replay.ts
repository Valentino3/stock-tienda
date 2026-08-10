import { and, eq, inArray } from "drizzle-orm";
import {
  products, productVariants, sales, saleItems, cashSessions, clients, clientAccountMovements,
} from "@/db/schema";
import { applyStockMovement } from "@/domain/stock";
import { calcularTotales, esListaValida, resolverPrecio, type Discount, type PriceList } from "@/domain/sales";
import { createSyncNotification } from "@/domain/notifications";

/**
 * Sincronización de ventas cobradas sin conexión.
 *
 * Es un camino DISTINTO de createSale, no una variante con un flag, porque las
 * garantías son opuestas y mezclarlas volvería frágil el camino online:
 *
 *   | | createSale (online) | replaySale (offline) |
 *   |-|-|-|
 *   | precio | lo resuelve el servidor | el capturado al cobrar |
 *   | caja | la que esté abierta | la que estaba abierta al vender |
 *   | fecha | now() | la del dispositivo, acotada |
 *   | stock insuficiente | rechaza la venta | la registra y deja negativo |
 *
 * La asimetría del stock es deliberada: online, rechazar impide sobrevender.
 * En el replay la mercadería ya salió del local y ya se cobró — rechazar no
 * devuelve las unidades, solo pierde el registro de la venta. Se registra, se
 * deja el stock en negativo y se levanta un aviso.
 *
 * Todo lo que sea sospechoso vuelve como `avisos` en la respuesta ADEMÁS de
 * quedar en la bandeja de avisos: la divergencia silenciosa es el peor modo de
 * falla de cualquier sincronización.
 */

// Fecha del dispositivo: se acepta pero acotada. Un reloj mal configurado (pila
// de la BIOS muerta, zona horaria "arreglada" a mano) mandaría ventas al año
// que sea y rompería todos los reportes sin fallar nunca.
const MAX_ANTIGUEDAD_MS = 30 * 24 * 60 * 60 * 1000;
const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;

const PG_UNIQUE_VIOLATION = "23505";

export type ClienteOffline = {
  uid: string;
  name: string;
  phone?: string | null;
  docTipo?: number | null;
  docNro?: string | null;
};

/**
 * Producto dado de alta sin conexión. En una feria aparece mercadería que no
 * está en el catálogo, y la alternativa a poder cargarla es peor: no venderla,
 * o cobrarla como si fuera otro producto — que ensucia el stock y el reporte
 * de los dos.
 *
 * Deliberadamente mínimo: nombre, precio, cantidad. Una variante por producto.
 * El resto (categoría, proveedor, costo) se completa después desde Productos,
 * con tiempo y sin cola en el mostrador.
 */
export type ProductoOffline = {
  uid: string;
  variantUid: string;
  name: string;
  basePrice: number;
  stock: number;
  sku?: string | null;
};

export type ResultadoProducto = {
  uid: string;
  estado: "aplicado" | "duplicado" | "error";
  variantId?: number;
  error?: string;
  avisos: string[];
};

export type VentaOffline = {
  uid: string;
  /** ISO del reloj del dispositivo al cobrar. */
  capturadoEn: string;
  /** Caja que estaba abierta al vender, NO la que esté abierta al sincronizar. */
  cashSessionId: number;
  paymentMethod: "efectivo" | "transferencia" | "tarjeta" | "cuenta";
  /**
   * `variantId` para lo que ya existía en el catálogo; `variantUid` para un
   * producto creado sin conexión, cuyo id todavía no existe.
   */
  items: {
    variantId?: number;
    variantUid?: string;
    quantity: number;
    unitPrice: number;
    discount?: Discount;
    /**
     * Con qué lista se cobró en el dispositivo. Es METADATO: acá NO se
     * recalcula el precio con ella — el importe que vale es `unitPrice`, el
     * que el cliente pagó. Sirve para dos cosas: escribir
     * `sale_items.priceList`, y comparar la deriva de precio contra la lista
     * correcta en vez de contra el precio de venta.
     */
    priceList?: PriceList;
  }[];
  saleDiscount?: Discount;
  clientId?: number | null;
  /** Cliente dado de alta sin conexión, que todavía no tiene id. */
  clientUid?: string | null;
};

export type ResultadoVenta = {
  uid: string;
  estado: "aplicada" | "duplicada" | "error";
  saleId?: number;
  total?: number;
  error?: string;
  avisos: string[];
};

export type ResultadoCliente = {
  uid: string;
  estado: "aplicado" | "duplicado" | "error";
  clientId?: number;
  error?: string;
};

/**
 * Quién puede sincronizar qué.
 *
 * Vive acá y no dentro del route handler para poder testearla como el resto del
 * dominio, sin mockear sesión ni base.
 *
 * Sincronizar ventas y clientes es del empleado: vender es su trabajo, y
 * exigir dueño dejaría sus ventas offline sin poder entrar. Dar de alta
 * PRODUCTOS es del dueño, igual que `saveProduct` en
 * src/app/(app)/productos/actions.ts — sin esta guarda el replay sería una
 * puerta lateral para crear catálogo.
 */
export function puedeSincronizar(input: { esDueno: boolean; cantidadProductos: number }):
  | { ok: true }
  | { ok: false; error: string } {
  if (input.cantidadProductos > 0 && !input.esDueno) {
    return {
      ok: false,
      error: "Solo el dueño puede dar de alta productos. Pedile que sincronice él, o que los cargue desde Productos.",
    };
  }
  return { ok: true };
}

/**
 * Alta de los productos creados sin conexión. Corre ANTES que las ventas: sus
 * items referencian la variante por uid. Idempotente por (storeId, uid).
 */
export async function replayProductos(
  db: any,
  input: { storeId: number; productos: ProductoOffline[] }
): Promise<ResultadoProducto[]> {
  const resultados: ResultadoProducto[] = [];

  for (const p of input.productos) {
    const avisos: string[] = [];
    try {
      const uid = p.uid?.trim();
      const variantUid = p.variantUid?.trim();
      if (!uid || !variantUid) throw new Error("UID_REQUERIDO");
      if (!p.name?.trim()) throw new Error("EMPTY_NAME");
      if (typeof p.basePrice !== "number" || !(p.basePrice >= 0)) throw new Error("INVALID_PRICE");
      if (!Number.isInteger(p.stock) || p.stock < 0) throw new Error("INVALID_QUANTITY");

      const [ya] = await db.select({ id: productVariants.id }).from(productVariants)
        .where(and(eq(productVariants.storeId, input.storeId), eq(productVariants.uid, variantUid)));
      if (ya) {
        resultados.push({ uid, estado: "duplicado", variantId: ya.id, avisos });
        continue;
      }

      const variantId = await db.transaction(async (tx: any) => {
        const [prod] = await tx.insert(products).values({
          storeId: input.storeId, uid, name: p.name.trim(), basePrice: p.basePrice,
        }).returning({ id: products.id });

        // El SKU es único por tienda. Si el que se tipeó en la feria ya existe,
        // se guarda el producto SIN sku en vez de perder la venta: el nombre y
        // el precio son lo que hace falta para que el registro cierre.
        let sku = p.sku?.trim() || null;
        if (sku) {
          const [choca] = await tx.select({ id: productVariants.id }).from(productVariants)
            .where(and(eq(productVariants.storeId, input.storeId), eq(productVariants.sku, sku)));
          if (choca) {
            avisos.push(`El SKU "${sku}" ya existía: el producto "${p.name.trim()}" se creó sin SKU.`);
            sku = null;
          }
        }

        const [variante] = await tx.insert(productVariants).values({
          storeId: input.storeId, productId: prod.id, uid: variantUid, name: "", sku, stock: p.stock,
        }).returning({ id: productVariants.id });
        return variante.id as number;
      });

      resultados.push({ uid, estado: "aplicado", variantId, avisos });
    } catch (err) {
      const code = (err as any)?.code ?? (err as any)?.cause?.code;
      if (code === PG_UNIQUE_VIOLATION) {
        const [ya] = await db.select({ id: productVariants.id }).from(productVariants)
          .where(and(eq(productVariants.storeId, input.storeId), eq(productVariants.uid, p.variantUid)));
        if (ya) {
          resultados.push({ uid: p.uid, estado: "duplicado", variantId: ya.id, avisos });
          continue;
        }
      }
      resultados.push({
        uid: p.uid,
        estado: "error",
        error: err instanceof Error ? err.message : "ERROR_DESCONOCIDO",
        avisos,
      });
    }
  }

  return resultados;
}

/**
 * Alta de los clientes creados sin conexión. Corre ANTES que las ventas porque
 * una venta a cuenta los referencia por uid. Idempotente por (storeId, uid).
 */
export async function replayClientes(
  db: any,
  input: { storeId: number; clientes: ClienteOffline[] }
): Promise<ResultadoCliente[]> {
  const resultados: ResultadoCliente[] = [];

  for (const c of input.clientes) {
    try {
      const uid = c.uid?.trim();
      if (!uid) throw new Error("UID_REQUERIDO");
      if (!c.name?.trim()) throw new Error("EMPTY_NAME");

      const [ya] = await db.select({ id: clients.id }).from(clients)
        .where(and(eq(clients.storeId, input.storeId), eq(clients.uid, uid)));
      if (ya) {
        resultados.push({ uid, estado: "duplicado", clientId: ya.id });
        continue;
      }

      const [row] = await db.insert(clients).values({
        storeId: input.storeId,
        uid,
        name: c.name.trim(),
        phone: c.phone?.trim() || null,
        docTipo: c.docTipo ?? null,
        docNro: c.docNro?.trim() || null,
      }).returning({ id: clients.id });
      resultados.push({ uid, estado: "aplicado", clientId: row.id });
    } catch (err) {
      // Carrera con otro envío del mismo lote: el índice único resuelve el
      // empate y se relee el ganador.
      const code = (err as any)?.code ?? (err as any)?.cause?.code;
      if (code === PG_UNIQUE_VIOLATION) {
        const [ya] = await db.select({ id: clients.id }).from(clients)
          .where(and(eq(clients.storeId, input.storeId), eq(clients.uid, c.uid)));
        if (ya) {
          resultados.push({ uid: c.uid, estado: "duplicado", clientId: ya.id });
          continue;
        }
      }
      resultados.push({
        uid: c.uid,
        estado: "error",
        error: err instanceof Error ? err.message : "ERROR_DESCONOCIDO",
      });
    }
  }

  return resultados;
}

/** Acota la fecha del dispositivo a una ventana creíble alrededor del reloj del servidor. */
function acotarFecha(capturadoEn: string, avisos: string[]): Date {
  const ahora = Date.now();
  const t = Date.parse(capturadoEn);
  if (Number.isNaN(t)) {
    avisos.push("La fecha del dispositivo era ilegible: se registró con la fecha de sincronización.");
    return new Date(ahora);
  }
  if (t > ahora + TOLERANCIA_FUTURO_MS) {
    avisos.push("El reloj del dispositivo estaba adelantado: se registró con la fecha de sincronización.");
    return new Date(ahora);
  }
  if (t < ahora - MAX_ANTIGUEDAD_MS) {
    avisos.push("El reloj del dispositivo estaba atrasado más de 30 días: se registró con la fecha de sincronización.");
    return new Date(ahora);
  }
  return new Date(t);
}

/**
 * Registra UNA venta capturada sin conexión. Una transacción por venta y no una
 * por lote: una venta con un problema no puede frenar a las otras 199.
 */
export async function replaySale(
  db: any,
  input: {
    storeId: number;
    sellerId: string;
    venta: VentaOffline;
    clientePorUid?: Map<string, number>;
    variantePorUid?: Map<string, number>;
  }
): Promise<ResultadoVenta> {
  const { venta, storeId, sellerId } = input;
  const avisos: string[] = [];
  const uid = venta.uid?.trim();

  if (!uid) return { uid: venta.uid, estado: "error", error: "UID_REQUERIDO", avisos };
  if (!venta.items?.length) return { uid, estado: "error", error: "EMPTY_SALE", avisos };
  if (venta.items.some((i) => !Number.isInteger(i.quantity) || i.quantity <= 0)) {
    return { uid, estado: "error", error: "INVALID_QUANTITY", avisos };
  }
  if (venta.items.some((i) => typeof i.unitPrice !== "number" || !(i.unitPrice >= 0))) {
    return { uid, estado: "error", error: "INVALID_PRICE", avisos };
  }

  // Se resuelven los uid de variantes creadas sin conexión ANTES de abrir la
  // transacción: si el producto no se pudo crear, la venta no entra en vez de
  // entrar colgada de una variante equivocada.
  const items: {
    variantId: number; quantity: number; unitPrice: number;
    discount?: Discount; priceList?: PriceList;
  }[] = [];
  for (const i of venta.items) {
    const resuelto = i.variantUid != null
      ? input.variantePorUid?.get(i.variantUid)
      : i.variantId;
    if (!Number.isInteger(resuelto)) {
      return { uid, estado: "error", error: "VARIANT_NOT_FOUND", avisos };
    }
    // Una lista basura no puede llegar al enum: sería un 22P02 de Postgres
    // adentro de la transacción, abortando el lote con un mensaje ilegible.
    if (i.priceList !== undefined && !esListaValida(i.priceList)) {
      return { uid, estado: "error", error: "INVALID_PRICE_LIST", avisos };
    }
    items.push({
      variantId: resuelto as number,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discount: i.discount,
      priceList: i.priceList,
    });
  }

  // Cliente: por id directo, o por uid si se creó sin conexión.
  let clientId = venta.clientId ?? null;
  if (venta.clientUid) {
    const resuelto = input.clientePorUid?.get(venta.clientUid);
    if (!resuelto) return { uid, estado: "error", error: "CLIENT_NOT_FOUND", avisos };
    clientId = resuelto;
  }
  if (venta.paymentMethod === "cuenta" && !clientId) {
    return { uid, estado: "error", error: "CLIENT_REQUIRED", avisos };
  }

  try {
    return await db.transaction(async (tx: any) => {
      const [ya] = await tx.select().from(sales)
        .where(and(eq(sales.storeId, storeId), eq(sales.uid, uid))).limit(1);
      if (ya) {
        return { uid, estado: "duplicada" as const, saleId: ya.id, total: ya.total, avisos };
      }

      // La caja tiene que ser de esta tienda. Que esté cerrada NO bloquea: la
      // venta ya se cobró y pertenece a esa jornada. Se avisa, porque los
      // totales guardados al cierre ya no la incluyen.
      const [caja] = await tx.select().from(cashSessions)
        .where(and(eq(cashSessions.id, venta.cashSessionId), eq(cashSessions.storeId, storeId)));
      if (!caja) throw new Error("CASH_SESSION_NOT_FOUND");
      const cajaCerrada = caja.closedAt != null;

      const variantRows = await tx
        .select({
          id: productVariants.id,
          name: productVariants.name,
          price: productVariants.price,
          priceCash: productVariants.priceCash,
          priceWholesale: productVariants.priceWholesale,
          basePrice: products.basePrice,
          productName: products.name,
          tracksStock: products.tracksStock,
          isPromo: products.isPromo,
        })
        .from(productVariants)
        .innerJoin(products, eq(productVariants.productId, products.id))
        .where(and(
          eq(productVariants.storeId, storeId),
          inArray(productVariants.id, items.map((i) => i.variantId)),
        ));

      const porId = new Map(variantRows.map((v: any) => [v.id, v]));
      if (porId.size !== new Set(items.map((i) => i.variantId)).size) throw new Error("VARIANT_NOT_FOUND");

      // Precio capturado, no el actual: es el que el cliente pagó. Si el
      // catálogo cambió mientras tanto se avisa, no se corrige.
      //
      // ⚠️ La comparación es contra LA LISTA CON LA QUE SE COBRÓ, no contra el
      // precio de venta. Sin esto, cada venta mayorista sincronizada de una
      // feria genera un aviso falso ("se cobró 9000 y hoy figura 12000"): 200
      // ventas serían 200 avisos basura en la misma bandeja donde viven los
      // avisos reales de stock negativo, que es como se deja de mirarla.
      for (const i of items) {
        const v: any = porId.get(i.variantId);
        const lista = i.priceList ?? "venta";
        let actual: number;
        try {
          actual = resolverPrecio(v, lista);
        } catch {
          // La lista existía en el dispositivo y hoy ya no está cargada. Es
          // otra cosa que un precio distinto, y se dice distinto.
          avisos.push(
            `${v.productName} se cobró con la lista "${lista}", que ya no está cargada. Revisá el precio.`,
          );
          continue;
        }
        if (actual !== i.unitPrice) {
          avisos.push(`Precio distinto en ${v.productName}: se cobró ${i.unitPrice} y hoy figura ${actual}.`);
        }
      }

      const { lines, saleDiscount, total } = calcularTotales(
        items, (i) => i.unitPrice, venta.saleDiscount,
      );

      if (venta.paymentMethod === "cuenta") {
        const [client] = await tx.select({ id: clients.id }).from(clients)
          .where(and(eq(clients.id, clientId as number), eq(clients.storeId, storeId)));
        if (!client) throw new Error("CLIENT_NOT_FOUND");
      }

      const [sale] = await tx.insert(sales).values({
        storeId,
        uid,
        sellerId,
        cashSessionId: caja.id,
        createdAt: acotarFecha(venta.capturadoEn, avisos),
        total,
        discountAmount: saleDiscount,
        paymentMethod: venta.paymentMethod,
        clientId: venta.paymentMethod === "cuenta" ? clientId : null,
      }).returning();

      if (venta.paymentMethod === "cuenta") {
        await tx.insert(clientAccountMovements).values({
          storeId,
          clientId: clientId as number,
          type: "cargo",
          amount: total,
          saleId: sale.id,
          createdBy: sellerId,
        });
      }

      for (const line of lines) {
        await tx.insert(saleItems).values({
          saleId: sale.id,
          variantId: line.variantId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountAmount: line.lineDiscount,
          // Metadato de la cola. Una venta guardada por un build anterior no
          // lo trae y entra como "venta", que es correcto: ese build no sabía
          // cobrar de otra forma.
          priceList: line.priceList ?? "venta",
          // A diferencia de createSale, acá el flag se lee al SINCRONIZAR y no
          // al vender. Es un desfase de horas o días en una feria; el catálogo
          // offline no guarda si estaba en promo, y agregarlo obligaría a otro
          // bump de DB_VERSION para un dato que casi nunca cambia en el medio.
          isPromo: Boolean((porId.get(line.variantId) as any)?.isPromo),
        });
        // Simétrico con createSale: lo que no lleva stock no lo mueve ni acá.
        // Sin esta guarda, cada plato vendido sin conexión dejaría el stock en
        // negativo y levantaría un aviso al sincronizar, por un número que a
        // nadie le importa.
        const v: any = porId.get(line.variantId);
        if (v.tracksStock === false) continue;

        const restante = await applyStockMovement(tx, {
          variantId: line.variantId,
          storeId,
          type: "venta",
          quantity: -line.quantity,
          userId: sellerId,
          saleId: sale.id,
          permitirNegativo: true,
          reason: "Venta sin conexión sincronizada",
        });

        if (restante < 0) {
          const etiqueta = v.name ? `${v.productName} — ${v.name}` : v.productName;
          avisos.push(`Stock negativo en ${etiqueta}: quedó en ${restante}.`);
          await createSyncNotification(tx, {
            storeId, userId: sellerId, type: "stock_negativo",
            label: v.productName, variantName: v.name || null,
            variantId: line.variantId, stockAtCreate: restante,
            message: `Stock negativo (${restante} u.) en ${etiqueta} tras sincronizar la venta #${sale.id} hecha sin conexión.`,
          });
        }
      }

      if (cajaCerrada) {
        avisos.push(`La caja #${caja.id} ya estaba cerrada: sus totales no incluyen esta venta.`);
        await createSyncNotification(tx, {
          storeId, userId: sellerId, type: "venta_post_cierre",
          label: `Caja #${caja.id}`,
          message: `La venta #${sale.id} (${total}) se sincronizó después de cerrar la caja #${caja.id}. Los totales del cierre no la incluyen.`,
        });
      }

      return { uid, estado: "aplicada" as const, saleId: sale.id, total: sale.total, avisos };
    });
  } catch (err) {
    // Carrera con otro envío del mismo lote.
    const code = (err as any)?.code ?? (err as any)?.cause?.code;
    if (code === PG_UNIQUE_VIOLATION) {
      const [ya] = await db.select().from(sales)
        .where(and(eq(sales.storeId, storeId), eq(sales.uid, uid))).limit(1);
      if (ya) return { uid, estado: "duplicada", saleId: ya.id, total: ya.total, avisos };
    }
    return {
      uid,
      estado: "error",
      error: err instanceof Error ? err.message : "ERROR_DESCONOCIDO",
      avisos,
    };
  }
}

/**
 * Lote completo. El orden es obligatorio, no una preferencia: las ventas
 * referencian productos y clientes creados sin conexión por uid, así que esos
 * tienen que existir antes de procesarlas.
 */
export async function replayLote(
  db: any,
  input: {
    storeId: number;
    sellerId: string;
    productos?: ProductoOffline[];
    clientes?: ClienteOffline[];
    ventas: VentaOffline[];
  }
) {
  const productos = await replayProductos(db, { storeId: input.storeId, productos: input.productos ?? [] });
  const variantePorUid = new Map(
    input.productos
      ?.map((p, i) => [p.variantUid, productos[i]?.variantId] as const)
      .filter((par): par is readonly [string, number] => par[1] != null) ?? [],
  );

  const clientes = await replayClientes(db, { storeId: input.storeId, clientes: input.clientes ?? [] });
  const clientePorUid = new Map(
    clientes.filter((c) => c.clientId != null).map((c) => [c.uid, c.clientId as number]),
  );

  const ventas: ResultadoVenta[] = [];
  for (const venta of input.ventas) {
    ventas.push(await replaySale(db, {
      storeId: input.storeId, sellerId: input.sellerId, venta, clientePorUid, variantePorUid,
    }));
  }

  return {
    productos,
    clientes,
    ventas,
    resumen: {
      aplicadas: ventas.filter((v) => v.estado === "aplicada").length,
      duplicadas: ventas.filter((v) => v.estado === "duplicada").length,
      errores: ventas.filter((v) => v.estado === "error").length,
      conAvisos: ventas.filter((v) => v.avisos.length > 0).length,
      productosCreados: productos.filter((p) => p.estado === "aplicado").length,
    },
  };
}

/** Ventas ya sincronizadas de esta tienda, para que el cliente limpie su cola. */
export async function uidsYaSincronizados(db: any, storeId: number, uids: string[]): Promise<string[]> {
  if (uids.length === 0) return [];
  const filas = await db.select({ uid: sales.uid }).from(sales)
    .where(and(eq(sales.storeId, storeId), inArray(sales.uid, uids)));
  return filas.map((f: { uid: string }) => f.uid);
}
