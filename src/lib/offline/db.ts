import type { VarianteCatalogo } from "./busqueda";

/**
 * Almacén local del punto de venta (IndexedDB).
 *
 * IndexedDB y no localStorage porque acá entran hasta 20k variantes:
 * localStorage tiene ~5 MB, es síncrono (congelaría la pantalla al leerlo) y
 * guarda solo strings. El carrito en curso sí vive en localStorage — es chico
 * y se necesita de forma síncrona al montar (ver vender/sale-form.tsx).
 *
 * Esta capa es deliberadamente tonta: primitivas de lectura y escritura, sin
 * lógica. Todo lo que se pueda decidir sin tocar el navegador vive en
 * busqueda.ts y sincronizacion.ts, que sí se pueden testear en Node.
 */

const DB_NOMBRE = "stock-tienda-offline";
const DB_VERSION = 1;

export const TIENDA_META = "meta";
export const TIENDA_CATALOGO = "catalogo";
export const TIENDA_CLIENTES = "clientes";
export const TIENDA_COLA = "cola";
export const TIENDA_CLIENTES_NUEVOS = "clientesNuevos";

export type MetaSnapshot = {
  storeId: number;
  generadoEn: string;
  cashSessionId: number | null;
  truncado: boolean;
};

export type ClienteLocal = { id: number; name: string };

export type ClienteNuevoLocal = {
  uid: string;
  name: string;
  phone?: string | null;
  docTipo?: number | null;
  docNro?: string | null;
};

export type VentaEnCola = {
  uid: string;
  capturadoEn: string;
  cashSessionId: number;
  paymentMethod: "efectivo" | "transferencia" | "tarjeta" | "cuenta";
  items: {
    variantId: number;
    quantity: number;
    unitPrice: number;
    discount?: { kind: "amount" | "percent"; value: number };
    // Solo para mostrar la cola y el ticket sin volver a mirar el catálogo.
    productName: string;
    variantName: string | null;
  }[];
  saleDiscount?: { kind: "amount" | "percent"; value: number };
  clientId?: number | null;
  clientUid?: string | null;
  total: number;
  intentos: number;
  ultimoError?: string | null;
};

