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
