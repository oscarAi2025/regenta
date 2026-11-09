# Lecciones Regenta

- (1/11/2026) Postgres devuelve los date como Date de JS y al serializar se corren de día por la zona horaria: en las API, castear a ::text las fechas que viajan al navegador.
- (1/11/2026) Un proceso lanzado con pg_ctl/& desde la shell muere al terminar la orden: el Postgres y el servidor de pruebas se lanzan como tarea en segundo plano.
- (1/11/2026) GRAVE, encontrado al sembrar un lote vencido: registrar_venta tomaba por FEFO también lotes vencidos (el vencido es «el que vence antes»). Regla: toda consulta de existencias vendibles filtra `vence is null or vence >= current_date`; hay prueba de base de datos que lo exige.
- (1/11/2026) Antes de afirmar en la web «único/primero» se investiga la competencia con fuentes: «única con IA» era falso (Más Control «Conti IA», Farmatízate con pedido sugerido). Lo que sí se sostiene se dice con precisión.
- (1/11/2026) Al cambiar la siembra, las pruebas que asumían «exactamente 2 lotes» se rompieron: las pruebas comparan los mismos lotes por id, no por posición.
- (1/11/2026) pg devuelve bigint como texto: un id bigint que viaja al navegador y vuelve a una API con z.number() falla. Castear a ::int en la consulta (si cabe) o usar z.coerce en la API.
- (1/11/2026) `x not in (...)` con x NULL es NULL y el IF no salta: en controles de permiso usar `coalesce(rol_en(..), '') not in (...)`. La revisión independiente lo encontró: la anulación entre empresas era posible.
- (1/11/2026) Un GET que crea sesión es CSRF de inicio de sesión: las entradas a la demo son POST con verificación de Origin y nunca reemplazan una sesión real.
- (1/11/2026) `current_date` depende de la zona del servidor de base de datos (Supabase = UTC): fijar America/Bogota en la base y en la conexión.
- (1/11/2026) En plpgsql, un alias de SQL con el mismo nombre que una variable (ln) es «ambiguo»: usar alias distintos en las consultas dentro de funciones.
- (1/11/2026) pg.Pool sin `pool.on("error")` tumba el proceso cuando la base cierra conexiones inactivas (lo vimos al reiniciar la base con el servidor arriba). Siempre registrar el manejador.
- (1/11/2026) Oscar pidió logos de la DIAN y de superintendencias como respaldo: no se ponen logos de entidades sin aval (sería dar a entender una certificación que no existe). Se usa texto con la norma que se cumple, el respaldo real (empresa, NIT) y la aclaración de que no hay aval.

## 1/11/2026 · «Debe quedar claro que es facturación, y para distribuidoras»
- La categoría va primero: si el producto es un software de facturación, el H1, el título, la cabecera y el pie lo dicen con esas palabras. Los beneficios (IA, vencidos) van después, nunca en lugar de la categoría.
- Antes de anunciar un público nuevo (distribuidoras), verificar que el producto lo atiende de verdad. Si faltaba (factura con cliente en la caja, crédito, cartera), se construye primero; lo que aún no existe (listas por cliente, cupos, preventa) se dice en la página.
- Pruebas de navegador que se repiten sobre la misma base deben elegir datos con margen (productos con existencias de sobra), no «el primero de la lista».

## 1/11/2026 · «Proveedor tecnológico autorizado por la DIAN»
- Una frase de confianza también es una afirmación verificable: antes de publicar «autorizado por», buscar la fuente (web del proveedor y listado oficial de la DIAN). MATIAS se declara «software propio», no proveedor tecnológico.
- Logos de entidades del Estado: no, aunque el proveedor tenga habilitación; sellos en texto con la norma que se cumple.
- Pruebas de pagos: verificar la firma contra el ejemplo oficial de la pasarela, no solo contra el propio código.

## 1/11/2026 · Auditoría total
- Tailwind 3 no aplica opacidad (bg-x/95) a colores definidos como var(--x): definir los tokens como rgb(var(--x-rgb) / <alpha-value>).
- Funciones SQL con estimaciones de filas altas disparan el JIT de Postgres (segundos de compilación): set jit = off en la función.
- Repartir un total entre lotes redondeando cada parte deja centavos sueltos: calcular el total una vez y dar el resto al último.
- Un sello «El más elegido» sin clientes es una afirmación falsa: usar «Recomendado».

## 1/11/2026 · Consola
- `order by (col = $x) desc` pone primero los NULL (desc = nulls first): usar coalesce(col = $x, false).
- En consultas con join, calificar columnas comunes (estado existe en empresas y documentos_dian).
- Next agrega un elemento con role=alert (anunciador de rutas): en pruebas, buscar alertas dentro del formulario.

