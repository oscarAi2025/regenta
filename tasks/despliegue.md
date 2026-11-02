# Puesta en producción de Regenta (Netlify + Supabase + Resend + Stripe + QR Bancolombia)

Orden recomendado. Cada paso dice qué hace Oscar y cómo se comprueba. Las claves nunca se pegan en el chat ni en el
repositorio: van solo en el panel de cada servicio.

## 1. Supabase (base de datos)
**Hecho el 02/11/2026.** Proyecto `regenta` (ref `dwjvwskgykcfxcbakiri`, São Paulo, Postgres 17, API de datos de
Supabase desactivada). Se instaló desde el editor SQL, sin terminal: `node scripts/sql-supabase.mjs` genera
`db/supabase/1_migraciones.sql` y `2_datos_NN.sql` a partir de una base preparada con db-reset contra la copia local de
Supabase. Comprobado en el Supabase real: las 16 migraciones, 25.474 filas idénticas a la copia local (huella md5 por
tabla), triggers activos, `anon` sin permisos en tablas ni funciones, todas las tablas con RLS, el cambio de rol
`authenticated` funciona (el dueño demo ve sus 1.288 ventas y un usuario ajeno ve 0). Superadministrador creado el mismo día
(gerencia@farmagenericoscolombia.com, invitación + inserción en `superadmins` tras activar). Los pasos de abajo quedan para una instalación nueva desde terminal.

1. Crear el proyecto en la región más cercana (São Paulo, `sa-east-1`).
2. Panel → Project Settings → Database:
   - Descargar el certificado SSL (`prod-ca-2021.crt`). Es la CA con la que se verifica la conexión.
   - Copiar la cadena del **pooler en modo transacción** (puerto 6543). Esta es la `DATABASE_URL` de Netlify.
   - Copiar la del **pooler en modo sesión** (puerto 5432). Esta se usa solo desde el computador para migrar.
3. Desde el computador, en la carpeta del proyecto:
   ```bash
   DATABASE_URL='<pooler modo sesión>' DATABASE_CA=./prod-ca-2021.crt node scripts/db-reset.mjs --produccion --demo
   ```
   - Aplica las migraciones 001–016 y las registra en `regenta_migraciones`. Nunca borra nada.
   - La 016 quita los permisos que Supabase da por defecto a `anon` y `authenticated` (para su API de datos, que Regenta
     no usa): quedan solo los que Regenta necesita. Regenta no usa la API de datos ni Supabase Auth: si quieres, puedes
     desactivarlos en el panel; no hace falta.
   - Carga el catálogo maestro (~10.000 productos) y las alertas INVIMA si la base está vacía.
   - `--demo` crea la droguería de demostración. Quítalo si no habrá demo pública.
   - Para actualizaciones futuras se corre el mismo comando sin `--demo`: solo aplica lo pendiente.
4. Crear el superadministrador. La contraseña se escribe en la terminal y no se muestra:
   ```bash
   DATABASE_URL='<pooler modo sesión>' DATABASE_CA=./prod-ca-2021.crt node scripts/crear-superadmin.mjs tu@correo.com "Oscar"
   ```
5. Comprobar que el pooler permite el cambio de rol que usa la seguridad por fila. Es el único punto que la
   documentación de Supabase no confirma. En el editor SQL de Supabase:
   ```sql
   begin; select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
   set local role authenticated; select auth.uid(), current_user; rollback;
   ```
   Debe devolver el uuid y `authenticated`.

## 2. Resend (correos)
1. Crear la cuenta y agregar el dominio. Resend recomienda un subdominio, por ejemplo `correo.tudominio.co`.
2. Copiar en el DNS del dominio los registros SPF y DKIM que muestra Resend y esperar a que diga «Verified»
   (normalmente unos 15 minutos, hasta 72 horas).
3. Crear una API key con permiso «Sending access».
4. Sin `RESEND_API_KEY` y `CORREO_REMITENTE`, los correos quedan como «simulados» en /admin/correos y no llegan a nadie.

