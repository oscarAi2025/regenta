# 09 · UX/UI y accesibilidad

## Cobertura automática existente (batería base, 17/11/2026)

| Suite | Qué revisa | Resultado |
|---|---|---|
| `auditoria.mjs` | Web pública rastreada desde la portada (estado, título, descripción, H1 único, canonical, Open Graph, JSON-LD, imágenes con alt, enlaces rotos, duplicados, consola, desborde móvil) + cada pantalla de la app con cada rol (dueño, cajera, bodega, vendedor) y redirección de las prohibidas | **358 pantallas, 0 fallos** |
| `dispositivos.mjs` | Cada pantalla pública, de la app y de la consola en 10 equipos (iPhone SE 320 px → PC 1920 px, tabletas, horizontal): estado 200, sin errores de consola, sin desborde, nada fuera de la pantalla y objetivos táctiles ≥ 44 px | **748 pantallas, 0 avisos, 0 fallos** |
| `caja`, `mostrador`, `solo-factura`, `sin-conexion` | Venta con teclado (F2/F4/F6/F9, Enter), lector de código de barras, celular | 0 fallos |

## Accesibilidad WCAG 2.2 AA (axe-core 4.10.2, nueva en esta auditoría)

Se corrió axe sobre 15 pantallas clave (dueño, cajera y web pública) con las reglas `wcag2a`, `wcag2aa`, `wcag21aa` y `wcag22aa`.

| Hallazgo | Dónde | Antes | Corrección | Después |
|---|---|---|---|---|
| Contraste insuficiente de los títulos de grupo del menú lateral (blanco al 45 % sobre fondo oscuro) | Todas las pantallas de la app | 5 nodos por pantalla | `Navegacion.tsx`: blanco al 75 % | Sin violaciones |
| Contraste del aviso legal de la portada (blanco al 40 %) | `/` | 1 nodo | `Cumplimiento.tsx`: blanco al 70 % | Sin violaciones |
| Lista desplazable de «Ventas por día» sin acceso por teclado | `/reportes` | 1 | `tabIndex` + `aria-label` | Corregido (se confirma en la regresión) |
| **Pendiente (P3):** cada resultado de la búsqueda de la caja es una `option` que contiene botones (Caja/Unidad) — los lectores de pantalla no anuncian bien los controles anidados | `/caja` | 8 | No se cambió: rediseñar el patrón (lista de filas con botones en vez de `listbox`) toca el flujo de venta con teclado y sus pruebas | Pendiente |

Resultado tras las correcciones: 13 de 15 pantallas sin violaciones; queda la de la caja (P3) y la de Reportes se valida en la regresión final.

## UX de los recorridos esenciales

Cubiertos por suites e2e existentes, con resultado 0 fallos en la batería base: registro y activación (`admin`, `consola-clave`), configuración inicial (`parametros`, `gestion`), primer producto y lote (`producto-lote`, `gestion`), carga de inventario (`gestion`, `compras`), abrir caja, vender y cerrar (`turnos`, `caja`), emitir el documento correcto (`facturacion`, `solo-factura`, `factura-carta`), utilidad (`resultados`, `reportes-costos`), vencimientos (`precios-lotes`, `inventario-control`), Regenta IA (`ia`).

Hallazgo de UX con impacto real corregido: la caja dejaba el botón **Cobrar** activo para una factura a consumidor final que luego fallaba (AUD-01, ver 04).

## No verificado

- Pruebas con usuarios reales (personas con poca experiencia tecnológica): fuera del alcance de una auditoría automatizada.
- Lectores de pantalla reales (NVDA/VoiceOver): solo reglas automáticas de axe.
