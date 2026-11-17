# 10 · Rendimiento y concurrencia

Entorno: servidor `next start` (compilación de producción) y Postgres 16 en el mismo contenedor de pruebas, base demo recién sembrada (1.294 ventas, catálogo de demo). **No** se ejecutó carga contra producción (el script se niega si `BASE` no es `localhost`).

Script: `tests/carga/ventas.mjs` — N cajas cobrando a la vez por HTTP (`POST /api/ventas`), todas sobre **el mismo producto** (peor caso: compiten por los mismos lotes), y después N búsquedas simultáneas de la caja (`GET /api/productos?q=acetaminofen`).

| Cajas a la vez | Cobros OK | Errores | p50 cobro | p95 cobro | Máx. | Stock baja | Lotes negativos | p50 búsqueda | p95 búsqueda |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 5 | 5 | 0 | 153 ms | 200 ms | 200 ms | 5 | 0 | 69 ms | 72 ms |
| 20 | 20 | 0 | 273 ms | 324 ms | 324 ms | 20 | 0 | 155 ms | 189 ms |
| 50 | 50 | 0 | 574 ms | 597 ms | 614 ms | 50 | 0 | 223 ms | 306 ms |
| 100 | 100 | 0 | 1.020 ms | 1.078 ms | 1.079 ms | 100 | 0 | 519 ms | 674 ms |

**Integridad bajo carga: 100 %.** En todos los niveles, el número de ventas, la baja de existencias y el cero de negativos cuadran exactamente.

**Lectura:** la latencia crece casi lineal porque las 100 ventas se serializan sobre los mismos lotes (bloqueo por fila, que es lo correcto para no vender lo que no hay). En una droguería real cada caja vende productos distintos y no compite así. 100 cobros simultáneos del mismo producto se resuelven en ~1,1 s.

## Umbrales propuestos (para vigilar en producción)

| Operación | Umbral p95 | Medido local (20 a la vez) |
|---|---:|---:|
| Cobro en caja | < 800 ms | 324 ms |
| Búsqueda de producto en caja | < 400 ms | 189 ms |

## Lo que no se midió y por qué

- Latencia real de Netlify + Supabase (red entre regiones, arranque en frío de funciones): requiere medir en producción o en un staging en la misma infraestructura; no existe un staging separado.
- Consumo de memoria y fugas en Netlify Functions: no accesible desde aquí.
- Latencia de la IA: depende del proveedor; con el simulador local no es representativa.
- Lección ya registrada (`tasks/lessons.md`, 17/11): una lectura por fila con `to_jsonb()` en la búsqueda de la caja la hizo 2-3 veces más lenta; se corrigió con una comprobación por proceso.
