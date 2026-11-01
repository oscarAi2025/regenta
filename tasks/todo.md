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

## Iteración 4 (1/11/2026): IA visible, rediseño vendedor, más páginas/guías, revisión total de código (pedido de Oscar)
- [x] Revisión independiente de código: 30 hallazgos; arreglados los críticos y altos (anulación entre empresas, dueño cambiando su plan/estado, demo pública vulnerable, nota crédito al anular, zona horaria Bogotá) y casi todos los medios y bajos
- [x] Regenta IA: asistente con API de Claude + 7 herramientas de solo lectura con RLS; probado de punta a punta con API simulada (12 comprobaciones)
- [x] Prioridades del día en el inicio, buscador Ctrl+K (pantallas, productos y preguntas a la IA), patrón semanal en Predicción
- [x] Logo nuevo (cápsula + cruz + chispa de IA) y favicon
- [x] Plan Socio Farmagenéricos (gratis o con descuento según compras) en portada y /precios
- [x] Portada rediseñada (hero oscuro con conversación de IA, «hecho desde adentro», funciones con capturas, diferencial verificado, calculadora, precios, guías)
- [x] Páginas nuevas: /precios, /por-que-regenta, /funciones + 5 funciones, /para/regentes, /para/duenos-de-drogueria
- [x] 9 guías nuevas (15 en total): 3 operativas/comerciales + 6 normativas verificadas (control especial, apertura, temperatura y humedad, precio máximo, vencidos, venta por unidad)
- [x] Pruebas: base 27/27 · INVIMA 3/3 · caja e2e · IA e2e 12/12 · gestión e2e 76/76

### Pendiente
- [ ] Oscar: aprobar precios y escalones del Plan Socio (src/lib/planes.ts)
- [ ] Poner ANTHROPIC_API_KEY en el servidor de producción para activar Regenta IA
- [ ] Reinicio nocturno de los datos de la demo pública
- [ ] Varias sedes/cajas (hoy se usa la primera caja activa y su sede)
- [ ] Accesibilidad del listado de la caja (aria-activedescendant)
- [ ] Probar /api/invima contra invima.gov.co desde producción; confirmar con MATIAS consumo del POS

## Iteración 5 (1/11/2026): logo minimalista, tarifas con dos caminos, auditoría página por página
- [x] Logo: cápsula de dos tonos + «Regenta» grande + «by Farmagenéricos Colombia» pequeño; favicon
- [x] Tarifas: «Sin asociarte» y «Como socio de Farmagenéricos» con tabla de precio final por escalón y calculadora
- [x] Respaldo y cumplimiento (texto, sin logos de entidades: no hay aval) + razón social y NIT en el pie
- [x] Auditoría automática (tests/e2e/auditoria.mjs): 27 páginas públicas + 14 pantallas × 3 roles × 2 tamaños = 113 revisiones, 0 fallos
- [x] Arreglos de la auditoría: títulos/descripciones largos, Open Graph en 4 páginas, H1 de la caja; servidor ya no se cae si la base reinicia

## Iteración 6 (1/11/2026): que se entienda que es facturación + gestión para droguerías, farmacias y distribuidoras (pedido de Oscar)
- [x] Producto: factura electrónica con cliente (NIT/CC) desde la caja: buscar o crear cliente sin salir de la venta
- [x] Producto: venta a crédito con plazo (solo dueño/admin, solo con factura y cliente) + cartera con abonos y vencidas
- [x] Base: migración 008 (condición, plazo, vence_pago, abonos, v_cartera, registrar_abono; anular bloqueado si hay abonos)
- [x] DIAN: forma de pago crédito y fecha de vencimiento en el documento
- [x] Web: posicionamiento claro en hero, títulos, metas, cabecera, pie y entrar: «software de facturación electrónica y gestión»
- [x] Web: /para/distribuidoras, /para/droguerias y función /funciones/facturacion-electronica, con lo que hay de verdad (sin prometer listas por cliente ni preventa)
- [x] App: rótulo «Facturación · Inventario · IA» bajo la marca
- [x] Pruebas: base (crédito, abonos, permisos), e2e de caja con factura y crédito, cartera, auditoría SEO
- [x] Resultado: base 29/29 · INVIMA 3/3 · caja, gestión, IA y facturación e2e 0 fallos · auditoría 31 páginas públicas + 16 pantallas × 3 roles × 2 tamaños = 133 revisiones, 0 fallos