## 1/11/2026 · Auditoría adversarial de la consola
- Una sesión firmada que no se vuelve a comprobar en la base sobrevive a suspensiones y cambios de contraseña: toda sesión se valida contra la base en cada petición (empresa activa, miembro activo, versión de contraseña).
- Las acciones de soporte («entrar como») deben llevar su propia marca y caducidad, no depender de otra cookie.
- Un webhook firmado solo avisa: la verdad se consulta en la API del proveedor (referencia y monto pueden no estar firmados).
- Los límites de intentos en memoria no sirven en serverless y las cabeceras de IP las puede escribir el cliente: contar solo fallos, en la base, y creer solo la cabecera de la plataforma.
- Las rutas que reciben un id deben filtrar por la empresa de la sesión aunque RLS ya proteja.

## QR de pago (2 nov 2026)
- Antes de pedirle a Oscar un dato o archivo (QR, llaves, cuentas), buscarlo en los otros repositorios de /home/claude: el QR Bre-B
  y la llave de IA DEV ya estaban en justicia-activa (`src/data/pagos.ts`, `public/img/pagos/qr-iadev.png`). Pedirlo de nuevo lo molesta.

## Despliegue Supabase/Netlify (2 nov 2026)
- Probar las migraciones como en Supabase, no como superusuario: `tests/supabase-local.sql` crea un dueño sin superusuario,
  `auth` ajeno, `pgcrypto` en `extensions` y los permisos por defecto de Supabase. Ahí salieron dos cosas que la base
  local normal escondía: `session_replication_role` necesita superusuario (la demo quedaba toda con fecha de hoy) y
  Supabase da a `anon` acceso a todas las tablas y funciones nuevas (migración 016 lo deja exacto).
- Nunca correr `next dev` en la misma carpeta que un `next start`: dev pisa `.next` y el servidor de producción se rompe.
- Error React 418 intermitente (1-2 %) en pantallas largas del panel: el JS en caché arrancaba la hidratación antes de
  que llegara todo el HTML. Un `loading.tsx` en el grupo (app) da el límite de Suspense y lo eliminó (0 de 400).
  Medirlo con muchas visitas: una sola corrida verde no prueba nada en errores intermitentes.
- Los límites por IP solo deben contar solicitudes válidas; si no, un usuario que corrige un dato queda bloqueado.
- Instalar en Supabase sin contraseña ni terminal: generar SQL (scripts/sql-supabase.mjs) y correrlo en el editor SQL
  desde Claude in Chrome (el texto se trae de raw.githubusercontent y se pone en Monaco). El JSON de los datos debe salir
  como texto de Postgres (json_agg::text), no pasar por JavaScript: JS quita la escala de los números (81850.00 → 81850).
  `alter table … enable trigger` falla con "pending trigger events" si hay FK diferidas: `set constraints all immediate` antes.
  Comprobar con huella md5 por tabla (timezone UTC, collate "C") contra la copia local, no solo con conteos.
- La pantalla de crear proyecto de Supabase: la lista de regiones se mueve al hacer scroll; confirmar con captura la región elegida.

## Netlify con plan de créditos (02/11/2026)
- En el plan por créditos cada build gasta créditos del EQUIPO. El equipo FARMAGENERICOS COLOMBIA tenía 42 créditos y
  4 builds seguidos (incluido uno disparado solo por subir tsconfig.tsbuildinfo) agotaron el límite: Netlify pausó
  TODOS los proyectos del equipo, no solo Regenta.
- Regla: antes de desplegar, mirar los créditos que quedan. No hacer push a main por archivos sin efecto
  (tsbuildinfo) mientras Netlify construye desde main. Probar todo lo posible antes del despliegue para hacer uno solo.
- Probar la conexión (contraseña, CA) antes de gastar un build: un error de DATABASE_URL se ve en el registro de la
  función sin volver a construir.

## Redirecciones en Netlify (02/11/2026)
- En las funciones de Netlify `req.url` trae el host interno del despliegue (`main--sitio.netlify.app`). Un
  `NextResponse.redirect(new URL(ruta, req.url))` manda al visitante a ese otro host, sin la cookie recién creada:
  el botón «Probar la demo» no entraba. Usar redirecciones relativas (`Location: /ruta`) o `REGENTA_URL`, nunca req.url.
- Una auditoría con fetch ve los `redirect()` de Next como 200 + `<meta http-equiv="refresh">`: no es fallo si la
  página solo trae el marco sin datos.

## MATIAS (02/11/2026)
- La documentación de MATIAS se lee mejor desde el navegador: /openapi.json y las páginas .md (docs.matias-api.com).
  `get_page_text` devuelve textos largos; `javascript_tool` corta la salida (~1 KB).
- En el API se usan los IDs de su base, no los códigos DIAN (type_document_id 20 = POS, 94 = NC POS; unidad = 70;
  NIT = 3, CC = 1). Consultar los catálogos (/identity-documents, /quantity-units) antes de suponer.
- `tax_exclusive_amount` es la base GRAVADA (0 si no hay IVA), no el subtotal.
- Probar el cuerpo en el sandbox antes de desplegar: no gasta documentos ni créditos de Netlify.

