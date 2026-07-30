# Facturación electrónica ARCA (ex-AFIP)

Emisión de **Facturas A y B** y **Notas de Crédito** contra el web service
WSFEv1 de ARCA, con CAE real, código QR (RG 4892) y comprobante imprimible.

---

## Cómo funciona, en una pasada

1. La venta se registra como siempre. **Nunca depende de ARCA.**
2. En `/ventas`, el dueño (o un empleado habilitado) toca **Emitir factura**.
3. El sistema reserva el próximo número, le pide el CAE a ARCA y asienta el
   resultado.
4. Si ARCA rechaza, se muestra el motivo textual de ARCA y se puede reintentar
   con el **mismo número** (ARCA no lo consumió).
5. Si se anula una venta ya facturada, se emite la **nota de crédito**
   automáticamente. Si eso falla, la anulación igual se completa y la venta queda
   marcada como **NC pendiente**.

### A o B

Lo decide la **condición frente al IVA del cliente**, nunca el hecho de tener
CUIT:

| Cliente | Comprobante |
|---|---|
| Responsable Inscripto con CUIT válido | **Factura A** |
| Monotributista (tiene CUIT) | Factura B |
| Sujeto exento | Factura B |
| Consumidor final, con o sin DNI | Factura B |
| Venta sin cliente (efectivo) | Factura B a Consumidor Final, `99/0` |

> Emitirle una Factura A a un monotributista es un error fiscal real. El sistema
> lo previene, pero conviene saberlo al cargar los datos de un cliente.

---

## Puesta en marcha

### 1. Clave de cifrado del servidor

El certificado y la clave privada de cada tienda se guardan **cifrados** en la
base (AES-256-GCM). La clave maestra va en env:

```bash
openssl rand -base64 32   # 32 bytes en base64
```

```
ARCA_MASTER_KEY=<lo que salió del comando>
ARCA_MASTER_KEY_ID=k1
```

> **Si se pierde esta clave, no hay recuperación**: cada tienda tiene que volver
> a subir su certificado. Guardala también fuera de Vercel, en un gestor de
> contraseñas. Es el punto del cifrado en reposo, no un defecto.

### 2. Certificado de ARCA

En tu computadora:

```bash
openssl genrsa -out arca.key 2048
openssl req -new -key arca.key \
  -subj "/C=AR/O=TU RAZON SOCIAL/CN=stock-tienda/serialNumber=CUIT 30707429530" \
  -out arca.csr
```

**Guardá `arca.key` en un lugar seguro.** No se puede volver a descargar.

En el portal de ARCA:

1. *Administración de Certificados Digitales* → subí `arca.csr` → descargá el `.crt`.
2. **El paso que todos se saltean:** *Administrador de Relaciones* → delegá el
   servicio **Facturación Electrónica (wsfe)** al alias del certificado. Sin
   esto, ARCA responde "computador no autorizado".
3. Homologación y producción son **dos certificados distintos**, cada uno con su
   propia delegación. Hacé los tres pasos dos veces.

### 3. En la app

`/facturacion` (solo el dueño):

1. **Datos del emisor** — CUIT, razón social, domicilio, punto de venta,
   alícuota de IVA. Activá *Facturación activada*.
2. **Certificado** — subí el `.crt` y el `.key`. Se valida que el par coincida,
   que no esté vencido y que el CUIT sea el mismo antes de guardar nada.
3. **Probar conexión** — tiene que dar 3 de 3 en verde.

---

## Entregarle el comprobante al cliente

Cada comprobante autorizado tiene un **link público** propio: `/c/<token>`. Lo
abre cualquiera que lo tenga, sin usuario — el comprador no tiene cuenta en el
sistema. El token son 32 bytes al azar y lo único que abre es ese comprobante:
no da acceso a la tienda, ni a otras ventas, ni a la ficha del cliente.

Desde el comprobante, el botón **Enviar al cliente** ofrece:

- **WhatsApp** — abre la app con el mensaje ya escrito. Va por `wa.me`, o sea
  desde el teléfono del vendedor, **no** por la API de WhatsApp Business. La API
  manda sola desde el server pero exige verificación de Meta Business, número
  registrado y plantillas aprobadas de a una: semanas de trámite para lo que acá
  se resuelve con una URL.
- **Copiar link** — para pegarlo donde sea.

El link no vence. Un comprobante fiscal el cliente lo puede necesitar meses
después para su contador, y el QR de ARCA tampoco vence. Si un link se filtrara,
el token se puede regenerar y el viejo deja de servir.

### Envío por correo — pendiente

No está implementado. La columna `clients.email` ya existe y se carga desde la
ficha del cliente, pero falta el proveedor de envío.

Para completarlo hace falta, en este orden:

1. **Un dominio propio** con acceso a su DNS. Es el bloqueante real: sin
   verificar el dominio, los mails caen en spam o no salen.
2. `vercel integration add resend/resend-email --no-claim -m domain=<tu-dominio> -m region=sa-east-1`
   (Resend es el único proveedor de `messaging` del marketplace; `sa-east-1` es
   São Paulo, la región más cercana).
3. `vercel env pull` y armar el envío contra las variables reales.

El grueso del trabajo ya está hecho: el mail solo tiene que llevar el link que
ya existe.

