# 05 · Conformidad DIAN de Regenta (facturación electrónica)

Fecha de la auditoría: 17/11/2026 · Alcance: el código de `/home/claude/regenta` (Next 15 + Postgres), sin acceso a producción, a credenciales, al portal de habilitación de la DIAN ni al sandbox de MATIAS. No se emitió ningún documento real ni se modificó código.

Lo que se ejecutó: `node --experimental-strip-types --test tests/matias.test.mjs` → **15/15 pruebas superadas** (son pruebas puras, sin red). Las pruebas de base de datos (`tests/db.test.mjs`) y las e2e (`tests/e2e/*.mjs`) **no se ejecutaron**: no hay Postgres activo (`pg_isready` → sin respuesta) ni servidor levantado, y no se quiso tocar nada compartido. Sus resultados se citan como «prueba existente», no como prueba superada en esta auditoría.

---

## 1. Modelo de operación

**Resumen en tres líneas**
1. Regenta **no genera, no firma y no transmite XML UBL**: arma un JSON propio y lo envía a la **API de MATIAS (`/api/ubl2.1/...`)**, que genera el UBL 2.1, firma con el certificado cargado en MATIAS, calcula el CUFE/CUDE/CUDS, transmite a la DIAN y devuelve el veredicto, la clave, el QR y (a veces) el XML y el PDF.
2. Opera como **«casa de software»**: un solo `MATIAS_TOKEN` en el servidor; cada droguería es un cliente de esa cuenta (`empresas.matias_cliente` → `?client_uuid=`), con su certificado, su software DIAN (ID, PIN y TestSetId del portal, modalidad «software propio») y sus resoluciones; la numeración se carga en la consola de Regenta (`resoluciones_dian`).
3. El ambiente lo decide el servidor (`REGENTA_DIAN=simulado|matias`, `MATIAS_URL` sandbox o producción) más la marca `pruebas` de cada numeración: la demo y las numeraciones de pruebas se **simulan** (CUFE de ejemplo marcado «SIMULADO», XML de prueba marcado); solo una numeración de producción con `REGENTA_DIAN=matias` va a la DIAN.

**Detalle (con evidencia)**

| Aspecto | Implementación | Evidencia |
|---|---|---|
| Interfaz de emisión | `Emisor` con dos implementaciones: `simulado` y `emisorMatias()` | `src/lib/dian/index.ts:43-60` |
| API usada | `POST {MATIAS_URL}/api/ubl2.1/invoice` (FE y POS), `/notes/credit` (NC y, según el código, también ND), `/ds/document`, `/ds/adjustment-note`; consulta `GET /status` para la regla 90 | `src/lib/dian/matias.ts:105-109, 240, 248-265` |
| Configuración por cliente | UUID de MATIAS, certificado, software (tipo 1 FE, 3 DS, 4 POS), set de pruebas, sincronización de numeraciones, resoluciones de notas | `src/lib/dian/matias-cuenta.ts:47-160`; `src/app/api/admin/clientes/[id]/habilitacion/route.ts`; `src/app/api/admin/clientes/[id]/numeraciones/route.ts:11-64` |
| Numeración en Regenta | Tabla `resoluciones_dian` (tipo, número de resolución, prefijo, desde/hasta/actual, vigencia, `pruebas`, `activa`) | `db/migrations/001_base.sql:166-181`; restricción de producción `022_endurecer.sql:300` |
| Ambientes | `MATIAS_URL` (por defecto `https://sandbox-api.matias-api.com`; en producción `api-v2`, según `tasks/todo.md:186`); `pruebas=true` ⇒ simulado | `matias-cuenta.ts:17`; `index.ts:54-60, 101-106` |
| Estados del documento | `pendiente`, `enviando`, `aceptado`, `rechazado`, `anulado` (más el atributo `simulado`). **No existe «borrador» ni «contingencia»**: la venta nace ya con número y documento `pendiente` | `001_base.sql:242`; `index.ts:71-112, 174-189` |
| ¿La UI dice «validada» solo con respuesta real? | Tiquete y factura: «Documento validado por la DIAN» solo si `estado='aceptado' && !simulado`; si no, «Pendiente de validación DIAN» o «EMISIÓN SIMULADA · SIN VALIDEZ FISCAL». `aceptado` solo se graba con `IsValid="true"` + `XmlDocumentKey`, con `is_valid=1` del reintento o con la consulta de estado (regla 90). Excepción menor: el distintivo de los listados (`EstadoDian`) muestra «DIAN ✓» sin mirar `simulado` (solo afecta a la demo) | `src/app/tiquete/[id]/page.tsx:116-123`; `src/app/tiquete/factura/[id]/page.tsx:173, 228-234`; `matias.ts:195-211`; `src/components/ui/EstadoDian.tsx:2` |
| CUFE/CUDE/QR | Los **devuelve MATIAS** (`XmlDocumentKey`, `qr.qrDian`); si falta el QR, Regenta arma la URL de consulta `catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=`. Regenta solo calcula un SHA-384 **de ejemplo** en modo simulado | `matias.ts:191, 199-203`; `index.ts:46-51` |
| Cola | Venta → documento `pendiente`; intento inmediato (`emitirDocumento`), luego una tarea de Netlify cada 15 min (`/api/tareas`) con reintentos a 30 s, 2 min, 10 min, 30 min y 2 h; `for update skip locked`; recupera un `enviando` de más de 5 min; a las 48 h sin respuesta lo marca `rechazado` | `src/lib/venta-servidor.ts:107-112`; `netlify/functions/tareas.mjs`; `src/app/api/tareas/route.ts:31`; `index.ts:62-112` |
| Idempotencia | `ventas.idem_key` único; `uuid` del documento = `documentos_dian.id` (MATIAS no emite dos veces el mismo); `documentos_idem` para DS/ND; la regla 90 («procesado anteriormente») se resuelve consultando el estado | `001_base.sql:202`; `033_cuentas_clientes.sql:423-428`; `matias.ts:80, 254-265`; `035_dian_soporte.sql:44` |

