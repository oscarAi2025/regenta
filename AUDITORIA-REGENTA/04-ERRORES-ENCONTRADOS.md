# 04 · Errores encontrados

Auditoría integral de Regenta · 17/11/2026 · rama `audit/regenta-enterprise-quality`.
Todo se reprodujo en local (Postgres 16 con datos sintéticos de la demo y servidor `next start`), nunca en producción.

Severidad: **P0** bloqueante crítico · **P1** alta · **P2** media · **P3** mejora.
Estado: **Corregido** (con prueba que falla antes y pasa después) · **Pendiente** (documentado, no corregido) · **Decisión** (requiere a Oscar o a un contador).

## Resumen

| Sev. | Encontrados | Corregidos | Pendientes |
|---|---:|---:|---:|
| P0 | 0 | 0 | 0 |
| P1 | 12 | 7 | 5 |
| P2 | 21 | 4 | 17 |
| P3 | 30+ | 0 | 30+ (en 05, 06 y 08) |

## P1 corregidos

| ID | Área | Fallo | Causa raíz | Corrección | Prueba |
|---|---|---|---|---|---|
| AUD-01 | DIAN / caja | La caja ofrece «Consumidor final» para la factura electrónica y deja el botón **Cobrar** activo, pero el cobro falla con «necesita el correo del cliente». | `registrar_venta` exigía correo a toda factura, incluida la CC 222222222222 (MATIAS la acepta sin correo). La prueba e2e solo miraba que el botón estuviera activo. | Migración `051_auditoria_correcciones.sql`: se exceptúa solo el documento 222222222222. | `tests/auditoria-db.test.mjs` (falló antes, pasa después) y `tests/e2e/solo-factura.mjs` (ahora cobra de verdad). |
| AUD-02 | Caja / dinero | El **cierre ciego** no era ciego: la cajera recibía, en `GET /api/turnos` y en el corte parcial impreso, base, ventas en efectivo, abonos y salidas. El esperado salía sumando. | El ocultamiento era solo visual (`Turno.tsx`). | `src/lib/turnos.ts` (`cegar`): con el turno abierto la cajera solo recibe número de ventas, base, entradas y salidas. Corte parcial ciego en `tiquete/turno/[id]`. | `tests/e2e/turnos.mjs` (2 comprobaciones nuevas), `cuentas-clientes.mjs`. |
| AUD-03 | Suscripciones / dinero | El pago manual de la consola no era idempotente: dos envíos (doble clic, reintento, dos pestañas) sumaban **dos periodos pagados**. | Sin `idem_key` ni bloqueo. | `api/admin/clientes/[id]/pagos`: bloqueo por droguería, `idem_key` y detección del mismo pago en 2 minutos. `PagoManual.tsx` envía la clave. | `tests/e2e/correcciones-auditoria.mjs` (envío doble en paralelo → 1 pago). |
| AUD-06 | Inventario | La migración desde Alegra **activó y cargó con existencias artículos que estaban INACTIVOS** en Alegra. Caso real: 641 cajas de montelukast que no existen entraron a la bodega de Farmagenéricos el 09/11/2026 (el ítem estaba inactivo en Alegra desde el 27/08, sin un solo movimiento). | `activo = $7 or $8 > 0` en la migración. | Por defecto los inactivos con saldo **no se importan** (quedan inactivos y en cero); la simulación los lista; solo con «importar» explícito entran. | `tests/e2e/migracion-inactivos.mjs` (10 comprobaciones). `migracion.mjs` ajustada. |
| AUD-07 | IA | La IA no tenía forma fiable de responder márgenes: usaba el último costo del pedido sugerido o hacía la cuenta el propio modelo. | Faltaba herramienta. | Herramienta `rentabilidad_productos` (solo gerencia) con las mismas reglas que Reportes (sin IVA, neto de devoluciones, costo del lote vendido, excluye costos por revisar). | `tests/e2e/ia.mjs`: el producto más rentable y su margen coinciden con un cálculo independiente en SQL. |
| AUD-04 | Permisos | El vendedor entraba por URL a Inventario, Productos y Alertas y **descargaba el Excel del inventario completo**. | Solo se ocultaba en el menú. | `puede.verInventario` en las tres páginas y en `api/inventario/exportar` (403). | `tests/e2e/correcciones-auditoria.mjs`. |
| SEG-01 | Seguridad | La consola de superadministración entra solo con contraseña (dos pasos apagados por variable). | Configuración (`REGENTA_ADMIN_DOS_PASOS` sin poner en Netlify). | **Decisión de Oscar**: poner `REGENTA_ADMIN_DOS_PASOS=1` en Netlify. No requiere código. | Suite `admin.mjs` ya prueba el segundo paso (134/134). |

## P2 corregidos