## Impresión (02/11/2026)
- La CSP tenía frame-ancestors 'none' y X-Frame-Options DENY en todo el sitio: un iframe propio (impresión silenciosa
  de la tirilla) queda bloqueado. Abrir solo la ruta que se enmarca (/tiquete) con frame-ancestors 'self'.
- El aviso de hidratación «caret-color» en las pruebas con `next dev` no sale con `next build && next start`: las e2e
  se validan contra el build de producción (REGENTA_DEMO=1 y las claves de prueba).
- Un texto de botón que contiene la palabra de otro botón («…tarjeta, Nequi…») rompe los selectores por nombre accesible
  (getByRole name hace coincidencia parcial). Nombres de botón cortos y únicos.

## 2026-11-02 · Demo sin embudo de venta
- Error: la demo era una app abierta sin ninguna estructura de venta; al salir mandaba a «Entrar». Oscar: «una demo abierta no vende».
- Regla: toda demo de un SaaS es un embudo. Barra fija con la oferta y «Contratar», recorrido guiado a los momentos «ajá», aviso tras cada acción clave, oferta (máx. 2 por visita) al completar / intención de salida / tiempo, y salida hacia una página de oferta, nunca al login.
- Regla: en marketing no se nombran otros programas: se dice «software POS genérico».
- Regla: avisos flotantes de la demo nunca encima de la zona de trabajo de la caja (taparon la venta y rompieron el flujo).

## 2026-11-02 · Candado de inmutabilidad olvidado
- Error: la migración 020 añadió ventas.devuelto pero el trigger venta_solo_anular solo permite cambiar «estado»: toda devolución habría fallado en producción. Lo destapó el e2e de la pantalla, no la migración.
- Regla: al añadir una columna mutable a una tabla con trigger de inmutabilidad, actualizar el trigger en la misma migración y probar la escritura de punta a punta antes de aplicar en producción.

## 2026-11-02 · Pruebas e2e con carreras de hidratación
- Error: escribir en la caja justo después de goto (antes de hidratar React) perdía teclas; y esperar '[role="option"]' encontraba la lista «Ofrécelos primero», no los resultados. Fallaban de vez en cuando.
- Regla: tras goto a una pantalla interactiva, esperar networkidle; y esperar el elemento exacto (aria-label="Resultados"), nunca un selector genérico que otra lista también cumple.

## 2026-11-02 · Auditoría: lo que se pasaba por alto
- Error: con numeración de prueba un cliente que paga podía «vender» documentos sin validez fiscal; Stripe aprobaba cualquier sesión firmada con la referencia; las renovaciones no extendían el periodo; una cuenta vencida nunca se suspendía; un pago con NIT ajeno se ligaba a otra droguería.
- Regla: todo webhook valida que el objeto es el que creamos (id, moneda, monto), no solo la firma. Todo SaaS necesita el ciclo completo: renovar → extender, fallar → avisar sin borrar lo pagado, vencer → gracia → suspender, pagar → reactivar.
- Regla: los límites anti-abuso que importan van en la base (las funciones serverless no comparten memoria).

## Velocidad (03/11/2026)
- Antes de optimizar consultas, medir el piso: si una página vacía tarda 1,3 s, el problema es la distancia servidor↔base (región), no el SQL. Servidor y base en la misma región.
- Políticas RLS con una función por fila (rol_en(empresa_id)) cuestan muchísimo aunque haya pocos datos: usar `empresa_id in (select mis_empresas())`, que se calcula una vez por consulta. Comparar resultados por rol antes y después.
- Medir justo después de resetear la base engaña: sin estadísticas (ANALYZE) los planes son malos. Repetir la medida con estadísticas.
- Cada ida a la base cuenta con la base lejos: juntar begin/set_config/set role en una sola consulta.

## Stripe (03/11/2026)
- El webhook de Regenta lee eventos «snapshot» (data.object). Al crear el destino en Workbench elegir **Snapshot**, no Thin (que es la recomendada por defecto).

## Revisión independiente (03/11/2026)
- Reutilizar una cuenta «por correo» al invitar es una puerta de toma de cuentas: nunca vincular desde el flujo del cliente una cuenta que ya pertenece a otra empresa o ya tiene contraseña, y nunca devolver en la respuesta un enlace de contraseña de alguien que ya la tiene.
- Si un documento se emite en «real» o «simulado» según SU numeración, la nota crédito puede salir simulada aunque el original sea real: la nota hereda el modo del original (guardia en la base).
- Un envío con timeout no es «no enviado»: tras un intento, anular debe producir nota crédito y enviar el original.
- Toda cola con estado «enviando» necesita recuperación por tiempo (correos igual que DIAN).
- Un fallo «intermitente» en las pruebas puede ser real: reproducirlo con registro de red antes de descartarlo (el abono se guardaba pero la pantalla no se refrescaba).
- Las rutas deben mirar el permiso antes que los datos: un rol sin permiso merece 403, no «falta un dato».

