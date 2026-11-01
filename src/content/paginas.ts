// Páginas comerciales por función y por perfil (silo SEO de producto). Solo describen lo que Regenta hace hoy;
// lo que está en integración se dice así.

export type Pagina = {
  ruta: string; grupo: "funciones" | "para" | "software"; corto: string;
  titulo: string; descripcion: string; h1: string; entradilla: string;
  captura?: { src: string; alt: string };
  beneficios: [string, string][]; pasos?: string[]; preguntas: [string, string][]; guias: string[];
  /** Texto largo para las páginas pilar de SEO. */
  secciones?: { h2: string; p: string[] }[];
};

export const PAGINAS: Pagina[] = [
  {
    ruta: "facturacion-electronica", grupo: "funciones", corto: "Facturación electrónica",
    titulo: "POS o factura electrónica en la misma caja | Regenta",
    descripcion: "Tiquete POS electrónico para el mostrador y factura electrónica de venta para clientes con NIT, desde la misma caja, con contado o crédito a plazo.",
    h1: "POS y factura electrónica en la misma caja",
    entradilla: "En la misma caja eliges el documento: tiquete POS electrónico para el cliente de mostrador o factura electrónica de venta para la empresa, la IPS o la droguería que te compra con NIT. Buscas al cliente o lo creas en segundos, y facturas de contado o a crédito.",
    captura: { src: "/capturas/facturacion.webp", alt: "Caja de Regenta en modo factura electrónica con el cliente, la forma de pago a crédito y el plazo" },
    beneficios: [
      ["POS o factura, en la misma pantalla", "Un clic cambia el documento. El inventario, los lotes y la numeración se manejan igual en los dos."],
      ["Clientes con NIT sin digitar de más", "Buscas por NIT, cédula o nombre. Si es nuevo, lo creas sin salir de la venta y Regenta calcula el dígito de verificación del NIT."],
      ["Contado o crédito", "Factura de contado con seis medios de pago, o a crédito a 15, 30, 45, 60 o 90 días, que queda en Cartera para cobrar."],
      ["Numeración con tu resolución", "Cada documento toma el siguiente número de tu resolución vigente; dos cajas nunca toman el mismo número."],
    ],
    pasos: ["En la caja, toca «Factura electrónica».", "Busca o crea el cliente con su NIT o cédula.", "Agrega los productos, toca Cobrar y elige contado o crédito."],
    preguntas: [
      ["¿Ya se envía a la DIAN?", "Cada documento queda numerado con tu resolución y en cola de envío. La emisión ante la DIAN se está integrando y se activa en tu cuenta al terminar; en la demostración la emisión es simulada y así lo dice en pantalla."],
      ["¿Necesito resolución de facturación?", "Sí. La numeración la autoriza la DIAN a tu NIT, para el POS electrónico y para la factura electrónica de venta. Regenta usa la que tengas vigente y te avisa si se vence o se agota."],
      ["¿Hace notas crédito?", "Sí: al anular una venta cuyo documento ya fue aceptado, Regenta genera la nota crédito con su propia numeración."],
    ],
    guias: ["pos-electronico-drogueria-dian", "cuanto-cuesta-software-drogueria"],
  },
  {
    ruta: "regenta-ia", grupo: "funciones", corto: "Regenta IA",
    titulo: "Regenta IA: inteligencia artificial para droguerías",
    descripcion: "Pregúntale a tu droguería en lenguaje normal: qué pedir, qué se vence, cuánto vendiste o qué alerta del INVIMA te toca. Responde con tus datos reales.",
    h1: "Regenta IA: pregúntale a tu droguería",
    entradilla: "Escribe como le hablarías a tu regente: «¿qué debo pedir esta semana?», «¿cuánto vendí ayer y cómo me pagaron?». Regenta IA consulta tus ventas, lotes, predicciones y alertas y te responde con cifras, diciendo de dónde salen.",
    captura: { src: "/capturas/ia.webp", alt: "Panel de Regenta IA respondiendo qué pedir con los datos de la droguería" },
    beneficios: [
      ["Responde con tus datos", "No inventa: cada respuesta sale de consultas a tus ventas, existencias, lotes y alertas, y te muestra qué consultó."],
      ["Ve solo lo que tú puedes ver", "Usa los mismos permisos que tu usuario: la cajera no recibe costos ni utilidad, el dueño sí."],
      ["Solo consulta, nunca cambia nada", "No vende, no ajusta inventario, no borra. Para eso están las pantallas de Regenta, con su registro de quién hizo qué."],
      ["Tus prioridades del día", "En el inicio ves qué hacer primero hoy (alertas, lo que se agota, lo que se vence) y con un clic le pides a la IA que te lo explique."],
    ],
    pasos: ["Abre Regenta IA desde cualquier pantalla (o con Ctrl+K).", "Escribe tu pregunta o toca una sugerencia.", "Regenta IA consulta tus datos y te responde con cifras y la fuente."],
    preguntas: [
      ["¿Qué modelo de IA usa?", "Modelos Claude de Anthropic, conectados a herramientas de solo lectura sobre los datos de tu droguería."],
      ["¿Me puede dar dosis o diagnósticos?", "No. Regenta IA ayuda con la gestión de la droguería; las decisiones clínicas son del profesional."],
      ["¿Qué datos salen de Regenta?", "Solo los resultados de las consultas necesarias para responder tu pregunta, enviados a la API de Anthropic por conexión cifrada. Regenta IA no ve nada que tu usuario no pueda ver."],
    ],
    guias: ["inventario-por-lotes-drogueria", "como-hacer-pedido-drogueria"],
  },
  {
    ruta: "pedido-sugerido", grupo: "funciones", corto: "Pedido sugerido",
    titulo: "Pedido sugerido para droguerías con tus ventas",
    descripcion: "Regenta calcula cuánto vendes de cada producto, para cuántos días te alcanza y cuántas cajas pedir. Lo envías por WhatsApp o Excel en un clic.",
    h1: "El pedido de tu droguería, calculado con tus ventas",
    entradilla: "Nada de pedir a ojo mirando la estantería. Regenta mira tus ventas de 8 semanas (con más peso a las dos últimas), lo que tienes y cuánto tarda tu proveedor, y te arma el pedido en cajas completas.",
    captura: { src: "/capturas/prediccion.webp", alt: "Pedido sugerido con existencias, venta por semana, días de cobertura y cajas a pedir" },
    beneficios: [
      ["Primero lo que se agota", "Ordena por días de cobertura: lo que se acaba esta semana arriba, en rojo."],
      ["Tendencias a la vista", "Flechas que te dicen qué se está vendiendo más o menos que antes."],
      ["Tu semana", "Ve qué días vendes más (por ejemplo, sábados) para recibir el pedido antes."],
      ["Listo para enviar", "Ajusta cajas y mándalo por WhatsApp, cópialo o descárgalo en Excel."],
    ],
    pasos: ["Vende con Regenta: cada venta alimenta el cálculo.", "Abre Predicción → Pedido sugerido.", "Ajusta cantidades y envíalo a tu proveedor."],
    preguntas: [["¿Cómo calcula las cajas?", "Ritmo de venta diario × (días de entrega + días de cobertura) − existencias vigentes, sin bajar de tu mínimo, redondeado a cajas completas. Hoy usa 3 días de entrega y 15 de cobertura."], ["¿Y si soy nuevo?", "Las predicciones se vuelven confiables desde las 3 semanas de ventas; antes te lo avisamos en pantalla."]],
    guias: ["como-hacer-pedido-drogueria", "inventario-por-lotes-drogueria"],
  },
  {
    ruta: "control-de-vencimientos", grupo: "funciones", corto: "Vencimientos",
    titulo: "Control de vencimientos por lote para droguerías",
    descripcion: "Lotes con semáforo, venta FEFO automática, bloqueo de vencidos y riesgo de vencimiento en pesos meses antes. Deja de botar mercancía.",
    h1: "Vencimientos bajo control, lote por lote",
    entradilla: "Regenta registra lote y fecha en cada entrada, vende siempre del lote que vence primero, no deja vender lo vencido y te dice con meses de anticipación qué unidades no alcanzarás a vender y cuánta plata son.",
    captura: { src: "/capturas/vencimiento.webp", alt: "Lotes que se vencerían sin venderse con unidades y valor en riesgo" },
    beneficios: [
      ["FEFO automático", "Cada venta descuenta del lote más próximo a vencer, como pide la Resolución 1403 de 2007."],
      ["Lo vencido no se vende", "La caja bloquea los lotes vencidos aunque tengan existencias."],
      ["Riesgo en pesos", "Con tu ritmo de venta, cuántas unidades de cada lote se vencerían y su valor a costo."],
      ["Capital sin rotación", "Lo que no se vende hace 45 días: no lo vuelvas a pedir."],
    ],
    preguntas: [["¿Qué rangos usa el semáforo?", "Rojo a 30 días o menos y ámbar entre 31 y 90 días."]],
    guias: ["control-fechas-vencimiento-drogueria", "semaforizacion-medicamentos-drogueria", "como-reducir-vencidos-drogueria"],
  },
  {
    ruta: "alertas-invima", grupo: "funciones", corto: "Alertas INVIMA",
    titulo: "Alertas sanitarias INVIMA cruzadas con tu inventario",
    descripcion: "Regenta lee las alertas de medicamentos del INVIMA y te avisa si tienes ese lote, ese registro sanitario o ese producto. Con constancia de la revisión.",
    h1: "Las alertas del INVIMA, cruzadas con tu estantería",
    entradilla: "El INVIMA publica alertas de medicamentos falsificados, fraudulentos o defectuosos. Regenta las cruza con tu inventario y solo te avisa cuando algo te toca, de lo más seguro (tienes el lote) a lo que hay que revisar (mismo nombre).",
    captura: { src: "/capturas/alertas.webp", alt: "Alerta del INVIMA: la droguería tiene en existencias el lote alertado" },
    beneficios: [
      ["Tienes este lote", "Si un lote alertado está en tus existencias, aviso rojo en el inicio."],
      ["Mismo registro sanitario", "Guarda el registro en la ficha del producto (o en tu Excel) y Regenta lo compara."],
      ["Revisión con constancia", "«Separé el producto», «No tengo ese lote»: queda quién, cuándo y qué hizo, y no se puede borrar."],
      ["Enlace a la alerta oficial", "Cada aviso lleva a la publicación del INVIMA."],
    ],
    preguntas: [["¿De dónde salen las alertas?", "Del listado oficial de alertas sanitarias de invima.gov.co, sección de medicamentos."], ["¿Reemplaza la revisión del regente?", "No: encuentra las coincidencias y guarda la evidencia; la revisión física y la decisión son del regente."]],
    guias: ["alertas-sanitarias-invima-drogueria", "consultar-registro-sanitario-invima"],
  },
  {
    ruta: "caja-pos", grupo: "funciones", corto: "Caja POS",
    titulo: "Caja de droguería con venta por caja y por unidad",
    descripcion: "Caja para droguería con lector de código de barras, venta por caja o por unidad, seis medios de pago y numeración con tu resolución. En la nube.",
    h1: "Una caja de droguería que se aprende en cinco minutos",
    entradilla: "Escanea o escribe dos letras, elige caja o unidad y cobra. Teclas rápidas para la fila (F2 buscar, F9 cobrar), cambio calculado y el producto que conviene vender primero a la vista.",
    captura: { src: "/capturas/caja.webp", alt: "Caja de Regenta con precios por caja y por unidad y el tiquete de la venta" },
    beneficios: [
      ["Caja o pastilla", "Precio por caja y por unidad en el mismo producto, sin descuadrar el inventario."],
      ["Seis medios de pago", "Efectivo, Nequi, Daviplata, tarjeta, transferencia y Bre-B."],
      ["Sin ventas duplicadas", "Si se cae la red a mitad del cobro, el reintento no cobra dos veces."],
      ["Nada se borra", "Las ventas se anulan con motivo y quedan registradas."],
    ],
    preguntas: [["¿Emite el POS electrónico DIAN?", "Cada venta se numera con tu resolución y queda en cola; la emisión ante la DIAN se está integrando y se activa en tu cuenta al terminar."]],
    guias: ["pos-electronico-drogueria-dian"],
  },
  {
    ruta: "cartera-y-credito", grupo: "funciones", corto: "Cartera y crédito",
    titulo: "Cartera y crédito para droguerías y distribuidoras",
    descripcion: "Vende a crédito con factura electrónica y plazo, registra los abonos y mira quién te debe, cuánto está vencido y qué vence esta semana.",
    h1: "Vende a crédito sin perder de vista quién te debe",
    entradilla: "La distribuidora que surte droguerías, la droguería con convenio con una IPS o un hogar geriátrico: si fías, necesitas saber a quién, cuánto y hasta cuándo. Regenta guarda cada factura a crédito con su plazo, los abonos y los días de mora.",
    captura: { src: "/capturas/cartera.webp", alt: "Cartera de Regenta con facturas a crédito, saldo, días de mora y registro de abonos" },
    beneficios: [
      ["Por cobrar, vencido y lo que vence en 7 días", "Tres cifras al abrir Cartera, y la lista ordenada por fecha de vencimiento."],
      ["Abonos en la misma fila", "Valor, medio de pago y referencia. Nunca se acepta un abono mayor que el saldo."],
      ["Solo la gerencia fía y cobra", "Vender a crédito y registrar abonos es del dueño o el administrador; la cajera no ve la cartera."],
      ["Nada se borra", "Una factura con abonos no se puede anular sin devolver primero lo abonado: el registro siempre cuadra."],
    ],
    pasos: ["Factura a crédito desde la caja eligiendo el plazo.", "Abre Cartera para ver lo que te deben y lo vencido.", "Registra cada abono cuando el cliente te pague."],
    preguntas: [
      ["¿Tiene cupo de crédito por cliente?", "Todavía no: hoy controlas el plazo y el saldo de cada factura. Si necesitas cupos por cliente, cuéntanos tu caso."],
      ["¿La cajera puede vender a crédito?", "No. Solo el dueño o el administrador; así nadie fía sin autorización."],
    ],
    guias: ["pos-electronico-drogueria-dian"],
  },
  {
    ruta: "distribuidoras-medicamentos", grupo: "software", corto: "Distribuidoras de medicamentos",
    titulo: "Software para distribuidoras de medicamentos | Regenta",
    descripcion: "Factura electrónica a droguerías con NIT, venta por caja, crédito con plazo y cartera, inventario por lote y vencimiento, alertas INVIMA y pedido sugerido.",
    h1: "Software para distribuidoras de medicamentos",
    entradilla: "Lo hace Farmagenéricos Colombia, que también es distribuidora: le vendemos a droguerías todos los días. Regenta te deja facturar a tus clientes con NIT, venderles a crédito y cobrar, mientras cuidas cada lote y cada fecha de vencimiento en tu bodega.",
    captura: { src: "/capturas/cartera.webp", alt: "Cartera de una distribuidora en Regenta con saldos y vencimientos por cliente" },
    beneficios: [
      ["Factura electrónica a tus clientes", "Buscas la droguería por NIT o la creas en segundos; Regenta calcula el dígito de verificación."],
      ["Crédito con plazo y cartera", "Facturas a 15, 30, 45, 60 o 90 días, registras abonos y ves lo vencido sin hojas de cálculo."],
      ["Bodega por lote y vencimiento", "Recibes compras por lote, despachas primero lo que vence antes y nunca sale un lote vencido."],
      ["Alertas del INVIMA contra tu bodega", "Si sale una alerta de un lote que tienes, te enteras y queda la constancia de la revisión."],
      ["Pedido sugerido en cajas", "Con tus despachos reales: qué se agota primero y qué no rota."],
      ["Roles de bodega y gerencia", "Bodega recibe y ajusta; solo la gerencia ve costos, fía y cobra."],
    ],
    secciones: [
      { h2: "Qué necesita una distribuidora de medicamentos", p: [
        "Una distribuidora factura a otras empresas: droguerías, clínicas, IPS y hogares geriátricos, casi siempre con NIT y muchas veces a crédito. Necesita factura electrónica de venta, control de la cartera, bodega por lote y vencimiento, y saber a tiempo si una alerta del INVIMA afecta un lote que ya despachó o que tiene en bodega.",
        "Los ERP grandes resuelven todo eso con implementaciones largas y costosas. Los POS genéricos no lo resuelven. Regenta está en el medio: lo esencial de una distribuidora farmacéutica, en la nube y listo en días.",
] },
      { h2: "Cómo trabaja Regenta en la distribuidora", p: [
        "Factura electrónica a clientes con NIT, con el dígito de verificación calculado. Ventas a crédito a 15, 30, 45, 60 o 90 días, con abonos, saldo y días de mora en Cartera. Recepción de compras por lote y despacho del lote que vence primero. Pedido sugerido en cajas con tus despachos reales.",
        "Bodega recibe y ajusta; solo la gerencia ve costos, fía y cobra. Todo queda auditado: quién hizo qué y cuándo.",
] },
    ],
    preguntas: [
      ["¿Qué no hace todavía para una distribuidora?", "Hoy Regenta no maneja listas de precio distintas por cliente, cupos de crédito ni preventa con vendedores en ruta. Si tu operación los necesita, escríbenos y te decimos con franqueza si te sirve."],
      ["¿Funciona con varias bodegas?", "Cada cuenta trabaja hoy con una bodega o sede; el manejo de varias sedes está en integración."],
      ["¿Cuánto cuesta para una distribuidora?", "Las distribuidoras van en el plan Cadena, con precio según tu operación. Escríbenos por WhatsApp."],
    ],
    guias: ["inventario-por-lotes-drogueria", "alertas-sanitarias-invima-drogueria", "pos-electronico-drogueria-dian"],
  },
  {
    ruta: "facturacion-electronica-droguerias", grupo: "software", corto: "Facturación electrónica para droguerías",
    titulo: "Facturación electrónica para droguerías y farmacias",
    descripcion: "Programa de facturación electrónica para droguerías y farmacias: POS y factura DIAN en la misma caja, certificado incluido, inventario por lote e IA.",
    h1: "Software de facturación electrónica para droguerías",
    entradilla: "En una droguería la facturación no termina en la DIAN: cada venta mueve un lote con fecha de vencimiento. Regenta factura y controla el inventario en el mismo paso, con el certificado digital y la habilitación incluidos.",
    captura: { src: "/capturas/facturacion.webp", alt: "Caja de Regenta en modo factura electrónica con cliente y crédito" },
    beneficios: [
      ["POS o factura, un clic", "Tiquete POS para el mostrador y factura electrónica para el cliente con NIT o cédula."],
      ["Certificado incluido", "Certificado digital y habilitación de tu NIT ante la DIAN incluidos en todos los planes."],
      ["Notas crédito", "Al anular una venta ya emitida, Regenta genera la nota crédito con su numeración."],
      ["Inventario en el mismo paso", "Cada factura descuenta del lote que vence primero; nunca de uno vencido."],
    ],
    secciones: [
      { h2: "POS electrónico o factura electrónica: cuándo cada uno", p: [
        "La Resolución 165 de 2023 de la DIAN permite el documento equivalente POS electrónico en ventas de hasta 5 UVT (unos $261.870 en 2026). Por encima de ese valor, o cuando el comprador la pide, va factura electrónica de venta.",
        "En Regenta eliges el documento en la misma caja: tiquete POS para el cliente de mostrador o factura electrónica con los datos del cliente. Si es una empresa, la buscas por NIT o la creas en segundos y Regenta calcula el dígito de verificación.",
] },
      { h2: "Qué pedirle a un programa de facturación para droguería", p: [
        "Que numere cada documento con tu resolución sin repetir números, que no se pueda borrar una venta (se anula con motivo y nota crédito) y que siga funcionando si la DIAN tarda: la venta se guarda y el envío se reintenta solo.",
        "Que el certificado digital y la habilitación estén incluidos, que venda por caja y por unidad, y que lleve el inventario por lote y vencimiento. Un programa de facturación genérico cumple lo primero; una droguería necesita todo.",
] },
      { h2: "Cómo empezar", p: [
        "Pruebas la demo en un clic, sin registro. Si te sirve, contratas en línea o por WhatsApp, te habilitamos ante la DIAN con tu NIT y cargamos tus productos desde Excel (en el plan Pro lo hacemos nosotros).",
] },
    ],
    preguntas: [
      ["¿El certificado digital tiene costo aparte?", "No. El certificado digital y la habilitación de tu NIT ante la DIAN están incluidos en todos los planes."],
      ["¿Ya se envía a la DIAN?", "Cada documento queda numerado con tu resolución y en cola de envío. La emisión ante la DIAN se está integrando y se activa en tu cuenta al terminar."],
      ["¿Sirve para farmacias-droguerías?", "Sí. La facturación, el inventario por lote y los vencimientos funcionan igual."],
    ],
    guias: ["pos-electronico-drogueria-dian", "cuanto-cuesta-software-drogueria", "facturacion-electronica-sector-salud-rips"],
  },
  {
    ruta: "facturacion-electronica-sector-salud", grupo: "software", corto: "Facturación sector salud",
    titulo: "Software de facturación electrónica para el sector salud",
    descripcion: "Facturación electrónica DIAN, POS e inventario por lote para droguerías, farmacias y distribuidoras del sector salud. Qué cubre Regenta y qué no (RIPS).",
    h1: "Software de facturación electrónica para el sector salud",
    entradilla: "El sector salud no factura como una tienda: hay lotes, vencimientos, registros sanitarios, alertas del INVIMA, ventas a crédito a clínicas y la visita de la secretaría de salud. Regenta es el software de facturación hecho para la parte farmacéutica del sector: droguerías, farmacias-droguerías y distribuidoras.",
    captura: { src: "/capturas/facturacion.webp", alt: "Factura electrónica a una IPS con crédito a 45 días en la caja de Regenta" },
    beneficios: [
      ["POS y factura electrónica", "Tiquete POS para el mostrador y factura electrónica de venta para empresas, clínicas e IPS con NIT."],
      ["Crédito y cartera", "Facturas a 15, 30, 45, 60 o 90 días con abonos y días de mora."],
      ["Inventario farmacéutico", "Lote, vencimiento y registro sanitario en cada movimiento; nunca se vende un vencido."],
      ["Cumplimiento sanitario", "Alertas del INVIMA cruzadas con tus lotes y evidencia para la secretaría de salud."],
    ],
    secciones: [
      { h2: "Qué necesita el software de facturación de una droguería o distribuidora", p: [
        "Facturar ante la DIAN es la base: POS electrónico en el mostrador y factura electrónica de venta cuando el comprador la pide o supera 5 UVT, según la Resolución 165 de 2023. Pero en medicamentos eso no alcanza: cada venta tiene que salir del lote correcto, el programa no puede dejar vender lo vencido y, cuando el INVIMA publica una alerta, tienes que saber en minutos si ese lote está en tu estantería.",
        "Por eso un POS genérico se queda corto. Regenta une la facturación con el inventario por lote, la cartera de clientes y la inteligencia artificial que te dice qué pedir y qué se te va a vencer." ] },
      { h2: "¿Y las IPS?", p: [
        "Las IPS facturan servicios de salud con el RIPS como soporte, según la Resolución 948 de 2026 del Ministerio de Salud. Regenta no genera RIPS. Lo que sí hace es facturarle a una IPS cuando tu droguería o tu distribuidora le vende medicamentos, y manejar la droguería o el punto de venta de medicamentos que una IPS tenga como establecimiento aparte." ] },
    ],
    preguntas: [
      ["¿Regenta sirve para una IPS?", "Para la facturación de servicios de salud con RIPS, no: eso lo hace el software de la IPS. Sí sirve para la droguería o el punto de venta de medicamentos que la IPS tenga aparte, y para las droguerías y distribuidoras que le venden a IPS."],
      ["¿Ya se envía a la DIAN?", "Cada documento queda numerado con tu resolución y en cola de envío. La emisión ante la DIAN se está integrando y se activa en tu cuenta al terminar."],
    ],
    guias: ["facturacion-electronica-sector-salud-rips", "pos-electronico-drogueria-dian", "inventario-por-lotes-drogueria"],
  },
  {
    ruta: "pos-drogueria", grupo: "software", corto: "POS para droguería",
    titulo: "POS para droguería y farmacia con factura electrónica",
    descripcion: "POS para droguería: lector de código de barras, venta por caja o por unidad, POS y factura electrónica, Nequi, Daviplata, QR y lote que vence primero.",
    h1: "Sistema POS para droguerías y farmacias",
    entradilla: "La caja de una droguería atiende fila, vende pastillas sueltas, cobra con Nequi o QR y tiene que sacar primero el lote que vence antes. El POS de Regenta hace todo eso en una pantalla que una auxiliar aprende en cinco minutos.",
    captura: { src: "/capturas/caja.webp", alt: "POS de Regenta para droguería con venta por caja y por unidad" },
    beneficios: [
      ["Rápido en la fila", "Lector de código de barras, F2 buscar, F9 cobrar y cambio calculado."],
      ["Caja o pastilla", "Precio por caja y por unidad sin descuadrar el inventario."],
      ["Todos los medios de pago", "Efectivo, Nequi, Daviplata, Bre-B, QR Bancolombia, tarjeta y transferencia."],
      ["Ayuda a vender", "Te muestra qué vender primero y, si algo está agotado, los parecidos que sí tienes."],
    ],
    secciones: [
      { h2: "POS genérico o POS para droguería", p: [
        "Un POS genérico cobra y descuenta un número de inventario. Un POS para droguería además sabe de qué lote sale cada unidad, bloquea los vencidos, avisa lo que vence pronto y separa el precio por caja del precio por unidad. Esa diferencia es la que evita pérdidas y sanciones.",
        "En el mostrador la diferencia se nota en la fila: la auxiliar escanea, elige caja o unidad y cobra con el medio que traiga el cliente, mientras el sistema decide en silencio qué lote sale y si se puede vender.",
] },
      { h2: "Qué debe hacer un sistema POS de droguería", p: [
        "Emitir el documento equivalente POS electrónico y, cuando el cliente la pida o la venta pase de 5 UVT, la factura electrónica de venta, como dice la Resolución 165 de 2023 de la DIAN.",
        "Vender por caja y por unidad del mismo producto sin descuadrar el inventario, cobrar con efectivo, Nequi, Daviplata, Bre-B, QR, tarjeta o transferencia, y no duplicar una venta si se cae la red a mitad del cobro.",
        "Sacar primero el lote que vence antes, no dejar vender un lote vencido o separado por una alerta del INVIMA y mostrar a la auxiliar qué conviene ofrecer primero.",
] },
      { h2: "Cómo lo hace Regenta", p: [
        "La caja de Regenta funciona en el navegador del computador, la tableta o el celular, con lector de código de barras y teclas rápidas (F2 buscar, F9 cobrar). Cada venta queda numerada con tu resolución, nada se borra y las anulaciones llevan motivo y nota crédito.",
        "Si un producto está agotado, la caja te muestra los parecidos que sí tienes, con el mismo principio activo y concentración, para que la venta no se pierda. Y Regenta IA te dice al final del día qué pedir y qué se te va a vencer.",
] },
    ],
    preguntas: [["¿Funciona sin instalar nada?", "Sí, en el navegador del computador de la caja, una tableta o el celular."], ["¿Hace factura electrónica además del POS?", "Sí: en la misma caja eliges tiquete POS o factura electrónica con el cliente, de contado o a crédito."]],
    guias: ["pos-electronico-drogueria-dian", "venta-por-unidad-medicamentos-drogueria"],
  },
  {
    ruta: "farmacias", grupo: "software", corto: "Software para farmacias",
    titulo: "Software para farmacias en Colombia: lotes e INVIMA",
    descripcion: "Sistema para farmacias y droguerías: facturación electrónica, inventario por lote y vencimiento, pedido sugerido, alertas INVIMA e inteligencia artificial.",
    h1: "Software para farmacias en Colombia",
    entradilla: "Un solo sistema para la farmacia: vender y facturar, recibir mercancía por lote, controlar vencimientos, pedir lo justo y cumplir con la secretaría de salud. Con una inteligencia artificial que responde con tus datos.",
    captura: { src: "/capturas/inicio.webp", alt: "Inicio de Regenta con las prioridades del día de la farmacia" },
    beneficios: [
      ["Facturación", "POS y factura electrónica, notas crédito al anular."],
      ["Inventario por lote", "Recepción técnica, FEFO y bloqueo de vencidos."],
      ["Pedido sugerido", "Con tus ventas de 8 semanas y el día fuerte de tu semana."],
      ["Regenta IA", "Pregúntale qué pedir o cuánto vendiste y responde con cifras."],
    ],
    secciones: [
      { h2: "Qué necesita el software de una farmacia", p: [
        "Una farmacia o farmacia-droguería necesita vender rápido, facturar ante la DIAN y llevar el inventario como lo exige el sector: por lote, con fecha de vencimiento y registro sanitario. También necesita saber qué pedir, qué se le va a vencer y si una alerta del INVIMA toca algo que tiene en la estantería.",
        "La mayoría de programas resuelven la caja y la factura. Pocos resuelven el resto, y ahí es donde se pierde plata: en lo que se vence sin venderse, en lo que se agota el día de más venta y en el tiempo que se va revisando alertas a mano.",
] },
      { h2: "Lo que Regenta hace por tu farmacia", p: [
        "Factura con POS o factura electrónica, de contado o a crédito. Recibe la mercancía por lote con su vencimiento. Vende primero lo que vence antes y no deja vender lo vencido. Calcula el pedido sugerido con tus ventas de ocho semanas y te muestra el riesgo de vencimiento en pesos meses antes.",
        "Cruza las alertas oficiales del INVIMA con tus lotes, registros y productos, y guarda la constancia de lo que revisaste para la visita de la secretaría de salud. Y Regenta IA responde en lenguaje normal con los datos de tu farmacia.",
] },
      { h2: "Hecho por gente del sector", p: [
        "Regenta lo hace Farmagenéricos Colombia, un distribuidor farmacéutico que surte droguerías. Por eso piensa como un regente y no como una tienda: el lote, la fecha y la norma están en cada pantalla.",
] },
    ],
    preguntas: [["¿Sirve para una farmacia-droguería?", "Sí: caja, inventario por lote y vencimientos son los mismos. Si haces preparaciones magistrales, esa parte no la maneja Regenta."]],
    guias: ["requisitos-abrir-drogueria-colombia", "control-fechas-vencimiento-drogueria", "temperatura-humedad-drogueria"],
  },
  {
    ruta: "inventario-farmacia", grupo: "software", corto: "Inventario de farmacia",
    titulo: "Software de inventario para farmacia por lote y vencimiento",
    descripcion: "Inventario de farmacia por lote y fecha de vencimiento: recepción técnica, FEFO, semáforo de vencimientos, riesgo en pesos y alertas INVIMA por lote.",
    h1: "Inventario de farmacia por lote y vencimiento",
    entradilla: "En una farmacia el inventario no es un número: es cada lote con su fecha. Regenta lleva el inventario como lo exige el sector y te dice cuánta plata está en riesgo de vencerse meses antes.",
    captura: { src: "/capturas/vencimiento.webp", alt: "Lotes que se pueden vencer con su valor en pesos" },
    beneficios: [
      ["Recepción por lote", "Lote, vencimiento, cantidad, costo y registro sanitario en cada entrada."],
      ["FEFO automático", "La caja vende primero el lote que vence antes."],
      ["Riesgo en pesos", "Qué lotes no alcanzarás a vender antes de su fecha, con su valor."],
      ["Ajustes con motivo", "Nada se borra: cada ajuste queda con quién, cuándo y por qué."],
    ],
    preguntas: [["¿Puedo cargar mi inventario desde Excel?", "Sí: productos desde Excel y, en el plan Pro, te los cargamos nosotros."]],
    guias: ["inventario-por-lotes-drogueria", "como-reducir-vencidos-drogueria", "semaforizacion-medicamentos-drogueria"],
  },
  {
    ruta: "regentes", grupo: "para", corto: "Para regentes",
    titulo: "Software para regentes de farmacia | Regenta",
    descripcion: "Vencimientos por lote, alertas INVIMA con constancia, recepción técnica y registro sanitario en un solo lugar. Hecho para el trabajo del regente.",
    h1: "Software para regentes de farmacia",
    entradilla: "El regente responde por lo que se vende y por lo que hay en la estantería. Regenta le da el control por lote, las alertas del INVIMA cruzadas y la evidencia lista para la visita de la secretaría de salud.",
    beneficios: [
      ["Recepción por lote", "Lote, vencimiento, cantidad y registro sanitario en cada entrada, escaneando."],
      ["Alertas con evidencia", "Coincidencias con el INVIMA y la constancia de lo que hiciste."],
      ["Vencimientos antes de que pasen", "Semáforo y riesgo por lote; la caja no vende vencidos."],
      ["Permisos por rol", "Cada auxiliar con su usuario; nada se borra, todo queda auditado."],
    ],
    preguntas: [["¿Sirve si soy regente de varias droguerías?", "Cada droguería es una cuenta; el manejo de varias sedes está en integración."]],
    guias: ["control-fechas-vencimiento-drogueria", "alertas-sanitarias-invima-drogueria", "consultar-registro-sanitario-invima"],
  },
  {
    ruta: "duenos-de-drogueria", grupo: "para", corto: "Para dueños",
    titulo: "Programa para dueños de droguería | Regenta",
    descripcion: "Ventas, utilidad, pedido sugerido y plata parada en la estantería, desde el celular. Deja de perder plata en vencidos y agotados.",
    h1: "Para el dueño: tu droguería en números, desde el celular",
    entradilla: "Lo que vendiste hoy, cuánto ganaste, cómo te pagaron, qué hay que pedir y cuánta plata está a punto de vencerse. Sin pedir reportes ni abrir Excel.",
    captura: { src: "/capturas/inicio.webp", alt: "Inicio del dueño con ventas, ganancia y prioridades del día" },
    beneficios: [
      ["Ganancia del día", "Venta, costo y margen, solo visibles para ti."],
      ["Menos agotados", "Pedido sugerido con tus ventas reales."],
      ["Menos vencidos", "Riesgo de vencimiento en pesos meses antes."],
      ["Control del equipo", "Usuarios por rol, anulaciones con motivo, auditoría."],
    ],
    preguntas: [["¿Lo veo desde el celular?", "Sí, Regenta funciona en el navegador del celular, la tableta o el computador."]],
    guias: ["como-hacer-pedido-drogueria", "como-reducir-vencidos-drogueria"],
  },
];

export const pagina = (ruta: string) => PAGINAS.find((p) => p.ruta === ruta);
