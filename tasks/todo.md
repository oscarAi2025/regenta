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
- [ ] B · Cumplimiento (migración 029): pantalla Documentos electrónicos (facturas, POS y notas crédito con estado DIAN, filtros, reenvío, XML/PDF); planilla de temperatura y humedad (registro diario, fuera de rango, informe mensual imprimible) — regenta_b, 4502
- [ ] C · Control especial (migración 030): marca de control especial / venta con fórmula en el producto; la caja pide paciente, médico y fórmula; libro de control especial exportable — regenta_c, 4503
- [ ] Integración: menú (Navegacion), inicio con tareas, typecheck, npm test, e2e completos y auditoría de pantallas en local; migraciones 028–030 a producción con autorización de Oscar; un solo despliegue; verificación en vivo