| ID | Fallo | Corrección | Prueba |
|---|---|---|---|
| AUD-05 (SEG-04) | La cajera podía **reemplazar el correo y el teléfono** de un cliente existente «creándolo» otra vez: las facturas electrónicas se desviaban sin auditoría. | La cajera solo completa lo que falta; reemplazar es de la gerencia. | `correcciones-auditoria.mjs`. |
| IA-P2-1 | Los datos de las herramientas (nombres, alertas INVIMA) entraban al modelo sin marcarlos como no confiables. | Regla explícita en el prompt de sistema. | `ia.mjs` comprueba que la regla llega al modelo. |
| IA-P2-3 | El vendedor recibía de la IA existencias, lotes, predicción y alertas que no ve en su menú. | `herramientasPara` y `ejecutar` excluyen esas herramientas para el vendedor. | `ia.mjs`: no se le ofrecen y si el modelo las pide, se niegan. |
| IA-guía | El prompt mandaba el margen a `pedido_sugerido`. | Guía a `rentabilidad_productos` y a decir «no hay registro» si falta el dato. | `ia.mjs`. |

## P1 pendientes (requieren decisión o desarrollo mayor)

| ID | Fallo | Por qué no se corrigió ahora | Propuesta |
|---|---|---|---|
| DIAN-P1-1 | No se aplica el **tope de 5 UVT** del tiquete POS. | La norma (E.T. art. 616-1 par. 2, sin impuestos; UVT 2026 = $52.374 → $261.870) aplica al tiquete POS; hay fuentes que dicen que la Res. 165/2023 lo levantó para el POS **electrónico** y la DIAN (Oficio 20900/2024) no lo aclara. Bloquear ventas sin certeza rompe la caja. | Que el contador confirme. Si aplica: aviso en caja y, luego, bloqueo con paso automático a factura. |
| DIAN-P1-2 | No hay **contingencia** según la norma (art. 1.5.1.5.7.1 Res. 227/2025, antes art. 37 Res. 165/2023): sin internet sale un comprobante provisional sin número; si falla el proveedor (no la DIAN) el tiquete dice «Pendiente de validación DIAN». | Desarrollo de un flujo nuevo con numeración de contingencia. | Diseñar el modo contingencia con el proveedor tecnológico. |
| DIAN-P1-3 | A las **48 h sin respuesta** un documento pasa a «rechazado»; anular una venta rechazada no genera nota crédito. Si la DIAN sí lo validó, queda un ingreso sin anular. | Cambia la máquina de estados de documentos ya emitidos; necesita prueba contra el sandbox. | Estado «sin respuesta» + consulta por CUFE antes de dar por rechazado. |
| DIAN-P1-5 | **Documento soporte** sin control de plazos y con la fecha de generación en lugar de la de la compra; apagado por defecto en producción. | Requiere validar en sandbox (el propio código lo marca «sin validar»). | Activar por droguería tras pruebas; alerta de compras sin soporte. |
| AUD-08 | Inventario real de Farmagenéricos con **saldos fantasma** heredados de Alegra (montelukast 641; Repelente Out 139, Bactroderm 98, Gorro 17, Clopisev, Salbutamol jarabe, Jabón Divina, Domperidona, Levotiroxina 100, Amlodipino x300). | Es un cambio de inventario real en producción: prohibido sin autorización. | Conteo físico y ajuste en Regenta (Inventario → Ajustes) con motivo «saldo heredado de Alegra»; o autorizar que se haga desde la consola. |

## P2 pendientes (resumen; detalle en 02, 05, 06 y 08)

- **SEG-05**: venta marcada «sin conexión» desde el navegador salta «exigir turno» y se puede fechar hasta 72 h atrás (puede caer en un turno ya cerrado).
- **SEG-02 / SEG-03**: fuerza bruta repartida contra un correo; límites por IP que serían globales si faltan las variables de la plataforma (`REGENTA_CABECERA_IP=x-nf-client-connection-ip` lo resuelve).
- **SEG-06**: zod 3.25.76 con aviso GHSA-mrhx-c7xc-m3w5 (memoria con colecciones grandes); los esquemas ya limitan `.max()` en casi todas las listas. Actualizar a zod 4 es un cambio amplio.
- **Inventario**: `POST /api/inventario` acepta `tipo: "compra"` desde la bodega (entra mercancía sin pasar por Compras ni cuentas por pagar); el conteo a ciegas se puede eludir mirando `GET /api/inventario/lotes`.
- **Modo droguería interna**: solo la caja y la venta están bloqueadas; Pedidos, Turnos y Precios siguen abiertos por URL.
- **Consola**: puede desactivar al único dueño; `PATCH /api/admin/pagos` desliga un pago sin validar su estado.
- **DIAN-P2**: número rechazado no se reenvía ni se inhabilita; `documentos_dian` sin trigger de inmutabilidad; XML guardado solo si el proveedor lo devuelve; nota débito sin envío al adquirente; DV del NIT del cliente no se envía; numeración tecleada a mano sin contrastar con la DIAN; ventas sin conexión numeradas fuera de orden cronológico.
- **IA-P1-2 / P2-4 / P2-5**: sin registro de tokens por droguería; sin reintentos ante 429/529 ni `maxDuration`; la política de privacidad no nombra a Anthropic como encargado.
- **Otras escrituras sin idempotencia**: `POST /api/pedidos`, `POST /api/productos` sin código de barras, `POST /api/control-especial/anexo13`, `POST /api/alertas`, conteos en modo «sumar».