---

## Homologación → producción

La app arranca en **homologación**. Todo comprobante de prueba sale marcado:
badge `PRUEBA ·` en `/ventas` y marca de agua *COMPROBANTE DE PRUEBA — SIN
VALIDEZ FISCAL* en la impresión.

Para pasar a producción hacen falta **las tres cosas**:

1. `ARCA_ALLOW_PRODUCCION=true` en el environment **Production** de Vercel.
   Es un kill switch a nivel servidor: sin él, la app *físicamente no puede*
   llegar a los endpoints de producción de ARCA aunque la tienda esté configurada
   así. Existe porque los previews comparten la base de datos de producción (ver
   `DEPLOY.md`), y sin esta guarda un preview podría emitir comprobantes reales.
2. El certificado de **producción** cargado, con su propia delegación de wsfe.
3. Escribir el CUIT del comercio para confirmar, en `/facturacion`.

La numeración de cada ambiente va por separado: pasar a producción arranca de
cero (o desde donde ARCA tenga registrado, que el sistema consulta solo).

---

## Verificación end-to-end

Antes de facturar de verdad:

1. `npm test` en verde y `npx tsc --noEmit` limpio.
2. Certificado de **homologación** para el CUIT real, con wsfe delegado en el
   Administrador de Relaciones **de homologación**.
3. *Probar conexión* → 3/3.
4. Emitir una **Factura B a Consumidor Final**, una **Factura A a un CUIT
   conocido**, una **NC B** y una **NC A**.
5. Abrir el comprobante impreso y **escanear el QR** con el teléfono. En
   homologación ARCA va a decir "no encontrado": es lo esperado, lo que se está
   verificando es que la URL esté bien formada.
6. Forzar los caminos de falla: certificado equivocado (esperar el mensaje de
   delegación) y `ARCA_WSFE_URL` apuntando a un agujero negro.
   **La fila de la venta tiene que quedar intacta en los dos casos** y el botón
   volver a *Reintentar*.
7. Emitir 3 seguidas → `0001-00000001..3`, sin saltos. **Doble clic** en el botón
   → un solo CAE.
8. Pasar a producción y emitir **una** Factura B real por una venta chica.
   Verificar que aparezca en *Mis Comprobantes* del portal de ARCA. Después
   emitir su nota de crédito. Ese ida y vuelta es la puerta de salida a producción.

---

## Cuando algo falla

| Lo que ves | Qué pasa |
|---|---|
| "ARCA no reconoce el certificado…" | Falta delegar **wsfe** en Administrador de Relaciones, para *ese* ambiente. |
| "Verificá que subiste el .crt…" | Subiste el CSR en vez del certificado, o el `.key` es de otro certificado. |
| "Estamos renovando la sesión…" | Otra operación está renovando el ticket de ARCA. Esperá unos segundos. |
| "ARCA rechazó el comprobante: …" | Es el mensaje textual de ARCA. Corregí lo que dice y reintentá; el número se reusa. |
| Badge **Sin verificar** | Se perdió la respuesta de ARCA. Tocá **Consultar en ARCA**: el sistema pregunta qué pasó con ese número y lo resuelve. |
| Badge **NC pendiente** | Venta anulada cuya factura sigue con CAE. Es IVA declarado que no cobraste: emití la nota de crédito desde el detalle. |
| "El número N ya fue usado por otro comprobante" | Ese número lo ocupa un comprobante ajeno en ARCA. **Requiere un humano**: contactá a tu contador. |

---

## Notas de operación

- **Migraciones.** `0014_facturacion_arca` y `0015_comprobantes_indices`. Se
  aplican con `npx drizzle-kit migrate`, igual que el resto.
- **Fecha del comprobante.** Siempre "hoy" en hora de Argentina, nunca la fecha
  de la venta: con Concepto = 1 ARCA solo acepta ±5 días y exige que no sea
  anterior al último comprobante autorizado.
- **El umbral que exige identificar al comprador** queda vacío por defecto
  (nunca exige). El monto lo fija ARCA y cambia: **consultalo con tu contador** y
  cargalo en `/facturacion`.
- **Empleados.** No pueden emitir por defecto. Un comprobante autorizado no se
  borra, solo se anula con nota de crédito. Se habilita en `/facturacion`, y
  cada emisión queda registrada con quién la hizo.
- **Rotación de la clave maestra.** Poné la nueva en `ARCA_MASTER_KEY` /
  `ARCA_MASTER_KEY_ID` y la vieja en `ARCA_MASTER_KEY_PREVIOUS` /
  `ARCA_MASTER_KEY_PREVIOUS_ID`. Cada dato cifrado lleva embebido con qué clave
  se cifró, así que una base a medio rotar sigue funcionando.
- **Multi-alícuota.** Hoy todos los productos usan la alícuota de la tienda. La
  matemática ya soporta varias; agregarlo es sumar una columna a `products` y
  cambiar una función (`ivaIdParaLinea` en `src/domain/fiscal-comprobante.ts`).
- **`drizzle-orm/neon-serverless` no es intercambiable por `neon-http`.** La
  numeración depende de `pg_advisory_xact_lock`, que bajo `neon-http` se vuelve
  un no-op silencioso. Ver el comentario en `src/db/index.ts`.