---

## 2. Normativa verificada (fuentes primarias)

| Norma | Qué se verificó | Fuente |
|---|---|---|
| **Resolución DIAN 000165 de 2023** (1/11/2023, D.O. 52.567) | Art. 60: adopta la **versión 1.9 del Anexo Técnico de Factura Electrónica de Venta** y la **versión 1.0 del Anexo de Documento Equivalente Electrónico**; art. 62 parágrafo (mod. Res. 8/2024): v1.9 obligatoria desde el 1/5/2024. Arts. 11.3.3 y 12.3.3: consumidor final con «222222222222». Art. 19: el documento equivalente electrónico se entiende expedido cuando la DIAN lo valida y se entrega al adquirente. Art. 33 par. 3: el documento rechazado «no se encuentra validado», sin consumir el consecutivo; si ya se consumió, procede inhabilitarlo (art. 47 num. 1.11). Art. 37: inconvenientes del facturador ⇒ factura de talonario o papel, transcripción como «factura tipo 3» y transmisión en 48 h; inconvenientes de la DIAN ⇒ se expide sin validación y se transmite en 48 h; documento equivalente: 48 h y conservar los soportes del inconveniente. Arts. 42-48: numeración consecutiva autorizada para FE, talonario, POS y documento soporte; prefijo de hasta 4 caracteres; vigencia máxima 2 años. Art. 64: conservación (art. 632 ET, Ley 962/2005 art. 46) | https://normograma.mintic.gov.co/docs/pdf/resolucion_dian_0165_2023.pdf (copia del normograma oficial) |
| **Resolución DIAN 000227 de 2025** | **Existe.** Expedida el 23/09/2025 (D.O. 53.254 del 25/09/2025): «Por la cual se expide la resolución Única en Materia Tributaria, Aduanera y Cambiaria en lo de competencia de la DIAN». Es **compilatoria** (Parte 1 Tributaria). Su **Título 5 (Sistema de facturación)** recoge la Res. 165/2023 y la Res. 167/2021: p. ej. art. 1.5.1.10.2 (anexo 1.9, fuente Res. 165 art. 60), art. 1.5.1.5.7.1 (inconvenientes tecnológicos, fuente art. 37), art. 1.5.1.6.1.1 (documentos que requieren numeración, fuente art. 42), art. 1.5.1.6.2.1 (prefijo, fuente art. 43), art. 1.5.1.6.2.5 num. 1.11 (inhabilitación, fuente art. 47), art. 1.5.1.11.2 (conservación, fuente art. 64), arts. 1.5.2.x (documento soporte, fuente Res. 167/2021). Art. 8: deroga «el texto de los artículos de las resoluciones aquí compilado». **No pude verificar línea a línea** la tabla completa de equivalencias ni si cambia algún requisito técnico (no adopta un anexo nuevo en lo que se leyó: el de FE sigue siendo el 1.9) | https://cancilleria.gov.co/normograma/compilacion/docs/resolucion_dian_0227_2025.htm (copia del normograma); reseña: https://incp.org.co/agendatributariaincp/noticias/2025/09/dian-expidio-su-resolucion-unica-en-materia-tributaria-aduanera-y-cambiaria/ |
| Resolución DIAN 000167 de 2021 (documento soporte) | Art. 2: por operación o acumulado semanal con un mismo proveedor; art. 4: fecha de la operación = fecha de generación, numeración autorizada, CUDS; art. 5: nota de ajuste como mecanismo de anulación/corrección, el número anulado no se reutiliza; art. 10 par.: por operación se transmite **en el momento de la operación**; el semanal, **a más tardar el último día hábil de la semana**; arts. 11-12: 48 h ante inconvenientes; art. 17: anexo técnico DS v1.1. Compilada en Res. 227/2025, arts. 1.5.2.2.1, 1.5.2.2.3, 1.5.2.2.4, 1.5.2.3.4-1.5.2.3.6, 1.5.2.5.1 | https://normograma.mintic.gov.co/mintic/docs/pdf/resolucion_dian_0167_2021.pdf |
| Decreto 442 de 2023 (POS) | Modifica el art. 1.6.1.4.26 del DUR 1625/2016 y reproduce el par. 2 del art. 616-1 ET: el tiquete POS solo procede si la venta **no supera 5 UVT, sin impuestos**, y el adquirente puede exigir factura | https://normograma.dian.gov.co/dian/compilacion/docs/decreto_0442_2023.htm |
| UVT 2026 | $52.374 (Res. DIAN 000238 de 2025) ⇒ 5 UVT = $261.870 | https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0238_2025.htm ; https://incp.org.co/publicaciones/infoincp-publicaciones/impuestos/2025/12/dian-fijo-en-52-374-en-valor-de-la-uvt-para-el-ano-gravable-2026/ |

