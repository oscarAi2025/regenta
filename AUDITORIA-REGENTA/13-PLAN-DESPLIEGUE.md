# 13 · Plan de despliegue

Nada de esta rama está en producción. Orden propuesto, cada paso con su verificación y su vuelta atrás.

## 0. Antes de empezar

- Copia de seguridad de Supabase (Database → Backups → copia manual, o `pg_dump` del esquema `public`).
- Revisar la regresión final (12) en verde.
- El modo consulta (commit 314cc6b) no requiere migración.

## 1. Base de datos (Oscar, en el SQL Editor de Supabase)

1. Pegar `db/produccion/bloque4-051.sql` y ejecutarlo. Es una sola transacción: si el texto de `registrar_venta` no es el esperado, **falla entera y no cambia nada**.
2. Verificar: `select nombre from regenta_migraciones order by nombre desc limit 1;` → `051_auditoria_correcciones.sql`.
3. **Rollback**: la 051 solo amplía una condición. Para revertir, ejecutar el mismo bloque con los textos `viejo` y `nuevo` intercambiados y borrar la fila `051_auditoria_correcciones.sql` de `regenta_migraciones`.

## 2. Código

1. Revisar y fusionar `audit/regenta-enterprise-quality` en `main` (Netlify despliega solo al hacer push a `main`).
2. Verificar en producción: Consola → Sistema dice «Base de datos al día: 051_auditoria_correcciones.sql».
3. Prueba de humo (sin emitir documentos reales):
   - Entrar como cajera en la **demo**: la pantalla Turno muestra «Cierre ciego» y no el esperado.
   - Consola → un cliente → Migración: aparece la casilla de artículos inactivos (apagada).
4. **Rollback**: «Rollback» al despliegue anterior en Netlify (Deploys → Publish deploy). El código anterior funciona con la 051 aplicada (la migración solo amplía lo permitido).

## 3. Configuración (Oscar, en Netlify → variables, alcance Functions)

| Variable | Valor | Por qué |
|---|---|---|
| `REGENTA_ADMIN_DOS_PASOS` | `1` | SEG-01: la consola entra hoy solo con contraseña. Antes, configurar el código de la app autenticadora en la consola. |
| `REGENTA_CABECERA_IP` | `x-nf-client-connection-ip` | SEG-03: que los límites de intentos sean por IP real y no globales. |

Rollback: borrar la variable y volver a desplegar.

## 4. Datos de Farmagenéricos (requiere autorización expresa)

Saldo fantasma heredado de Alegra (AUD-08): contar en físico montelukast 10 mg x30 (Regenta: 689; real comprado: 48), Repelente Out 60 ml (139), Bactroderm (98), Gorro desechable (17), Clopisev 75 mg (13), Salbutamol jarabe Laproff (11), Jabón facial Divina (6), Domperidona Genfar (3), Levotiroxina 100 mcg (2), Amlodipino x300 (2). Ajustar en Regenta → Inventario → Ajustes con motivo «Saldo heredado de Alegra (ítem inactivo)». El ajuste queda numerado y en el kardex.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Una cajera echa de menos ver las ventas del turno | Es el comportamiento de un cierre ciego; la gerencia lo ve todo y la cajera lo ve al cerrar. |
| Un vendedor usaba Inventario por URL | El vendedor busca productos en Pedidos; si se necesita, se le da rol de cajera o bodega. |
| La 051 no encuentra el texto en producción (función modificada a mano) | Falla sin cambiar nada; revisar `pg_get_functiondef('registrar_venta(jsonb)')`. |
