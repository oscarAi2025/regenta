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
- [x] Varias sedes/cajas (hoy se usa la primera caja activa y su sede)
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
- [x] Oscar: Stripe con la LLC (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET; webhook /api/pagos/stripe) si quiere renovación automática con tarjeta
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

## Iteración 9 (1/11/2026): consola de superadministración y acceso con contraseña (pedido de Oscar)
- [x] Cuentas con contraseña (scrypt), invitaciones de un solo uso (7 días) y /activar; /entrar con correo y contraseña
- [x] Consola /admin: resumen (clientes, ingreso mensual estimado, cobrado, demos, cola DIAN, INVIMA), clientes (buscar, activar/suspender, entrar como, ver), alta de cliente en un paso (empresa, sede, caja, numeraciones, dueño con enlace), ficha (plan en un clic, usuarios, restablecer contraseña, nota, pagos, historial), pagos (crear cuenta desde un pago, atendido), solicitudes de demo (WhatsApp, contactada, crear cliente), sistema (procesar DIAN, sincronizar INVIMA, variables), bitácora
- [x] Aviso de modo soporte dentro de la app al entrar como un cliente
- [x] scripts/crear-superadmin.mjs (contraseña escrita en la terminal, nunca en el chat)
- [x] Caja: los productos con existencias salen primero (NULL en el orden por código de barras)
- [x] Pruebas: base 32/32 · firmas 6/6 · e2e caja, gestión, IA, facturación, pagos y consola 0 fallos · auditoría 145 revisiones 0 fallos

### Pendiente
- [x] Oscar: crear su superadministrador en producción con scripts/crear-superadmin.mjs
- [x] Correo transaccional para enviar invitaciones (hoy se mandan por WhatsApp desde la consola)
- [ ] Reinicio de la demo desde la consola

## Iteración 10 (1/11/2026): correos, seguridad de la consola y despliegue
- [x] Correos (Resend, cola con clave única, reintentos): invitación, contraseña nueva, bienvenida, solicitud, pagos, renovación, suspensión; embudo de 5 correos con autorización y baja de un clic; /admin/correos
- [x] Seguridad (auditoría adversarial): sesión revalidada en la base, soporte de 1 hora, superadmins intocables desde clientes, demo solo con usuarios fijos, filtros por empresa, límites de intentos en la base, webhook Wompi confirmado contra su API, errores 500 → 400
- [x] Despliegue: netlify.toml, tarea horaria, conexión al pooler de Supabase con CA, migraciones registradas en producción, tasks/despliegue.md
- [x] QA funcional: lote con fecha fija, NIT con DV, límites sin errores 500, mensajes en español, CSV Windows-1252, permisos de bodega, confirmaciones
- [x] Pruebas: base 33/33 · firmas 6/6 · correos 17/17 · e2e caja, gestión, IA, facturación, pagos y consola (63 revisiones) 0 fallos · auditoría 145 pantallas 0 fallos

### Pendiente
- [ ] Oscar: cuentas y variables según tasks/despliegue.md (Supabase, Resend con dominio, Netlify, Wompi, superadmin)
- [ ] Emisor MATIAS real en src/lib/dian (requiere contrato Casa de Software y su URL de producción; hoy «simulado»)
- [x] Un mismo correo dueño de dos droguerías: elegir droguería al entrar (hoy entra a la más antigua)
- [ ] Caja: conservar la venta en curso si se recarga la página

## Paridad con Alegra POS (auditoría 02/11/2026, fuentes en ayuda.alegra.com)
- [x] Impresión de tirilla 80/58 mm: automática al cobrar (iframe), F8 reimprime, «Imprimir tiquete» en la venta, QR y CUDE, datos de la Res. 165/2023 art. 19-20
- [x] Turnos de caja: apertura con base, ingresos y egresos de efectivo, cierre con «dinero real en caja», diferencia, reporte imprimible, «exigir turno» (migración 018, tests/e2e/turnos.mjs)
- [x] Pagos mixtos (una parte con otro medio y el resto en efectivo, cambio solo sobre el efectivo)
- [x] Descuento por ítem y descuento general (%), tope de la cajera 10 %, informado a la DIAN como descuento de línea (aceptado en el sandbox de MATIAS) — migración 019, tests/e2e/descuentos.mjs
- [ ] Devolución parcial (nota crédito por ítems/cantidades)
- [x] Venta sin internet: catálogo local, cola con idempotencia, comprobante provisional, envío solo al volver (tests/e2e/sin-conexion.mjs) con tirilla provisional y sincronización
- [ ] Reportes: ventas por producto, por cajero, por medio de pago y por turno
- [ ] Venta en espera (varias ventas abiertas) — Alegra no la tiene: ventaja
- [x] Términos y condiciones (/terminos), enlazados en el pie y aceptados al contratar; política de datos al día (Google Workspace, encargados)

## 2026-11-02 · Embudo de venta (hecho y en producción, commit 1ee05b2)
- [x] Demo: barra fija con oferta y «Contratar ahora», recorrido de 3 pasos, aviso tras vender, oferta al completar / al irse / a los 3 min (máx. 2)
- [x] Salir de la demo → /demo/gracias (oferta, objeciones, formulario), no a «Entrar»
- [x] Portada: dolor (vencidos, venta perdida, cierre DIAN art. 657 ET), pila de valor, garantía 30 días, precio congelado, barra flotante en escritorio
- [x] Contratar y Tarifas con garantía y pila de valor; términos actualizados (garantía y precio congelado)
- [x] Sin nombres de otros programas (guía de precios con rangos)
- [x] Regenta IA con perfil experto (regencia, normativa, farmacología, mostrador, venta)
- [x] Migración 020 (devoluciones) aplicada en Supabase
- [ ] ANTHROPIC_API_KEY en Netlify (la pega Oscar) y redeploy
- [x] Devolución parcial: pantalla en el detalle de la venta + comprobante + e2e (tests/e2e/devoluciones.mjs, 0 fallos)
- [x] Migración 021 aplicada en Supabase (21 migraciones) y desplegado; verificado en producción: reportes, CSV, catálogo (600), venta + devolución + comprobante
- [x] Reportes (dueño/admin): netas, ganancia, IVA, por día, por medio, horas fuertes, por cajero, por producto; exportar CSV para Excel (tests/e2e/reportes.mjs)
- [x] Venta sin internet: catálogo local, cola con idempotencia, comprobante provisional, envío solo al volver (tests/e2e/sin-conexion.mjs)

## 2026-11-02 · MATIAS producción (paquete Casa de Software 30.000 pagado y aprobado)
- [x] URL de producción del API: https://api-v2.matias-api.com (MATIAS_URL, ya en Netlify)
- [x] La demo emite siempre en simulado aunque el servidor use MATIAS
- [x] Consola → cliente → «Facturación electrónica (MATIAS)»: UUID del cliente en MATIAS + número de resolución DIAN y paso a producción por numeración (e2e admin)
- [x] MATIAS_TOKEN en Netlify (lo pegó Oscar); prueba desde Consola → Sistema: «Conexión con MATIAS correcta (producción): IA DEV INVESTIMENTS COLOMBIA SAS · 0 clientes»
- [ ] Por cada droguería: habilitación DIAN (portal Habilitación con su usuario: software, set de pruebas), certificado en MATIAS, resolución POS/factura en MUISCA, crear el cliente en MATIAS → UUID en la consola
- [x] REGENTA_DIAN=matias en Netlify y desplegado (la demo sigue simulada)

