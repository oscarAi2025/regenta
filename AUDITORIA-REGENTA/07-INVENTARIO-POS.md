# 07 · Caja (POS), inventario, compras y lotes

Pruebas sobre la droguería demo y la droguería VECINA (datos sintéticos), servidor y Postgres locales. Resultados de la batería base del 17/11/2026 (código antes de las correcciones) y de la regresión final (ver 12).

## Lo que se comprobó y cómo

| Requisito del prompt | Cómo se prueba | Suite | Resultado |
|---|---|---|---|
| Venta registra y descuenta inventario **una sola vez** | Venta por API y por pantalla; existencias antes/después | `caja`, `mostrador`, `db.test` | Cumple |
| Reintento por red / doble clic **no duplica** la venta | Mismo `idem_key` enviado **3 veces en paralelo** en conexiones distintas: 1 venta, las otras responden `repetida: true` con el mismo número | `concurrencia-db.test` (nueva) | Cumple |
| Dos cajeros venden a la vez la **última existencia** | Dos transacciones confirmadas en paralelo piden todo el stock: una pasa, la otra recibe error; stock 0, ningún lote negativo | `concurrencia-db.test` (nueva) | Cumple |
| Recibir la misma mercancía dos veces **no duplica** | Misma entrada en paralelo con la misma `idem_key`: suma una vez | `concurrencia-db.test` (nueva), `compras` | Cumple |
| FEFO (sale primero lo que vence antes) | Producto con dos lotes; la venta toma el de vencimiento más cercano | `db.test`, `caja` | Cumple |
| Venta fraccionada (caja/unidad) | Presentación unidad y caja; equivalencias `unidades_por_caja` | `db.test`, `caja`, `descuentos` | Cumple |
| Total cobrado = impuestos + descuentos + medios | Descuento de línea + general; pago mixto con cambio solo sobre el efectivo | `descuentos`, `turnos` | Cumple |
| Dinero en tipo exacto | Columnas `numeric` en ventas, líneas, pagos y costos; ningún `float` en la base; redondeo a pesos en descuentos | Revisión de `db/migrations` | Cumple |
| Devoluciones y anulaciones con nota crédito | Devolución parcial y anulación; inventario vuelve; nota crédito pendiente de envío | `devoluciones`, `db.test`, `facturacion` | Cumple |
| Apertura, arqueo y cierre de caja con diferencia | Base, salidas, venta mixta, faltante de $1.000 en el cierre | `turnos`, `cajas` | Cumple |
| **Cierre ciego** real | La cajera no recibe cifras de las que se deduzca el esperado | `turnos` (nuevo) | **Fallaba → corregido (AUD-02)** |
| Lotes vencidos/bloqueados no se venden; cuarentena e INVIMA | Venta rechazada de lote bloqueado o vencido | `precios-lotes`, `cumplimiento`, `inventario-control` | Cumple |
| Ajustes, conteos y kardex con auditoría | Ajuste numerado con motivo; conteo a ciegas; kardex con antes/después | `inventario-control`, `lotes-corregir` | Cumple (ver pendiente del conteo a ciegas en 04) |
| Compras: recepción, costos sin IVA, cuentas por pagar | Factura de proveedor leída por IA y revisada; pagos parciales; egreso de caja | `compras`, `compras-factura` | Cumple |
| Control especial (Anexo 13) | Fórmula, libro de control, informe mensual calculado de los movimientos | `control-especial`, `anexo13` | Cumple |
| Droguería interna sin DIAN | Entregas con FEFO, anulación por gerencia, sin ventas | `modo-interno` | Cumple (ver pendiente de rutas abiertas en 04) |
| Producto inactivo | No aparece en la caja; la migración ya no activa inactivos con saldo | `gestion`, `migracion-inactivos` (nueva) | **Fallaba en la migración → corregido (AUD-06)** |
| Sin conexión | Venta guardada en el navegador y sincronizada al volver, sin duplicar | `sin-conexion` | Cumple (ver SEG-05 en 04) |

## Hallazgo con impacto real en un cliente

La migración desde Alegra del 09/11/2026 cargó a la bodega de Farmagenéricos 641 cajas de montelukast que no existen, más otros nueve productos con saldo de ítems inactivos en Alegra (detalle en 04, AUD-08). La causa ya está corregida para futuras migraciones. El inventario de producción **no se tocó**: hay que contar en físico y ajustar con autorización de Oscar.