**No verificado:** las reglas de validación del Anexo Técnico 1.9 (tolerancias de redondeo, códigos de concepto de notas, uso del DV del adquirente, códigos de responsabilidades fiscales). No se logró abrir el anexo en `micrositios.dian.gov.co` en esta sesión; donde el hallazgo depende de él se marca «No verificable». Tampoco se verificó que MATIAS esté autorizado por la DIAN como proveedor tecnológico.

---

## 3. Matriz de conformidad

Resultados: **Cumple** / **Parcial** / **No cumple** / **No verificable**. «Prueba existente» = archivo de pruebas del repositorio; solo `tests/matias.test.mjs` se ejecutó (15/15).

| # | Requisito legal | Requisito técnico | Implementación Regenta (archivo:línea) | Prueba existente | Resultado | Evidencia |
|---|---|---|---|---|---|---|
| 1 | Habilitación como facturador (Res. 165 arts. 26 ss., hoy Título 5 Res. 227/2025) | Software registrado, set de pruebas aprobado, certificado vigente | `matias-cuenta.ts:94-122` (registrar software, `run-test`, sincronizar numeraciones); `habilitacion/route.ts` | `tests/e2e/habilitacion.mjs` (contra un **MATIAS simulado**) | **No verificable** | Sin acceso al portal de habilitación ni a la cuenta MATIAS; `tasks/todo.md:189, 213` deja la habilitación por droguería como pendiente |
| 2 | FE de venta conforme al Anexo 1.9 (art. 60 Res. 165 / 1.5.1.10.2 Res. 227) | UBL 2.1 firmado, CUFE SHA-384, validación previa | Delegado en MATIAS; cuerpo en `matias.ts:63-94` (tipo 7, operación 1, forma de pago contado/crédito) | `tests/matias.test.mjs` «Factura a crédito a un NIT» (pasa) | **Parcial** | El XML lo genera el proveedor: Regenta solo responde por el JSON. Los comentarios dicen que el sandbox aceptó esos cuerpos el 02/11/2026 (`matias.test.mjs:1-3`); no es reproducible aquí |
| 3 | Documento equivalente POS electrónico (art. 19 Res. 165; anexo DE v1.0) | Tipo 20, CUDE, datos del punto de venta y del fabricante del software | `matias.ts:66, 74-75, 85-88` | `matias.test.mjs` «POS: tipo 20…» (pasa) | **Parcial** | Correcto en forma; falla el tope de 5 UVT (fila 4) y el cliente identificado va sin tipo de documento (H-P2-5) |
| 4 | POS solo si la venta ≤ 5 UVT sin impuestos (art. 616-1 par. 2 ET; Dec. 442/2023) | Bloquear o pasar a factura por encima de $261.870 de base (2026) | **No existe**: `registrar_venta` (`033_cuentas_clientes.sql:390-441`) y `venta-servidor.ts:66-71` no miran el valor | Ninguna | **No cumple** | `grep -i uvt` solo aparece en textos comerciales (`src/content/paginas.ts:188, 221, 251`; `guias.ts:147-172`) |
| 5 | Numeración autorizada, consecutiva, prefijo ≤ 4, vigencia ≤ 2 años (arts. 42-48 / 1.5.1.6.x) | Tomar el número con bloqueo; impedir uso vencido o agotado | `033_cuentas_clientes.sql:430-442` (`for update`, vigencia, agotamiento); `035_dian_soporte.sql:100-120`; `numeraciones/route.ts:11-44`; `022_endurecer.sql:300`; `001_base.sql:255` (único por tipo+prefijo+número) | `tests/db.test.mjs:85` (numera); **sin prueba** de vencida/agotada en la venta | **Parcial** | Lógica correcta por lectura; faltan pruebas; la numeración se teclea a mano (H-P2-7) |
| 6 | Un rechazo no consume el consecutivo; si se consumió, se inhabilita (art. 33 par. 3, art. 47 num. 1.11 / 1.5.1.6.2.5) | Reenviar con el mismo número o tramitar la inhabilitación | Reenvío con el mismo número: `ventas/[id]/reenviar/route.ts`. Pero anular una venta rechazada la deja `anulado` sin reenvío ni inhabilitación: `024_miembros_cartera.sql:68-69` | `tests/db.test.mjs:255, 434` | **Parcial** | H-P2-1 |
| 7 | Validación previa y estado real (art. 19, art. 33) | Solo «aceptado» con respuesta de validación | `matias.ts:195-211`; `index.ts:174-189` | `matias.test.mjs` «Respuestas…» y «regla 90…» (pasan) | **Cumple** (lógica) | El estado 98 se reintenta; 422 y el rechazo DIAN son definitivos; 401/402/5xx se reintentan |
| 8 | Contingencia del facturador: talonario + factura tipo 3, 48 h; DE físico ante inconvenientes (art. 37 / 1.5.1.5.7.1; art. 21) | Numeración de contingencia, documento tipo 3, soportes del inconveniente | **No implementado**: el tipo `contingencia` existe en la tabla (`001_base.sql:169`) pero nada lo usa; sin internet se entrega un «COMPROBANTE PROVISIONAL… No es un documento electrónico» (`src/lib/sin-conexion.ts:121-140`) y el número se asigna al sincronizar | `tests/e2e/sin-conexion.mjs` (prueba la cola, no la contingencia) | **No cumple** | H-P1-2 |
| 9 | Transmitir en 48 h lo que no se pudo validar (art. 37) | Reintentos, aviso y escalado | `index.ts:62-66, 90`; aviso a las 24 h `operacion.ts:84-100` | Ninguna prueba de `procesarCola` | **Parcial** | A las 48 h el documento pasa a «rechazado» sin que la DIAN lo haya rechazado (H-P1-3) |
| 10 | Nota crédito con referencia al CUFE/CUDE y concepto (anexo 1.9) | Tipo 5/94, operación 12/11, `billing_reference`, concepto 1 parcial / 2 anulación | `matias.ts:64-67, 89-92`; espera el CUFE del original `index.ts:150-155`; NC en producción `024_miembros_cartera.sql:25-42` | `matias.test.mjs` NC POS, NC factura y NC parcial (pasan); `db.test.mjs:255, 409, 434`; `e2e/devoluciones.mjs` | **Cumple** (lógica) | Los códigos de concepto no se contrastaron con el anexo |
| 11 | Nota débito (anexo 1.9) | Tipo de nota débito, referencia, concepto, entrega al adquirente | `matias.ts:108` (ruta `/notes/credit` con `type_document_id: 4`), `matias.ts:136-140` (`response_id "4"`, `send_email: 0`) | `matias.test.mjs` «Nota débito…» (pasa); `db.test.mjs:1490`; `e2e/dian-soporte.mjs` (simulado) | **No verificable** | El propio código dice «validar en sandbox antes de producción»; el envío real está apagado por defecto (`035_dian_soporte.sql:50`) |
| 12 | Documento soporte y nota de ajuste (Res. 167/2021 / 1.5.2.x) | Tipo DS, CUDS, proveedor, periodo semanal, ajuste por anulación o corrección | `035_dian_soporte.sql:100-296`; `matias.ts:105-149`; `soporte.ts` | `db.test.mjs:1400, 1452`; `e2e/dian-soporte.mjs` (simulado); `matias.test.mjs` DS y ajuste (pasan) | **Parcial / No verificable** | Tipos «confirmados por soporte MATIAS 06/11/2026; validar en sandbox» (`matias.ts:104`); `dian_complementario` en `false` por defecto |
| 13 | Plazo del documento soporte: en el momento de la operación; el semanal, a más tardar el último día hábil de la semana (Res. 167 art. 10 par. / 1.5.2.3.4) | Generación automática o aviso con fecha límite | **Manual** (botón en la ficha de la compra); sin aviso ni tarea; fecha del DS = fecha de generación (`index.ts:217`) | Ninguna | **No cumple** | H-P1-5 |
| 14 | CUFE/CUDE/CUDS y QR en la representación gráfica | Clave del proveedor, URL de consulta | `matias.ts:191, 199-203`; `tiquete/[id]/page.tsx:116-123`; `tiquete/factura/[id]/page.tsx:79, 230` | `matias.test.mjs` (pasa); `e2e/cumplimiento.mjs` | **Cumple** (delegado) | Regenta no calcula claves reales |
| 15 | Consumidor final «222222222222» (arts. 11.3.3 y 12.3.3) | POS sin datos ⇒ 222222222222; factura a consumidor final | POS: `matias.ts:13, 74-75`. Factura: la caja crea un cliente CC 222222222222 **sin correo** (`ClienteFactura.tsx:77-88`), pero `registrar_venta` exige correo para toda factura (`033_cuentas_clientes.sql:395-398`) | `e2e/solo-factura.mjs:42-53` solo comprueba que el botón Cobrar se habilita; la factura de la línea 59 se hace con **otro** cliente | **POS Cumple / Factura No cumple** | H-P1-4 |
| 16 | IVA por tarifa (0, 5, 19) y excluidos | Tributo por línea y totales por tarifa; los excluidos sin tributo | `001_base.sql:90` (`iva in (0,5,19)`); `matias.ts:18-38`; no responsable ⇒ IVA 0 (`033_cuentas_clientes.sql:479`) | `matias.test.mjs` «POS… excluidos sin tributo» (pasa) | **Cumple** | — |
| 17 | Redondeos coherentes con las reglas del anexo | Base e IVA a 2 decimales; el precio unitario × cantidad cuadra con la base | Base = round(total/(1+t),2), IVA = total − base (`033_cuentas_clientes.sql:494-495`); `price_amount = p2(bruto/cantidad)` (`matias.ts:29`) | `matias.test.mjs` «Descuento de línea…» (pasa); redondeo 3 × 3.333,33 aceptado en sandbox según el comentario | **No verificable** | Con cantidades grandes, `price_amount × cantidad` puede diferir del bruto en hasta 0,005 × cantidad (H-P3-5) |
| 18 | Entrega al adquirente (art. 19) | Envío del XML/PDF (AttachedDocument) | FE/POS: `send_email: c?.email ? 1 : 0` (lo envía MATIAS) `matias.ts:81`; ND: `send_email: 0` `matias.ts:140` | Ninguna (depende del proveedor) | **Parcial** | H-P2-4 |
| 19 | Conservación (art. 64 / 1.5.1.11.2) | Guardar el XML validado (y la respuesta de la DIAN) | `documentos_dian.xml` se llena solo si MATIAS devuelve un XML reconocible (`matias.ts:164-182`; `index.ts:177-178`); recuperación por regla 90 ⇒ `xml: null` (`matias.ts:191`) | `matias.test.mjs` «XML…» (pasa) | **Parcial** | H-P2-3 |
| 20 | Inmutabilidad de lo emitido | Bloquear cambios en documentos aceptados | Ventas, líneas y pagos: triggers (`001_base.sql:277-291`; `043_migracion_alegra.sql:22-47`); `documento_lineas` y `soporte_compras`: `035_dian_soporte.sql:83-95`. **`documentos_dian` no tiene trigger** | `db.test.mjs:130` (ventas) | **Parcial** | H-P2-2 |
| 21 | Un documento por venta, sin duplicados | Idempotencia de la caja y del envío | `033_cuentas_clientes.sql:423-428`; `001_base.sql:203, 255`; `matias.ts:80, 254-265` | `e2e/sin-conexion.mjs` (reenvío no duplica); `matias.test.mjs` regla 90 | **Cumple** | — |
| 22 | Representación gráfica con resolución, rango y vigencia, software (art. 19) | Datos en el tiquete o factura | `tiquete/[id]/page.tsx:83-86, 126`; `tiquete/factura/[id]/page.tsx` | `e2e/factura-carta.mjs` | **Cumple** (lectura) | La fecha «Validada DIAN» es `actualizado`, no la de la DIAN (H-P3-4) |

