# ChubutxTRES — Web institucional + membresías recurrentes

**Stack:** HTML, CSS, JavaScript nativo, Bootstrap 5.3.3, Supabase Auth/Postgres/Edge Functions y Mercado Pago Suscripciones. **Sin React / sin Vite / sin npm** para la web pública.

## Instalación

Abrí **INSTALACION_PASO_A_PASO.md**. Empezá con la migración SQL y las tres funciones de Supabase; después actualizá GitHub Pages. Conservá las credenciales públicas existentes de `config.js`, que vienen como placeholder en este paquete por seguridad.

## Estructura

- `index.html` — página de entrada.
- `assets/style.css` — estilos V2 conservados.
- `assets/app.js` — interfaz V2 con mensajes de error legibles, historial de cuotas, baja de membresías y pestaña de cobros para administración.
- `config.js` — plantilla pública; **hay que completar/restaurar** antes del despliegue.
- `supabase/migrations/20261107000000_initial.sql` — inicial (NO repetir si ya está instalada).
- `supabase/migrations/20261107010000_payments_production.sql` — actualización no destructiva.
- `supabase/functions/create-subscription/index.ts` — crear suscripción.
- `supabase/functions/mercadopago-webhook/index.ts` — verificar firma, reconciliar factura y pago.
- `supabase/functions/manage-subscription/index.ts` — cancelar la renovación.
- `supabase/config.toml` — verificaciones JWT específicas.

## Advertencia de producción

No se puede garantizar un cobro real ni certificar el circuito completo sin ejecutar una prueba controlada contra tu cuenta. La aplicación no guarda números de tarjeta, CVV ni Access Tokens en el navegador. El checkout se realiza en Mercado Pago.

Documentación: [Suscripciones sin plan](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/integration-configuration/subscription-no-associated-plan/pending-payments), [Webhooks](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/additional-content/your-integrations/notifications/introduction), [Funciones Supabase](https://supabase.com/docs/guides/functions/auth).


## V4: aportes únicos y suscripciones

La actualización V4 agrega aportes únicos con Checkout Pro, sin modificar el CSS ni las categorías de membresías. Seguí `INSTALACION_APORTES_V4.md`.


## V5
Ver `INSTALACION_V5.md` para cuotas y aportes únicos por categoría administrables.
