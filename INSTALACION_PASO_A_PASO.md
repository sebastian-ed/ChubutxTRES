# ChubutxTRES — Instalación de cobros reales

Este paquete mantiene la web HTML/CSS/JS/Bootstrap, el proyecto Supabase existente y la integración de Suscripciones (sin plan) de Mercado Pago. **No hay tokens ni contraseñas reales dentro del ZIP.**

## 0. Antes de tocar nada

- Exportá una copia de la base Supabase y descargá tu GitHub actual (por seguridad).
- Usá la aplicación REAL de Mercado Pago para recibir cobros reales. No uses el token de la aplicación creada desde el vendedor ficticio.
- Los valores de las categorías que existen actualmente en tu base pueden ser importantes (por ejemplo, sponsor $1.000.000/mes). Revisalos antes de activar cobros.
- La web depende del archivo público `config.js`: este ZIP trae los campos **vacíos como plantilla**. **Conservá de tu GitHub actual el `config.js` que ya funciona**, o completá la URL de Supabase y la clave **pública**. Nunca coloques un `service_role` o un token de Mercado Pago allí.

## 1. Actualizá la base (obligatorio y sin borrar datos)

En Supabase → SQL Editor → New query, abrí y copiá **sólo** el archivo:

`supabase/migrations/20261107010000_payments_production.sql`

Ejecutá con **Run**. No vuelvas a ejecutar la migración `20261107000000_initial.sql` si ya tenés cuentas y tablas creadas. La nueva migración añade `subscription_invoices`, `provider_events` y el RPC `admin_invoices`; preserva las tablas anteriores.

## 2. Publicá las tres funciones

En Supabase → Edge Functions → Functions. Para las funciones existentes, abrí Code → index.ts, reemplazá por el archivo correspondiente de este ZIP y tocá **Deploy updates**.

- `supabase/functions/create-subscription/index.ts` → `create-subscription` (Verify JWT **ON**)
- `supabase/functions/mercadopago-webhook/index.ts` → `mercadopago-webhook` (Verify JWT **OFF**)
- `supabase/functions/manage-subscription/index.ts` → **nueva** función `manage-subscription` (Verify JWT **ON**)

Al crear `manage-subscription`, elegí Deploy new function → Via Editor; reemplazá el código de ejemplo por `index.ts` y publicá.

**Muy importante:** Verify JWT debe estar apagado SÓLO para el webhook. La función verifica la firma HMAC con `MP_WEBHOOK_SECRET`.

## 3. Cargá los secrets correctos

Supabase → Edge Functions → Secrets, configurá o actualizá:

| Key | Value |
|---|---|
| `MP_ACCESS_TOKEN` | Token **de producción** de tu aplicación real ChubutxTRES (privado) |
| `MP_WEBHOOK_SECRET` | Firma secreta **de producción** de la misma aplicación, en Webhooks |
| `SITE_URL` | `https://sebastian-ed.github.io/ChubutxTRES` |
| `SITE_ORIGIN` | `https://sebastian-ed.github.io` |
| `MP_TEST_MODE` | `false` |

Podés eliminar `MP_TEST_PAYER_EMAIL`; el modo real utiliza el email del usuario autenticado. No compartas ninguno de los secrets.

## 4. Mercado Pago Webhooks

En tu aplicación **real** (no la TestApp del vendedor ficticio), abrí Webhooks en modo **producción**.

URL: `https://zhbftkasuixhdkhbovqc.supabase.co/functions/v1/mercadopago-webhook`

Activá los eventos de **Planes y suscripciones** y los eventos de **Pagos** que ofrece el panel para suscripciones. Esta versión admite `subscription_preapproval`, `subscription_authorized_payment` y `payment`. Guardá, copiá la nueva clave secreta de producción y comprobá que coincida con `MP_WEBHOOK_SECRET`.

La notificación necesita firma real y `x-request-id`; abrir la URL en Chrome no sirve para probarla.

## 5. Actualizá los archivos públicos en GitHub

Repositorio GitHub → ChubutxTRES → reemplazá:

- `index.html`
- `assets/app.js`
- `assets/style.css` (sin cambios visuales respecto de V2)

Si reemplazás el repositorio completo, restaurá también tu `config.js` **público** que ya utilizás. Podés conservar las migraciones y las funciones en GitHub; no incluyen secretos.

Esperá a que GitHub Pages actualice la página, recargá con Ctrl+F5 y probá con un usuario autenticado.

## 6. Prueba controlada en producción

Una prueba con credenciales reales puede generar cargos y renovaciones reales. **No uses tu propio usuario vendedor como comprador.** Usá otra cuenta real que autorice el pago, una categoría de importe reducido *aprobada* y una tarjeta habilitada. Luego cancelá desde Mi cuenta y verificá también en Mercado Pago. Nunca hagas pruebas con la categoría de $1.000.000.

Comprobá estos hitos:

1. Se abre checkout seguro de Mercado Pago (`init_point`).
2. La tabla `memberships` almacena `mp_preapproval_id` y `status=pending`.
3. Al autorizar en Mercado Pago, llega el webhook firmado a Supabase y la membresía cambia a `authorized`.
4. Los cobros recurrentes se muestran en `subscription_invoices` y el panel **Administración → Cobros de membresías**, con `payment_status=approved` sólo si el proveedor lo confirma.
5. **Cancelar suscripción** desde Mi cuenta provoca la baja en Mercado Pago y actualiza la membresía.
6. Repetir la notificación webhook no crea dos facturas (índice único por ID de factura).

**No confundas `authorized` con `approved`:** authorized = contrato de suscripción autorizado; approved = cuota abonada. Las liquidaciones bancarias se verifican aparte en Mercado Pago.

## 7. Si falla algún paso

- `400` en create-subscription: leé el mensaje de respuesta de DevTools → Network → Response (por ejemplo, falta razón social).
- `409`: ya existe membresía abierta; no vuelvas a crear otra. Si quedó `creating` tras un timeout, la operación es ambigua: revisá Mercado Pago y Supabase antes de cambiar su estado.
- `502`: Mercado Pago rechazó la creación; leé los Logs de `create-subscription` (`MP_PREAPPROVAL_REJECTED`).
- `401` al abrir create-subscription directamente en Chrome es esperado (requiere JWT del usuario).
- Webhook 401: el evento no pasó la verificación HMAC; revisá la **firma secreta de producción** y el entorno configurado.
- Cobro no enlazado: revisar `provider_events` (payload `linked:false`), luego consultar la operación real en Mercado Pago.

## Limitaciones deliberadas

- No se incluyen credenciales reales; sin ellas no se puede ejecutar un pago real automáticamente.
- No se hicieron cobros ni llamadas con credenciales reales desde este entorno.
- La conciliación registra la relación factura/cobro que devuelve Mercado Pago, **no** reemplaza el extracto/liquidación bancaria ni un sistema contable.
- El esquema ya existente de fallos anteriores permanece por trazabilidad. No elimina registros previos.
- Los eventos de factura y pago pueden llegar en distinto orden. El sistema intenta vincular por ID de factura o búsqueda de pago autorizado; si Mercado Pago no devuelve esa relación, queda el evento sin adjudicar, visible para revisión manual.