- Una vista con filtro por usuario (mis_empresas / auth.uid()) no sirve en procesos del servidor (sinRLS): ahí hay que consultar las tablas filtrando por empresa. El error salta solo cuando la conexión del pool tuvo antes claims de un usuario (cadena vacía → JSON inválido), así que puede pasar las pruebas una vez y fallar la siguiente.
- Al alterar un token en una prueba, garantizar que el valor cambia (sustituir el último carácter por uno distinto al que había).

- Un endpoint solo probado con «basura» (datos rotos) puede estar roto en el camino feliz: cargar numeración DIAN daba 500 siempre ($5 - 1 con tipos deducidos distintos). Cada acción de la consola necesita al menos una prueba con datos válidos.
- En SQL parametrizado, si un mismo parámetro se usa como valor de columna bigint y en una operación aritmética, castearlo explícito ($5::bigint).
- Al buscar texto en HTML renderizado por React, quitar los comentarios <!-- --> que separan trozos de texto.

## 06/11/2026 · Regenta IA caída en producción
- El asistente respondía siempre «no pudo responder» y el registro solo decía «El servicio de IA respondió 400»: la causa real (saldo de créditos de Anthropic agotado) no se veía. Regla: todo error de un servicio externo se registra con su código Y su mensaje, y la consola tiene un botón para probar cada servicio (MATIAS, correo, IA).
- Los mensajes al usuario no prometen acciones que el sistema no hace («ya avisamos al equipo» sin aviso real).

## 06/11/2026 · Bloque 1-A (ajustes, kardex, conteo físico)
- La emulación de celular de Playwright (isMobile) agranda el viewport de diseño cuando algo se sale (innerWidth pasó de 390 a 716): `scrollWidth - innerWidth` da 0 aunque la página desborde. Medir contra `screen.width` y buscar elementos que salen de la pantalla fuera de una tabla desplazable (tests/e2e/inventario-control.mjs, `desborde` y `cortados`). Ojo: «portada sin desborde» de gestion.mjs usa la medida vieja.
- `justify-items-start` en una grilla deja a cada hijo con su ancho de contenido: el acta se salía de la pantalla del celular. En pantallas del panel, `grid-cols-[minmax(0,1fr)]`.
- `router.refresh()` no re-renderizó en el build de producción al cerrar el conteo (ya había pasado en Cartera). Si la pantalla cambia de estado (abierto → cerrado), navegar con `location.assign`; y probar las e2e contra `next build && next start`.
- Una prueba de base de datos que confirma (commit) «dejar en cero lo no contado» sobre todo el inventario vació la demo y tumbó las demás pruebas: lo que una prueba guarda de verdad debe ser neutro (contar igual al sistema).
- `pkill -f "next start"` no detiene el servidor (el proceso pasa a llamarse `next-server`): detenerlo por su carpeta de trabajo o su puerto. `next start` exige REGENTA_SESSION_SECRET aunque sea local.
- La carpeta de capturas del scratchpad la comparten los hilos paralelos: cada frente escribe en su propia subcarpeta.
## 06/11/2026 · Frente B (cumplimiento)
- Con varios `next dev` en paralelo (un frente por puerto) el servidor de desarrollo se cerró solo al compilar todas las rutas del contrato de endpoints: las suites largas se corren contra `next build && next start`.
- El contrato de endpoints buscaba «fugas» con una expresión regular también dentro del ZIP binario: los bytes comprimidos formaron «Pg_» al azar. Los cuerpos binarios no se revisan como texto.
- La siembra cambia ventas.creado pero no documentos_dian.creado: la fecha de un tiquete o factura es la de su venta (la de la nota crédito, la suya). Las pantallas de documentos filtran por esa fecha, con d.creado como cota inferior para usar el índice.
- En componentes de cliente no usar toLocaleString para textos que se renderizan en el servidor (riesgo de diferencias de ICU e hidratación): formatos hechos a mano.
## 06/11/2026 · Control especial (frente C)
- En un trigger, `auth.uid()` falla («invalid input syntax for type json») si la conexión tuvo antes claims locales: tras la transacción `request.jwt.claims` queda en '' y no en NULL. En triggers que pueden correr desde procesos del servidor, comprobar `nullif(current_setting('request.jwt.claims', true), '')` antes de llamar a auth.uid().
- Para exigir algo «con la venta» sin tocar registrar_venta: función aparte en la misma transacción (que exige `ventas.creado = now()`, así no se completa a posteriori) + restricción diferida (`constraint trigger … initially deferred`) que lo comprueba al confirmar. En pruebas de base: `set constraints all immediate` para dispararla sin confirmar.
- Repetir una e2e muchas veces sobre la misma base agota las existencias de los productos que usa (caja.mjs con «acetaminofen forte mk»): antes de diagnosticar un fallo «nuevo», reiniciar la base y repetir.