---

## 4. Hallazgos

### P0 — bloqueantes
Ninguno confirmado con lo que se pudo leer y ejecutar. (El P1-1 puede subir a P0 si el contador confirma que las droguerías ya emiten POS por encima de 5 UVT en producción.)

### P1 — altos (incumplimiento normativo o pérdida de coherencia fiscal)

**P1-1 · No se aplica el tope de 5 UVT del tiquete POS.**
`db/migrations/033_cuentas_clientes.sql:390-441` (`registrar_venta`, última versión) y `src/lib/venta-servidor.ts:66-71` aceptan `tipo_doc='pos'` por cualquier valor. La landing y las guías prometen la regla (`src/content/paginas.ts:188, 251`; `src/content/guias.ts:156, 172`).
*Fallo concreto:* una caja de Ozempic de $900.000 sale como tiquete POS electrónico; la DIAN lo valida (el anexo no lo impide), pero se incumple el art. 616-1 par. 2 ET y el comprador queda sin soporte para costos ni IVA descontable.

**P1-2 · No hay contingencia según el art. 37 de la Res. 165/2023 (hoy art. 1.5.1.5.7.1 de la Res. 227/2025).**
- Sin internet: se imprime un «COMPROBANTE PROVISIONAL… No es un documento electrónico» sin número ni requisitos (`src/lib/sin-conexion.ts:121-140`); el número POS se asigna al sincronizar (`033_cuentas_clientes.sql:440-442`). No hay talonario, numeración de contingencia ni factura tipo 3 (el tipo `contingencia` de `001_base.sql:169` no se usa en ningún sitio).
- Con internet, pero con MATIAS caído o lento: la caja entrega el tiquete con «Pendiente de validación DIAN» (`src/app/tiquete/[id]/page.tsx:123`). La norma solo permite expedir sin validación cuando el fallo es de la DIAN; si el fallo es del facturador o de su proveedor, corresponde la contingencia del art. 37 num. 1.1.
*Fallo concreto:* se cae el internet de la droguería 3 horas; el cliente se va con un papel sin validez fiscal y la droguería no tiene soporte del inconveniente (art. 37 num. 2.2) ni documento físico que transcribir.

