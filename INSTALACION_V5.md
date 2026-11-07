# ChubutxTRES V5 — DOS PRECIOS POR CATEGORÍA

## Cambios
- Cada categoría tiene **cuota recurrente** (`price_ars`) y **aporte único fijo** (`one_time_price_ars`), editables por el administrador.
- El importe libre que aparece inicialmente en el campo de aporte único es configurable desde **Administración → Categorías**.
- Sigue disponible el aporte libre por única vez.
- En el aporte único por categoría, el servidor consulta el precio en Supabase; no acepta un precio manipulado desde el navegador.
- No se modifican las cuotas contratadas anteriormente ni se generan cobros al editar precios.

## Instalación sobre V4 (por este orden)
1. **Supabase → SQL Editor**: ejecutá únicamente `supabase/migrations/20261107030000_category_one_time_prices.sql`. Deben existir las tablas de V4.
2. **Supabase → Edge Functions → create-one-time-payment → Code**: reemplazá `index.ts` con el del paquete V5 y hacé **Deploy updates**. Mantener JWT habilitado.
3. **Supabase → Edge Functions → create-subscription → Code**: opcionalmente reemplazá `index.ts` con el de V5 para mostrar un motivo de rechazo más claro. Mantener JWT habilitado.
4. **GitHub**: subí `assets/app.js` actualizado (o el repositorio completo). Conservá el `config.js` de tu instalación actual; el ZIP contiene una plantilla de ejemplo.
5. Abrí la web, entrá como administrador a **Administración → Categorías** y elegí **Editar importes** para cada categoría. El primer importe es la cuota recurrente y el segundo el aporte único fijo.
6. Ahí mismo podés modificar el importe inicial del campo **Otro aporte por única vez**. Se guarda en la tabla `site_settings`.
7. Probá los botones de aporte único por categoría y aporte libre con una cuenta compradora distinta de la vendedora; verificá la confirmación por webhook y panel administrativo.

## Importante sobre suscripciones
El mensaje `MP_PREAPPROVAL_REJECTED` proviene de Mercado Pago. El ZIP no puede solucionar un rechazo de la API sin conocer el mensaje completo de `create-subscription → Logs`. La V5 agrega `provider_message` a la respuesta, pero NO desactiva las validaciones de pagos. Un monto de $1 puede ser rechazado por reglas del proveedor; tampoco está garantizada la disponibilidad de todos los medios de pago para suscripciones recurrentes. No utilices una tarjeta real de la misma cuenta vendedora para hacer la prueba.

## Seguridad / cobros
El token `MP_ACCESS_TOKEN` permanece exclusivamente en los secrets de Supabase. Mantener JWT en `create-one-time-payment` y `create-subscription`. El webhook debe continuar verificando la firma. El regreso a GitHub Pages no confirma ningún pago. Las cuotas y aportes solo se acreditan con consulta del proveedor desde el backend.