## 2026-11-02 · Acceso automático tras el pago
- [x] Al aprobarse un pago (Stripe, Wompi o QR confirmado) se crea la droguería con sede, caja y numeraciones de prueba, el dueño queda invitado y recibe el correo para crear su contraseña; el pago queda ligado y atendido (e2e admin)
- [x] NIT obligatorio al contratar; si el NIT ya es cliente, solo se liga el pago
- [x] Numeraciones de prueba emiten en simulado aunque el servidor use MATIAS
- [x] La página del pago aprobado dice a qué correo (enmascarado) llegó el acceso y lleva a Entrar
- [x] Correos reales con Resend (Google Admin no dio acceso): regenta.pro verificado (DKIM, SPF de envío, DMARC en Netlify DNS), CORREO_REMITENTE = Regenta <hola@regenta.pro>, RESEND_API_KEY (la pegó Oscar); botón «Enviarme un correo de prueba» en Consola → Sistema

## 2026-11-02 · Auditoría integral (dueño, cajero, admin, superadmin, pagos, DIAN, correos) — migración 022
- [x] Venta real bloqueada con numeración de prueba (sin validez fiscal); aviso en la caja y en «Mi droguería» mientras llega la habilitación
- [x] Producción exige UUID de MATIAS y número de resolución; prefijo ≤ 4; búsqueda de la resolución por rango del consecutivo
- [x] Consola: cargar numeración nueva (desactiva la anterior, no solapa números emitidos); alta manual crea NC de prueba
- [x] Cola DIAN cada 15 min con presupuesto de tiempo; plazo de 72 h para rechazados; «Reenviar a la DIAN» en la venta (dueño/admin); devolución bloqueada si la factura está rechazada
- [x] Tarea horaria: suscripción vencida → aviso, 3 días de gracia → suspensión; numeración por vencer/agotarse (30 y 7 días, 10 %); rechazos DIAN al dueño
- [x] Pagar reactiva la cuenta y deja el plan pagado; pago con NIT ajeno no se liga solo (revisión en consola)
- [x] Stripe: checkout validado (sesión, modo, COP, monto); renovaciones mensuales extienden el periodo (idempotente); cobro fallido no borra lo pagado; cancelación marcada
- [x] Límites compartidos en la base (IA de la demo, solicitudes de demo, pagos, restablecer)
- [x] Cajero: tope de salida de caja; no ve cifras globales en la IA; no renombra clientes; factura exige correo del cliente
- [x] CSV sin inyección de fórmulas; claves de tareas comparadas en tiempo constante
- [x] «¿Olvidaste tu contraseña?» autoservicio; «Mi droguería» (datos, topes de la cajera, plan, documentos del mes, habilitación, equipo con cupo del plan); primeros pasos en Inicio; lector de código de barras agrega al instante
- [x] Pruebas: 13 grupos e2e en 0 fallos + unitarias 33 y 14
- [x] Producción 2026-11-03: migración 022 aplicada en Supabase (registrada en regenta_migraciones; columnas, 6 funciones y limites_uso verificadas); despliegue Netlify de 32660db sin errores
- [x] Verificado en vivo: /api/tareas y /api/dian sin clave → 401; restablecer → respuesta genérica; equipo/configuración sin sesión → 401; «¿Olvidaste tu contraseña?» en /entrar; venta POS en la demo (3 u, $3.600, inventario 383→380, documento aceptado simulado); tarea programada cada 15 min, «Run now» → 200
### Pendiente
- [x] Stripe en producción: falta STRIPE_WEBHOOK_SECRET (el webhook responde 503 «Stripe no configurado"); Oscar lo pega en Netlify si va a cobrar con Stripe
- [ ] Habilitación DIAN y certificado MATIAS de cada droguería (equipo de Oscar)

## 2026-11-03 · Importación, anulación, Regenta IA en celular y velocidad
- [x] Importar productos: .xlsx y .csv de cualquier sistema; columnas reconocidas solas (y corregibles); números, fechas, IVA y códigos en cualquier formato; filas del mismo producto unidas; lotes ya cargados no se suman otra vez (subir el mismo archivo dos veces no cambia nada); ajustes automáticos explicados; todo o nada, en bloque (hasta 15.000 filas)
- [x] Anular: la nota crédito de anulación sale a la DIAN al instante; la venta muestra nota, estado y CUDE (o «no hizo falta nota crédito»); reenvío si la rechazan
- [x] Regenta IA: respuesta en flujo palabra por palabra, consultas en paralelo, instrucciones en caché, «Detener»; en celular pantalla completa, «atrás» la cierra, botón pequeño que se esconde al bajar; negritas y listas legibles
- [x] Velocidad: región de funciones Netlify → São Paulo (junto a Supabase; autorizado por Oscar); arranque de transacción en una sola ida a la base; cabecera con una consulta; seguridad por fila con mis_empresas() (migración 023: 10–20× más rápido en inventario, mismo resultado por rol)
- [x] Migración 023 aplicada en producción (21 políticas, ninguna con rol_en) · despliegue lanzado 07:51 con región São Paulo
- [x] Despliegue confirmado; en vivo (desde España): primera respuesta 0,3–0,6 s (antes 1,3 s); Inicio 1,1 s (antes 3,8–7,2 s); Inventario 1,1 s (antes 2,4 s); Predicción 0,9 s (antes 2,9 s)
- [x] Stripe: Oscar pega STRIPE_SECRET_KEY y STRIPE_WEBHOOK_SECRET (destino de eventos «Snapshot» → https://regenta.pro/api/pagos/stripe)

## 2026-11-03 · Revisión independiente (3 revisores) — migración 024
- [x] CRÍTICO toma de cuentas: el dueño ya no puede invitar/«reactivar» la cuenta de otra droguería ni recibir enlaces de contraseña de quien ya la tiene; la base ya no deja a usuarios escribir miembros (e2e admin + db.test)
- [x] CRÍTICO DIAN: una nota crédito de una venta real nunca sale simulada (trigger nc_exige_produccion); la consola no pasa ventas a producción sin notas crédito en producción
- [x] Anular con envío en duda: se manda el original y luego su nota crédito (la nota espera el CUFE); anulación de un turno anterior descuenta el efectivo del turno abierto
- [x] Correos atascados en «enviando» vuelven a la cola; presupuesto de tiempo; el enlace de contraseña no queda en claro tras error/cancelación
- [x] Pagos: pago anulado suspende (si no hay otro vigente); suspensión manual vs impago (un pago no reactiva la manual); vencimiento por empresa; planes especiales no se rebajan; doble cobro y renovación con otro monto quedan «por atender»; NIT con DV pegado; recordatorios también tras Stripe cancelada; el dueño cancela la renovación con tarjeta en Mi droguería; suspender en consola cancela la suscripción de Stripe
- [x] Entrar: selector de droguería si la cuenta tiene varias; bloqueo por correo no deja fuera al dueño; «olvidé mi contraseña» responde en el mismo tiempo
- [x] Sin conexión: errores pasajeros se reintentan solos; «Reintentar» y «Registrar con el precio de hoy»; no exige turno a ventas ya hechas sin internet
- [x] Importación: mismo producto con y sin código de barras se une; resolución que aún no empieza no se puede cargar
- [x] SEO: robots.txt deja leer el noindex de /entrar y /activar y bloquea las rutas internas que faltaban; etiquetas twitter en todas las páginas públicas
- [x] Producción 03/11 10:00: migración 024 aplicada (columna suspension, trigger NC, authenticated sin escritura en miembros) y desplegado 4cf07b8
- [ ] Dudas normativas para confirmar con MATIAS/DIAN: contingencia de 72 h, fecha en reenvíos, responsabilidades fiscales del adquirente (tax_level/regime), código de medio de pago para débito/Nequi
- [ ] Pendientes menores: abonos en efectivo con varias cajas activas; CSP sin 'unsafe-inline' (nonce)

## 2026-11-03 · Contrato de endpoints (tests/e2e/endpoints.mjs, 850 comprobaciones)
- [x] Las 44 rutas de la API, cada una: sin sesión, desde otro sitio (CSRF), rol sin permiso, 8 cuerpos basura, método inexistente, sin fugas de errores internos; falla si aparece una ruta nueva sin probar
- [x] Arreglado: /api/sesion devolvía 500 con cuerpo «null»; 6 rutas validaban datos antes que el rol (ahora 403 claro); estado de pago con límite por IP; reportes sin error interno si falla la base
- [x] Cartera: el saldo a veces no se actualizaba tras un abono (router.refresh no aplicaba); ahora la fila toma el saldo que confirma el servidor
- [x] Producción verificada: 282 comprobaciones de endpoints (sin sesión, sin clave, consola, datos basura, fugas) en 0 fallos; venta + anulación con nota crédito NCSE2 aceptada (demo, simulada) e inventario 380→378→380; la cajera recibe 403 en productos, equipo, reportes y anular

## 2026-11-03 · Stripe (modo de prueba) configurado y probado en producción
- [x] Webhook «Regenta pagos» (Workbench, formato Resumen/snapshot, API 2024-12-18.acacia, 4 eventos) → https://regenta.pro/api/pagos/stripe
- [x] Oscar pegó STRIPE_WEBHOOK_SECRET y STRIPE_SECRET_KEY (sk_test) en Netlify; desplegado c180524
- [x] Pago real de prueba (4242): aprobado, suscripción guardada, vence 03/12/2026, droguería «OSCARIN» creada con dueño y numeraciones de prueba, correos invitación y pago aprobado enviados
- [x] Cancelación desde Stripe: llega customer.subscription.deleted, se marca cancelada, la droguería sigue activa hasta el vencimiento
- [x] Droguería de prueba «OSCARIN» usa el NIT real 901845370-5 de IA DEV INVESTIMENTS COLOMBIA: Oscar la suspende o la borra desde la consola
- [x] Modo real: decidir si se usa esta cuenta (gestionada por Mercury, Stripe recomienda una nueva) o una cuenta nueva de la LLC; repetir webhook + claves live (mejor clave restringida: Checkout Sessions y Subscriptions en escritura)

## 2026-11-03 · Cajas por plan y equipo visible
- [x] Límites del plan en un solo lugar (lib/planes LIMITES): Esencial 1 caja / 3 usuarios; Pro 3 cajas / usuarios ilimitados
- [x] Mi droguería → Cajas: crear, renombrar, activar/desactivar (no la última, no con turno abierto, tope del plan, nombres únicos); /api/cajas
- [x] Cada computadora elige su caja (cookie regenta_caja, validada en el servidor): ventas, devoluciones y turno quedan en esa caja; selector en Caja y Turno si hay más de una
- [x] Equipo: «Agregar persona» visible también en la demo (responde que se hace al contratar); con el cupo lleno, botón para pasar a Pro
- [x] Pruebas: tests/e2e/cajas.mjs, admin (cajas por plan), contrato de endpoints (899 comprobaciones)

## 2026-11-03 · Stripe en modo real + cajas en producción
- [x] Webhook live we_1UXeDORSn19yy9XRFUqnntak (Resumen, 4 eventos) → https://regenta.pro/api/pagos/stripe; Oscar pegó las claves live en Netlify
- [x] Desplegado 9b1015f (cajas por plan) con las claves live
- [x] En vivo: webhook responde 400 «Firma no válida» (la clave está cargada, ya no 503); /api/pagos con Stripe devuelve sesión cs_live_ en checkout.stripe.com
- [x] En vivo: Mi droguería muestra Equipo (0 de 3) y Cajas (1 de 1 en Esencial, Agregar caja, Renombrar, Desactivar); /api/cajas sin sesión → 401
- [x] Orden de prueba RG-ESENCIAL-MW0IN3QT-7F2A2B5E («PRUEBA STRIPE LIVE») queda pendiente sin pagar; la sesión de Stripe vence sola en 24 h
- [ ] Oscar: primer cobro real (puede reembolsarlo) para confirmar la firma del webhook live de punta a punta
- [x] Oscar: suspender o borrar la droguería de prueba «OSCARIN» (NIT real 901845370-5)

## 2026-11-03 · Consola: eliminar prueba y descartar órdenes (56715e4, sin desplegar)
- [x] Eliminar droguería de prueba: solo suspendida, sin numeración DIAN en producción, no demo, confirmando NIT; borra cuentas huérfanas; pagos y bitácora quedan (migración 025)
- [x] Descartar orden de pasarela sin pagar: cierra la sesión de Stripe, queda rechazada/atendida sin correo; un pago tardío igual se aprueba
- [x] e2e admin 0 fallos
- [x] 025 aplicada en producción (Oscar confirmó Run query)
- [x] Desplegado bd0efdc; Oscar descartó RG-ESENCIAL-MW0IN3QT-7F2A2B5E y eliminó OSCARIN desde la consola

## 2026-11-03 · Revisión independiente por tipo de usuario (24 hallazgos)
Alta:
- [x] 1 Stripe: segunda suscripción sin cancelar la anterior; correo de cobro fallido dice «no se cobró nada» mientras Stripe reintenta
- [x] 2 Renovación con otro correo (nit_existente): no hay «Ligar a cliente» que reactive, aplique plan y vencimiento
- [x] 3 Consola no edita datos fiscales (razón social, DV, responsable IVA, dirección, ciudad)
- [x] 4 Dueño sin historial de pagos/recibos de su suscripción
- [x] 5 Exportar datos (productos, clientes, ventas, cartera, XML/PDF DIAN) también suspendida — lo prometen los términos
- [x] 6 Guardar aceptación de términos (versión, fecha, IP) en la orden de pago
Media: 7 reintento de correo con enlace sale sin enlace · 8 suspendido sin botón Renovar · 9 bajar de plan inmediato y sin recortar excesos · 10 cobro de documentos extra prometido y no implementado · 11 reembolso/garantía sin acción · 12 pago manual / vencimiento de clientes de consola · 13 correo «ya estás habilitado» y textos · 14 cambiar rol/correo/dueño desde consola · 15 gestión de clientes de la droguería · 16 proveedores y costo al recibir
Baja: 17 correo al cancelar renovación · 18 plan Socio límites/descuento · 19 reactivar tras suspender no restaura Stripe · 20 recordatorios a dueños actuales · 21 aviso de vencimiento en la app · 22 cambiar contraseña dentro · 23 enlace vencido → pedir uno nuevo · 24 tope diario de IA por empresa

## 2026-11-03 · Graves resueltos (8ea67d3 + 07ab9c8) · 026 aplicada por Oscar
- [x] Suite completa: endpoints 931 · 0 fallos; todos los e2e 0 fallos; unitarias 36 + 22
- [x] En vivo (bd0efdc): orden de prueba «descartada sin pagar»; OSCARIN ya no está en clientes; webhook Stripe 400 firma; /api/exportar sin sesión 401; ficha con «Descargar sus datos» y ZIP 200 (PK); /admin/activar con enlace falso «ya no sirve»
- [x] Superadmin de Oscar (gerencia@farmagenericoscolombia.com) con contraseña propia vía db/consola/superadmin-enlace.sql
- [x] Detalle: un pago aprobado cuya droguería se eliminó aún muestra «Crear su cuenta» (ocultar si está atendido)

## 2026-11-03 · Puntos medios y bajos de la revisión (migración 027)
- [x] 7 Reintentar correo de contraseña genera enlace nuevo
- [x] 8 Suspendido por impago: correo y entrada con «Renovar» (se reactiva solo al pagar); cajera ve «avísale al dueño»
- [x] 9 Bajar de Pro a Esencial se aplica al vencer lo pagado (plan_siguiente) y recorta cajas/usuarios con aviso; consola avisa exceso al cambiar plan
- [x] 10 Documentos extra: cargo mensual (solo documentos de producción), correo con referencia y llave QR, aviso al 90 %, consola marca pagado/condona, Mi droguería y franja en la app
- [x] 11 Reembolso: Stripe desde la consola (refund + cancela suscripción) o «Marcar devuelto»; anula y suspende si no hay otro pago
- [x] 12 Pago manual (transferencia, consignación, efectivo) con plan, vencimiento, reactivación y correo
- [x] 13 Correo «Ya facturas ante la DIAN» al quedar en producción; textos de pago aprobado y bienvenida corregidos; alerta en consola de pagados sin habilitar
- [x] 14 Consola: cambiar rol (nunca sin dueño) y correo de usuarios
- [x] 15 Página Clientes (dueño/admin): buscar, compras, corregir, quitar contacto (Ley 1581)
- [x] 16 Proveedores al recibir (lista + factura) y «Costos por completar» para dueño/admin
- [x] 17 Correo al cancelar la renovación (dueño o Stripe)
- [x] 18 Socio con topes de Pro (el descuento Socio sigue en la factura mensual, no en el pago en línea)
- [x] 19 Reactivar avisa si la renovación con tarjeta quedó cancelada
- [x] 20 Recordatorios de renovación a los dueños actuales
- [x] 21 Franja en la app: plan por vencer/vencido y cargos pendientes
- [x] 22 Mi cuenta: cambiar contraseña y cerrar las demás sesiones
- [x] 23 Enlace vencido → «Envíame un enlace nuevo» (al correo de la cuenta)
- [x] 24 Tope diario de Regenta IA por droguería (300)
- [x] Detalle: pago aprobado de una droguería eliminada ya no ofrece «Crear su cuenta»
- [x] BUG previo: cargar numeración DIAN desde la consola daba 500 (integer vs bigint) — corregido y cubierto por ingresos.mjs
- [x] 027 aplicada en producción; desplegado ea3626f y verificado en vivo (consola: cargos, devoluciones, alerta sin habilitar; /api/activar/nuevo 200; /api/cuenta sin sesión 401; webhook 400)
- [x] Suite completa: endpoints 1085 · todos los e2e 0 fallos (incluye ingresos.mjs y consola-clave.mjs) · auditoría 160 · unitarias 36 + 22
- [x] Portada y Tarifas: sección «¿Ya tienes programa? Cámbiate sin detener la caja» (3 pasos reales) + preguntas frecuentes del cambio (con FAQPage)
- [x] SEO: Search Console verificado (geekxmedia@gmail.com; etiqueta de la otra cuenta también puesta), sitemap enviado (44 URL), indexación pedida de la portada; guía «cambiar-software-drogueria» alineada con la promesa nueva y enlazada desde la sección

## 04/11/2026 · Avisos internos a la gerencia
- [x] Plantilla `aviso_interno` (sin enlaces de acceso ni llaves) y `avisar()` en la cola de correos
- [x] Todo correo transaccional a un cliente genera su aviso a la gerencia (registro, activación, pagos, renovaciones, suspensiones, DIAN…)
- [x] Aviso de cada solicitud de demo (también sin correo) y de cada intento de compra (QR, Wompi, Stripe), al instante
- [x] Pruebas: correos 28/28, embudo 38, pagos 33, ingresos 51, endpoints 1085, unitarias 36+22
- [ ] Oscar: desplegar en Netlify (Deploys → Trigger deploy)

## 06/11/2026 · Bloque 1 de la auditoría del droguista (cumplimiento y control)
Reparto en 3 frentes paralelos (cada uno en su rama, su base local y su puerto); el menú y el despliegue los integra el hilo principal.
- [x] A · Inventario (migración 028): ajustes y bajas con motivo + acta de baja imprimible; kardex por producto; conteo físico (toma de inventario) con diferencias y ajuste en un clic — base local regenta_a, puerto 4501
  - [x] 028_conteos.sql: ajustes + ajuste_lineas (consecutivo por empresa, inmutables), registrar_ajuste() sobre registrar_entrada (tipo 'ajuste'), conteos + conteo_lineas (abierto/cerrado, uno abierto por sede, cerrado inmodificable por trigger), iniciar/contar/cerrar_conteo (cierre = un solo ajuste «Diferencia de conteo» en la misma transacción), kardex() con saldo acumulado; RLS con mis_empresas(); el costo se lee de lote_costos (solo gerencia)
  - [x] API: /api/inventario/lotes, /ajustes, /kardex (JSON y CSV), /conteos, /conteos/[id], /conteos/[id]/cerrar (permiso antes que datos; cajera 403)
  - [x] Pantallas: Inventario → «Ajustar o dar de baja» (+ historial por motivo), acta imprimible /inventario/actas/[id], «Conteo físico» (lista, contar en celular, cerrar), informe imprimible; ficha del producto → Kardex con filtros y CSV
  - [x] Pruebas: db.test (ajuste, conteo, kardex cuadra), e2e inventario-control.mjs, endpoints.mjs con las rutas nuevas, regresión caja/gestion/devoluciones/operacion, capturas 1440 y iPhone 13
  - [x] Resultado (build de producción en :4501, base recién sembrada): npm test 41 + 22 · inventario-control 78 · endpoints 1226 · caja 22 · gestion 88 · devoluciones 15 · operacion 9, todo en 0 fallos; migración probada también como en Supabase (sin superusuario): anon sin acceso, authenticated solo lee y ejecuta las funciones públicas, aplicar_ajuste interna
- [x] B · Cumplimiento (migración 029): pantalla Documentos electrónicos (facturas, POS y notas crédito con estado DIAN, filtros, reenvío, XML/PDF); planilla de temperatura y humedad (registro diario, fuera de rango, informe mensual imprimible) — regenta_b, 4502
  - [x] /documentos (dueño/admin): POS, facturas y notas crédito (anulación/devolución) con estado DIAN, motivo del rechazo, filtros, búsqueda, contadores que filtran, reenvío (uno o todos), CSV, CUFE/CUDE con consulta DIAN, PDF si el proveedor lo entrega; índice documentos_empresa_creado
  - [x] /temperatura (dueño/admin/bodega): registro por jornada y área, alerta y acción obligatoria fuera de rango, corrección sin borrar, rangos por droguería, planilla del mes con faltantes; /informes/temperatura imprimible; CSV
  - [x] Pruebas: tests/e2e/cumplimiento.mjs, 2 pruebas nuevas en db.test.mjs, rutas nuevas en endpoints.mjs
  - [ ] Sin XML guardado: la descarga masiva de XML queda pendiente hasta guardar el XML que devuelve el proveedor
- [x] C · Control especial (migración 030): marca de control especial / venta con fórmula en el producto; la caja pide paciente, médico y fórmula; libro de control especial exportable — regenta_c, 4503
  - [x] Marcas en ficha, alta, listado e importación Excel (sí/no/x/1, «condición de venta»); auditoría del cambio de marca
  - [x] Caja: panel de fórmula (control: paciente, médico, registro, n.º y fecha vigente según el plazo de la droguería; con fórmula: confirmación), F9 lleva al dato que falta, sin internet se bloquean los que exigen datos (catálogo local v2 con marcas)
  - [x] Servidor: API valida (400) y la base exige el registro al confirmar (restricción diferida); la fórmula solo entra con su venta; venta_formulas inmutable y visible solo a gerencia
  - [x] /control-especial: dispensaciones y reintegros (anulación/devolución), saldo por producto, filtros, CSV, informe imprimible (/control-especial/informe), ajustes (vigencia, exigir datos); enlaces desde Productos y Reportes; ZIP de datos con el libro
  - [x] Pruebas: db 42/42 · unitarias 25/25 · e2e control-especial 0 fallos · caja, descuentos, devoluciones, sin-conexion, facturacion 0 fallos (build de producción) · endpoints 1124 (1 fallo ajeno: sin REGENTA_CRON_KEY)
  - [x] Integración: enlace en el menú (Navegacion) y migración 030 en Supabase (con autorización de Oscar)
- [x] Integración: menú agrupado (Vender · Inventario · Cumplimiento · Gestión), typecheck, npm test 74/74, e2e 21/21 suites sin fallos (1323 comprobaciones de endpoints, 160 pantallas auditadas); migraciones 028–030 aplicadas en producción con autorización de Oscar (06/11/2026); un solo despliegue

## 06/11/2026 · Correcciones del Bloque 1 (revisión independiente) — migración 030a
- [x] Conteo físico: lo vendido después de contar un lote no vuelve al inventario al cerrar (existencias al contar por línea)
- [x] Cierre de conteos sin tope de lotes; anular un conteo abierto (dueño o administrador, con motivo)
- [x] Bloqueo compartido al contar: un conteo que se cierra no recibe líneas nuevas
- [x] Consola: eliminar droguerías de prueba con ajustes, conteos, temperatura y fórmulas
- [x] Temperatura: fecha de Bogotá; el informe muestra la hora real y marca los registros atrasados
- [x] Kardex por la empresa del producto; baja «Vencido» solo con lote vencido; idempotencia de ajustes; aviso de una venta por fórmula
- [x] Pruebas: npm test 80/80 · e2e 21/21 suites sin fallos (1345 comprobaciones de endpoints, 160 pantallas)
- [x] 030a aplicada en producción con autorización de Oscar (06/11/2026); un solo despliegue
- [x] Conteo a ciegas y rangos de temperatura fijos en la demo compartida (038, en producción 06/11)
- [ ] Pendiente bajo: paginación de ajustes y conteos antiguos

## 06/11/2026 · Bloque 2 (compras, mostrador, cuentas de clientes)
Tres frentes en paralelo (2-A regenta_2a :4511, 2-B regenta_2b :4512, 2-C regenta_2c :4513); integración en `bloque2-integracion` (regenta_2int, :4520).
- [x] A · Compras (031): proveedores ampliados, compras con costo sin IVA, bonificadas y promedio ponderado, recepción de la bodega sin costos, pagos a proveedores (también desde la caja), devoluciones y notas crédito, cuentas por pagar con CSV; /compras, /proveedores, /cuentas-por-pagar, tirilla de recepción
- [x] B · Mostrador (032): cantidad tecleada y «12*», venta en curso que sobrevive a recargar, ventas en espera (F4/F6), domicilios, cotizaciones imprimibles, rol vendedor (arma pedidos, no cobra)
- [x] C · Cuentas de clientes (033): cupo, plazo, bloqueo y mora por cliente; la cajera fía dentro del cupo; la gerencia autoriza con motivo (auditoría); recibos de caja por turno; cartera por cliente con edades y CSV; estado de cuenta
- [x] Integración: una sola lógica de venta (src/lib/venta-servidor.ts) para /api/ventas y para cobrar pedidos (cupo, fórmula, turno, idempotencia idénticos)
- [x] Integración: crédito en la caja según GET /api/clientes/[id]/credito (la cajera ve «Crédito» dentro del cupo; motivo escrito en la pantalla cuando la gerencia se pasa; motivo en español si no se puede)
- [x] 033a: eliminar_empresa_prueba borra compras, pagos y devoluciones a proveedores, pedidos y recibos (la versión 030a fallaba por pagos_proveedor → movimientos_caja); recibos borrables solo desde la consola
- [x] Menú: Pedidos (Vender), grupo Compras (Compras, Cuentas por pagar), vendedor solo con Inicio y Pedidos; Equipo con rol Vendedor; exportar con recibos, proveedores, compras, pagos, devoluciones, cuentas por pagar y pedidos; robots
- [x] Pruebas: endpoints y auditoría con las rutas y pantallas nuevas (incluido el vendedor); mocks de IA y Wompi con puerto configurable (IA_MOCK_PUERTO, WOMPI_MOCK_PUERTO)
- [x] SQL de producción db/produccion/bloque2-031-033a.sql probado de una pieza como rol sin superusuario sobre una copia hasta 030a
- [ ] Oscar: aplicar bloque2-031-033a.sql en Supabase y desplegar (un solo despliegue)
- [ ] Pendiente: el vendedor de la demo (la demo no trae uno); proveedores no tienen entrada propia en el menú (se llega desde Compras y Cuentas por pagar)

## 06/11/2026 · Bloque 2 en producción
- [x] 2-A Compras, proveedores, cuentas por pagar y devoluciones a proveedor (031)
- [x] 2-B Mostrador: cantidad tecleada, venta en espera F4/F6, domicilios, cotizaciones, rol vendedor (032)
- [x] 2-C Fiado con cupo, recibos de caja, cartera por cliente, abonos por turno (033)
- [x] Integración: una sola lógica de venta, crédito en la caja, 033a (eliminar droguerías de prueba con las tablas nuevas), menú y permisos
- [x] Guardia de navegación (clics que el enrutador dejaba colgados) y /favicon.ico
- [x] Pruebas: npm test 96/96 · e2e 24/24 suites sin fallos (1821 comprobaciones de endpoints, 248 pantallas) · suites nuevas 3 veces seguidas
- [x] 031–033a aplicadas en producción con autorización de Oscar (06/11/2026); un solo despliegue
- [x] Bloque 3: resultados y ganancia corregida, gastos, auxiliar de IVA, bitácora; DIAN complementaria (documento soporte, nota débito, XML); precios masivos, códigos alternos, etiquetas y cuarentena (ver «06/11/2026 · Bloque 3»)
- [x] Cotizaciones con las iniciales de la droguería (decisión de Oscar, 06/11/2026: sin logo)

## 06/11/2026 · Bloque 3
Tres frentes en paralelo (3-A regenta_3a, 3-B regenta_3b, 3-C regenta_3c); integración en `bloque3-integracion` (regenta_3int, :4540).
- [x] A · Resultados (034): gastos G-n inmutables (anular con motivo; en efectivo salen del turno), utilidad sin IVA y neta de devoluciones (lotes sin costo aparte, costo heredado marcado) en Reportes, Resultados e Inicio; /reportes/resultados, /reportes/iva, /reportes/cierre, /gastos, /bitacora
- [x] B · DIAN complementaria (035): documento soporte por operación o semanal, nota de ajuste, nota débito, XML guardado (uno o ZIP), /documentos con los tipos nuevos; envío real apagado por droguería hasta activarlo en la consola
- [x] C · Precios y lotes (036): códigos alternos (caja, búsqueda, sin internet v3, importación), cambios de precio en bloque con vista previa firmada y reversión, etiquetas EAN-13/Code 128 (A4 y rollo), cuarentena (poner, liberar, baja) y destino de las devoluciones
- [x] Integración: 036a (eliminar droguerías de prueba con todo el bloque; arregla el orden de devoluciones que fallaba desde 033a; numeraciones de prueba DSSE/NASE/NDSE para la demo), menú (Gastos, Bitácora, Precios en bloque, Etiquetas, Cuarentena; marca activa sin duplicados), exportar, robots, siembra, endpoints y auditoría
- [x] Regenta IA: ventas netas de devoluciones, como Reportes
- [x] React 418 intermitente en actas, tirillas e informes: loading.tsx en tiquete, informes y control-especial (0 de 800 visitas)
- [x] SQL de producción db/produccion/bloque3-034-036a.sql probado de una pieza como rol sin superusuario sobre una copia hasta 033a con demo
- [x] Producción 06/11: 034–036a aplicadas en Supabase (hash d5c1f65d…, 4 migraciones registradas, 6 tablas nuevas, anon sin permisos, 1293 ventas intactas) y publicado en main
- [x] Farmagenéricos: inventario de Alegra importado en producción (127 productos, 6.822 und, $30.451.101 a costo). Sin costo, por revisar: Ultra Fer (Alegra 300), Amoxicladelt 1000 (3.500), Loperamida 2mg x6 (2.390 > precio 1.980)
- [ ] Regenta IA en producción responde «mantenimiento» (401/crédito): recargar créditos en console.anthropic.com
- [x] Auditoría 06/11: revisión de seguridad independiente (0 críticos/altos; 2 medios y 3 bajos corregidos), 27 suites e2e + 2.259 comprobaciones de endpoints + 88+30 pruebas de base en verde, matriz de 10 equipos (730 pantallas) sin fallos tras arreglos; 037 aplicada en producción
- [ ] Segundo factor (TOTP: Google Authenticator/Authy + códigos de respaldo) para la consola de administración: Oscar lo quiere en ~1 semana (pedido 06/11)
- [ ] Oscar: aplicar bloque3-034-036a.sql en Supabase y desplegar (un solo despliegue)
- [ ] Pendiente: activar el envío real de documento soporte y nota débito en MATIAS por droguería (consola) tras probar en su sandbox; la consola (/admin) sigue sin loading.tsx (no se midió 418 allí)

## 08/11/2026 · Consola: quién entra a la demo, desde dónde y qué hace (pedido de Oscar)
- [x] SQL 039: demo_visitas (ubicación aproximada por IP de Netlify a nivel ciudad, dispositivo, origen, rol, lead) + demo_eventos; IP solo como hash
- [x] Origen de la visita (utm, gclid, referente y primera página) en cookie de primer contacto; POST /demo crea la visita y su cookie
- [x] /api/demo/evento: páginas, ventas, preguntas a la IA (primeros 200 caracteres), ofertas, clics a Contratar y WhatsApp
- [x] Datos de contacto dentro de la demo (formulario corto en la oferta) → solicitudes_demo + visita
- [x] Consola /admin/demo: cifras (7 y 30 días), por ciudad, dispositivo y origen; lista de visitas; detalle con la línea de tiempo
- [x] Privacidad: explicar la analítica de la demo; conservación 12 meses
- [x] Prueba e2e demo-visitas + batería afectada (embudo, admin, ia); build; preview; publicar
- [ ] Oscar: aplicar db/produccion/bloque4-039.sql en Supabase (sin él la consola avisa y la demo funciona igual)
- [ ] Comprobar en producción que Netlify entrega la ciudad (cabecera x-nf-geo) en la primera visita real

## 08/11/2026 · Compras desde la factura del proveedor (XML/ZIP de la DIAN, PDF o foto) — pedido de Oscar
Objetivo: el proveedor manda la factura → Regenta arma la compra sola (proveedor, número, CUFE, productos, lote, vencimiento, cantidades, costo, IVA) y la persona solo revisa y guarda. Sin romper el flujo actual de Nueva compra.
Muestras de Oscar: ZIP de Distribuidora Pasteur (resultó ser una NOTA CRÉDITO de descuento, no una factura) y foto de un tiquete POS de Farmagenéricos (Alegra) con «(FECHA VENCIMIENTO: dd/mm/aaaa)(LOTE: …)» dentro de la descripción.
- [x] Lector puro (src/lib/factura-proveedor.ts, sin dependencias): ZIP (inflateRaw de Node), AttachedDocument → Invoice/CreditNote/DebitNote, proveedor y NIT, número, fecha, CUFE, líneas (código, descripción, cantidad, precio, descuento, IVA), totales; lote y vencimiento desde campos UBL (LotIdentification) o desde la descripción
- [x] Notas crédito/débito: se reconocen y NO cargan inventario (aviso claro)
- [x] La factura debe ser para esta droguería (NIT del comprador) — aviso si no coincide
- [x] Emparejar con el catálogo: código de barras/alterno → lo aprendido de ese proveedor → nombre (puntaje); si no hay certeza, la persona elige (nunca se adivina en silencio)
- [x] Memoria por droguería y proveedor (SQL 040: proveedor_productos) que se guarda al registrar la compra: la próxima factura sale emparejada sola
- [x] Foto o PDF: Regenta IA (visión) devuelve el mismo formato; la imagen se reduce en el navegador antes de subir; con tope diario por droguería
- [x] Archivo original guardado en el espacio privado de la droguería (SQL 040: compra_archivos, RLS por empresa, 12 MB máx.) y enlazado a la compra
- [x] Bodega: recibe productos/lotes/cantidades sin costos (como hoy)
- [x] UI en Nueva compra: «Cargar desde la factura» (archivo o cámara) → rellena el formulario existente; líneas por emparejar con buscador; avisos de vencidos y de diferencias
- [x] Regenta IA: herramienta de costos por proveedor (quién vende más barato cada producto) con los datos de las compras
- [x] Pruebas: unitarias del lector (ZIP real de Pasteur + factura de prueba), e2e de compras desde XML y foto (IA simulada), endpoints, dispositivos; batería completa

- [ ] Consola: React 418 intermitente (1 vez en ~750 pantallas, /admin/clientes en iPhone 15 Pro Max). Arreglo: exigir la sesión en src/app/admin/layout.tsx (fuera de Suspense) y luego loading.tsx; probar admin, consola-clave, demo-visitas y bucle de 400 visitas
- [x] SQL 040 aplicado por Oscar en Supabase (Success, 08/11 15:37); publicado en main (8c9c828 y 3288165)
- [x] Comprobado EN VIVO en regenta.pro (demo, dueño): XML leído en 0,5 s con lote/vencimiento y producto encontrado; foto leída por la IA real de producción en 7 s, 2 líneas, proveedor, NIT, número, total, lotes y vencimientos exactos
- [ ] Oscar: probar con una foto real de una factura en papel y con ZIP de otros proveedores (además de Pasteur)
- [ ] UX demo: el panel «Pruébalo en 3 minutos» abierto tapa los botones de «Cargar desde la factura» en pantallas bajas de PC (se puede minimizar)
- [x] SQL 041 aplicado por Oscar (09/11 10:11) y comprobado EN VIVO: «PRUEBA-657246» registrada; «PRUEBA 657246» y «PRUEBA657246» rechazadas (409). Compra de prueba anulada.
- [x] Comprobado EN VIVO con IA real: ZIP de AXA (24/24 lotes del PDF), Zanecol (4/4), Allers y Pasteur; fotos de Zanecol, AXA (pág. 1) y tiquete real: todas las líneas exactas.
- [ ] Fotos de Pasteur y Allers con la IA real (tope de 5 lecturas/día en la demo agotado el 09/11)

## 09/11/2026 · Auditoría extrema: lo que queda (decisiones y funciones nuevas)
Decisiones de Oscar (contenido público y legal; no se toca sin su visto bueno, regla SEO):
- [ ] Promesa de facturación DIAN activa (portada, tarjeta SETT1024, franja ✓ DIAN, /demo/gracias, guía de los 12, términos §4) mientras MATIAS no esté habilitado.
- [ ] Plan Cadena «varias sedes» frente a «una sede por cuenta».
- [ ] «Comparativa con fuentes» sin fuentes; «revisamos 15 programas» sin lista.
- [ ] Términos/privacidad: quién cobra con Stripe (IA DEV INVESTMENTS LLC) frente a la S.A.S.; Wompi y transferencia internacional en la política de datos.
- [ ] /funciones lista las 15 páginas; «seis medios de pago» (son siete); pedido sugerido «cuánto tarda tu proveedor» frente a 3 días fijos; quién carga los productos en Esencial; títulos SEO con y sin «| Regenta»; precio a mano en la guía de precios.
Funciones nuevas (no son arreglos de una línea):
- [ ] Nota crédito de proveedor sin devolución (descuento o precio) y sobre facturas ya pagadas.
- [ ] Recibir una factura en partes (la bodega recibe 2 de 18 líneas) y completar después.
- [ ] Precargar costos al costear una compra de la bodega desde el XML guardado.
- [ ] Nota débito en la cartera del cliente.
- [ ] Venta sin internet sin existencias al sincronizar: hoy queda con aviso y acciones en la caja; falta avisar al dueño.
- [ ] Reinicio programado de la demo pública (datos de visitantes) o demo en base aparte.
- [ ] Revisar vigente_desde de la numeración y vencimiento de la numeración de notas crédito en anular/devolver.
- [ ] Confirmar con MATIAS si resolution_number es opcional en las notas (ya no se exige en Regenta).
- [ ] Verificación en dos pasos de la consola: hecha y probada, APAGADA por decisión de Oscar (09/11/2026). Se enciende con la variable REGENTA_ADMIN_DOS_PASOS=1 en Netlify.

## 09/11/2026 · Habilitación DIAN desde la consola (MATIAS)
- [x] Certificado Viafirma recibido (IA DEV, 09/11/2026–08/11/2028); el .p7b no firma: Oscar sube el .p12 en MATIAS con su contraseña
- [x] Consola → cliente → «Habilitación DIAN en MATIAS»: certificado, software (factura, documento soporte, POS), set de pruebas, estado, numeraciones de la DIAN
- [x] Cuenta principal: el cliente con el NIT de la casa de software (Farmagenéricos) emite sin client_uuid; bloqueado para otros NIT (consola, PATCH y emisión)
- [x] Pruebas: habilitacion.mjs (MATIAS simulado, 30), matias.test (destino), endpoints, admin, ingresos
- [x] .p12 en MATIAS; DIAN «Software propio» Regenta (2f505ac7-…, PIN 92380, TestSetId 6711feeb-…); set de pruebas superado → producción (09/11/2026)
- [x] Resolución 18764118389325: FGE 1–50.000, 24 meses; asociada a Regenta en la DIAN; sincronizada en MATIAS con su clave técnica
- [x] Regenta (Farmagenéricos): factura FGE y nota crédito NCF en producción; «Emite ante la DIAN»
- [x] Primera factura real FGE1 aceptada (09/11/2026)
- [ ] NCF1 rechazada por falta de resolution_number: corregido (nota lleva la resolución del original + resolución de notas en MATIAS); publicar, «Configurar las notas en MATIAS» y reenviar NCF1
- [x] Farmagenéricos solo factura (decisión de Oscar 09/11/2026): la caja no ofrece POS y el servidor lo rechaza mientras el POS esté en pruebas
- [ ] Idea UX: botón «Consumidor final» (CC 222222222222) en el cliente de la factura

## 09/11/2026 · Migración Alegra → Regenta (Farmagenéricos) — pedido de Oscar
Decisiones de Oscar: «Alegra manda» en existencias; el historial entra solo para consulta.
Extraído de Alegra (MCP, en paralelo): 872 productos de la bodega FARMAGENERICOS (144 con existencias: 8.670 unidades,
$51.881.934 a costo), 267 contactos, 2.146 documentos (1.035 son de FARMAGENERICOS: POSF + FA1; los POSD y 2 FA1 son de
FARMAHUB AMBALA y no se migran). Cartera de Farmagenéricos: 6 facturas por $3.993.462 (la FA11728 de $8.000 es de Ambala).
- [x] Migración 043: ventas_externas (historial), ventas.origen/externo_id (cartera de Alegra sin caja ni DIAN, no se
      anula), clientes.direccion/ciudad, productos.externo_id
- [x] POST /api/admin/clientes/[id]/migracion (simular/aplicar, por partes, repetible) + pantalla en la consola
- [x] Existencias exactas: lotes nuevos como inventario inicial con costo (vencidos como ajuste), sobrantes en cero con
      un ajuste numerado, comprobación final producto por producto dentro de la transacción
- [x] Historial de Alegra (/ventas/historial y detalle), enlace en Ventas y en la ficha del cliente; informes, inicio,
      ventas del día y Regenta IA excluyen lo de Alegra
- [x] tests/e2e/migracion.mjs con los datos reales convertidos
- [x] Batería completa en verde (32 suites + migración 42/42 + habilitación 35 + unitarias 88+52; solo-factura dependía de la fecha de la demo: corregida)
- [x] Oscar pegó bloque4-043.sql (Success) → publicado en main (a079394) → aplicado desde la consola el 10/11/2026:
      254 clientes nuevos + 1 igual, 6 proveedores, 745 productos nuevos + 127 existentes (por nombre), 17 lotes entran,
      2 ajustados (TAPA BOCAS 49→54, ULTRA FER 343→323), 8.670 unidades, $51.881.934 a costo, 1.035 documentos al
      historial, 6 facturas a cartera por $3.993.462. Segunda simulación: todo «sin cambios» (idempotente)
- [x] La consola decía «Migración aplicada» al volver a simular: corregido (sale en el próximo despliegue)
- [x] Corregir lotes (pedido de Oscar): migración 044 corregir_lote (código y fecha, motivo, auditoría, sin tocar existencias;
      el código de un lote con alerta INVIMA no cambia) + PATCH /api/inventario/lotes/[id] + /inventario/lotes con la lista de
      vencidos con existencias; tests/e2e/lotes-corregir.mjs 25/25
- [x] Oscar pegó bloque4-044.sql (Success) → publicado en main (e57fb99) → en producción la ruta nueva responde (401 sin sesión)
- [ ] Intermitente: tras una baja, el historial de /inventario/ajustes a veces no se refresca sin recargar (1 de 3 corridas; router.refresh del App Router)

## 10/11/2026 · Factura carta, Excel, historial y clientes completos (pedidos de Oscar)
- [x] Refrescos garantizados (useRefrescar + MarcaRender) en las 15 pantallas que guardan y refrescan: 0 de 60 fallos (antes 2 de 20)
- [x] Factura en tamaño carta /tiquete/factura/[id]: logo, cliente completo, una fila por producto con sus lotes, totales por tarifa, valor en letras, CUFE/QR; una hoja carta
- [x] Caja: la factura sale en carta por defecto (preferencia por caja: carta o tirilla), F8, «Imprimir también la tirilla», «Ver la factura»; detalle de venta y Documentos llevan a la carta
- [x] Logo de la droguería (migración 045): dueño en «Mi droguería», soporte en la consola; PNG/JPG/WebP reducido; SVG no; la demo no
- [x] Inventario en Excel (.xlsx, hoja de productos y de lotes; costos solo para gerencia) y paginación de 100 con «N a M de T»
- [x] Historial de Alegra como informe: rango de fechas, resumen, por mes, productos y clientes, paginación y Excel; tarjeta en Ventas e Informes
- [x] Clientes: compras de Regenta + Alegra, ciudad, paginación (antes 0 compras y corte en 200)
- [x] Pruebas: factura-carta.mjs 39/39, migracion.mjs 54/54, letras unitaria
- [x] Oscar pegó bloque4-045.sql → publicado (a31b110) → logo de Farmagenéricos subido desde «Mi droguería» → comprobado en producción:
      FGE1 en carta con logo, QR y CUFE; clientes 255; historial $589.660.131 / 1.035 doc.; cartera $3.993.462; Excel 200;
      inventario 413 activos (los 474 inactivos de Alegra quedan retirados, como en Alegra)
- [ ] Factura carta: «1 unidad» en singular (corregido en la rama; sale con la próxima publicación)
- [ ] POS electrónico de Farmagenéricos: falta su habilitación DIAN (set de pruebas POS); mientras, la caja solo factura

## 10/11/2026 · Revisión independiente (3 revisores) — migración 046
- [x] Código: índice ventas por cliente, formato de factura por droguería, bodega no revive vencidos, historial solo gerencia,
      fechas imposibles, cartera sin pérdidas silenciosas, factor de caja en migración, Alegra fuera de métricas, calidades tributarias
- [x] UX: régimen de IVA de la venta, QR desde el CUFE, saldo de Alegra neto de abonos, vencidos ≠ agotados, estado DIAN real,
      recibo de caja desde Cartera, aviso sin turno, 404 en español, deuda en ámbar, sin «Genérico», ticket promedio igual
- [x] Adversarial: pagos en Alegra al repetir migración, middleware para parámetros repetidos, UUID estricto, soporte en la
      auditoría sin RLS, lote original en factura, IVA por tarifa que suma, colores al imprimir, logo por bytes, lotes visibles
- [x] Consola con loading.tsx y acceso en el layout (0 errores 418 en 450 visitas)
- [x] Batería final en verde: 36 suites + 322 pantallas + 748 en 10 equipos + 2.497 endpoints + migración 56 + habilitación 35 + unitarias 141
- [ ] Oscar: confirmar si MATIAS figura como proveedor tecnológico (art. 11 num. 18 Res. 165/2023) para ponerlo en la factura
- [ ] Oscar pega bloque4-046.sql → publicar → poner Farmagenéricos en factura «carta» (046 deja «tirilla» a las existentes)
- [ ] Pendientes de UX no bloqueantes: tablas como tarjetas en celular (cartera/clientes), paginación con números, menú
      «Mi droguería/Salir» fijo abajo, pasar todas las descargas CSV a Excel


## 10/11/2026 · POS electrónico de Farmagenéricos + pendientes de UX (pedido de Oscar)
- [x] Nombre en la factura: ya sale «Software: Regenta · Fabricante: IA DEV INVESTIMENTS COLOMBIA S.A.S. · NIT» (art. 11 num. 18 y
      art. 19 num. 10 Res. 165/2023); MATIAS no va (software propio, sin proveedor tecnológico: «si lo tuviere»)
- [x] DIAN habilitación → Documentos equivalentes → Software propio «Regenta POS» (ID 3d3b74bd-…, PIN 77433, TestSetId f4139e2f-…)
- [x] Registrado en MATIAS (software 5066, tipo 4) y set de pruebas iniciado
- [x] Set de pruebas superado → producción (DIAN «Sincronizar a Producción» si hace falta)
- [ ] Numeración POS de producción (MUISCA / la POSF de Alegra) asociada a Regenta POS → «Traer numeraciones» → resolución en Regenta
- [ ] Caja de Farmagenéricos ofrece POS + factura; prueba real de un POS
- [x] Descargas CSV → Excel (.xlsx) en todas las pantallas
- [x] Paginación con números de página
- [x] Menú: «Mi droguería / Salir» fijos abajo
- [x] Tablas como tarjetas en el celular (cartera, clientes…)
- [x] Pruebas: 13 suites + dispositivos 748 + auditoría 322 + caja, seguridad, solo-factura, migración 69: todo en verde → publicado (cab9336) y comprobado en producción (Excel de cartera, documentos, inventario; paginación y menú)
- [x] MUISCA: numeración NUEVA del POS (decisión de Oscar): solicitud 20334824 → resolución 18764118426208, FGP 1–50.000, POS electrónico, establecimiento Farmagenéricos (10/11/2026). El menú da una página de error y un aviso del RUT: se entra por «Solicitar Numeración de Facturación» y «Aceptar»

## 10/11/2026 · Guía de usuario (PDF) y video formativo (pedido de Oscar)
- [x] Capturas reales paso a paso (droguería de ejemplo «Droguería San Rafael», es-CO), 19 capítulos, 60 pasos
- [x] Revisión independiente del guion contra el código: 18 hallazgos corregidos (roles, buscador, turno ciego, pago mixto, crédito con cupo, devolver/anular solo gerencia…)
- [x] PDF A4 de 43 páginas; video 13:42 con voz es-CO (Salomé), subtítulos y zoom; audio normalizado
- [x] Correo de contraseña nueva: nombra «¿Olvidaste tu contraseña?» como en pantalla
- [ ] Publicar el arreglo del correo con la próxima publicación

## 11/11/2026 · Reportes con datos reales + precio editable en caja (Oscar: «ganancia −561 millones», «las ventas de ayer no salen en el buscador por fecha»)
Causa raíz: el lote inicial de «kennedy bajalenguas caja x 500» se creó con costo por unidad = $31.280 (costo de la caja); 18.000 unidades vendidas × $31.280 = −$562 M. El historial con fechas solo busca Alegra.
- [x] Reportes/Resultados/Inicio: costo «por revisar» (costo por unidad > 3 × precio vendido sin IVA) fuera de la utilidad y aviso con corrección en el sitio
- [x] Corregir el costo de un lote sin compra (dueño/admin, motivo, auditoría); con compra, se corrige en la compra
- [x] Unidades del reporte por producto en cajas + unidades
- [x] Formulario de producto: costo por caja cuando se cuenta en cajas; aviso y bloqueo (cliente y servidor) de costo por unidad que no cuadra con el precio
- [x] Historial por fechas: también las ventas de Regenta
- [x] Caja: cambiar el precio de una línea antes de cobrar (y descuentos visibles)
- [x] Pruebas: reportes-costos 23, reportes 19, resultados 88, descuentos 7, producto-lote 24, caja 22, mostrador 79, migración 69, factura-carta 45, sin-conexión 15, auditoría 322 pantallas, gestión 88, endpoints 2.497: 0 fallos
- [x] Publicado (994661f) y visto en producción: aviso de costos, ganancia $246.947
- [x] Totales del rango = Regenta + Alegra (vendido, ventas, IVA, días, medios, productos); reportes-costos 26, reportes 19, resultados 88, migración 69, auditoría 322, endpoints 2.497: 0 fallos
- [ ] Publicar y verificar

## 11/11/2026 · ¿Está TODO Alegra en Regenta? (Oscar va a dar de baja Alegra) — sin nada de Farmahub (Oscar: «datos de Farmahub no deben estar jamás»)
- [x] Hallazgo: las 33 notas crédito no se migraron → el historial contaba $589.660.131; real $321.680.623 (32 facturas anuladas, entre ellas Alkosto $257,9 M, y 4 devoluciones parciales por $387.991)
- [x] Migración 047 (devuelto + notas en ventas_externas; Oscar la aplicó: Success) + API de migración con notas y plazo del cliente; historial, detalle, Excel, clientes, ventas y reportes netos de notas
- [x] POSF1035 (09/11, $2.500) que faltaba; clientes 255 + 1 (todos los de Farmagenéricos), proveedores 7, productos 872: completos
- [x] Publicado y aplicado en producción (consola): 33 ventas actualizadas + POSF1035 nueva; repetido en simulación: 34 «ya estaban» (sin cambios); Maria Alcira Diaz con 30 días (repetido: «iguales»)
- [x] Copia completa de Alegra en Excel enviada: 1.036 ventas, 8.191 líneas, 33 notas, 258 clientes, 8 proveedores, 872 productos, 1.085 pagos, 163 egresos, 2 compras, 5 cajas; sin nada de Farmahub
- [x] AZITROMICINA (DELTAZITROM): ajuste N.º 2 en producción (−1, motivo POSF1035): 544 = Alegra
- [x] Saludo de inicio para Carlos Ñustes (por su correo), publicado 65dc4fd