## 3. Netlify (sitio)
**Hecho el 02/11/2026.** Proyecto `regenta-droguerias` (equipo FARMAGENERICOS COLOMBIA), https://regenta-droguerias.netlify.app.
`DATABASE_URL` sin contraseña (pooler transacción 6543) + `DATABASE_PASSWORD` aparte (secreta). La CA de Supabase va también
en el código (`src/lib/supabase-ca.ts`). Cada build gasta créditos del equipo: un solo despliegue por cambio y `[skip netlify]`
en commits sin efecto. Pendiente: dominio propio, Resend, Stripe, Anthropic.
1. Importar el repositorio de GitHub. Netlify detecta Next.js 15 solo; no hay que instalar plugins.
2. Site configuration → Environment variables, con alcance **Builds y Functions**:

| Variable | Valor |
| --- | --- |
| `REGENTA_URL` | `https://tudominio.co`, sin barra al final. Sin ella el build se detiene a propósito. |
| `REGENTA_SESSION_SECRET` | 48 o más caracteres aleatorios (`openssl rand -base64 48`) |
| `REGENTA_CRON_KEY` | 32 o más caracteres aleatorios, distinta de la anterior |
| `DATABASE_URL` | Pooler de Supabase en modo transacción (puerto 6543) |
| `DATABASE_CA` | Contenido del `prod-ca-2021.crt`, pegado completo. Si el panel no acepta varias líneas, cambia cada salto de línea por `\n`. |
| `RESEND_API_KEY` | La llave de Resend |
| `CORREO_REMITENTE` | `Regenta <hola@correo.tudominio.co>` (dominio verificado) |
| `CORREO_RESPUESTA` | `gerencia@farmagenericoscolombia.com` (opcional; es el valor por defecto) |
| `REGENTA_QR_LLAVE` | No hace falta: ya trae la llave `@iadevinvestiment` y el QR (`public/qr-pago.png`) de la cuenta empresarial, los mismos de Justicia Activa. `off` apaga el QR. |
| `REGENTA_QR_TITULAR` | Opcional. Titular que ve el cliente (por defecto IA DEV INVESTIMENTS COLOMBIA S.A.S.) |
| `WOMPI_PUBLIC_KEY`, `WOMPI_INTEGRITY_SECRET`, `WOMPI_EVENTS_SECRET` | No se usan por ahora (sin Wompi). Si algún día se activa, salen del panel de Wompi. |
| `ANTHROPIC_API_KEY` | Activa Regenta IA |
| `REGENTA_DEMO` | `1` si habrá demo pública |
| `REGENTA_DIAN` | `simulado` hasta tener MATIAS configurado |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Cuenta Stripe de la LLC: pago con tarjeta y renovación automática. |

3. Desplegar y conectar el dominio. Netlify da el HTTPS.
4. Tarea programada: `netlify/functions/tareas.mjs` corre cada hora, en hora UTC, solo en el sitio publicado. En
   Netlify → Functions → `tareas` → «Run now», el registro debe mostrar `tareas 200` con el resumen.

## 3b. MATIAS (factura electrónica real)
**Integrado y probado en el sandbox el 02/11/2026** (`src/lib/dian/matias.ts`, pruebas en `tests/matias.test.mjs`).
El sandbox de MATIAS aceptó: POS (tipo 20) con producto excluido y gravado, factura a crédito a un NIT (tipo 7), nota
crédito de POS (tipo 94, operación 11), redondeo 3 × 3.333,33, documento sin IVA; el reintento del mismo número
responde 400 «ya validado» y Regenta lo toma como aceptado. Migración 017 (`empresas.matias_cliente`) ya aplicada en Supabase.
Para activarlo (cuando haya cuenta de producción):
1. Netlify: `REGENTA_DIAN=matias`, `MATIAS_URL` (la de producción que entrega MATIAS) y `MATIAS_TOKEN` (token personal
   de la cuenta de casa de software; secreto, lo pega Oscar).
