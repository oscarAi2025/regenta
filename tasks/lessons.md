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
