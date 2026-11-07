# CHUBUTxTRES — versión HTML/CSS/JavaScript/Bootstrap

Versión equivalente del proyecto ChubutxTRES. **No utiliza React, React Router, Vite ni JSX.** La interfaz utiliza HTML5, CSS3 (se conserva íntegro el archivo de estilos de la versión anterior), JavaScript nativo (script clásico) y Bootstrap 5.3.3. La lógica de usuarios y las funciones de pagos siguen ejecutándose en Supabase; el checkout lo proporciona Mercado Pago.

## Contenido

- Home institucional, Plan, Proyectos, Actualidad, Contacto y Membresías.
- Registro, inicio de sesión, recuperación de contraseña, cuenta y perfil de empresa.
- Categorías configurables: hotelero, prestador turístico, sponsor corporativo y aliado/inversor.
- Admin: KPIs de membresías, buscador, listado de adherentes, exportación CSV, aranceles, eventos de pago y formularios de contacto.
- Mercado Pago: Edge Function para crear preapproval recurrente y webhook firmado para consultar estados verificados.
- Los aranceles iniciales son cero; **no se puede cobrar hasta configurar valores reales aprobados**.
- Identidad visual: se conservó el CSS original con fuentes DM Sans / Instrument Serif, negro, blanco cálido y los mismos recursos fotográficos de la primera versión.

## Despliegue directo en GitHub Pages

1. Subir la carpeta completa al repositorio de GitHub (su contenido en la raíz).
2. En `config.js`, reemplazar `SUPABASE_URL` y `SUPABASE_ANON_KEY` por los valores **públicos** del proyecto Supabase. No agregar claves de servicio ni secretos de Mercado Pago.
3. En GitHub > Settings > Pages, elegir `Deploy from a branch`, rama `main` y carpeta `/(root)`.
4. La página se publica sin build ni `npm install`: `index.html` carga Bootstrap mediante CDN, el CSS local y el JavaScript nativo en `assets/app.js`.
5. Las rutas usan `#/plan`, `#/miembros`, `#/cuenta`, `#/admin` para funcionar dentro de GitHub Pages sin reescritura del servidor.
6. Si la web se sirve desde una subcarpeta, los enlaces a CSS/JS ya son relativos y siguen funcionando.

Para visualizar la web pública, se puede abrir `index.html` directamente (doble clic). Para probar autenticación, redirecciones y pagos se recomienda utilizar un servidor HTTP:

```bash
python -m http.server 8080
```

Luego abrir `http://localhost:8080/`.

## Activar Supabase

1. Crear un proyecto Supabase.
2. En SQL Editor ejecutar `supabase/migrations/20261107000000_initial.sql`.
3. Configurar Site URL en Auth, y en Redirect URLs agregar el dominio público y los destinos de recuperación (por ejemplo `https://TU_USUARIO.github.io/TU_REPO/#/acceso`).
4. Crear el primer usuario mediante Registro y después promoverlo **sólo desde SQL Editor**:

```sql
UPDATE public.profiles
SET role = 'admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'ADMIN@DOMINIO.COM');
```

5. Ingresar a `#/admin`, pestaña Categorías, y asignar las cuotas autorizadas. Categorías con monto 0 no admiten checkout.

## Activar Mercado Pago

Las funciones de servidor se conservan de la versión anterior para mantener el mismo flujo de pagos. **No alojar el token privado en GitHub Pages ni en config.js.**

```bash
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase functions deploy create-subscription
supabase functions deploy mercadopago-webhook --no-verify-jwt
supabase secrets set MP_ACCESS_TOKEN=APP_USR_... MP_WEBHOOK_SECRET=... SITE_URL=https://TU_USUARIO.github.io/TU_REPO SITE_ORIGIN=https://TU_USUARIO.github.io
```

En Mercado Pago Developers configurar el webhook:

`https://TU_PROJECT_REF.supabase.co/functions/v1/mercadopago-webhook`

La función crea la suscripción vía `POST /preapproval`; Mercado Pago recibe el número de tarjeta. La pantalla de retorno no confirma pagos. Los estados sólo se actualizan mediante consultas del servidor, invocadas desde notificaciones verificadas. La cuenta del vendedor y sus credenciales son indispensables para utilizarlo en producción.

**Advertencia de producción:** antes de aceptar cobros reales hay que probar alta con tarjeta, aprobación, rechazo, renovación, pausas, cancelación y llegada del webhook con firma correcta. Esta versión hereda las limitaciones de la primera: no ofrece cancelación self-service ni conciliación financiera completa; `authorized` significa suscripción autorizada, no necesariamente cuota cobrada. Los importes y beneficios requieren aprobación de la organización.

## Estructura

```text
index.html                   HTML principal
config.js                    Configuración pública Supabase
assets/style.css             CSS original (sin cambios)
assets/app.js                Interfaz y lógica en JavaScript nativo
supabase/migrations/         Tablas, políticas RLS y función admin
supabase/functions/          Integración segura con Mercado Pago
README.md                    Esta guía
```

## Pruebas y controles

- `node --check assets/app.js` valida sintaxis JavaScript.
- `python -m http.server 8080` permite verificar rutas, scroll y visualización.
- No hay dependencias React, ReactDOM, Vite ni proceso de compilación.
- Las pruebas end-to-end con Supabase/MP reales requieren credenciales y entorno de despliegue, por lo que **no se consideran superadas sólo por la conversión técnica**.

### Diferencias frente a la versión React

Únicamente se reemplazó la capa de interfaz por DOM/template strings, delegación de eventos y hash routing. Se mantuvieron contenido, textos, diseño visual, estructura de pantalla, formularios, modelo de datos y funciones de Mercado Pago. Bootstrap se sigue cargando con versión 5.3.3; su uso es complementario al CSS propio.
