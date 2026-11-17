# 03 · Matriz de pruebas

Qué riesgo cubre cada suite y si es nueva o se ajustó en esta auditoría. Todas corren en local contra una compilación de producción (`next start`) y Postgres 16. No se usa ningún dato de clientes reales. Los proveedores externos (MATIAS, Wompi, Stripe e IA) están simulados.

## Unitarias y de base de datos (`npm test`)

| Archivo | Riesgo que cubre | Estado |
|---|---|---|
| `db.test.mjs` | RLS multiempresa, `registrar_venta`, numeración, FEFO, devoluciones | Existente |
| `concurrencia-db.test.mjs` | Dos cajas vendiendo a la vez la última unidad; cobro triplicado con la misma `idem_key`; entrada repetida en paralelo | **Nueva** |
| `auditoria-db.test.mjs` | AUD-01: factura a consumidor final sin correo sí, cliente identificado sin correo no | **Nueva** |
| `matias.test.mjs`, `entregas.test.mjs` | Armado del documento DIAN, CUFE, reintentos y respuestas del proveedor | Existente |
| `anexo13*`, `invima`, `importar`, `factura-proveedor`, `producto-desde-factura` | Anexo 13, catálogo INVIMA, importación de Alegra y de facturas de proveedor | Existente |
| `pagos.test.mjs`, `correos.test.mjs`, `visitas-demo`, `version-db`, `ubicacion-db`, `modo-interno-db`, `letras` | Firmas de pago, plantillas, demo, versión de migraciones, ubicación y modo interno | Existente |

## De punta a punta (HTTP y navegador)

| Área | Suites | Riesgos principales | Cambios |
|---|---|---|---|
| Caja y venta | `caja`, `cajas`, `mostrador`, `solo-factura`, `sin-conexion`, `descuentos`, `devoluciones` | Teclado y lector, varias cajas, venta sin internet, factura a consumidor final, NC por devolución | `solo-factura` ahora cobra de verdad (AUD-01) |
| Turnos y dinero | `turnos`, `cuentas-clientes` | Arqueo, **cierre ciego**, abonos y cartera | Cierre ciego en API y corte parcial (AUD-02) |
| Inventario | `gestion`, `compras`, `compras-factura`, `producto-lote`, `lotes-corregir`, `inventario-control`, `precios-lotes`, `ubicacion` | Lotes, vencimientos, FEFO, kardex, ajustes y costos | — |
| Migración | `migracion`, `migracion-inactivos` | Importar desde Alegra sin saldos fantasma | **Nueva** `migracion-inactivos` (AUD-06) |
| DIAN | `facturacion`, `factura-carta`, `dian-soporte`, `cumplimiento`, `control-especial`, `anexo13`, `habilitacion` | Emisión, notas, documento soporte, habilitación (MATIAS simulado) | — |
| Reportes | `reportes`, `reportes-costos`, `resultados` | Utilidad, márgenes y costos | — |
| IA | `ia` | Respuestas con datos reales, permisos por rol, inyección | Rentabilidad contra SQL independiente, anti-inyección, vendedor sin inventario (AUD-07) |
| Suscripción | `pagos`, `ingresos`, `operacion`, **`modo-consulta`** | Cobro, webhooks, vencimiento, suspensión, reactivación | **Nueva** `modo-consulta` (44 comprobaciones); `ingresos` ajustada |
| Permisos | `correcciones-auditoria`, `seguridad`, `admin`, `consola-clave` | Vendedor, cajera, consola, dos pasos | **Nueva** `correcciones-auditoria` (AUD-03/04/05) |
| Contrato de la API | `endpoints` | Cada ruta: sin sesión, CSRF, rol, datos basura, método, sin fugas | Exige que toda ruta nueva entre en el contrato (+2 rutas de consulta) |
| Pantallas | `auditoria`, `dispositivos` | SEO, consola, desborde, objetivos táctiles en 10 equipos, cada rol | — |
| Embudo y demo | `embudo`, `saludo`, `demo-visitas`, `parametros`, `modo-interno` | Correos comerciales con permiso, demo, parámetros | — |

## Carga (`tests/carga/ventas.mjs`)

Corre con 5, 20, 50 y 100 cajas sobre el mismo producto y comprueba la integridad (ventas, existencias y lotes negativos). Se niega a correr fuera de `localhost`.

## Huecos conocidos

- No hay pruebas contra el sandbox real de MATIAS ni de la DIAN, porque no hubo acceso.
- No hay pruebas de contingencia del art. 37, porque esa función no existe (ver 05).
- La accesibilidad se revisó con axe-core 4.10.2 sobre 15 pantallas. No se probó con lectores de pantalla reales.