**P1-3 · A las 48 h un documento sin respuesta pasa a «rechazado» y puede anularse sin nota crédito, aunque la DIAN lo tenga validado.**
`src/lib/dian/index.ts:62-66, 90` lo marca `rechazado` («Sin respuesta tras 48 horas»); `db/migrations/024_miembros_cartera.sql:68-69` trata cualquier `rechazado` como descartable (`anulado`, sin NC). El listado lo llama «rechazados por la DIAN» (`src/app/(app)/ventas/page.tsx:38`).
*Fallo concreto:* MATIAS responde 5xx `DOCUMENT_POSSIBLY_SENT` durante 2 días mientras la DIAN sí validó el CUFE. Al pasar 48 h el documento queda «rechazado»; el dueño anula la venta, el inventario vuelve y no sale nota crédito. En la DIAN queda un ingreso validado sin anular y en Regenta una venta anulada: la información exógena y el IVA no cuadran.

**P1-4 · La factura electrónica a consumidor final no se puede emitir.**
La caja ofrece «Consumidor final» y crea el cliente CC 222222222222 con correo vacío (`src/app/(app)/caja/ClienteFactura.tsx:8, 77-88`), pero la base rechaza toda factura cuyo cliente no tenga correo válido (`db/migrations/033_cuentas_clientes.sql:395-398`). La e2e `tests/e2e/solo-factura.mjs:42-53` solo comprueba que el botón se habilita y luego factura con otro cliente (línea 59).
*Fallo concreto:* en una droguería «solo factura» (POS en pruebas, el caso que prueba `solo-factura.mjs`), toda venta de mostrador sin datos del comprador falla al cobrar con «La factura electrónica necesita el correo del cliente».