## Navegación del cliente en pantallas de filtros (06/11/2026)
- Los enlaces que solo cambian los parámetros de la misma página (contadores, limpiar, paginación) a veces no terminaban la navegación del enrutador de Next. En pantallas de filtros: enlaces normales `<a>` (recarga completa), igual que el formulario GET.
- Tras guardar, la pantalla no debe depender de `router.refresh()` para mostrar lo guardado: la API devuelve los datos ya actualizados y el componente los aplica; el refresco queda solo para el resto de la pantalla.
- Pruebas e2e: nunca `isVisible()` justo después de `goto` en páginas con `loading.tsx` (el contenido llega por streaming); usar `waitFor`. Hacer clic y esperar la URL con `Promise.all`.
- La batería completa contra un solo servidor acumula el límite anti-abuso por IP en memoria: pagos va primero o con servidor recién arrancado.

## Varios equipos en paralelo sobre el mismo Postgres (06/11/2026)
- `scripts/db-reset.mjs` usa la base `regenta` por defecto: un reinicio sin DATABASE_URL borra la base de otro. Cada frente y el integrador usan su propia base (regenta_2a…, regenta_int) y pasan DATABASE_URL en la misma línea de cada comando.
- Si una suite falla con «terminating connection due to administrator command» o le faltan datos de la demo, primero sospechar de un reinicio ajeno, no del código.
- Detener solo el servidor propio (`fuser -k 4500/tcp`), nunca `pkill -f "next start"`: mataría los servidores de los demás frentes.

## 06/11/2026 · Frente 2-C (cuentas de clientes)
- Un `<span class="sr-only">` (posición absoluta) dentro de una tabla con `overflow-x-auto` se ubica respecto al primer ancestro posicionado, no al contenedor desplazable: en el celular ensanchaba la página (/clientes llegó a 766 px). Los contenedores desplazables de tablas llevan `relative`. La prueba `cortados` no lo ve (excluye lo que está dentro de un desplazable): mirar también `desborde`.
- `set constraints all immediate` en una prueba deja inmediatas las FK diferidas para el resto de la transacción: una venta posterior (líneas antes que la venta) falla por FK. Tras alterar triggers, volver con `set constraints all deferred`.
- `fetch().text()` quita el BOM: para comprobar el BOM de un CSV, leer los bytes (`arrayBuffer`).
- Con `loading.tsx`, `notFound()` llega por streaming con estado 200: las pruebas comprueban el contenido («404») y que no salga el dato ajeno, no el código HTTP.

## 06/11/2026 · Integración del Bloque 2
- Al resolver conflictos «uniendo ambos lados» en un archivo de pruebas, git puede quedarse con el cierre común (`});`) de un solo lado: la prueba anterior quedó sin cerrar. Tras resolver: `node --check` y contar las pruebas (base + las de cada frente) antes de seguir.
- Una copia del flujo de venta en otro módulo (cobrar pedidos) se queda atrás del original en cuanto otro frente lo cambia (motivo_credito): la lógica de venta vive en un solo módulo (src/lib/venta-servidor.ts). Los «pre-chequeos» en el navegador no reemplazan la regla del servidor.
- Cada tabla nueva con llave hacia empresas por un camino RESTRICT/NO ACTION (pagos_proveedor → movimientos_caja) rompe eliminar_empresa_prueba sin que ninguna prueba del frente lo note: cada bloque añade una prueba de base que llena TODAS sus tablas en la empresa B y la elimina.
- No poner `update` de datos en una migración para rellenar una columna nueva: crear la columna con el valor de las filas viejas (`default true`) y cambiar luego el default; no reescribe la tabla y no vuelve a marcar nada si la migración se repite.
- Los servidores simulados de las pruebas (IA, Wompi) toman su puerto de una variable: con puertos fijos dos hilos no pueden correr la batería a la vez.

