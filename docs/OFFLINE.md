# Vender sin conexión

Cómo operar cuando no hay internet: un corte del ISP en el local o una feria
donde directamente no hay señal.

## Qué funciona y qué no

| | Sin conexión |
|-|-|
| Buscar productos y armar el carrito | Sí, contra el catálogo guardado en el dispositivo |
| Cobrar (efectivo, transferencia, tarjeta, cuenta) | Sí, la venta queda en cola |
| Imprimir un comprobante para el cliente | Sí, ticket **no fiscal** |
| Dar de alta un cliente | Sí, se crea al sincronizar |
| Abrir o cerrar la caja | **No.** Se abre antes de salir y se cierra al volver |
| Facturar en ARCA | **No.** Se emite al volver la conexión, desde `/ventas` |
| Productos, Ventas, Clientes, Reportes, Importar | **No.** Necesitan servidor |

El stock que se ve sin conexión es del último momento con internet. Es una
referencia, no una garantía: dos dispositivos o una venta online pueden haber
movido esa variante mientras tanto.

## Preparar un dispositivo

Con internet, y una sola vez por dispositivo:

1. Entrar a la app e **instalarla** (en Chrome, el ícono de instalar en la barra
   de direcciones). Instalada abre en ventana propia — no se cierra por
   accidente como una pestaña, y ahí adentro está la cola de ventas.
2. Abrir **Vender** al menos una vez. Eso guarda la pantalla en el dispositivo;
   sin ese paso, sin conexión no hay nada que abrir.
3. Tocar **«Preparar para vender sin conexión»**. Baja el catálogo, los clientes
   y la caja abierta. La fecha del último guardado queda a la vista.
4. **Abrir la caja** antes de perder la conexión. Sin caja abierta la pantalla
   de venta no se monta, ni con catálogo guardado.

Antes de salir a una feria, repetir el paso 3 para llevar el catálogo del día.

## Durante el corte

- La barra superior avisa «Sin conexión» y cuántas ventas hay pendientes.
- Cada venta cobrada se guarda en el dispositivo y muestra un ticket no fiscal
  para imprimir.
- El carrito a medio armar sobrevive a un F5 o a un cierre accidental.

## Al volver la conexión

La cola se sincroniza sola. También hay botón **«Sincronizar ahora»**.

Después de sincronizar puede aparecer un resumen con:

- **Stock negativo.** La venta entró igual. La mercadería ya salió y ya se
  cobró: rechazarla no devuelve las unidades, solo borra el registro. Se corrige
  con un ajuste desde Productos.
- **Precio distinto.** Se cobró el precio que estaba en el dispositivo. Si el
  catálogo cambió mientras tanto, se avisa pero no se corrige: el cliente pagó
  ese importe.
- **Venta rechazada.** No entró y no va a entrar reintentando (por ejemplo, el
  producto se borró del catálogo). Hay que cargarla a mano. Es plata cobrada
  que no está registrada — mirarlo el mismo día.

Lo mismo queda en **Avisos**, así que no se pierde si nadie leyó el resumen.

**Cerrar la caja recién después de sincronizar.** El arqueo se calcula sobre lo
que hay en el servidor; con ventas en cola, el número no cuadra. La app lo
impide mientras queden pendientes.

## Facturar lo vendido sin conexión

ARCA necesita internet, así que no hay CAE en el momento. Al volver, las ventas
aparecen en `/ventas` como «Sin facturar» y se emiten desde ahí.

**La factura sale con la fecha de emisión, no con la del evento.** ARCA rechaza
un comprobante con fecha anterior a la del último autorizado del punto de venta,
así que retro-fechar trabaría la numeración. Conviene confirmarlo con el
contador antes de una feria de varios días.

## Límites conocidos

- **Un solo dispositivo por tienda vendiendo sin conexión.** Dos dispositivos
  offline a la vez pueden vender la misma unidad; al sincronizar, la segunda
  venta entra igual y deja el stock negativo.
- **Borrar los datos de navegación borra la cola.** Si el navegador limpia el
  almacenamiento del sitio, las ventas pendientes se pierden. Sincronizar
  seguido es la mitigación; no vaciar el historial con cola pendiente, la otra.
- **Hasta 20.000 variantes** por dispositivo. Si el catálogo es más grande, el
  guardado avisa que quedó incompleto.
- **La app se actualiza al cerrarla y volver a abrirla.** Es a propósito:
  cambiar de versión en medio de una venta puede dejar la pantalla hablando con
  código de otra build.

## Para desarrollo

- Service worker: `public/sw.js`, escrito a mano. Serwist exige configuración de
  webpack y el proyecto compila con Turbopack.
- Almacenamiento local: `src/lib/offline/db.ts` (IndexedDB). La lógica
  testeable vive aparte, en `busqueda.ts` y `sincronizacion.ts`.
- Sincronización: `POST /ventas/replay` → `src/domain/sales-replay.ts`.
  Idempotente por `sales.uid` y `clients.uid`.
- Detección de conexión: `hayConexion()` sondea `/api/health`. Nunca
  `navigator.onLine` — informa si hay interfaz de red, no si hay internet.