**P1-5 · Documento soporte: no se garantizan los plazos y en producción queda apagado por defecto.**
La generación es manual (ficha de la compra); no hay tarea ni aviso por compras a no obligados sin DS (`grep soporte src/lib/operacion.ts` vacío). La fecha del DS es la de generación (`src/lib/dian/index.ts:217`), no la de la operación. `empresas.dian_complementario` vale `false` por defecto (`035_dian_soporte.sql:50`) y, con numeración de producción, `bloqueoEnvio` impide generar (`src/lib/dian/soporte.ts:50-57`).
*Fallo concreto:* una compra del lunes a un proveedor no obligado se registra y nadie pulsa «Generar documento soporte»; el viernes vence el plazo del semanal (Res. 167 art. 10 par. num. 2) y el costo y el IVA de esa compra quedan sin soporte.

### P2 — medios

**P2-1 · Números rechazados descartados sin reenvío ni inhabilitación.** `024_miembros_cartera.sql:68-69`. El art. 33 par. 3 de la Res. 165 dice que el rechazo no consume el consecutivo y que, si se consumió, se inhabilita (art. 47 num. 1.11). Regenta deja el número `anulado` y sigue con el siguiente: queda un hueco en el rango autorizado sin el trámite.

**P2-2 · `documentos_dian` no es inmutable en la base.** No hay trigger `before update or delete` (`001_base.sql:236-256`; solo un trigger de inserción en `024_miembros_cartera.sql:41-42`); `guardar()` actualiza sin condicionar el estado previo (`index.ts:174-189`). Un error de código o una sentencia manual con el rol del servidor puede reescribir `cufe`, `xml` o `estado` de un documento aceptado. (`documento_lineas` sí está protegido: `035_dian_soporte.sql:92-93`.)