## Navegaciones colgadas del enrutador de Next.js 15 (06/11/2026)
- Síntoma medido: clic en un enlace interno (sobre todo desde /inventario hacia /inventario/ajustes o /conteos) → la respuesta RSC llega entera (Resource Timing: ~5 KB en 30 ms) pero la dirección nunca cambia; hasta 5 de 20 clics. Esperar a que la página cargue no lo evita. No hay error en servidor ni consola. Es un problema conocido del App Router sin arreglo oficial.
- Solución: `src/components/GuardiaNavegacion.tsx` en el layout raíz. Tras un clic interno, si la respuesta de esa pantalla ya llegó (PerformanceObserver, petición iniciada después del clic) y en 2,5 s la dirección no cambió, carga la pantalla de forma normal. Si el servidor tarda, no actúa. Medido después: 0 de 120.
- Para reproducir: scratchpad nav3.mjs (clic + waitForURL en bucle, por origen y destino). Un fallo intermitente de navegación en e2e es un fallo real hasta demostrar lo contrario.
## 06/11/2026 · Frente 3-A (resultados, gastos, IVA, bitácora)
- `new Date("2026-13-01T12:00:00Z").toISOString()` LANZA (RangeError), no devuelve otra fecha: un validador de fechas que compara con toISOString sin mirar antes `isNaN(getTime())` tumbaba /reportes y su API con `?desde=2026-13-01` (500). Toda validación de fecha comprueba primero que la fecha existe; el contrato de endpoints debe probar un mes 13, no solo «x».
- La utilidad con `coalesce(costo, 0)` infla la ganancia: lo vendido de lotes sin costo se saca de la utilidad y se informa aparte; las devoluciones restan base y costo el día en que se hacen.
- registrar_venta solo cobra IVA si la droguería es responsable de IVA (la demo no lo es): una prueba de IVA por tarifa debe activar `responsable_iva` y dejarlo como estaba.
- resumen_turno exige ser miembro de la droguería: desde una prueba con la conexión del servidor da «Turno no encontrado»; llamarla como el dueño (claims + rol authenticated).
- Las migraciones NO llevan su `insert into regenta_migraciones` (lo hace db-reset y chocaría la llave): esa línea va solo en el SQL de producción (db/produccion).

