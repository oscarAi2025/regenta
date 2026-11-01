// Guías para regentes y dueños de droguería (silo SEO hacia la portada). Solo hechos verificados en la fuente que se enlaza;
// lo que es práctica recomendada y no norma se dice así. Revisadas el 1 de noviembre de 2026.

export type Bloque = { h2: string; p?: string[]; lista?: string[]; pasos?: string[]; nota?: string };
export type Guia = {
  slug: string; titulo: string; descripcion: string; h1: string; entradilla: string; actualizada: string;
  bloques: Bloque[]; preguntas: [string, string][]; fuentes: [string, string][]; relacionadas: string[];
  cta: { titulo: string; texto: string };
};

export const GUIAS: Guia[] = [
  {
    slug: "como-elegir-software-drogueria",
    titulo: "Cómo elegir software para droguería: 12 criterios",
    descripcion: "Los 12 criterios para elegir el mejor software para tu droguería en Colombia: facturación DIAN, lotes, vencimientos, alertas INVIMA, precio real y soporte.",
    h1: "Cómo elegir el mejor software para tu droguería",
    entradilla: "Casi todos los programas prometen facturación electrónica. La diferencia está en lo que pasa después de cobrar: el lote que sale, lo que se vence, la alerta del INVIMA y lo que cuesta de verdad al final del año. Estos son los criterios que usamos como distribuidor que ve droguerías todos los días.",
    actualizada: "2026-11-01",
    bloques: [
      { h2: "Lo básico: facturar y cobrar", lista: [
        "1. POS electrónico y factura electrónica de venta en la misma caja, según la Resolución 165 de 2023 de la DIAN.",
        "2. Certificado digital y habilitación ante la DIAN incluidos, o con su costo dicho desde el principio.",
        "3. Que una venta no se duplique ni se pierda si se cae internet a mitad del cobro, y que nada se pueda borrar: se anula con motivo.",
        "4. Todos los medios de pago del mostrador: efectivo, Nequi, Daviplata, Bre-B, QR, tarjeta y transferencia." ] },
      { h2: "Lo que separa a un software de droguería de un POS genérico", lista: [
        "5. Inventario por lote y fecha de vencimiento en cada movimiento, con venta del lote que vence primero.",
        "6. Bloqueo de la venta de lotes vencidos.",
        "7. Venta por caja y por unidad del mismo producto sin descuadrar el inventario.",
        "8. Alertas sanitarias del INVIMA cruzadas con tus lotes y registros sanitarios, con constancia de la revisión.",
        "9. Pedido sugerido calculado con tus ventas, no a ojo." ] },
      { h2: "Lo que define si te sirve en el día a día", lista: [
        "10. Precio real del año: plan, documentos incluidos y lo que cuesta pasarse del tope, certificado e implementación.",
        "11. Que funcione en el navegador del computador, la tableta y el celular, sin instalar nada.",
        "12. Soporte por WhatsApp de gente que conozca el sector, y que puedas probarlo antes de pagar." ],
        nota: "Pide siempre una demostración con datos parecidos a los tuyos y revisa la página de precios del proveedor: los precios cambian." },
      { h2: "Cómo usar estos criterios", p: [
        "Haz una tabla con los programas que estés mirando y marca cada criterio. Los primeros cuatro los cumplen casi todos; del 5 al 9 está la diferencia entre un programa para tienda y uno para droguería; el 10 te evita sorpresas en la factura del proveedor." ] },
    ],
    preguntas: [
      ["¿Cuál es el mejor software para droguería?", "El que cumpla los 12 criterios a un precio que puedas sostener. Para una droguería pesan más el control por lote y vencimiento y las alertas del INVIMA que funciones de tienda general."],
      ["¿Un POS genérico sirve para una droguería?", "Sirve para cobrar y facturar, pero normalmente no lleva el inventario por lote, no bloquea vencidos ni cruza las alertas del INVIMA, que es donde una droguería pierde plata o se expone en la visita."],
    ],
    fuentes: [
      ["Resolución DIAN 000165 de 2023 (normograma DIAN)", "https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0165_2023.htm"],
      ["Alertas sanitarias del INVIMA", "https://www.invima.gov.co/"],
    ],
    relacionadas: ["cuanto-cuesta-software-drogueria", "pos-electronico-drogueria-dian"],
    cta: { titulo: "Regenta cumple los 12", texto: "Facturación DIAN con certificado incluido, lotes y vencimientos, alertas INVIMA, pedido sugerido e IA. Pruébalo en un clic, sin registro." },
  },
  {
    slug: "cambiar-software-drogueria",
    titulo: "Cambiar de software de droguería sin perder datos",
    descripcion: "Cómo pasar de tu programa actual a uno nuevo sin perder productos, existencias por lote ni la numeración DIAN: pasos, qué exportar y en qué orden.",
    h1: "Cómo cambiar de software de droguería sin perder inventario ni lotes",
    entradilla: "Cambiar de programa da miedo por una razón: perder el inventario o quedarse un día sin poder facturar. Con un orden claro se hace en un fin de semana. Este es el que recomendamos.",
    actualizada: "2026-11-01",
    bloques: [
      { h2: "Antes de cambiar", pasos: [
        "Exporta desde tu programa actual la lista de productos con código de barras, precio de venta y unidades por caja (casi todos exportan a Excel).",
        "Exporta las existencias. Si tu programa no lleva lotes, haz un conteo físico por lote y fecha de vencimiento: es el momento de empezar bien.",
        "Revisa tu resolución de numeración con la DIAN: el programa nuevo debe usar una numeración vigente y no repetir números ya usados.",
        "Elige un día de poco movimiento para el cambio y avisa al equipo." ] },
      { h2: "El día del cambio", pasos: [
        "Carga los productos en el programa nuevo desde el Excel.",
        "Registra las existencias como inventario inicial, por lote y con su fecha de vencimiento.",
        "Haz una venta de prueba con POS y otra con factura electrónica, y una anulación, antes de abrir.",
        "Deja el programa viejo solo para consulta: no vendas en los dos a la vez." ] },
      { h2: "Después del cambio", lista: [
        "Revisa en la primera semana que los totales de caja cuadren con los medios de pago.",
        "Confirma con tu contador cómo guardar la información del programa anterior.",
        "Capacita a cada auxiliar con su usuario y su rol." ] },
    ],
    preguntas: [
      ["¿Pierdo el historial de ventas?", "El historial queda en tu programa anterior y en los documentos electrónicos ya reportados. En el programa nuevo empiezas con productos y existencias; las ventas nuevas se registran desde ese día."],
      ["¿Regenta me ayuda a pasarme?", "Sí. Puedes cargar tus productos desde Excel y, en el plan Pro, los cargamos nosotros. También te acompañamos en la primera venta."],
    ],
    fuentes: [["Resolución DIAN 000165 de 2023 (normograma DIAN)", "https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0165_2023.htm"]],
    relacionadas: ["como-elegir-software-drogueria", "inventario-por-lotes-drogueria"],
    cta: { titulo: "Te pasamos tus productos", texto: "Carga desde Excel incluida; en el plan Pro lo hacemos nosotros. Certificado digital y habilitación DIAN incluidos." },
  },
  {
    slug: "kardex-drogueria",
    titulo: "Kardex de droguería: cómo llevarlo por lote",
    descripcion: "Qué es el kardex de una droguería, qué debe registrar cada movimiento (lote, vencimiento, entrada, salida, saldo) y cómo llevarlo sin cuaderno ni Excel.",
    h1: "Kardex de droguería por lote y vencimiento",
    entradilla: "El kardex es la historia de cada producto: qué entró, qué salió y cuánto queda. En una droguería no basta con el producto: hay que saber de qué lote y con qué fecha de vencimiento.",
    actualizada: "2026-11-01",
    bloques: [
      { h2: "Qué es el kardex", p: [
        "Es el registro de todos los movimientos de inventario de un producto, en orden: compras, ventas, devoluciones, ajustes y bajas, con el saldo después de cada uno. Sirve para saber cuánto tienes, para cuadrar el inventario físico y para responder de dónde salió cada unidad." ] },
      { h2: "Qué debe registrar cada movimiento en una droguería", lista: [
        "Fecha y hora, y quién lo hizo.",
        "Producto, lote y fecha de vencimiento.",
        "Tipo de movimiento: compra, venta, devolución, ajuste, baja por vencimiento o avería.",
        "Cantidad que entra o sale, en unidades exactas (también las vendidas sueltas).",
        "Saldo resultante del lote y del producto.",
        "Documento de soporte: factura del proveedor, POS o factura electrónica, acta de baja." ] },
      { h2: "Por qué el cuaderno y el Excel se quedan cortos", p: [
        "A mano, el kardex se atrasa el día de más venta, no cuadra con las unidades sueltas y cualquiera puede borrar una fila. Un sistema lo arma solo con cada venta y cada recepción, por lote, y no deja borrar: los errores se corrigen con un ajuste que queda registrado." ] },
    ],
    preguntas: [
      ["¿El kardex se lleva por producto o por lote?", "Por producto y, en una droguería, también por lote: así sabes qué lote vendiste, cuál vence primero y qué separar si sale una alerta."],
      ["¿Regenta lleva el kardex?", "Sí. Cada venta, recepción, ajuste y anulación queda como movimiento del lote, con quién lo hizo y cuándo; nada se borra."],
    ],
    fuentes: [["Alertas sanitarias del INVIMA", "https://www.invima.gov.co/"]],
    relacionadas: ["inventario-por-lotes-drogueria", "control-fechas-vencimiento-drogueria"],
    cta: { titulo: "Kardex automático por lote", texto: "Regenta registra cada movimiento por lote y vencimiento, sin cuaderno ni Excel, y te muestra el saldo al instante." },
  },
  {
    slug: "facturacion-electronica-sector-salud-rips",
    titulo: "Facturación electrónica en salud y RIPS: guía 2026",
    descripcion: "Qué exige la Resolución 948 de 2026 a IPS y prestadores (RIPS como soporte de la factura electrónica) y qué cambia o no para droguerías y distribuidoras.",
    h1: "Facturación electrónica en el sector salud y RIPS en 2026",
    entradilla: "En salud no basta con la factura electrónica de la DIAN: a los prestadores se les exige además el RIPS como soporte. En 2026 cambió la norma. Esto es lo que dice, a quién aplica y dónde encaja el software de una droguería o una distribuidora.",
    actualizada: "2026-11-01",
    bloques: [
      { h2: "La norma vigente: Resolución 948 de 2026", p: [
        "El Ministerio de Salud expidió la Resolución 948 del 14 de mayo de 2026, que regula el Registro Individual de Prestación de Servicios de Salud (RIPS) como soporte de la factura electrónica de venta en salud. Su artículo 23 derogó las Resoluciones 2275 de 2023, 558 de 2024 y 1884 de 2024, que eran las que se aplicaban antes.",
        "La misma resolución fijó fechas: reglas de rechazo desde el 1 de junio de 2026 y ajustes en los programas de facturación desde el 1 de julio de 2026." ] },
      { h2: "A quién aplica", lista: [
        "Prestadores de servicios de salud: IPS, profesionales independientes y transporte asistencial.",
        "Proveedores de tecnologías en salud.",
        "Entidades responsables de pago y otros pagadores del sistema (EPS, aseguradoras SOAT, ADRES, entre otros).",
      ], nota: "La resolución no menciona a las droguerías por su nombre. Si tu droguería le factura a una EPS u otro pagador del sistema, revisa con tu contador si te aplica." },
      { h2: "Qué cambia para una droguería o una distribuidora", p: [
        "La venta al público en el mostrador sigue con POS electrónico o factura electrónica de venta según la Resolución DIAN 165 de 2023. La venta de una distribuidora a droguerías, clínicas u hospitales es una venta comercial con factura electrónica de venta.",
        "Cuando el comprador es una IPS, la factura es la normal de la DIAN: el RIPS lo arma la IPS cuando factura sus propios servicios a la EPS." ] },
      { h2: "Si eres una IPS", p: [
        "La facturación de servicios de salud con RIPS se hace con el software de facturación de tu IPS. Si además tienes una droguería o un punto de venta de medicamentos como establecimiento aparte, ese mostrador sí se maneja como cualquier droguería: caja, POS o factura, inventario por lote y vencimientos." ] },
    ],
    preguntas: [
      ["¿Sigue vigente la Resolución 2275 de 2023?", "No. La Resolución 948 de 2026 la derogó en su artículo 23, junto con las Resoluciones 558 y 1884 de 2024."],
      ["¿Mi droguería tiene que enviar RIPS?", "La resolución está dirigida a prestadores, proveedores de tecnologías en salud y pagadores, y no nombra a las droguerías. Si solo vendes al público, tu obligación es el POS o la factura electrónica de la DIAN; si le facturas a pagadores del sistema, confírmalo con tu contador."],
      ["¿Regenta genera RIPS?", "No. Regenta es facturación y gestión para droguerías, farmacias y distribuidoras: POS y factura electrónica, inventario por lote, cartera e IA."],
    ],
    fuentes: [
      ["Resolución 948 de 2026, Ministerio de Salud (texto completo)", "https://sidn.ramajudicial.gov.co/SIDN//NORMATIVA/TEXTOS_COMPLETOS/8_RESOLUCIONES/RESOLUCIONES%202026/MSPS%20Resolucion%20000948%20de%202026.pdf"],
      ["Resolución 558 de 2024 (normograma Supersalud)", "https://normograma.supersalud.gov.co/compilacion/docs/resolucion_minsaludps_0558_2024.htm"],
      ["Resolución DIAN 000165 de 2023 (normograma DIAN)", "https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0165_2023.htm"],
    ],
    relacionadas: ["pos-electronico-drogueria-dian", "cuanto-cuesta-software-drogueria"],
    cta: { titulo: "Facturación para el mostrador y la distribución", texto: "Regenta hace POS y factura electrónica, crédito y cartera, con el inventario por lote que exige el sector farmacéutico." },
  },
  {
    slug: "pos-electronico-drogueria-dian",
    titulo: "POS electrónico en droguerías: guía DIAN 2026",
    descripcion: "Qué es el documento equivalente electrónico POS, cuándo debes hacer factura electrónica (más de 5 UVT) y cómo cumplir la Resolución 165 en tu droguería.",
    h1: "POS electrónico y factura electrónica en droguerías",
    entradilla: "Desde 2024 el tiquete de caja de una droguería ya no es un papel cualquiera: es un documento electrónico que se reporta a la DIAN. Esto es lo que dice la norma y lo que tu programa de caja tiene que hacer por ti.",
    actualizada: "2026-11-01",
    bloques: [
      { h2: "Qué es el documento equivalente electrónico POS", p: [
        "La DIAN reglamentó los documentos equivalentes electrónicos con la Resolución 000165 del 1 de noviembre de 2023. Entre ellos está el tiquete de máquina registradora con sistema POS, que en su versión electrónica es el documento que entrega la caja de la droguería en cada venta.",
        "La resolución recuerda que el POS se puede expedir cuando la venta no supera 5 UVT, y que el comprador puede exigir factura electrónica." ] },
      { h2: "Cuánto son 5 UVT en 2026", p: [
        "La UVT para 2026 quedó en $52.374 (Resolución DIAN 000238 de 2025). Por tanto, 5 UVT son $261.870: ventas hasta ese valor pueden ir con POS electrónico; por encima, o si el cliente lo pide, va factura electrónica." ],
        nota: "Confirma con tu contador cómo aplica el tope a tu caso (por ejemplo, ventas a empresas o a crédito)." },
      { h2: "Desde cuándo es obligatorio", p: [
        "La Resolución 0008 de 2024 modificó el calendario del artículo 23 de la Resolución 165: grandes contribuyentes desde el 1 de mayo de 2024, declarantes de renta desde el 1 de junio de 2024 y no declarantes desde el 1 de julio de 2024. Hoy aplica a todos." ] },
      { h2: "Qué debe hacer tu programa de caja", lista: [
        "Numerar cada tiquete con tu resolución de numeración y no repetir números aunque se caiga la red a mitad del cobro.",
        "Guardar el detalle de cada venta (productos, IVA, medio de pago) sin que nadie lo pueda borrar: los errores se corrigen anulando con motivo y nota crédito.",
        "Enviar el documento a la DIAN (con software propio habilitado o por medio de un proveedor tecnológico) y avisarte si alguno fue rechazado.",
        "Pasar de POS a factura electrónica cuando la venta supere el tope o el cliente la pida." ] },
      { h2: "Errores frecuentes en droguerías", lista: [
        "Seguir usando un POS de papel o un programa que no envía nada a la DIAN.",
        "Borrar o editar ventas para «cuadrar» la caja, en vez de anularlas con motivo.",
        "Vender pastillas sueltas sin que el inventario descuente unidades: la venta y el inventario dejan de coincidir." ] },
    ],
    preguntas: [
      ["¿El tiquete POS de papel sigue siendo válido?", "El calendario de la Resolución 0008 de 2024 ya se cumplió para todos los grupos (el último, el 1 de julio de 2024). El documento debe ser electrónico."],
      ["¿Cuándo tengo que hacer factura electrónica y no POS?", "Cuando la venta supera 5 UVT ($261.870 en 2026) o cuando el comprador la exige."],
    ],
    fuentes: [
      ["Resolución DIAN 000165 de 2023 (normograma DIAN)", "https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0165_2023.htm"],
      ["Resolución DIAN 0008 de 2024, calendario (normograma)", "https://cancilleria.gov.co/normograma/compilacion/docs/resolucion_dian_0008_2024.htm"],
      ["Resolución DIAN 000238 de 2025, UVT 2026 (normograma DIAN)", "https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0238_2025.htm"],
    ],
    relacionadas: ["inventario-por-lotes-drogueria", "control-fechas-vencimiento-drogueria"],
    cta: { titulo: "Una caja hecha para droguería", texto: "Regenta numera cada venta con tu resolución, nunca duplica un cobro y no deja borrar: se anula con motivo. El envío a la DIAN se está integrando y se activa en tu cuenta al terminar." },
  },
  {
    slug: "control-fechas-vencimiento-drogueria",
    titulo: "Control de fechas de vencimiento en droguerías",
    descripcion: "Cómo controlar vencimientos en tu droguería: registro por lote, revisión periódica, FEFO, área para vencidos y qué hacer antes de que se te venza la mercancía.",
    h1: "Control de fechas de vencimiento en droguerías: guía práctica",
    entradilla: "Cada producto que se vence en la estantería es plata que se pierde dos veces: lo que pagaste y lo que no vendiste. Así se controla bien, y así se hace sin cuaderno.",
    actualizada: "2026-11-01",
    bloques: [
      { h2: "Qué dice la norma", p: [
        "El manual de la Resolución 1403 de 2007 (modelo de gestión del servicio farmacéutico) pide organizar el almacenamiento de forma que el lote más próximo a vencerse sea lo primero en dispensarse, y contar con un área para los productos que deben destruirse por vencimiento o deterioro." ],
        nota: "Tu secretaría de salud puede pedir formatos y frecuencias concretas en la visita: revisa su acta de inspección." },
      { h2: "Registra lote y vencimiento al recibir", p: [
        "El control empieza en la recepción: si no anotas lote y fecha de cada entrada, después solo puedes revisar a ojo. Lo práctico es registrar ambos datos en el momento de recibir la factura del proveedor." ] },
      { h2: "FEFO: primero lo que vence primero", p: [
        "FIFO despacha lo que llegó primero; FEFO despacha lo que vence primero. En droguería importa FEFO: a veces llega un lote nuevo que vence antes que el que ya tenías." ] },
      { h2: "Revisa con anticipación, no el día que vence", lista: [
        "Haz una revisión periódica (muchas droguerías la hacen mensual) de lo que vence en los próximos meses.",
        "Para lo que no alcanzarás a vender: exhibición, oferta o devolución al proveedor si tu acuerdo comercial lo permite.",
        "Lo vencido sale de la venta de inmediato y va al área de vencidos hasta su disposición final." ] },
      { h2: "Cómo hacerlo sin cuaderno", p: [
        "Un programa que guarda lote y vencimiento en cada entrada puede vender siempre del lote más próximo, bloquear la venta de lo vencido y, con tu ritmo de venta, decirte qué lote no alcanzará a venderse antes de su fecha." ] },
    ],
    preguntas: [
      ["¿Qué es FEFO?", "First Expired, First Out: se dispensa primero el lote que vence primero, que es lo que pide la Resolución 1403 de 2007 para el servicio farmacéutico."],
      ["¿Qué hago con un producto vencido?", "Retíralo de la venta, llévalo al área de vencidos y gestiona su disposición final según las indicaciones de tu secretaría de salud."],
    ],
    fuentes: [
      ["Resolución 1403 de 2007 (normograma INVIMA)", "https://normograma.invima.gov.co/normograma/compilacion/docs/resolucion_minproteccion_1403_2007.htm"],
      ["Resolución 1403 de 2007, PDF (INVIMA)", "https://www.invima.gov.co/sites/default/files/resolucion_1403_2007.pdf"],
    ],
    relacionadas: ["semaforizacion-medicamentos-drogueria", "inventario-por-lotes-drogueria"],
    cta: { titulo: "Que no se te vuelva a vencer nada sin aviso", texto: "Regenta vende siempre del lote que vence antes, no deja vender lo vencido y te muestra con meses de anticipación qué lotes no alcanzarás a vender y cuánta plata representan." },
  },
  {
    slug: "semaforizacion-medicamentos-drogueria",
    titulo: "Semaforización de medicamentos en droguería: guía",
    descripcion: "Qué es la semaforización de vencimientos, cómo definir rangos rojo, amarillo y verde, y cómo automatizar las alertas por lote en tu droguería.",
    h1: "Semaforización de vencimientos en droguerías",
    entradilla: "La semaforización es una forma visual de saber qué se vence pronto. No es una norma con rangos fijos: es una práctica que cada establecimiento define en su procedimiento.",
    actualizada: "2026-11-01",
    bloques: [
      { h2: "Qué es y para qué sirve", p: [
        "Consiste en marcar cada producto o lote con un color según el tiempo que le falta para vencer. Sirve para actuar antes: rotar, ofertar o devolver mientras todavía se puede." ],
        nota: "No encontramos en la Resolución 1403 de 2007 rangos de semaforización obligatorios. Hospitales y servicios farmacéuticos los definen en sus propios protocolos." },
      { h2: "Rangos de ejemplo", lista: [
        "Rojo: vence en 30 días o menos. Acción inmediata.",
        "Amarillo: vence entre 31 y 90 días. Planear rotación u oferta.",
        "Verde: más de 90 días." ],
        p: ["Son los rangos que usa Regenta por defecto. Ajústalos a tu procedimiento si tu droguería ya tiene otros."] },
      { h2: "En la estantería y en el programa", p: [
        "La etiqueta de color en la estantería ayuda al auxiliar; el semáforo en el programa, por lote, ayuda a no depender de que alguien se acuerde de cambiar la etiqueta." ] },
      { h2: "Qué hacer en cada color", lista: [
        "Rojo: exhibición al frente, ofrecerlo en la venta, devolución si el proveedor la acepta.",
        "Amarillo: no volver a pedir ese producto hasta que rote; revisar si hay un lote más nuevo que deba esperar.",
        "Vencido: fuera de la venta y al área de vencidos." ] },
    ],
    preguntas: [["¿La semaforización es obligatoria?", "Lo que pide la Resolución 1403 de 2007 es dispensar primero el lote más próximo a vencerse y separar lo vencido. Los colores y rangos son una práctica para cumplirlo."]],
    fuentes: [
      ["Resolución 1403 de 2007 (normograma INVIMA)", "https://normograma.invima.gov.co/normograma/compilacion/docs/resolucion_minproteccion_1403_2007.htm"],
      ["Ejemplo de protocolo institucional de semaforización (maternoinfantil.gov.co)", "https://maternoinfantil.gov.co/wp-content/uploads/2022/10/15.-PROTOCOLO-DE-SEMAFORIZACION-DE-MEDICAMENTOS-Y-DISPOSITIVOS.docx"],
    ],
    relacionadas: ["control-fechas-vencimiento-drogueria", "inventario-por-lotes-drogueria"],
    cta: { titulo: "El semáforo, automático y por lote", texto: "En Regenta cada lote aparece en rojo o ámbar según su fecha, y la caja te sugiere vender primero lo que conviene mover." },
  },
  {
    slug: "alertas-sanitarias-invima-drogueria",
    titulo: "Alertas sanitarias INVIMA: cómo revisarlas en droguería",
    descripcion: "Dónde consultar las alertas sanitarias del INVIMA, cómo cruzarlas con tu inventario por lote y registro sanitario, y qué hacer si tienes un producto afectado.",
    h1: "Alertas sanitarias del INVIMA: guía para droguerías",
    entradilla: "El INVIMA publica alertas casi a diario: falsificaciones, lotes defectuosos, productos fraudulentos. La pregunta para la droguería es una sola: ¿tengo eso en mi estantería?",
    actualizada: "2026-11-01",
    bloques: [
      { h2: "Dónde se publican", p: [
        "En invima.gov.co/alertas-sanitarias. El listado se puede filtrar por dirección (medicamentos, alimentos, dispositivos, cosméticos) y distingue entre alertas sanitarias e informes de seguridad. El 1 de noviembre de 2026 tenía 6.271 documentos.",
        "Cada alerta trae un número (por ejemplo, 329-2026), la fecha, el motivo, una tabla con producto, registro sanitario, titular y lote, el PDF y recomendaciones separadas para la comunidad, los profesionales y los establecimientos." ] },
      { h2: "Un ejemplo real", p: [
        "La alerta 329-2026 (9 de octubre de 2026) informa la falsificación de Buscapina® Compositum NF tabletas recubiertas, lote F0537A, registro INVIMA 2020M-003171-R4. Para establecimientos como las droguerías, la recomendación es no distribuir ni comercializar ese lote." ] },
      { h2: "Cómo cruzarlas con tu inventario", pasos: [
        "Lee el producto, el registro sanitario y el lote o lotes de la alerta (a veces el lote solo aparece en el título o en el PDF).",
        "Busca en tu inventario por nombre y por registro sanitario.",
        "Si tienes el producto, revisa los lotes que tienes en existencias contra los de la alerta.",
        "Deja constancia de la revisión: fecha, quién la hizo y qué encontraste." ] },
      { h2: "Si tienes un producto afectado", lista: [
        "Sepáralo de la venta de inmediato.",
        "Sigue las recomendaciones de la propia alerta para establecimientos.",
        "Consulta con tu secretaría de salud el manejo que corresponda." ] },
      { h2: "Por qué automatizarlo", p: [
        "Revisar a mano cada alerta contra cientos de productos y lotes no es realista en una droguería con un solo regente. Un programa que guarda lote y registro sanitario puede hacer el cruce solo y avisarte únicamente cuando algo te toca." ] },
    ],
    preguntas: [
      ["¿Un programa reemplaza la revisión del regente?", "No. El programa encuentra las coincidencias y guarda la evidencia; la revisión física del producto y la decisión son del regente o director técnico."],
      ["¿Qué es un informe de seguridad?", "Es un documento del INVIMA sobre riesgos asociados a un medicamento o grupo de medicamentos (por ejemplo, un efecto adverso), distinto de la alerta sobre un producto o lote concreto."],
    ],
    fuentes: [
      ["Alertas sanitarias (INVIMA)", "https://www.invima.gov.co/alertas-sanitarias"],
      ["Alerta 329-2026, Buscapina Compositum NF lote F0537A (INVIMA)", "https://www.invima.gov.co/alertas-sanitarias/falsificacion-del-producto-buscapina-compositum-nf-tabletas-recubiertas-lote-f0537a"],
    ],
    relacionadas: ["consultar-registro-sanitario-invima", "inventario-por-lotes-drogueria"],
    cta: { titulo: "Las alertas del INVIMA, cruzadas con tu inventario", texto: "Regenta lee las alertas de medicamentos del INVIMA y te avisa solo cuando coinciden con tu inventario: si tienes el lote, si es el mismo registro sanitario o si el nombre coincide. Y guarda quién lo revisó y cuándo." },
  },
  {
    slug: "consultar-registro-sanitario-invima",
    titulo: "¿Registro sanitario INVIMA vigente? Cómo consultarlo",
    descripcion: "Cómo consultar un registro sanitario en el INVIMA, interpretar su estado y evitar recibir en tu droguería productos con registro vencido o fraudulento.",
    h1: "Cómo saber si un registro sanitario está vigente",
    entradilla: "El registro sanitario es lo primero que se revisa en la recepción técnica. Esto es lo que ofrece el INVIMA para consultarlo y cómo usarlo en la droguería.",
    actualizada: "2026-11-01",
    bloques: [
      { h2: "La consulta oficial", p: [
        "El INVIMA tiene una página de consulta de registros sanitarios con búsqueda básica, búsqueda avanzada e InvimÁgil. Allí buscas por número de registro, nombre del producto o titular y ves los datos del registro." ] },
      { h2: "Los estados que vas a encontrar", p: [
        "En los datos abiertos del INVIMA los medicamentos se publican en conjuntos separados según el estado del Código Único de Medicamentos (CUM): vigentes, vencidos y en trámite de renovación. Un registro en trámite de renovación no es lo mismo que uno vencido: revisa el detalle." ] },
      { h2: "En la recepción técnica", lista: [
        "Que el producto tenga registro sanitario y coincida con lo que dice la factura.",
        "Que el lote y la fecha de vencimiento estén legibles y coincidan con el empaque.",
        "Que el empaque no muestre señales de alteración.",
        "Guardar el registro sanitario en la ficha del producto: así podrás cruzarlo con las alertas del INVIMA." ] },
      { h2: "Señales de alerta", lista: [
        "Precio muy por debajo del mercado o proveedor sin documentos.",
        "Diferencias de diseño, fuente o color frente al empaque que conoces.",
        "Lote o fechas que no coinciden entre el empaque y la factura." ] },
    ],
    preguntas: [["¿Dónde consulto un registro sanitario?", "En la página de consulta de registros sanitarios del INVIMA (invima.gov.co/consulta-registros-sanitarios)."]],
    fuentes: [
      ["Consulta de registros sanitarios (INVIMA)", "https://invima.gov.co/consulta-registros-sanitarios"],
      ["Código Único de Medicamentos vigentes (datos.gov.co)", "https://www.datos.gov.co/resource/i7cb-raxc.json"],
    ],
    relacionadas: ["alertas-sanitarias-invima-drogueria", "inventario-por-lotes-drogueria"],
    cta: { titulo: "El registro sanitario, en cada producto", texto: "En Regenta guardas el registro sanitario en la ficha del producto (o lo cargas desde Excel) y el sistema lo cruza con cada alerta nueva del INVIMA." },
  },
  {
    slug: "inventario-por-lotes-drogueria",
    titulo: "Inventario por lotes en droguería: guía FEFO",
    descripcion: "Cómo llevar el inventario de una droguería por lote y fecha de vencimiento: recepción, FEFO al vender, venta por unidad, conteos y qué pedir.",
    h1: "Inventario por lotes y vencimiento en droguerías",
    entradilla: "Una droguería no tiene «20 cajas de losartán»: tiene 12 del lote que vence en marzo y 8 del que vence en 2028. Llevarlo así cambia lo que vendes, lo que pides y lo que pierdes.",
    actualizada: "2026-11-01",
    bloques: [
      { h2: "Por qué por lote", lista: [
        "Para vender primero lo que vence primero (FEFO), como pide la Resolución 1403 de 2007.",
        "Para saber exactamente qué lote tienes cuando sale una alerta del INVIMA.",
        "Para que el valor de tu inventario y tus pérdidas por vencimiento sean reales." ] },
      { h2: "Recepción: el momento clave", p: [
        "Al recibir la factura del proveedor anota por cada producto el lote, la fecha de vencimiento, la cantidad (cajas y unidades sueltas) y el costo. Escanear el código de barras ahorra tiempo y errores." ] },
      { h2: "Vender por unidad sin descuadrar", p: [
        "Si vendes pastillas sueltas, el inventario tiene que llevarse en unidades: una caja de 30 tabletas son 30 unidades. Así la venta de 3 tabletas descuenta 3, del lote que vence antes." ] },
      { h2: "Conteos y ajustes", lista: [
        "Haz conteos parciales con frecuencia en lugar de un solo inventario anual.",
        "Cada diferencia se ajusta con motivo y queda registrado quién la hizo.",
        "Nada se borra: las correcciones son movimientos nuevos." ] },
      { h2: "Qué pedir y cuánto", p: [
        "Con el historial de ventas por producto se calcula cuánto vendes por día, para cuántos días te alcanza lo que tienes y cuántas cajas pedir para cubrir la entrega del proveedor y las semanas siguientes. Así no pides de más lo que no rota ni te quedas sin lo que más se vende." ] },
    ],
    preguntas: [["¿Puedo llevar lotes en Excel?", "Sí, pero cada venta tendría que descontar a mano del lote correcto. Un programa de caja con lotes lo hace solo en cada venta."]],
    fuentes: [["Resolución 1403 de 2007 (normograma INVIMA)", "https://normograma.invima.gov.co/normograma/compilacion/docs/resolucion_minproteccion_1403_2007.htm"]],
    relacionadas: ["control-fechas-vencimiento-drogueria", "alertas-sanitarias-invima-drogueria"],
    cta: { titulo: "Lotes, unidades y pedido sugerido en un solo lugar", texto: "Regenta recibe mercancía por lote, vende por caja o por unidad del lote que vence antes y te arma el pedido sugerido con tus ventas reales." },
  },
  {
    slug: "como-hacer-pedido-drogueria",
    titulo: "Cómo hacer el pedido de una droguería sin agotados",
    descripcion: "Cómo calcular cuánto pedir en tu droguería: ritmo de venta, días de entrega, cobertura, existencias y redondeo a cajas. Con fórmula y ejemplo.",
    h1: "Cómo hacer el pedido de una droguería (con fórmula y ejemplo)",
    entradilla: "Pedir a ojo deja dos huecos: lo que se agota y lo que se queda quieto en la estantería. Con tres números de cada producto puedes calcular el pedido justo.",
    actualizada: "2026-11-01",
    bloques: [
      { h2: "Los tres números que necesitas", lista: [
        "Ritmo de venta: unidades que vendes por día (mejor si das más peso a las últimas semanas).",
        "Días de entrega: cuánto tarda tu proveedor desde que pides hasta que recibes.",
        "Días de cobertura: para cuántos días quieres quedar surtido después de recibir." ] },
      { h2: "La fórmula", p: [
        "Unidades a pedir = ritmo de venta × (días de entrega + días de cobertura) − existencias vigentes.",
        "Si el resultado es negativo, no pidas. Si es positivo, redondea hacia arriba a cajas completas. Las existencias vencidas no cuentan." ] },
      { h2: "Ejemplo", p: [
        "Vendes 6 tabletas diarias de un antihipertensivo que viene en caja de 30. Tu proveedor entrega en 3 días y quieres cubrir 15. Necesitas 6 × 18 = 108 unidades; tienes 40 vigentes; faltan 68, es decir 3 cajas (90 unidades)." ] },
      { h2: "Errores que cuestan plata", lista: [
        "Pedir por lo que se vendió el mes pasado sin mirar la tendencia de las últimas semanas.",
        "Contar como existencias las unidades vencidas o próximas a vencer que no vas a vender.",
        "Volver a pedir productos que no rotan hace más de 45 días.",
        "No tener en cuenta que algunos días (por ejemplo, el fin de semana) vendes más." ] },
      { h2: "Automatizarlo", p: [
        "Un programa de caja que guarda cada venta por producto puede hacer este cálculo todos los días y darte el pedido listo para revisar y enviar." ] },
    ],
    preguntas: [["¿Cada cuánto debo pedir?", "Depende de tu proveedor y de tu flujo de caja; lo importante es que la cobertura que elijas te alcance hasta el siguiente pedido."]],
    fuentes: [],
    relacionadas: ["como-reducir-vencidos-drogueria", "inventario-por-lotes-drogueria"],
    cta: { titulo: "El pedido, calculado solo", texto: "Regenta hace esta cuenta con tus ventas de 8 semanas, te muestra lo que se agota primero y te deja enviar el pedido por WhatsApp o Excel." },
  },
  {
    slug: "como-reducir-vencidos-drogueria",
    titulo: "Cómo reducir los vencidos en tu droguería: 8 prácticas",
    descripcion: "Prácticas para que no se te venza la mercancía: FEFO, revisión anticipada, pedido por ritmo de venta, exhibición, devoluciones y control de lo que no rota.",
    h1: "Cómo reducir los productos vencidos en tu droguería",
    entradilla: "Cada producto vencido es una pérdida doble: lo que pagaste y lo que dejaste de vender. Estas prácticas atacan el problema desde la compra hasta la estantería.",
    actualizada: "2026-11-01",
    bloques: [
      { h2: "En la compra", lista: [
        "Pide por ritmo de venta, no por oferta: un descuento que se vence no es ahorro.",
        "Revisa la fecha de vencimiento al recibir y rechaza lotes demasiado cortos para tu rotación.",
        "No vuelvas a pedir lo que no se vende hace más de 45 días." ] },
      { h2: "En la estantería", lista: [
        "Aplica FEFO: adelante lo que vence primero (la Resolución 1403 de 2007 pide dispensar primero el lote más próximo a vencerse).",
        "Marca con color los lotes que vencen pronto y revisa con meses de anticipación, no el día que vencen.",
        "Exhibe y ofrece lo que tiene riesgo: el auxiliar tiene que saber qué conviene vender primero." ] },
      { h2: "Cuando ya hay riesgo", lista: [
        "Negocia devoluciones o cambios con tu proveedor antes de la fecha, si tu acuerdo lo permite.",
        "Lo vencido sale de la venta de inmediato y va al área de vencidos." ] },
      { h2: "Mídelo", p: [
        "Lo que no se mide no baja: calcula cada mes cuánto se te venció a costo y qué productos fueron. Con eso ajustas compras y exhibición." ] },
    ],
    preguntas: [["¿Qué es un buen porcentaje de vencidos?", "No hay una cifra oficial; lo importante es medir el tuyo cada mes y bajarlo."]],
    fuentes: [["Resolución 1403 de 2007 (normograma INVIMA)", "https://normograma.invima.gov.co/normograma/compilacion/docs/resolucion_minproteccion_1403_2007.htm"]],
    relacionadas: ["control-fechas-vencimiento-drogueria", "como-hacer-pedido-drogueria"],
    cta: { titulo: "Ve el riesgo antes de que se venza", texto: "Regenta te dice qué lotes no alcanzarás a vender antes de su fecha, cuánto valen y qué no rota hace 45 días." },
  },
  {
    slug: "cuanto-cuesta-software-drogueria",
    titulo: "Cuánto cuesta un software para droguería en Colombia",
    descripcion: "Precios publicados de programas POS y de facturación usados por droguerías en Colombia (noviembre 2026) y qué revisar antes de elegir.",
    h1: "¿Cuánto cuesta un software para droguería en Colombia? (2026)",
    entradilla: "Revisamos los precios que publican los programas de caja y facturación que usan las droguerías en Colombia. Estos son los datos, con su fuente, y lo que conviene revisar antes de elegir.",
    actualizada: "2026-11-01",
    bloques: [
      { h2: "Precios publicados (1 de noviembre de 2026)", lista: [
        "Alegra POS: Emprendedor $25.900/mes, Pyme $79.900, Pro $139.900 y Plus $199.900.",
        "Loggro: POS Tienda $54.990/mes, POS Avanzado $96.990 y POS Plus $292.990.",
        "Vendty: planes publicados entre $85.000 y $155.000 al mes según plan y forma de pago.",
        "POS Colombia: desde $0 hasta $649.900 al mes; los documentos electrónicos se compran aparte en paquetes anuales.",
        "Más Control (droguería): licencias anuales de $600.000 a $1.530.000.",
        "Otros programas para droguerías no publican precio y se cotizan por WhatsApp." ],
        nota: "Los precios cambian: revisa siempre la página del proveedor. Los enlaces están en las fuentes." },
      { h2: "Qué incluye y qué se cobra aparte", lista: [
        "Documentos electrónicos: ¿ilimitados, un cupo mensual o paquetes aparte?",
        "Certificado de firma digital: ¿incluido o lo pagas tú?",
        "Implementación y carga de productos.",
        "Número de cajas y de usuarios." ] },
      { h2: "Lo específico de droguería", lista: [
        "Lotes y vencimientos con venta del lote más próximo a vencer.",
        "Venta por unidad sin descuadrar el inventario.",
        "Registro sanitario en la ficha y cruce con las alertas del INVIMA.",
        "Pedido sugerido con tus ventas." ] },
    ],
    preguntas: [["¿Cuánto cuesta Regenta?", "Esencial $89.900 al mes y Pro $139.900 sin asociarte; como socio de Farmagenéricos Colombia, a mitad de precio o gratis según tus compras. Detalle en la página de tarifas."]],
    fuentes: [
      ["Alegra POS, precios", "https://www.alegra.com/colombia/pos/precios/"],
      ["Loggro, planes", "https://loggro.com/pymes/planes/"],
      ["Vendty, precios", "https://vendty.com/precios"],
      ["POS Colombia, precios", "https://poscolombia.com/por-que-pos-colombia"],
      ["Más Control, droguería", "https://mascontrol.com.co/drogueria"],
    ],
    relacionadas: ["pos-electronico-drogueria-dian", "inventario-por-lotes-drogueria"],
    cta: { titulo: "Pruébala antes de pagar", texto: "Entra a la demo de Regenta en un clic, sin registro, y mira con datos de 8 semanas qué te dice de pedido, vencimientos y alertas." },
  },
  {
    slug: "medicamentos-control-especial-drogueria",
    titulo: "Medicamentos de control especial en droguerías: guía",
    descripcion: "Qué exige la Resolución 1478 de 2006 a las droguerías con medicamentos de control especial: director técnico, registro, informe mensual y recetario.",
    h1: "Medicamentos de control especial en droguerías",
    entradilla: "Manejar medicamentos de control especial exige inscripción, un registro sin tachones de cada movimiento y un informe mensual. Esto es lo que dice la norma vigente.",
    actualizada: "2026-11-01",
    bloques: [
      { h2: "Quién puede dirigir la droguería", p: ["La droguería que maneje medicamentos de control especial debe estar dirigida por un químico farmacéutico, un tecnólogo en regencia de farmacia o un farmacéutico licenciado (Resolución 1478 de 2006, art. 37, parágrafo, modificado por la Resolución 2240 de 2008)."] },
      { h2: "Inscripción", p: ["El artículo 16 de la Resolución 1478 lista los documentos que deben aportar farmacias-droguerías y droguerías para inscribirse ante el Fondo Nacional o el Fondo Rotatorio de Estupefacientes; entre ellos, el acta de visita de la secretaría de salud con no más de un año."] },
      { h2: "El registro de movimientos", p: ["El artículo 48 exige llevar una base de datos, manual o sistematizada, con todos los movimientos de estos medicamentos, sujeta a auditorías periódicas."] },
      { h2: "El informe mensual", p: ["Los establecimientos minoristas presentan al Fondo Rotatorio de Estupefacientes de su departamento un informe de distribución o dispensación dentro de los primeros 10 días de cada mes, en el formato del Anexo 13 (art. 94)."] },
      { h2: "Fórmula y recetario oficial", lista: [
        "Se prescriben en recetarios oficiales que suministran los Fondos Rotatorios (art. 84), con el contenido mínimo del artículo 89.",
        "La cantidad máxima por fórmula es, en general, hasta 30 días de tratamiento (art. 80, modificado por la Resolución 315 de 2020).",
        "Dispensar con más de 15 días desde la expedición de la fórmula es falta (art. 97)." ] },
      { h2: "Cambios de 2026", p: ["La Resolución 116 de 2026 actualizó los listados de sustancias de la Resolución 315 de 2020; no cambia las reglas de dispensación. Quien maneje sustancias nuevas en los listados debía inscribirse dentro del plazo de transición."],
        nota: "En septiembre de 2026 se publicó un proyecto de prórroga de ese plazo; confirma con tu Fondo Rotatorio si quedó en firme." },
      { h2: "Qué revisa la inspección", p: ["La lista de chequeo de la Secretaría Distrital de Salud de Bogotá (2024) pregunta, entre otros, por el acta de apertura del registro, los informes mensuales (también en ceros), los registros de temperatura y humedad con instrumentos calibrados y el área exclusiva."] },
    ],
    preguntas: [["¿A quién se envía el informe mensual?", "Al Fondo Rotatorio de Estupefacientes del departamento, dentro de los primeros 10 días de cada mes (Res. 1478 de 2006, art. 94)."]],
    fuentes: [
      ["Resolución 1478 de 2006 (normograma Supersalud)", "https://normograma.supersalud.gov.co/compilacion/docs/resolucion_minproteccion_1478_2006.htm"],
      ["Resolución 1478 de 2006, PDF (FNE)", "https://fne.minsalud.gov.co/extranet/Paginas/normatividad/docs/Resolucion_1478_2006.pdf"],
      ["Resolución 116 de 2026, copia publicada por el ICA", "https://www.ica.gov.co/getattachment/Areas/Pecuaria/Servicios/Regulacion-y-Control-de-Medicamentos-Veterinarios/Normatividad-Aplicable/Resolucion-No-116-de-2026-MECE_260219_085726_ESTUPEFACIENTES.pdf.aspx?lang=es-CO"],
    ],
    relacionadas: ["temperatura-humedad-drogueria", "requisitos-abrir-drogueria-colombia"],
    cta: { titulo: "Inventario por lote y nada se borra", texto: "Regenta registra cada movimiento con lote, usuario y fecha, y nada se puede borrar: las correcciones quedan como movimientos nuevos con su motivo." },
  },
  {
    slug: "requisitos-abrir-drogueria-colombia",
    titulo: "Requisitos para abrir una droguería en Colombia 2026",
    descripcion: "Distancia mínima de 75 metros, director técnico, local y trámite ante la secretaría de salud. Qué cambió en 2026 con la Resolución 1999.",
    h1: "Requisitos para abrir una droguería en Colombia (2026)",
    entradilla: "En 2026 cambió dos veces la regla de apertura de droguerías. Esto es lo que rige hoy y lo que piden las secretarías de salud.",
    actualizada: "2026-11-01",
    bloques: [
      { h2: "Qué rige en 2026", p: ["La Resolución 1999 del 28 de agosto de 2026 del Ministerio de Salud derogó la Resolución 820 de 2026 y declaró vigente el artículo 1 del Decreto 3554 de 2008. Las autorizaciones expedidas bajo la Resolución 820 siguen vigentes y los trámites en curso se resuelven con el Decreto 3554."],
        nota: "Consultamos la Resolución 1999 en una copia del Diario Oficial publicada por un tercero; confírmala con tu secretaría de salud." },
      { h2: "Distancia mínima", p: ["El Decreto 3554 de 2008 fija una distancia mínima de 75 metros lineales al establecimiento minorista más cercano, con certificado de distancia previo expedido por la autoridad, medida desde el centro de la entrada principal."] },
      { h2: "Director técnico", p: ["Según el Decreto 2200 de 2005 (art. 11, numeral 2), la droguería la puede dirigir un químico farmacéutico, un tecnólogo en regencia de farmacia, un director de droguería, un farmacéutico licenciado o un expendedor de drogas. La farmacia-droguería la dirige un químico farmacéutico."] },
      { h2: "El local y la documentación", lista: [
        "Área mínima de 20 m², local independiente y aviso con la palabra «Droguería» (requisitos que publican Bogotá y Barranquilla).",
        "Termohigrómetros calibrados con sus registros, manuales de procesos y plan de gestión de residuos.",
        "Uso del suelo y contrato con un gestor de residuos peligrosos (Barranquilla)." ],
        nota: "Los requisitos de local los publican las secretarías de salud; revisa los de tu municipio." },
      { h2: "Desde el primer día", lista: ["Facturación: POS electrónico y factura electrónica ante la DIAN.", "Inventario por lote y fecha de vencimiento desde la primera compra.", "Registro sanitario de cada producto en la ficha, para cruzarlo con las alertas del INVIMA."] },
    ],
    preguntas: [["¿Cuál es la distancia mínima entre droguerías?", "75 metros lineales al establecimiento minorista más cercano, según el artículo 1 del Decreto 3554 de 2008, vigente por la Resolución 1999 de 2026."]],
    fuentes: [
      ["Decreto 3554 de 2008 (normograma INVIMA)", "https://normograma.invima.gov.co/compilacion/docs/decreto_3554_2008.htm"],
      ["Decreto 2200 de 2005 (normograma Supersalud)", "https://normograma.supersalud.gov.co/compilacion/docs/decreto_2200_2005.htm"],
      ["Requisitos de droguería, Secretaría de Salud de Bogotá", "https://bogota.gov.co/mi-ciudad/salud/que-se-debe-tener-si-voy-tener-una-drogueria-en-bogota-este-2025"],
      ["Requisitos de droguería, Alcaldía de Barranquilla", "https://barranquilla.gov.co/wp-content/uploads/dlm_uploads/2025/10/requisitos-para-la-inscripcion-autorizacion-para-el-funcionamiento-de-droguerias.pdf"],
      ["Resolución 1999 de 2026 (copia del Diario Oficial publicada por Consultorsalud)", "https://consultorsalud.com/wp-content/uploads/2026/09/Resolucion_001999_de_2026_MinSalud_OCR.pdf"],
    ],
    relacionadas: ["pos-electronico-drogueria-dian", "inventario-por-lotes-drogueria"],
    cta: { titulo: "Abre con el sistema listo", texto: "Regenta te deja vendiendo el mismo día: catálogo de casi 10.000 productos, lotes desde la primera compra y alertas del INVIMA desde el día uno." },
  },
  {
    slug: "temperatura-humedad-drogueria",
    titulo: "Temperatura y humedad en droguerías: control y registro",
    descripcion: "Qué piden la norma y las secretarías sobre temperatura y humedad en droguerías: termohigrómetros calibrados, registros y rangos del fabricante.",
    h1: "Control de temperatura y humedad en droguerías",
    entradilla: "Los medicamentos se guardan en las condiciones que indica el fabricante, y en la visita te pedirán cómo lo demuestras. Esto es lo verificado.",
    actualizada: "2026-11-01",
    bloques: [
      { h2: "Qué dice la norma", p: ["El manual de la Resolución 1403 de 2007 pide áreas de almacenamiento con temperatura y humedad relativa controladas, con termómetros, higrómetros u otros instrumentos y registros permanentes (numeral 1.1, literales d y h, en el capítulo del servicio farmacéutico)."] },
      { h2: "Qué piden las secretarías", lista: [
        "Bogotá pide termohigrómetros calibrados con sus registros y refrigeración para los productos que la requieran.",
        "En medicamentos de control especial, la lista de chequeo de Bogotá revisa que se cumplan las condiciones recomendadas por el fabricante, los registros y la calibración." ] },
      { h2: "Rangos de referencia", p: ["Un procedimiento del Fondo Rotatorio de Estupefacientes de Santander usa: temperatura ambiente controlada entre 15 y 30 °C (máximo 25 °C si la etiqueta no dice otra cosa), refrigeración entre 2 y 8 °C, humedad relativa ideal entre 50 % y 70 % y registro dos veces al día."],
        nota: "Es un documento técnico departamental, no una norma nacional: manda lo que diga la etiqueta del fabricante." },
      { h2: "Buenas prácticas", lista: ["Registra a la misma hora todos los días, con firma.", "Calibra los instrumentos y guarda el certificado.", "Si un registro sale de rango, anota qué hiciste."] },
    ],
    preguntas: [["¿Hay un rango nacional obligatorio?", "No encontramos una norma nacional con rangos numéricos para droguerías; aplica lo que indica el fabricante en la etiqueta."]],
    fuentes: [
      ["Resolución 1403 de 2007 (normograma INVIMA)", "https://normograma.invima.gov.co/compilacion/docs/resolucion_minproteccion_1403_2007.htm"],
      ["Requisitos de droguería, Secretaría de Salud de Bogotá", "https://bogota.gov.co/mi-ciudad/salud/que-se-debe-tener-si-voy-tener-una-drogueria-en-bogota-este-2025"],
      ["Procedimiento de almacenamiento, FRE Santander", "https://historico.santander.gov.co/intra/index.php/sig/finish/1879-fondo-rotatorio-de-estupefacientes/9037-almacenamiento-de-medicamentos-de-control-especial-monopolio-del-estado-fre-santander"],
    ],
    relacionadas: ["medicamentos-control-especial-drogueria", "control-fechas-vencimiento-drogueria"],
    cta: { titulo: "La evidencia, en un solo lugar", texto: "Regenta guarda la evidencia de lotes, vencimientos y alertas revisadas para la visita de la secretaría de salud." },
  },
  {
    slug: "precio-maximo-medicamentos-drogueria",
    titulo: "Precio máximo de medicamentos: qué aplica a droguerías",
    descripcion: "El control directo de precios de la Comisión de Precios de Medicamentos: a quién aplica, qué dice la Circular 18 de 2024 sobre droguerías y quién sanciona.",
    h1: "Precio máximo de venta de medicamentos: qué aplica a tu droguería",
    entradilla: "Muchos creen que la droguería debe vender al precio máximo regulado. La metodología vigente dice algo distinto para la venta al público.",
    actualizada: "2026-11-01",
    bloques: [
      { h2: "A quién aplica el precio máximo", p: ["La Circular 18 de 2024 de la Comisión Nacional de Precios de Medicamentos y Dispositivos Médicos (metodología de control directo) aplica el precio máximo a las transacciones primarias y secundarias, comerciales e institucionales, y a la transacción final institucional (art. 12)."] },
      { h2: "Y en la droguería", p: ["Para farmacias-droguerías y droguerías, el mismo artículo 12 dice que el precio de venta de los medicamentos «será libre, pero debe ser justo y acorde con los costos logísticos asociados a su distribución hasta el punto de venta y un margen de ganancia razonable»."] },
      { h2: "Sanciones", p: ["Incumplir el precio máximo es una violación de las normas de protección al consumidor en materia de precios, sancionable con las multas del artículo 132 de la Ley 1438 de 2011 (Circular 18 de 2024, art. 25). En la práctica, en 2026 la Superintendencia de Industria y Comercio sancionó a mayoristas e IPS."] },
      { h2: "Circulares de 2026", p: ["La Circular 22 del 19 de junio de 2026 incorporó mercados al control directo y actualizó precios máximos de medicamentos. El precio máximo se actualiza cada año según la tasa de cambio (art. 23 de la Circular 18)."],
        nota: "Consultamos la Circular 22 de 2026 en una copia publicada por Consultorsalud." },
    ],
    preguntas: [["¿La droguería tiene que vender al precio máximo?", "Según la Circular 18 de 2024 (art. 12), en farmacias-droguerías y droguerías el precio es libre, pero debe ser justo y acorde con los costos y un margen razonable."]],
    fuentes: [
      ["Circular 18 de 2024, CNPMDM (normograma INVIMA)", "https://normograma.invima.gov.co/normograma/docs/pdf/circular_cnpmd_0018_2024.pdf"],
      ["Circular 22 de 2026 (copia publicada por Consultorsalud)", "https://consultorsalud.com/wp-content/uploads/2026/06/022-DE-2026-Por-la-cual-se-incorpora-modifica-y-se-actualiza-el-precio-maximo-de-venta-de-los-medicamentos-sujetos-al-regimen-de-control-directo-de-precios-2.pdf"],
    ],
    relacionadas: ["cuanto-cuesta-software-drogueria", "como-hacer-pedido-drogueria"],
    cta: { titulo: "Tu margen, a la vista", texto: "Regenta te muestra la venta, el costo y el margen del día; los costos solo los ve el dueño o el administrador." },
  },
  {
    slug: "medicamentos-vencidos-que-hacer-drogueria",
    titulo: "Medicamentos vencidos en la droguería: qué hacer",
    descripcion: "Qué hacer con los medicamentos vencidos de tu droguería y con los que devuelven los clientes: área de vencidos, gestor de residuos y planes posconsumo.",
    h1: "Medicamentos vencidos: qué debe hacer la droguería",
    entradilla: "Hay dos casos distintos: lo que se te venció en el inventario y lo que el cliente trae para desechar. Cada uno tiene su camino.",
    actualizada: "2026-11-01",
    bloques: [
      { h2: "Lo que se vence en tu inventario", lista: [
        "Sale de la venta y va a un área identificada para productos que deben destruirse por vencimiento o deterioro (manual de la Resolución 1403 de 2007).",
        "Los residuos se entregan a un gestor autorizado, que expide un certificado (Resolución 591 de 2024, numeral 4.2.3).",
        "El generador conserva por 5 años las certificaciones de disposición final (Decreto 351 de 2014, compilado en el Decreto 780 de 2016)." ],
        nota: "Que el inventario vencido de la droguería vaya por gestor de residuos y no por el programa posconsumo es nuestra lectura de estas normas; confírmalo con tu secretaría de salud." },
      { h2: "Lo que traen los clientes", p: ["La Resolución 371 de 2009 obliga a farmacias y droguerías a participar en los planes de devolución posconsumo de medicamentos: aceptar la devolución de vencidos del consumidor, informar a los usuarios y ceder sin costo el espacio para los contenedores (arts. 2 y 4)."] },
      { h2: "Mejor que no se venza", p: ["Lo más barato es evitarlo: vende primero lo que vence antes, revisa con meses de anticipación y no pidas de más lo que no rota."] },
    ],
    preguntas: [["¿La droguería debe recibir medicamentos vencidos de los clientes?", "Sí, debe participar en los planes posconsumo (Resolución 371 de 2009, arts. 2 y 4)."]],
    fuentes: [
      ["Resolución 371 de 2009, MinAmbiente", "https://www.minambiente.gov.co/wp-content/uploads/2021/10/resolucion-0371-de-2009.pdf"],
      ["Decreto 351 de 2014 (normograma INVIMA)", "https://normograma.invima.gov.co/compilacion/docs/decreto_0351_2014.htm"],
      ["Resolución 591 de 2024 (normograma INVIMA)", "https://normograma.invima.gov.co/normograma/docs/pdf/resolucion_minsaludps_0591_2024.pdf"],
      ["Medicamentos vencidos, MinAmbiente", "https://www.minambiente.gov.co/asuntos-ambientales-sectorial-y-urbana/medicamentos-vencidos/"],
    ],
    relacionadas: ["como-reducir-vencidos-drogueria", "control-fechas-vencimiento-drogueria"],
    cta: { titulo: "Que se venza menos", texto: "Regenta te dice qué lotes no alcanzarás a vender antes de su fecha, cuánto valen y qué no rota, para que actúes a tiempo." },
  },
  {
    slug: "venta-por-unidad-medicamentos-drogueria",
    titulo: "¿Se pueden vender medicamentos por unidad en droguería?",
    descripcion: "Qué dicen el Decreto 677 de 1995 y el Decreto 2200 de 2005 sobre envases, reempaque y venta por unidad, y cómo mantener la trazabilidad del lote.",
    h1: "Venta por unidad de medicamentos en droguerías: qué dice la norma",
    entradilla: "Vender una tira del blíster es práctica común en el mostrador. No encontramos una norma que lo regule de forma expresa, pero sí reglas sobre el envase que conviene conocer.",
    actualizada: "2026-11-01",
    bloques: [
      { h2: "Lo que sí dice la norma", lista: [
        "Decreto 677 de 1995, art. 70: se prohíbe el expendio y entrega al público de medicamentos fuera del envase aprobado por el INVIMA (citado en el Concepto INVIMA 2044669 de 2019).",
        "Decreto 677, art. 2: envases, rótulos y empaques hacen parte integral del medicamento.",
        "Decreto 2200 de 2005: reenvasar o reempacar exige certificado de Buenas Prácticas de Manufactura (art. 11, parágrafo 5) y está prohibido tener envases o empaques vacíos en el servicio farmacéutico (art. 20, numeral 7)." ] },
      { h2: "Lo que no encontramos", p: ["No encontramos una norma ni un concepto oficial que regule o prohíba expresamente vender por unidad dentro del empaque original (por ejemplo, entregar una porción del blíster que conserva la identificación)."],
        nota: "Nuestra lectura: si al cortar el empaque se pierde la identificación del producto (nombre, lote, vencimiento), choca con los artículos 2 y 70 del Decreto 677. Consulta con tu secretaría de salud." },
      { h2: "Trazabilidad", p: ["Si vendes por unidad, el inventario tiene que llevarse en unidades y descontar del lote correcto; así sabes qué lote vendiste si sale una alerta."] },
    ],
    preguntas: [["¿Es ilegal vender pastillas sueltas?", "No encontramos una norma que lo prohíba expresamente; sí está prohibido entregar medicamentos fuera del envase aprobado por el INVIMA (Decreto 677 de 1995, art. 70)."]],
    fuentes: [
      ["Concepto INVIMA 2044669 de 2019", "https://normograma.invima.gov.co/compilacion/docs/concepto_invima_2044669_2019.htm"],
      ["Decreto 677 de 1995 (Secretaría de Salud de Bogotá)", "https://www.saludcapital.gov.co:443/Normo/jur/decreto_677_de_1995.pdf"],
      ["Decreto 2200 de 2005 (normograma Supersalud)", "https://normograma.supersalud.gov.co/compilacion/docs/decreto_2200_2005.htm"],
    ],
    relacionadas: ["inventario-por-lotes-drogueria", "alertas-sanitarias-invima-drogueria"],
    cta: { titulo: "Venta por unidad, con el lote correcto", texto: "Regenta descuenta cada unidad vendida del lote que vence primero, para que el inventario cuadre y sepas qué lote salió." },
  },
];

export const guia = (slug: string) => GUIAS.find((g) => g.slug === slug);
