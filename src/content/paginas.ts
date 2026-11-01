// Páginas comerciales por función y por perfil (silo SEO de producto). Solo describen lo que Regenta hace hoy;
// lo que está en integración se dice así.

export type Pagina = {
  ruta: string; grupo: "funciones" | "para"; corto: string;
  titulo: string; descripcion: string; h1: string; entradilla: string;
  captura?: { src: string; alt: string };
  beneficios: [string, string][]; pasos?: string[]; preguntas: [string, string][]; guias: string[];
};

export const PAGINAS: Pagina[] = [
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
    titulo: "Caja POS para droguerías: rápida y por unidad",
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
    preguntas: [["¿Emite el POS electrónico DIAN?", "Cada venta se numera con tu resolución y queda en cola; la emisión se está integrando con un proveedor tecnológico autorizado por la DIAN y se activa en tu cuenta al terminar."]],
    guias: ["pos-electronico-drogueria-dian"],
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