## 06/11/2026 · Integración del Bloque 3
- React 418 intermitente fuera del panel (actas, tirillas, informes): Next manda los scripts con `async` en el `<head>` y el HTML de las páginas dinámicas llega por partes (`chunked`). Sin un límite de Suspense, con el JavaScript en caché React a veces empieza a hidratar antes de que el navegador termine de recibir el documento y encuentra un DOM incompleto (`#418 args[]=HTML`). Medido en bucle: 4 de 450 visitas (/tiquete/recepcion, /informes/temperatura, /control-especial/informe). Con `loading.tsx` en tiquete, informes y control-especial: 0 de 800. Regla: todo segmento con páginas dinámicas fuera de (app) lleva su `loading.tsx` (salvo la consola, donde la redirección 307 sin sesión importa); y un 418 se reproduce con un bucle de 100+ visitas antes de dar algo por arreglado.
- Con `loading.tsx`, `notFound()` llega con estado 200: las pruebas que pedían 404 a un acta o cotización ajena pasan a comprobar el contenido (página no encontrada y ningún dato ajeno).
- `eliminar_empresa_prueba` fallaba desde 033a con cualquier devolución de venta (devolucion_lineas → venta_lineas es RESTRICT y se borraba venta_lineas primero). La prueba integral del bloque ahora llena TODAS las tablas en B y comprueba que no queda ninguna fila con su empresa_id en ninguna tabla (lista leída de information_schema, no escrita a mano); y se verificó que falla con la versión vieja (control negativo).
- La marca activa del menú con `startsWith(href)` enciende dos entradas cuando una ruta es prefijo de otra (/productos y /productos/precios; /cuenta y /cuentas-por-pagar): marcar solo la más larga que coincida por segmento.
- Pruebas de base de distintos frentes se pisan: una prueba que confirma (commit) una compra sobre «el producto de prueba» le da un tercer lote, y otra que suponía «exactamente dos lotes» falla solo en la suite unida. Lo que se compara se mide en la base (lo vendible real), nunca se supone.
- Al sembrar datos que antes creaba la prueba (numeraciones DSSE), revisar las aserciones que fijan el valor que ponía la prueba (prefijo DSE).
- Regenta IA y Reportes deben dar la misma cifra: la herramienta de ventas resta las devoluciones el día en que se hacen, igual que Reportes.
- (Frente 3-C) Al cambiar la versión del catálogo sin internet (v2 → v3), buscar las pruebas que la fijan (control-especial.mjs la comparaba).
- Con `loading.tsx`, Next 15 transmite la metadata dentro del `<body>`: el `<title>` («Estado de cuenta · Regenta») aparece en el DOM y `getByText("ESTADO DE CUENTA")` (subcadena, sin distinguir mayúsculas) contaba 2. En pruebas de texto de documentos: `{ exact: true }`.
- Con 23 entradas el menú del dueño no cabía en 1440×900 y la barra de desplazamiento estaba oculta: Gestión quedaba escondida sin pista. Menú compacto en escritorio y barra fina visible; al sumar entradas, mirar la captura del dueño a 900 px de alto.
- (06/11, auditoría) Nunca agregar ni editar archivos de db/migrations mientras corre una batería en ese worktree: cada suite hace db-reset y lee la carpeta; una migración a medio escribir tumbó 10 suites («RESET FALLÓ»). Cambios de código y migraciones, después de la batería (o en otro worktree).
- El ejecutor de migraciones (db-reset) registra cada archivo en regenta_migraciones: la migración NO lleva su propio insert (da clave duplicada). El insert va solo en el archivo de producción db/produccion/*.sql.
- `loading.tsx` con `<main>` dejaba dos `<main>` en pantalla mientras React revela la página (hasta ~300 ms después de «load»): rompe el modo estricto de Playwright y la semántica. El esqueleto de carga va en `<div role="status" aria-busy>`.
- Un `sr-only` (position: absolute) dentro de una tabla con desplazamiento lateral toma como referencia un ancestro fuera del contenedor y ensancha toda la página en celulares (/prediccion a 320–412 px): `table { position: relative }` en globals.css.
- Pantallas de 320 px (iPhone SE de 1.ª generación, plegables): revisar la cabecera pública; con px-5 el botón «Probar gratis» se salía 11 px.
- Controles de texto (Renombrar, ×, «¿Olvidaste tu contraseña?») de 20 px de alto son difíciles de tocar: mínimo 24 px (WCAG 2.5.8), con py-1.5 -my-1.5 para no mover el diseño.
- (06/11) La API de Anthropic rechaza un bloque de texto vacío en el historial («text content blocks must be non-empty»): la IA a veces abre un texto y pasa directo a una herramienta. Al armar el turno del asistente se quitan los textos vacíos; el mock de ia.mjs ahora responde 400 como la API real.
- La suite ia.mjs no se puede repetir dentro del mismo minuto: el límite de la demo (8 preguntas por minuto por IP) vive en memoria del servidor. Entre corridas, esperar 60 s.

## 2026-11-07 · Costos reales antes de fijar precios
- El documento adicional se publicó a $20 y a Regenta le cuesta ≈ $21 en MATIAS (paquete de 30.000): se vendía a pérdida. Subido a $50.
- El certificado digital NO va incluido en el paquete de MATIAS (solo el primero, como bono): cuesta $104.000/año por NIT. Antes de dar un costo o un margen, leerlo en la página oficial del proveedor, no de lo anotado.

## 2026-11-07 · Regenta IA «se cortaba»
- La API rechazaba el historial si cualquier mensaje pasaba de 2.000 caracteres: tras una respuesta larga de la IA (tablas, pedido), la pregunta siguiente fallaba con «Escribe tu pregunta». Validar la pregunta nueva, no el historial; el historial se limpia (orden, vacíos, errores) y se recorta en el servidor.
- Probar siempre una conversación de varios turnos con respuestas largas, no solo una pregunta suelta. Reproducido en la demo publicada antes de corregir.

## 08/11/2026 · Visitas a la demo
- La batería reutiliza el mismo servidor: los limitadores en memoria (por IP «local») se llenan con endpoints y luego fallan suites como admin («Demasiados intentos»). Reiniciar el servidor antes de una suite que activa cuentas, o correr admin antes que endpoints. No es un fallo del código.
- npm test (db.test) exige la base recién reiniciada (db-reset): tras la batería e2e da 36 fallos falsos.
- Cada ruta nueva de src/app/api debe añadirse al contrato de tests/e2e/endpoints.mjs o la suite falla («todas las rutas de la API están en el contrato»).
- Las cookies de primer contacto se escriben en un efecto del cliente: en las pruebas, esperar a que exista antes de navegar.

## 08/11/2026 · UX táctil: 44 px para todo lo que se toca
- Oscar: «nada debe ser grande o pequeño, debe ser perfecto para todos los dispositivos». La suite de dispositivos solo avisaba entre 24 y 32 px y solo miraba botones y campos: dejaba pasar enlaces sueltos (pestañas, filtros, «Ver todas») de 16–34 px.
- Regla: en pantallas táctiles (pointer: coarse) todo lo que se toca mide ≥ 44 px; la regla vive en globals.css (una sola vez, no clase por clase) y la suite falla por debajo de 44. Con ratón no cambia nada.
- Un `min-h-*` de Tailwind en un control gana a la regla global (clase > elemento): no usar alturas mínimas menores de 11 en controles.
- Los enlaces `inline` no aceptan min-height: si un enlace va solo (no dentro de un párrafo), darle `block` o `inline-block`, o que su contenedor sea flex/grid.
- En globals.css no usar selectores de clase de Tailwind (.flex, .block…) en reglas propias: Tailwind copia la regla en cada `@apply` de esa utilidad (quedó 15 veces y alcanzó clases por accidente). Usar `[class~="flex"]`. Las clases de componente con display propio (.pastilla) hay que nombrarlas.
- Flotantes (position: fixed): en celular horizontal (342 px de alto) el panel «Pruébalo en 3 minutos» se salía por arriba y no se podía minimizar. Todo panel flotante lleva `max-h-[calc(100dvh-…)] overflow-y-auto`; la suite de dispositivos comprueba que todo flotante visible cabe entero en la pantalla, también con el recorrido abierto.

## 08/11/2026 · Compras desde la factura del proveedor
- Una muestra de «factura» puede ser otra cosa: el ZIP de Pasteur era una NOTA CRÉDITO. Leer el tipo del documento (Invoice/CreditNote/DebitNote) y nunca cargar inventario con una nota.
- Muchos programas meten lote y vencimiento DENTRO de la descripción («(FECHA VENCIMIENTO: dd/mm/aaaa)(LOTE: x)»): sacarlos y limpiar el nombre antes de buscar en el catálogo.
- Emparejar por nombre: coincidir solo en cifras («500mg», «x100») o en la forma («tableta») no es el mismo producto; ante la duda, la persona elige y se recuerda por proveedor.
- autoFocus en un buscador: en el celular abre el teclado y baja la página, escondiendo lo de arriba. Enfocar solo con puntero fino (PC con lector).
- La consola (/admin): un `loading.tsx` en la raíz de /admin quita el React 418 (0 de 420 visitas) PERO rompe la seguridad: las páginas redirigen a la entrada desde dentro del límite de Suspense, así que la respuesta pasa a ser 200 y la redirección la hace el navegador (13 fallos en admin, consola-clave y demo-visitas). Revertido. El arreglo correcto es comprobar la sesión en el layout (fuera del límite) antes de añadir el loading.tsx; pendiente.
- Tres proveedores más (09/11): cada uno manda el lote distinto. Allers en el XML («VencimientoLote» = «aaaammdd-lote», varios con «;» y sus cantidades → partir la línea); AXA y Zanecol solo en el PDF del ZIP (leerlo con IA y casarlo por código o por nombre: Zanecol ordena el PDF distinto al XML). AXA usa ZIP64 aunque el archivo pese 47 KB. AXA pone «precio de referencia» (PricingReference 01) en todas las líneas: bonificada es solo valor de línea 0. Fletes y domicilios son cargos, no mercancía.
- Productos nuevos en la factura (09/11, Oscar): mandar a crear el producto en otra pantalla rompe la compra. Se crean en la misma tarjeta «Por emparejar», con lo que dice la línea (nombre, código, unidades por caja leídas de «CJA X 30», IVA) y precio sugerido con margen visible; «crear todos» primero los abre para revisar y luego los crea. Emparejar a mano un producto que va en caja debe entrar como cajas, no como sueltas.
- Cifras grandes en tarjetas de dos columnas: siempre `text-[clamp(20px,6.5vw,30px)] [overflow-wrap:anywhere]` y `min-w-0` en la tarjeta (como `Dato`). En Inicio, «Se vencerían» pasó a 8 cifras y desbordó el iPhone SE: los datos crecen solos.
- Comprobación en vivo con la IA real (09/11): AXA 24/24 lotes del PDF, Zanecol 4/4, Allers y Pasteur exactos; fotos de Zanecol, AXA y el tiquete real: todas las líneas exactas. Pero la IA leyó «FVZ 7037» como «FVZ-7037» y la regla de factura única comparaba el número tal cual: la misma compra podía entrar dos veces y duplicar inventario. Los números de documento se comparan solo por letras y cifras (SQL 041 + aviso de repetida).

## 09/11/2026 · Auditoría extrema (5 revisores en paralelo)
- Repartir la auditoría por áreas (web pública, caja, compras, DIAN/reportes, seguridad) y con revisores que no conocen el producto encontró ~140 fallos que las 30 suites no veían: las pruebas confirman lo que uno ya pensó, no lo que no pensó.
- Una cita normativa «de memoria» de un revisor no se corrige sin leer la fuente: se verificaron E.T. 484 (la anulación resta en su periodo), 488/493 con el oficio DIAN 15660/2026 (el no responsable no descuenta IVA: es costo) y Res. 165/2023 arts. 22, 36, 37, 42 y 43 (las notas no tienen numeración autorizada; 48 h para transmitir).
- «Cache-Control: no-store» en TODA la API rompió la batería: con no-store, una petición cuyo cuerpo la página no lee (los eventos de la demo, «fire and forget») queda abierta y la página nunca llega a «networkidle». Sin caché solo en las lecturas GET con sesión (en conSesion), y no en POST.
- No correr una prueba suelta mientras la batería usa el mismo puerto y la misma base: los resultados de ambas quedan inválidos (500 y «RESET FALLÓ» falsos).
- Cambiar la regla de un dato compartido (la demo es «no responsable de IVA») cambia lo que esperan otras pruebas: la de compras pasa a declarar explícitamente si la droguería es responsable, y el otro caso se prueba aparte.
- Un ZIP de 17 KB puede inflarse a 1,4 GB: descomprimir solo lo que se va a leer y con un tope total, nunca confiar en el tamaño que declara el ZIP ni en entradas repetidas.
- Al insertar código en una línea que ya tenía más instrucciones, un comentario «// …» añadido a mitad de línea se tragó el resto (setCobrando, setCobrado, setPedido): la caja seguía «cobrando» y no decía «quedó cobrado». Los comentarios van en su propia línea; tras cada edición automática, buscar «// .*; \w+(» en la línea.
