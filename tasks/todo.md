# Regenta · plan de trabajo

Especificación: https://claude.ai/artifact/78qFbvxbiGftd3bxur2Q7z (Claude Doc «Regenta · Especificación del producto»)

## Semana 1 · base (1/11/2026)
- [x] Repo: Next.js 15 + TypeScript + Tailwind, pg, tipografía Barlow (autoalojada)
- [x] Base de datos: migraciones compatibles con Supabase (empresas, sedes, cajas, miembros, catálogo maestro, productos, lotes, costos aparte, movimientos, ventas, pagos, clientes, resoluciones y documentos DIAN, auditoría)
- [x] Seguridad por fila (RLS) por empresa + rol; costo solo para dueño/admin; documentos fiscales inmutables
- [x] Función registrar_venta: lote por vencimiento más próximo (FEFO), pagos, numeración de la resolución, documento DIAN pendiente, auditoría; todo en una transacción
- [x] Pruebas de aislamiento: un usuario de la empresa A no ve ni escribe nada de la B; cajero no ve costos
- [x] Catálogo maestro precargado desde Farmagenéricos (nombre, laboratorio, IVA, EAN, categoría; sin proveedores ni costos)
- [x] Capa de datos del servidor: cada consulta corre como «authenticated» con los claims del usuario (igual que Supabase)
- [x] Acceso de desarrollo (usuarios sembrados) — Supabase Auth en la siguiente iteración
- [x] Caja POS: búsqueda/escáner, caja o unidad, ticket tipo tirilla, cobro con medios de pago y cambio, venta registrada, estado DIAN
- [x] Inventario: stock por lote con semáforo de vencimiento
- [x] Emisión DIAN: adaptador con modo simulado (MATIAS real al tener cuenta y documentación)
- [x] Verificación: pruebas SQL + e2e en navegador + capturas escritorio/móvil

## Resultado semana 1 (1/11/2026)
- 15 pruebas de base de datos y 24 del recorrido en navegador en verde (escritorio y móvil).
- Pendiente para cerrar la fase 1: Supabase (proyecto + Auth), Netlify (sitio + variables), compras desde la app, clientes y factura electrónica, venta sin conexión (cola local), consola Regenta, emisor MATIAS real.

## Iteración 2 (1/11/2026): página de venta + app más completa y bonita (pedido de Oscar)
- [x] Portada comercial en / (indexable; la app y /entrar con noindex): título y descripción con «software POS para droguerías», canonical, Open Graph con imagen, JSON-LD SoftwareApplication + FAQPage, sitemap.xml, robots.txt
- [x] Tiquete animado en la portada (una sola animación, respeta movimiento reducido), capturas reales de la app (caja, inventario, carga Excel, inicio)
- [x] Formulario de demo → tabla solicitudes_demo (trampa anti-bots, aviso Ley 1581) + WhatsApp +57 321 214 1970 y correo gerencia@
- [x] Sección «Funciona hoy / En integración»: la DIAN real, clientes/crédito, varias sedes y venta sin internet se presentan como «en integración», no como hechos
- [x] Inicio del panel: vendido hoy, ticket promedio, ganancia (solo dueño), vencimientos, ventas 7 días, medios de pago, pendientes, últimas ventas
- [x] Ventas: historial por día, detalle tipo tirilla, estado DIAN, anular con motivo (arreglado error de columna ambigua que tumbaba el detalle)
- [x] Productos: listado, alta desde el catálogo maestro, producto propio, edición, retiro, carga CSV con vista previa fila por fila y todo-o-nada
- [x] Inventario: recibir mercancía (escáner, lote, vence, cajas + sueltas, costo solo dueño/admin, proveedor) y botón en inventario e inicio
- [x] Navegación nueva por rol; cajera entra a la caja, dueño y bodega al inicio
- [x] Siembra demo con una semana de ventas (REGENTA_CAPTURAS=1 llena el día de hoy solo para las capturas)
- [x] Pruebas: base 15/15 · caja e2e 0 fallos · gestión e2e 37/37 (portada, SEO, demo, alta, carga CSV, recibir, vender, anular, permisos, móvil)

### Pendiente
- [ ] Dominio y REGENTA_URL de producción (el sitemap/canonical toman esa variable)
- [ ] Aviso al equipo cuando entra una solicitud de demo (hoy solo se guarda)
- [ ] Supabase + Netlify (Oscar crea las cuentas), emisor MATIAS, clientes y factura electrónica, varias sedes, venta sin internet
- [ ] Precios de los planes tras investigar competidores con fuentes

## Iteración 3 (1/11/2026): «el mejor software de droguerías de Colombia» + landing de conversión (pedido de Oscar)
Regla: en la web solo va lo que funciona y se puede demostrar. «Única» solo si la investigación con fuentes lo sostiene.
- [x] Investigación con fuentes (4 subagentes): 15 competidores y precios · fuentes INVIMA · SEO y normas · costos MATIAS/infra/TRM
- [x] Veredicto: «única con IA» NO se sostiene (Más Control «Conti IA», Farmatízate pedido sugerido). SÍ se sostiene: ninguno de 15 ofrece cruzar alertas INVIMA con el inventario (según sus páginas, 01/11/2026)
- [x] Motor de predicción (004): ritmo de venta 56 días (60 % últimos 14), cobertura, pedido sugerido en cajas, tendencia; riesgo de vencimiento FEFO por lote en pesos; capital sin rotación
- [x] Página Predicción (pedido editable → copiar / Excel / WhatsApp; vencimiento; sin rotación) + franja en Inicio
- [x] Alertas INVIMA (005): tabla global, cruce por lote/registro/nombre, constancia inmutable de la revisión (rol), aviso rojo en Inicio, página Alertas, registro sanitario en producto y carga Excel
- [x] Lector de alertas del INVIMA (/api/invima con REGENTA_CRON_KEY) + 5 alertas reales verificadas en la siembra
- [x] ARREGLO GRAVE: la caja vendía lotes vencidos por FEFO. Ahora nunca; prueba en base de datos
- [x] Siembra con 8 semanas de historia realista (alta y baja rotación, lotes en riesgo, lote F0537A alertado)
- [x] Portada de conversión: «Probar la demo» en un clic (/demo, sin registro), avisos en el hero, diferencial verificado, calculadora de pérdida, cuaderno vs Regenta, roles, precios, guías, FAQ, barra fija en móvil
- [x] 6 guías SEO con normas verificadas y fuentes (/guias): metas, Article + Breadcrumb + FAQ, CTA a mitad y al final, enlazado cruzado, sitemap
- [x] Pruebas: base 19/19 · INVIMA 3/3 · caja e2e 0 fallos · gestión e2e 55/55

### Pendiente
- [ ] Oscar: aprobar precios (src/lib/planes.ts) y si hay primer mes gratis
- [ ] Confirmar con MATIAS si el POS electrónico consume un documento igual que una factura
- [ ] Probar /api/invima contra invima.gov.co desde producción (aquí la red no llega) y programarlo cada 6 h
- [ ] Guías de fraccionamiento y de apertura de droguería: faltan normas verificadas
- [ ] Datos abiertos CUM (i7cb-raxc): estado del registro sanitario desde producción
- [ ] Dominio + REGENTA_URL, Supabase + Netlify, emisor MATIAS, aviso de solicitudes de demo
