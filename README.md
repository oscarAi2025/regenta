# Regenta · by Farmagenéricos Colombia

POS en la nube para droguerías y distribuidores: caja con tiquete POS electrónico, facturación DIAN (vía MATIAS),
inventario por lote y vencimiento, varias empresas con aislamiento total.

Especificación del producto: Claude Doc «Regenta · Especificación del producto».

## Arquitectura
- **Next.js 15** (App Router) desplegado en Netlify. Toda la lógica de datos va en el servidor.
- **Postgres** (Supabase en producción). Seguridad por fila (RLS) por empresa y rol. Las ventas solo entran por
  `registrar_venta()`: la base de datos fija precios, lote (el que vence antes primero) y numeración.
- **Cola DIAN** (`src/lib/dian`): la venta nunca espera a la DIAN. Emisor simulado hoy; MATIAS al tener la cuenta.

## Local
```bash
npm install
# Postgres 16 local en el puerto 5433 (socket en /tmp)
node scripts/db-reset.mjs          # esquema, catálogo maestro (~10.000 productos) y droguería demo
npm run build && REGENTA_DEMO=1 npx next start -p 4500
node --test tests/db.test.mjs      # aislamiento, permisos, ventas, inmutabilidad
node tests/e2e/caja.mjs            # recorrido real en el navegador (escritorio y móvil)
```

## Variables de entorno (producción)
| Variable | Para qué |
| --- | --- |
| `DATABASE_URL` | Conexión Postgres de Supabase (pooler) |
| `REGENTA_SESSION_SECRET` | Firma de la sesión (≥ 32 caracteres) |
| `REGENTA_CRON_KEY` | Clave de la tarea programada que procesa la cola DIAN |
| `REGENTA_DIAN` | `simulado` (pruebas) o `matias` |
| `REGENTA_DEMO` | `1` solo en el entorno de demostración |

En Supabase se aplican `db/migrations/*.sql` (no `db/local/`, que imita a Supabase solo en local).

## Tareas programadas (producción)
- `POST /api/dian` con `Authorization: Bearer $REGENTA_CRON_KEY`: procesa la cola de documentos DIAN.
- `POST /api/invima` con el mismo encabezado, cada 6 horas: trae las alertas sanitarias nuevas de medicamentos de invima.gov.co.
- `REGENTA_URL`: dominio público (canonical, sitemap, Open Graph).
- `REGENTA_DEMO=1` habilita «Probar la demo» (/demo) sobre la droguería de ejemplo.

## Pruebas
`node scripts/db-reset.mjs && node --test tests/db.test.mjs && node --experimental-strip-types --test tests/invima.test.mjs`, y con el servidor en :4500: `node tests/e2e/caja.mjs && node tests/e2e/gestion.mjs`.

## Regenta IA
- `ANTHROPIC_API_KEY` (variable de entorno del servidor) activa el asistente; sin ella, el panel explica que no está activado.

## Pagos de planes (/contratar)
- Wompi (Colombia: tarjeta, PSE, Nequi, Daviplata, Botón y QR Bancolombia): `WOMPI_PUBLIC_KEY`, `WOMPI_INTEGRITY_SECRET`, `WOMPI_EVENTS_SECRET` (opcionales `WOMPI_CHECKOUT_URL`, `WOMPI_API_URL`). URL de eventos en el panel de Wompi: `/api/pagos/wompi`.
- Stripe (renovación automática con tarjeta; Stripe no abre cuentas en Colombia, va con la LLC): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; webhook `/api/pagos/stripe` con los eventos `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`.
- Sin llaves, /contratar ofrece contratar por WhatsApp. Pruebas: `node tests/e2e/pagos.mjs` con las llaves de prueba indicadas en el archivo.
- Imagen para compartir: `node scripts/og.mjs`.
- `REGENTA_IA_MODELO` (opcional, por defecto `claude-sonnet-5-5`). `REGENTA_IA_URL` solo para pruebas (servidor simulado en tests/e2e/ia.mjs).
- Las herramientas de la IA son de solo lectura y corren con los permisos del usuario (RLS): la cajera no recibe costos.

## Demo pública
- «Probar la demo» es un POST con verificación de origen (/demo). La empresa demo (`empresas.demo = true`) no deja cambiar usuarios ni datos de empresa. Conviene reiniciar sus datos cada noche.