**P2-3 · La conservación del XML depende de lo que devuelva MATIAS.** `xmlEnRespuesta` busca heurísticamente un `<?xml` en el JSON (`matias.ts:164-182`); si no viene, `xml` queda nulo, y en la recuperación por regla 90 es siempre nulo (`matias.ts:191`). Tampoco se guarda el ApplicationResponse ni el AttachedDocument. La obligación de conservar (art. 64 / 1.5.1.11.2) recae en el facturador.

**P2-4 · Nota débito: entrega, ruta y códigos sin verificar.** `send_email: 0` (`matias.ts:140`): la ND nunca se envía al adquirente. Usa la ruta `/api/ubl2.1/notes/credit` con `type_document_id: 4` (`matias.ts:108`) y códigos de concepto «pendientes de verificar» (`matias.ts:136-137`). La de ajuste usa `"5"` para corrección sin contraste con el anexo DS.

**P2-5 · Datos del adquirente incompletos o fijos.** `adquirente()` no envía el DV del NIT y fija `tax_regime_id: 2` y `tax_level_id: 5` para todos (`matias.ts:54-60`); el POS con cliente identificado va sin tipo de documento (`matias.ts:75`). Su efecto depende de cómo MATIAS los complete (no verificable): podría declarar responsabilidades fiscales erróneas de un cliente persona jurídica.

