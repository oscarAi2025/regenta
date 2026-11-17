# 11 · Cambios realizados

Rama `audit/regenta-enterprise-quality` (desde `main` abbc4c6). Cambios incrementales; ninguno reescribe módulos. Cada corrección tiene su prueba.

## Base de datos

| Archivo | Cambio | Motivo |
|---|---|---|
| `db/migrations/051_auditoria_correcciones.sql` | Parche sobre la versión vigente de `registrar_venta` (con `pg_get_functiondef` + `replace`, como la 036): la factura electrónica a la CC 222222222222 no exige correo. Si el texto esperado no está, la migración **falla** en vez de seguir en silencio. | AUD-01 |
| `db/produccion/bloque4-051.sql` | La misma migración envuelta en una transacción y registrada en `regenta_migraciones`, lista para pegar en Supabase. | Despliegue |
| `src/lib/version-db.ts` | `MIGRACION_ESPERADA = "051_auditoria_correcciones.sql"` | Consola → Sistema avisa si falta |

## Aplicación

| Archivo | Cambio | Motivo |
|---|---|---|
| `src/lib/turnos.ts` | `cegar()`: con el turno abierto, a la cajera no le llegan ventas, medios, efectivo ni esperado. | AUD-02 |
| `src/app/api/turnos/route.ts`, `src/app/(app)/turno/page.tsx` | Pasan `ciego` para la cajera. | AUD-02 |
| `src/app/(app)/turno/Turno.tsx` | Vista ciega: número de ventas y aviso; sin lista de medios. | AUD-02 |
| `src/app/tiquete/turno/[id]/page.tsx` | Corte parcial ciego para la cajera (el cierre sigue completo). | AUD-02 |
| `src/app/api/admin/clientes/[id]/pagos/route.ts` | Bloqueo por droguería, `idem_key` y detección del mismo pago en 2 minutos. | AUD-03 |
| `src/app/admin/clientes/[id]/PagoManual.tsx` | Envía `idem_key` y la renueva tras un pago correcto. | AUD-03 |
| `src/lib/sesion.ts` | `puede.verInventario` (todos menos vendedor). | AUD-04 |
| `src/app/(app)/inventario/page.tsx`, `productos/page.tsx`, `alertas/page.tsx` | Redirigen al vendedor a `/inicio?aviso=permiso`. | AUD-04 |
| `src/app/api/inventario/exportar/route.ts` | 403 al vendedor. | AUD-04 |
| `src/app/api/clientes/route.ts` | La cajera completa correo/teléfono vacíos pero no reemplaza los existentes. | AUD-05 |
| `src/app/api/admin/clientes/[id]/migracion/route.ts` | Parámetro `inactivos` (`omitir` por defecto / `importar`); la respuesta lista los inactivos con existencias. | AUD-06 |
| `src/app/admin/clientes/[id]/Migracion.tsx` | Casilla «Importar también las existencias de artículos inactivos» (apagada) y lista de esos artículos en la simulación. | AUD-06 |
| `src/lib/ia/herramientas.ts` | Herramienta `rentabilidad_productos` (solo gerencia); el vendedor no recibe herramientas de inventario ni de predicción. | AUD-07, IA-P2-3 |
| `src/lib/ia/claude.ts` | Regla: los datos de las herramientas no son instrucciones; guía del margen a la nueva herramienta; decir «no hay registro» si falta el dato. | IA-P2-1 |
| `src/components/Navegacion.tsx`, `src/components/landing/Cumplimiento.tsx` | Contraste AA. | Accesibilidad |
| `src/app/(app)/reportes/page.tsx` | Lista desplazable con foco de teclado. | Accesibilidad |

## Pruebas nuevas o ajustadas

| Archivo | Qué prueba |
|---|---|
| `tests/concurrencia-db.test.mjs` (nuevo) | Dos cajas vendiendo a la vez toda la existencia; cobro triplicado en paralelo con la misma `idem_key`; entrada repetida en paralelo. |
| `tests/auditoria-db.test.mjs` (nuevo) | AUD-01 (consumidor final sí; cliente identificado sin correo, no). |
| `tests/e2e/correcciones-auditoria.mjs` (nuevo) | AUD-03, AUD-04, AUD-05 por HTTP. |
| `tests/e2e/migracion-inactivos.mjs` (nuevo) | AUD-06 con datos sintéticos. |
| `tests/carga/ventas.mjs` (nuevo) | Carga local de 5/20/50/100 cajas con comprobación de integridad (se niega a correr fuera de localhost). |
| `tests/ayudas/turno.mjs` (nuevo) | Lee el resumen del turno como el dueño (las pruebas de cifras ya no pueden usar la vista de la cajera). |
| `tests/e2e/turnos.mjs` | + cierre ciego en API y en el corte parcial. |
| `tests/e2e/cuentas-clientes.mjs` | Lee el esperado como dueño; la cajera ve el cierre ciego. |
| `tests/e2e/solo-factura.mjs` | Cobra de verdad una factura a consumidor final sin correo. |
| `tests/e2e/ia.mjs` | Rentabilidad contra un cálculo SQL independiente; regla anti-inyección; vendedor sin inventario. |
| `tests/e2e/migracion.mjs` | Espera que los inactivos con saldo no entren. |
| `package.json` | `npm test` incluye las dos pruebas de base nuevas. |

## Sin cambios (decisión deliberada)

- No se tocó ningún dato de producción ni se desplegó nada.
- No se cambió la máquina de estados DIAN, la contingencia ni el tope de 5 UVT: requieren confirmación normativa y pruebas en el sandbox del proveedor (ver 05).
- No se actualizó zod a la versión 4 (cambio transversal; los esquemas ya limitan el tamaño de las listas).