### Pendiente
- [ ] Listas de precio por cliente, cupo de crédito y preventa en ruta (distribuidoras): hoy la web dice que no los tiene
- [ ] MATIAS: forma de pago crédito (código 2) y fecha de vencimiento en la factura real

## Iteración 7 (1/11/2026): logo con mensaje, rediseño potente, pagos, apoyo en ventas y SEO del sector salud (pedido de Oscar)
- [x] Logo: R sobre tiquete de factura + chispa de IA, degradado salud; descriptor «Facturación e IA para el sector farmacéutico»; favicon e imagen para compartir
- [x] Portada rediseñada: héroe con producto en acción, franja de funciones, POS genérico vs Regenta, «te guía y te ayuda a vender», respaldo de Farmagenéricos mayorista, planes con Contratar, más CTA
- [x] Sellos de confianza en texto (sin logos de la DIAN ni superintendencias: no hay aval de esas entidades)
- [x] Corregido: se decía «proveedor tecnológico autorizado por la DIAN»; MATIAS dice en su web que no lo es (software propio) y no está en el listado DIAN del 15/10/2026
- [x] Caja: alternativas con existencias para productos agotados; medio de pago QR Bancolombia
- [x] Pagos de planes: Wompi (tarjeta, PSE, Nequi, Daviplata, Botón y QR Bancolombia) y Stripe (renovación automática, cuenta de la LLC); webhooks firmados; /contratar y /contratar/resultado; política de datos
- [x] SEO: /software/facturacion-electronica-sector-salud, /software/pos-drogueria, /software/farmacias, /software/inventario-farmacia y guía de facturación en salud y RIPS (Res. 948 de 2026)
- [x] Pruebas: base 29/29 · firmas e INVIMA 6/6 · e2e caja, gestión, IA, facturación y pagos 0 fallos · auditoría 140 revisiones 0 fallos

### Pendiente
- [ ] Oscar: crear cuenta Wompi (Bancolombia) y poner WOMPI_PUBLIC_KEY, WOMPI_INTEGRITY_SECRET, WOMPI_EVENTS_SECRET; URL de eventos: /api/pagos/wompi
- [ ] Oscar: Stripe con la LLC (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET; webhook /api/pagos/stripe) si quiere renovación automática con tarjeta
- [ ] Probar en sandbox de Wompi la URL del checkout y la de la API de pruebas (no confirmadas en su documentación de Colombia)
- [ ] Aviso al equipo cuando entra un pago aprobado (correo o WhatsApp)

## Iteración 8 (1/11/2026): auditoría total (código, SEO competitivo, UX/conversión y velocidad) y correcciones
- [x] Código: redondeo al repartir una caja en varios lotes; lotes separados por alerta INVIMA ya no se venden; JIT apagado en funciones de predicción y alertas (de ~2,5 s a ~60 ms); CSRF en /api/sesion; IP real en límites; categoría al editar; anulación de abonos; Stripe con transiciones e invoice.paid; RLS en invima_descartadas; cambio 0 en crédito; fecha inválida en ventas; aviso de venta repetida; límite de IA por IP en la demo
- [x] SEO: portada con «software para droguerías»; páginas índice /software y /para; /software/facturacion-electronica-droguerias; /software/distribuidoras-medicamentos (redirige desde /para/distribuidoras); /para/droguerias fusionada en la portada; títulos con búsqueda exacta; SoftwareApplication con AggregateOffer; 3 guías nuevas (cómo elegir, cambiar de software, kardex); enlaces de guías a páginas de software
- [x] UX/CRO: barra móvil y modales con transparencia real; botón de IA compacto; crédito visible al facturar; clientes recientes; contratar con casilla grande, plan seleccionado y total fijo; héroe y tarifas más directos en móvil; /entrar con el acceso primero; productos paginados; aviso al no tener permiso; zonas de toque más grandes
- [x] Velocidad: sin animación en el elemento principal, imágenes optimizadas (next/image) y solo fuentes latinas
- [x] Pruebas: base 32/32 · firmas e INVIMA 6/6 · e2e 0 fallos · auditoría 145 revisiones 0 fallos

### Pendiente
- [ ] Demo pública compartida: reinicio programado de los datos (o una demo por visitante)
- [ ] Barra de navegación inferior en la app para el celular
- [ ] Prueba social real cuando haya clientes (sin inventar)
- [ ] Guía «software gratis para droguería» contrastada con la DIAN
