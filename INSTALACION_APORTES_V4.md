# ChubutxTRES V4 — Membresía recurrente + aporte único

## Qué cambia
- **Suscribirme**: API de Suscripciones Mercado Pago (`/preapproval`), mantiene cobro periódico.
- **Aportar una sola vez**: Checkout Pro (`/checkout/preferences`), no genera renovación.
- Los dos pagos se concilian por caminos diferentes. El retorno del navegador **no acredita** ningún cobro.
- Importes iniciales de **$1 ARS** en el formulario de aporte único y en las categorías que ya configuraste en Supabase; no se modifican los precios existentes.

## Instalación sin React
1. Guardá respaldo del repositorio y de `config.js` antes de reemplazar archivos.
2. En Supabase > SQL Editor ejecutá **sólo** `supabase/migrations/20261107020000_one_time_contributions.sql` si la V3 ya estaba instalada. Si no lo estaba, instalá antes la migración V3 `20261107010000_payments_production.sql`.
3. Supabase > Edge Functions: actualizá **`mercadopago-webhook`** con su nuevo `index.ts`; creá **`create-one-time-payment`** copiando el `index.ts` incluido. Conservá `create-subscription` y `manage-subscription` de V3.
4. En `create-one-time-payment`, habilitá la verificación JWT. En `mercadopago-webhook`, **desactivá Verify JWT**, porque Mercado Pago no envía token Supabase y el servidor valida la firma `x-signature`.
5. En Mercado Pago Developers > Webhooks > **Modo productivo**, URL = `https://zhbftkasuixhdkhbovqc.supabase.co/functions/v1/mercadopago-webhook`. Eventos = **Planes y suscripciones** y **Pagos**. Guardá y verificá que `MP_WEBHOOK_SECRET` coincida con la clave **productiva** de esa aplicación.
6. Supabase > Edge Functions > Secrets: `MP_ACCESS_TOKEN` = Access Token productivo **de la misma aplicación**; `MP_TEST_MODE=false`; `SITE_URL=https://sebastian-ed.github.io/ChubutxTRES`; `SITE_ORIGIN=https://sebastian-ed.github.io`.
7. Publicá los archivos HTML/JS/CSS a GitHub Pages **conservando el `config.js` que ya está conectado a tu Supabase**. El `config.js` del ZIP contiene valores de ejemplo.
8. Comprobá la membresía recurrente y el aporte único por separado, con comprador real diferente del vendedor. Revisá Supabase Logs y `one_time_contributions`. El panel admin tiene pestaña **Aportes únicos**.

## Cómo validar un aporte de $1
1. Iniciá sesión en ChubutxTRES con tu cuenta y completá organización/razón social.
2. En Membresías o Mi cuenta, elegí **Aportar una sola vez**, importe `1`.
3. La web pedirá al servidor crear una preferencia Checkout Pro y te llevará a Mercado Pago para seleccionar el medio de pago disponible.
4. Si Mercado Pago rechaza $1, revisá Logs `MP_ONE_TIME_PREFERENCE_REJECTED`. No hay garantía de aceptación del importe mínimo por todos los medios.
5. **No consideres pagado** hasta que en la base de datos aparezca `approved` a través del webhook con el identificador real del pago.
6. Verificá el movimiento efectivamente acreditado en la cuenta vendedora y conciliá los cargos/comisiones antes de cerrar la prueba.

## Notas de seguridad
- **Nunca** subas `MP_ACCESS_TOKEN` o `MP_WEBHOOK_SECRET` a GitHub.
- No cambies el `SITE_URL` por la URL del webhook; son direcciones distintas.
- El enlace del checkout se valida antes de la redirección.
- Los pagos únicos se asocian por `external_reference` (UUID) y se contrastan con **monto, moneda e ID de preferencia** consultados al proveedor. La URL de retorno no cambia estados.
- Los registros de prueba anteriores se conservan.
- Debe probarse un webhook real firmado, notificaciones duplicadas, errores de pago y reembolsos antes de operar públicamente.
- Si Supabase devuelve 401 en `create-one-time-payment`, revisá JWT y la sesión. Si devuelve 502, buscá el log de rechazo del proveedor.