export const hayIndexedDB = () => typeof indexedDB !== "undefined";

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOMBRE, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TIENDA_META)) db.createObjectStore(TIENDA_META);
      if (!db.objectStoreNames.contains(TIENDA_CATALOGO)) db.createObjectStore(TIENDA_CATALOGO, { keyPath: "variantId" });
      if (!db.objectStoreNames.contains(TIENDA_CLIENTES)) db.createObjectStore(TIENDA_CLIENTES, { keyPath: "id" });
      if (!db.objectStoreNames.contains(TIENDA_COLA)) db.createObjectStore(TIENDA_COLA, { keyPath: "uid" });
      if (!db.objectStoreNames.contains(TIENDA_CLIENTES_NUEVOS)) db.createObjectStore(TIENDA_CLIENTES_NUEVOS, { keyPath: "uid" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function esperar<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function cerrarAlTerminar(db: IDBDatabase, tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}

async function leerTodo<T>(tienda: string): Promise<T[]> {
  const db = await abrir();
  try {
    return await esperar(db.transaction(tienda, "readonly").objectStore(tienda).getAll());
  } finally {
    db.close();
  }
}

export async function leerMeta(): Promise<MetaSnapshot | null> {
  const db = await abrir();
  try {
    const v = await esperar(db.transaction(TIENDA_META, "readonly").objectStore(TIENDA_META).get("snapshot"));
    return (v as MetaSnapshot) ?? null;
  } finally {
    db.close();
  }
}

/**
 * Reemplaza catálogo y clientes de una. Se borra primero: si un producto se
 * dio de baja en el servidor, tiene que desaparecer del dispositivo, y un
 * `put` fila por fila lo dejaría vivo para siempre.
 *
 * Todo en UNA transacción, así que un corte a mitad no deja medio catálogo.
 */
export async function guardarSnapshot(input: {
  meta: MetaSnapshot;
  variantes: VarianteCatalogo[];
  clientes: ClienteLocal[];
}): Promise<void> {
  const db = await abrir();
  const tx = db.transaction([TIENDA_META, TIENDA_CATALOGO, TIENDA_CLIENTES], "readwrite");
  tx.objectStore(TIENDA_CATALOGO).clear();
  tx.objectStore(TIENDA_CLIENTES).clear();
  for (const v of input.variantes) tx.objectStore(TIENDA_CATALOGO).put(v);
  for (const c of input.clientes) tx.objectStore(TIENDA_CLIENTES).put(c);
  tx.objectStore(TIENDA_META).put(input.meta, "snapshot");
  await cerrarAlTerminar(db, tx);
}

export const leerCatalogo = () => leerTodo<VarianteCatalogo>(TIENDA_CATALOGO);
export const leerClientes = () => leerTodo<ClienteLocal>(TIENDA_CLIENTES);
export const leerCola = () => leerTodo<VentaEnCola>(TIENDA_COLA);
export const leerClientesNuevos = () => leerTodo<ClienteNuevoLocal>(TIENDA_CLIENTES_NUEVOS);

export async function encolarVenta(venta: VentaEnCola, clienteNuevo?: ClienteNuevoLocal): Promise<void> {
  const db = await abrir();
  const tx = db.transaction([TIENDA_COLA, TIENDA_CLIENTES_NUEVOS], "readwrite");
  tx.objectStore(TIENDA_COLA).put(venta);
  if (clienteNuevo) tx.objectStore(TIENDA_CLIENTES_NUEVOS).put(clienteNuevo);
  await cerrarAlTerminar(db, tx);
}

/** Alta de cliente sin conexión: queda pendiente y disponible para elegir ya. */
export async function guardarClienteNuevo(cliente: ClienteNuevoLocal): Promise<void> {
  const db = await abrir();
  const tx = db.transaction(TIENDA_CLIENTES_NUEVOS, "readwrite");
  tx.objectStore(TIENDA_CLIENTES_NUEVOS).put(cliente);
  await cerrarAlTerminar(db, tx);
}

/** Saca de la cola lo que el servidor ya confirmó. */
export async function quitarDeLaCola(uids: string[], clienteUids: string[] = []): Promise<void> {
  if (uids.length === 0 && clienteUids.length === 0) return;
  const db = await abrir();
  const tx = db.transaction([TIENDA_COLA, TIENDA_CLIENTES_NUEVOS], "readwrite");
  for (const uid of uids) tx.objectStore(TIENDA_COLA).delete(uid);
  for (const uid of clienteUids) tx.objectStore(TIENDA_CLIENTES_NUEVOS).delete(uid);
  await cerrarAlTerminar(db, tx);
}

/** Marca el intento fallido sin sacar la venta de la cola. */
export async function marcarIntento(uid: string, error: string | null): Promise<void> {
  const db = await abrir();
  const tx = db.transaction(TIENDA_COLA, "readwrite");
  const store = tx.objectStore(TIENDA_COLA);
  const actual = (await esperar(store.get(uid))) as VentaEnCola | undefined;
  if (actual) store.put({ ...actual, intentos: (actual.intentos ?? 0) + 1, ultimoError: error });
  await cerrarAlTerminar(db, tx);
}

/**
 * Borra todo lo local. Se usa cuando el dispositivo pasa a otra tienda: dejar
 * el catálogo anterior mostraría productos que no existen en la tienda nueva.
 * NO se llama si hay cola pendiente — eso lo decide quien llama.
 */
export async function borrarTodo(): Promise<void> {
  const db = await abrir();
  const tiendas = [TIENDA_META, TIENDA_CATALOGO, TIENDA_CLIENTES, TIENDA_COLA, TIENDA_CLIENTES_NUEVOS];
  const tx = db.transaction(tiendas, "readwrite");
  for (const t of tiendas) tx.objectStore(t).clear();
  await cerrarAlTerminar(db, tx);
}
