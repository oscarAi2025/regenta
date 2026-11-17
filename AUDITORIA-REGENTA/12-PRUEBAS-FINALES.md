# 12 · Pruebas finales

Regresión completa del 17/11/2026 sobre la rama `audit/regenta-enterprise-quality`, con todas las correcciones aplicadas. Se usó una compilación de producción y una base recién sembrada (migraciones 001 → 051).

## Resultado: 0 fallos

| Bloque | Resultado |
|---|---|
| Unitarias (`node --test`) | 116 pasan, 0 fallan |
| Base de datos | 68 pasan, 0 fallan |
| 45 suites e2e | **1.772 comprobaciones, 0 fallos** |
| Contrato de la API (`endpoints`) | 2.699 comprobaciones, 0 fallos (2.711 con las rutas de consulta) |
| Pantallas por rol (`auditoria`) | 358 pantallas, 0 fallos |
| Dispositivos (`dispositivos`) | 748 pantallas en 10 equipos, 0 avisos, 0 fallos |
| Habilitación DIAN (MATIAS simulado) | 35 pasan, 0 fallan |

Suites e2e en verde: gestion 88, precios-lotes 112, ubicacion 16, correcciones-auditoria 13, migracion-inactivos 10, caja 22, cajas 12, mostrador 79, solo-factura 14, sin-conexion 15, devoluciones 15, descuentos 7, turnos 17, compras 125, compras-factura 79, producto-lote 24, lotes-corregir 27, inventario-control 92, cuentas-clientes 71, reportes 19, reportes-costos 26, resultados 88, facturacion 28, factura-carta 45, dian-soporte 97, cumplimiento 62, control-especial 60, anexo13 52, modo-interno 34, ia 40, pagos 39, ingresos 51, operacion 9, parametros 38, embudo 38, saludo 3, demo-visitas 21, admin 134, seguridad 15.

## Después de la regresión: modo consulta y renovación

Se probó en una copia aparte con su propia base:

| Suite | Resultado |
|---|---|
| `modo-consulta` (nueva) | 44 pasan, 0 fallan |
| `ingresos` (ajustada) | 0 fallos |
| `operacion`, `admin`, `pagos` | 0 fallos |
| `endpoints` (con las 2 rutas nuevas) | 2.711 comprobaciones, 0 fallos |

## Concurrencia y carga

- Cuando dos cajas venden a la vez la última unidad, una cobra y la otra recibe «sin existencias». No quedan existencias negativas.
- Un cobro triplicado en paralelo con la misma `idem_key` deja una sola venta y un solo documento.
- Con 100 cajas cobrando el mismo producto, el 100 % de las ventas queda íntegro y el p95 es de 1.078 ms (detalle en 10).

## Incidencias de la batería base que no eran errores

| Suite | Qué pasó | Por qué no es un error |
|---|---|---|
| unit/db | Falló 1 prueba | La base estaba sucia por otra corrida. Con la base reiniciada pasa. |
| ia | Falló | El archivo de prueba se editó mientras corría. Volvió a pasar (40/40). |
| modo-interno | Tiempo agotado | La máquina estaba con carga. Volvió a pasar (34/34). |

## Cómo repetirla

```bash
node scripts/db-reset.mjs && npm test
npm run build && npx next start -p 4500   # con las variables de prueba de cada suite (cabecera de cada archivo)
for t in tests/e2e/*.mjs; do node "$t"; done
```