2. Cada resolución de Regenta debe tener `numero_resolucion` y el mismo prefijo que en MATIAS. Las notas crédito de
   POS (tipo 94) y de factura (tipo 5) usan la resolución `nota_credito` de Regenta: registrar ese prefijo en MATIAS para ambos tipos.
3. Cada droguería cliente: `empresas.matias_cliente` = su client_uuid en la cuenta de casa de software.
Pendiente de confirmar en habilitación real: redondeo del precio unitario (2 decimales) ante la DIAN, medios de pago
(tarjeta = 48 crédito) y que excluidos sin tributo pasen las reglas de la DIAN.

## 4. Cobros: QR Bancolombia y Stripe
**QR de la cuenta empresarial Bancolombia (llave Bre-B), sin pasarela**
1. Ya configurado: llave `@iadevinvestiment` y QR de la cuenta empresarial Bancolombia (`public/qr-pago.png`, el mismo de
   Justicia Activa; sin monto fijo, el cliente escribe el valor que ve en pantalla).
2. Flujo:
   - El cliente elige «QR Bancolombia» en /contratar y ve el monto exacto, el QR y la llave. También le llegan por correo.
   - Paga desde cualquier banco, Nequi o Daviplata y manda el comprobante por WhatsApp con su referencia.
   - Al ver el dinero en la cuenta, en /admin/pagos → «QR por confirmar» → «Confirmar: el dinero llegó». El cliente
     recibe «Pago aprobado» y su página cambia sola.
3. No hay aviso automático del banco: la confirmación es manual. Un pago sin confirmar queda pendiente, nunca se aprueba solo.
4. El QR no cobra solo cada mes: Regenta envía recordatorios 5 días antes, 1 día antes y 1 día después del vencimiento.

**Stripe (tarjeta, renovación automática), cuenta de la LLC**
1. Webhook en Stripe: `https://tudominio.co/api/pagos/stripe` con los eventos `checkout.session.completed`,
   `invoice.paid`, `invoice.payment_failed` y `customer.subscription.deleted`.
2. Pago de prueba con la tarjeta de pruebas de Stripe (modo test): /contratar/resultado debe decir «Pago aprobado».

## 5. Primer cliente (el mismo día)
1. /admin/clientes/nuevo:
   - Datos de la droguería, plan y dueño.
   - Numeración POS. Si todavía no hay resolución DIAN, usar la de pruebas.
2. El dueño recibe el correo «Activa tu cuenta». El mismo enlace también se puede mandar por WhatsApp desde la ficha.
3. El dueño crea su contraseña, recibe la bienvenida y entra a /entrar.
4. La factura electrónica real exige MATIAS (Casa de Software) y el certificado digital del NIT. Mientras tanto, el POS
   funciona y los documentos quedan en la cola DIAN como «simulado».

## Comprobado en local antes de publicar
`npm test` · `node --test tests/correos.test.mjs` · `npm run e2e` · `npm run pagos` · `npm run admin` · `npm run auditoria`

## Comprobado contra una copia de Supabase en local
Base creada como en Supabase: dueño sin superusuario, esquema `auth` ajeno con su `auth.uid()`, `pgcrypto` en el
esquema `extensions` y los permisos por defecto que Supabase da a `anon`/`authenticated`. Ahí: las 16 migraciones y la
demo se aplican sin errores, `anon` no puede leer ni ejecutar nada y un usuario ajeno no ve datos de ninguna droguería;
todas las pruebas (base, correos, caja, gestión, IA, facturación, pagos, consola y auditoría de 145 pantallas) pasan.
Netlify: `netlify build` real (adaptador de Next v5) compila, empaqueta la función del sitio y la tarea `tareas` cada hora.

## No verificado (comprobarlo en el primer despliegue)
- Que el usuario del pooler de Supabase pueda hacer `set local role authenticated` (prueba del paso 1.5, 10 segundos).
- MATIAS (factura electrónica real ante la DIAN): la URL de producción se recibe al contratar. Falta confirmar en su
  sandbox el `type_document_id` de la factura de venta (la documentación dice 1 en un lugar y 7 en otro).
