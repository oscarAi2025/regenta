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
        "Enviar el documento a la DIAN por medio de un proveedor tecnológico autorizado y avisarte si alguno fue rechazado.",
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
    cta: { titulo: "Una caja hecha para droguería", texto: "Regenta numera cada venta con tu resolución, nunca duplica un cobro y no deja borrar: se anula con motivo. El envío a la DIAN se está integrando con un proveedor tecnológico autorizado." },
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
];

export const guia = (slug: string) => GUIAS.find((g) => g.slug === slug);
