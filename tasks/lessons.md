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