**P2-6 · Venta sin conexión: fecha retroactiva con número tardío.** `042_auditoria.sql:44-60` fecha la venta hasta 72 h atrás, pero el consecutivo se toma al sincronizar: el POS N+5 puede llevar fecha anterior al N; pasadas las 72 h se usa la hora de la sincronización (fecha falsa de la operación). Que la DIAN acepte la diferencia entre fecha de emisión y de recepción depende de las reglas del anexo (no verificado).

**P2-7 · Numeración tecleada a mano.** `numeraciones/route.ts:11-44` guarda prefijo, rango, resolución y vigencia escritos por el operador de la consola, sin contrastarlos con lo que la DIAN autorizó (existe `sincronizarNumeraciones` en `matias-cuenta.ts:116-122`, pero no se compara). Un rango mal escrito produce rechazos en cadena o números fuera de la autorización.

### P3 — bajos

- **P3-1** · `EstadoDian` muestra «Enviando» para `anulado` y «DIAN ✓» para un aceptado simulado (`src/components/ui/EstadoDian.tsx:2`).
- **P3-2** · `interpretar` exige `XmlDocumentKey` en el 200: un `IsValid="true"` sin la clave se graba como rechazo definitivo (`matias.ts:199, 205`).
- **P3-3** · Tiempos: `/api/tareas` tiene `maxDuration=26` y procesa correos antes que la cola (`tareas/route.ts:15, 30-31`); la cola calcula sus 20 s desde su propio arranque (`index.ts:66, 74`) y un envío con regla 90 puede sumar 30 s (`matias.ts:250, 260`). La función puede morir con documentos en `enviando` (se recuperan a los 5 min). Además, el índice `documentos_cola` cubre `('pendiente','rechazado')` y la cola busca `('pendiente','enviando')` (`001_base.sql:257`).
- **P3-4** · «Validada DIAN» muestra `actualizado`, no la fecha de validación de la DIAN (`tiquete/factura/[id]/page.tsx:60, 173`).
- **P3-5** · `price_amount = p2(bruto/cantidad)` (`matias.ts:29`): con cantidades grandes, precio × cantidad puede diferir del bruto en varios centavos; las tolerancias del anexo no se verificaron.
- **P3-6** · Las citas del código a «Res. 165/2023 art. 37 / arts. 42-43» (`index.ts:63`, `matias.ts:228`, `operacion.ts:83`, `numeraciones/route.ts:19`) deberían remitir a la Res. 227/2025 (arts. 1.5.1.5.7.1, 1.5.1.6.1.1 y 1.5.1.6.2.1), que compiló y derogó ese texto.

---

## 5. Dictamen

`DIAN: HABILITACIÓN NO VERIFICADA`

No hubo acceso al portal de habilitación de la DIAN ni a la cuenta MATIAS. La única evidencia es una e2e contra un MATIAS simulado (`tests/e2e/habilitacion.mjs`) y notas internas (`tasks/todo.md:186-191`) según las cuales la habilitación de cada droguería sigue pendiente.

`DIAN: CONFORMIDAD TÉCNICA PARCIAL`

- **A favor:** el modelo delegado es sólido. La validación previa se respeta: solo hay «aceptado» con un veredicto válido devuelto por MATIAS, y lo simulado va marcado. La idempotencia está bien resuelta (`idem_key`, uuid estable y regla 90), la numeración usa bloqueos y comprueba vigencia y agotamiento, la NC espera el CUFE del original, y el IVA va por tarifa con excluidos sin tributo. Las 15 pruebas del emisor pasan.
- **En contra:**
  - Incumplimientos de diseño: sin tope de 5 UVT en el POS, sin contingencia del art. 37, la marca de «rechazado» a las 48 h permite anular sin NC un documento quizá validado, la factura a consumidor final está bloqueada y no hay control de plazos del documento soporte.
  - La ND, el DS y la nota de ajuste no están validados en el sandbox: lo dice el propio código.
  - No se ejecutaron las pruebas de base de datos ni las e2e (no había Postgres ni servidor), y la aceptación en el sandbox que mencionan los comentarios no se pudo reproducir.

No es «FALLIDA» porque lo que sí se emite (FE, POS y NC) sigue el flujo correcto y falla de forma segura (rechaza en vez de emitir mal). Tampoco es «PROBADA» porque falta evidencia de punta a punta contra la DIAN y quedan los P1.
