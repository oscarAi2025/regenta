// Plantillas de correo de Regenta: HTML con tablas y estilos en línea (lo que leen bien Gmail, Outlook y el celular)
// y versión de texto. Transaccionales: siempre se envían. Comerciales: solo con autorización y con enlace de baja.
import { SITIO, WHATSAPP, CORREO, TELEFONO } from "../sitio";
import { pesos } from "../formato";

export type Correo = { asunto: string; html: string; texto: string; previa: string };
type Datos = Record<string, string | number | null | undefined>;

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const url = (ruta: string, campana: string) => `${SITIO}${ruta}${ruta.includes("?") ? "&" : "?"}utm_source=correo&utm_medium=email&utm_campaign=${campana}`;
const wa = (t: string) => `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(t)}`;
const primer = (n: unknown) => esc(String(n ?? "").trim().split(/\s+/)[0] || "");
/** «Hola María» o «Hola» si no hay nombre (nunca «Hola ,»). */
const hola = (n: unknown) => (primer(n) ? `Hola ${primer(n)}` : "Hola");
const txt = (v: unknown, otro = "") => (v === undefined || v === null || v === "" ? otro : String(v));
const PERIODO: Record<string, string> = { mes: "mensual", anio: "anual" };
const enlace = (v: unknown) => (/^https:\/\//.test(String(v ?? "")) || String(v ?? "").startsWith(SITIO) ? String(v) : `${SITIO}/entrar`);

/** Marco común: logo en texto, contenido, botón, firma y pie legal (con baja si es comercial). */
function marco(o: { previa: string; titulo: string; parrafos: string[]; boton?: { texto: string; href: string }; despues?: string[]; baja?: string }) {
  const p = (t: string) => `<p style="margin:0 0 16px;font:16px/1.6 Arial,Helvetica,sans-serif;color:#1f3442">${t}</p>`;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.titulo)}</title></head>
<body style="margin:0;padding:0;background:#eef3f2">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(o.previa)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3f2"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#0b1f33;padding:20px 28px"><span style="font:bold 24px Arial,Helvetica,sans-serif;color:#ffffff">Regenta</span><span style="font:12px Arial,Helvetica,sans-serif;color:#5eead4;padding-left:8px">Facturación e IA para el sector farmacéutico</span></td></tr>
<tr><td style="padding:32px 28px 8px">
<h1 style="margin:0 0 20px;font:bold 26px/1.2 Arial,Helvetica,sans-serif;color:#0b1f33">${esc(o.titulo)}</h1>
${o.parrafos.map(p).join("\n")}
${o.boton ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="background:#fbbf24;border-radius:12px"><a href="${esc(o.boton.href)}" style="display:inline-block;padding:14px 26px;font:bold 16px Arial,Helvetica,sans-serif;color:#0b1f33;text-decoration:none">${esc(o.boton.texto)}</a></td></tr></table>` : ""}
${(o.despues ?? []).map(p).join("\n")}
${p(`¿Dudas? Responde este correo o escríbenos por <a href="${esc(wa("Hola, tengo una pregunta sobre Regenta."))}" style="color:#0f766e">WhatsApp ${esc(TELEFONO)}</a>.`)}
${p("El equipo de Regenta · Farmagenéricos Colombia")}
</td></tr>
<tr><td style="padding:20px 28px;background:#f6f9f8;font:12px/1.5 Arial,Helvetica,sans-serif;color:#5b6d75">
Regenta es un producto de Farmagenéricos Colombia, establecimiento de IA DEV INVESTIMENTS COLOMBIA S.A.S., NIT 901.845.370-5, Ibagué, Tolima. ${esc(CORREO)}.<br>
Tratamos tus datos según la Ley 1581 de 2012: <a href="${SITIO}/privacidad" style="color:#5b6d75">política de datos</a>.${o.baja ? `<br>¿No quieres recibir más correos como este? <a href="${esc(o.baja)}" style="color:#5b6d75">Darte de baja</a>.` : ""}
</td></tr></table></td></tr></table></body></html>`;
  const quitar = (t: string) => t.replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g, "$2 ($1)").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  const texto = [o.titulo, "", ...o.parrafos.map(quitar), ...(o.boton ? [`${o.boton.texto}: ${o.boton.href}`, ""] : []), ...(o.despues ?? []).map(quitar),
    `¿Dudas? Responde este correo o escríbenos por WhatsApp ${TELEFONO}.`, "El equipo de Regenta · Farmagenéricos Colombia", "",
    "Regenta es un producto de Farmagenéricos Colombia (IA DEV INVESTIMENTS COLOMBIA S.A.S., NIT 901.845.370-5), Ibagué, Tolima.",
    ...(o.baja ? [`Darte de baja: ${o.baja}`] : [])].join("\n");
  return { html, texto, previa: o.previa };
}

export const PLANTILLAS = {
  // ── Transaccionales
  invitacion: (d: Datos): Correo => ({ asunto: `Activa tu cuenta de Regenta${d.empresa ? ` para ${d.empresa}` : ""}`, ...marco({
    previa: "Crea tu contraseña y empieza a facturar.", titulo: `${hola(d.nombre)}, tu cuenta está lista`,
    parrafos: [`Te creamos un usuario en Regenta${d.empresa ? ` para <b>${esc(d.empresa)}</b>` : ""}. Solo falta que crees tu contraseña.`],
    boton: { texto: "Crear mi contraseña", href: enlace(d.enlace) },
    despues: ["El enlace vence en 7 días y sirve una sola vez. Si vence, pídenos uno nuevo por WhatsApp."] }) }),

  restablecer: (d: Datos): Correo => ({ asunto: "Tu enlace para crear una contraseña nueva", ...marco({
    previa: "Crea una contraseña nueva para Regenta.", titulo: hola(d.nombre),
    parrafos: ["Pediste una contraseña nueva para entrar a Regenta. Créala con este enlace:"],
    boton: { texto: "Crear contraseña nueva", href: enlace(d.enlace) },
    despues: ["El enlace vence en 7 días y sirve una sola vez. Si no lo pediste tú, avísanos."] }) }),

  bienvenida: (d: Datos): Correo => ({ asunto: "Bienvenido a Regenta: tus primeros 3 pasos", ...marco({
    previa: "Carga tus productos y haz tu primera venta hoy.", titulo: primer(d.nombre) ? `¡Bienvenido, ${primer(d.nombre)}!` : "¡Bienvenido a Regenta!",
    parrafos: [`Tu cuenta${d.empresa ? ` de <b>${esc(d.empresa)}</b>` : ""} ya está activa. Así empiezas hoy mismo:`,
      "<b>1.</b> Carga tus productos desde Excel o búscalos en el catálogo de casi 10.000 productos.",
      "<b>2.</b> Recibe tu inventario por lote y fecha de vencimiento.",
      "<b>3.</b> Abre la caja y haz tu primera venta con POS o factura electrónica."],
    boton: { texto: "Entrar a Regenta", href: url("/entrar", "bienvenida") },
    despues: ["Si quieres, te acompañamos por WhatsApp en la primera venta."] }) }),

  solicitud_recibida: (d: Datos): Correo => ({ asunto: "Recibimos tu solicitud de demostración de Regenta", ...marco({
    previa: "Te escribimos al celular para agendarla.", titulo: primer(d.nombre) ? `Gracias, ${primer(d.nombre)}` : "Gracias",
    parrafos: [`Recibimos tu solicitud para conocer Regenta${d.drogueria ? ` en <b>${esc(d.drogueria)}</b>` : ""}. Te escribimos al celular para agendar la demostración.`,
      "Si quieres verla ya, entra a la demo: una droguería de ejemplo con 8 semanas de ventas, sin registro."],
    boton: { texto: "Ver la demo ahora", href: url("/entrar", "solicitud") } }) }),

  pago_aprobado: (d: Datos): Correo => ({ asunto: `Pago aprobado: Regenta${d.plan ? ` ${d.plan}` : ""}`, ...marco({
    previa: d.monto ? `Recibimos tu pago de ${pesos(Number(d.monto))}.` : "Recibimos tu pago.", titulo: "¡Pago aprobado!",
    parrafos: [`${hola(d.nombre)}, recibimos tu pago${d.monto ? ` de <b>${pesos(Number(d.monto))}</b>` : ""} por Regenta${d.plan ? ` <b>${esc(d.plan)}</b>` : ""}${d.periodo ? ` (${esc(PERIODO[String(d.periodo)] ?? d.periodo)})` : ""}.`,
      `${d.referencia ? `Referencia: <b>${esc(d.referencia)}</b>.` : ""}${d.vence ? ` Tu periodo pagado va hasta el <b>${esc(d.vence)}</b>.` : ""}`.trim() || "Guarda este correo como constancia.",
      "Si aún no tienes tu cuenta, te escribimos por WhatsApp para activarla y cargar tus productos."],
    boton: { texto: "Entrar a Regenta", href: url("/entrar", "pago") } }) }),

  pago_qr: (d: Datos): Correo => ({ asunto: `Paga tu plan de Regenta con QR${d.monto ? `: ${pesos(Number(d.monto))}` : ""}`, ...marco({
    previa: "Escanea el QR desde la app de tu banco y envíanos el comprobante.", titulo: "Así pagas con QR",
    parrafos: [`${hola(d.nombre)}, para activar Regenta${d.plan ? ` <b>${esc(d.plan)}</b>` : ""}${d.periodo ? ` (${esc(PERIODO[String(d.periodo)] ?? d.periodo)})` : ""} paga${d.monto ? ` <b>${pesos(Number(d.monto))}</b>` : ""} desde la app de tu banco, Nequi o Daviplata:`,
      `<b>1.</b> Abre la página de tu pago y escanea el QR${d.llave ? `, o transfiere a la llave Bre-B <b>${esc(d.llave)}</b>` : ""}${d.titular ? ` (a nombre de ${esc(d.titular)})` : ""}.`,
      `<b>2.</b> Envíanos el comprobante por WhatsApp con tu referencia${d.referencia ? ` <b>${esc(d.referencia)}</b>` : ""}.`,
      "<b>3.</b> Al ver el pago en la cuenta lo confirmamos, te llega el correo de pago aprobado y activamos tu cuenta."],
    boton: { texto: "Ver el QR y el monto", href: enlace(d.enlace) } }) }),

  pago_rechazado: (d: Datos): Correo => ({ asunto: "Tu pago de Regenta no se aprobó", ...marco({
    previa: "No se cobró nada. Puedes intentarlo con otro medio.", titulo: "El pago no se aprobó",
    parrafos: [`${hola(d.nombre)}, el banco no aprobó tu pago de Regenta${d.plan ? ` ${esc(d.plan)}` : ""}. No se cobró nada.`, "Puedes intentarlo con otro medio: tarjeta, PSE, Nequi o QR Bancolombia."],
    boton: { texto: "Intentar de nuevo", href: url(`/contratar?plan=${encodeURIComponent(String(d.plan_id ?? "pro"))}`, "pago_rechazado") } }) }),

  renovacion_fallida: (d: Datos): Correo => ({ asunto: "No pudimos cobrar la renovación de tu plan de Regenta", ...marco({
    previa: "Tu plan sigue activo; revisa tu tarjeta.", titulo: "Revisa tu tarjeta",
    parrafos: [`${hola(d.nombre)}, el banco no aprobó el cobro de la renovación de tu plan Regenta${d.plan ? ` ${esc(d.plan)}` : ""} con tarjeta. Tu plan sigue activo${d.vence ? ` hasta el <b>${esc(String(d.vence))}</b>` : ""} y Stripe volverá a intentar el cobro en los próximos días.`,
      "Si la tarjeta venció o prefieres pagar por QR Bancolombia, PSE o Nequi, renueva con otro medio: la renovación con la tarjeta anterior se cancela sola y no se cobra dos veces."],
    boton: { texto: "Renovar con otro medio", href: url(`/contratar?plan=${encodeURIComponent(String(d.plan_id ?? "pro"))}`, "renovacion_fallida") } }) }),

  pago_abandonado: (d: Datos): Correo => ({ asunto: "¿Te ayudamos a terminar tu contratación?", ...marco({
    previa: "Tu plan te está esperando.", titulo: hola(d.nombre),
    parrafos: [`Empezaste a contratar Regenta${d.plan ? ` ${esc(d.plan)}` : ""} pero el pago no se completó. Si tuviste algún problema, respóndenos y lo resolvemos.`],
    boton: { texto: "Terminar la contratación", href: url(`/contratar?plan=${encodeURIComponent(String(d.plan_id ?? "pro"))}`, "pago_abandonado") } }) }),

  renovacion_proxima: (d: Datos): Correo => ({ asunto: d.vence ? `Tu plan de Regenta vence el ${d.vence}` : "Tu plan de Regenta vence pronto", ...marco({
    previa: "Renueva en un clic para no interrumpir tu caja.", titulo: "Tu plan vence pronto",
    parrafos: [`${hola(d.nombre)}, el periodo pagado de Regenta${d.plan ? ` ${esc(d.plan)}` : ""}${d.empresa ? ` de <b>${esc(d.empresa)}</b>` : ""} vence ${d.vence ? `el <b>${esc(d.vence)}</b>` : "en pocos días"}.`, "Renuévalo con el medio que prefieras para que tu caja siga facturando sin interrupciones."],
    boton: { texto: "Renovar ahora", href: url(`/contratar?plan=${encodeURIComponent(String(d.plan_id ?? "pro"))}`, "renovacion") } }) }),

  renovacion_vencida: (d: Datos): Correo => ({ asunto: "Tu plan de Regenta venció: renuévalo hoy", ...marco({
    previa: "Renueva para no interrumpir tu servicio.", titulo: "Tu periodo pagado terminó",
    parrafos: [`${hola(d.nombre)}, el periodo de Regenta${d.plan ? ` ${esc(d.plan)}` : ""}${d.empresa ? ` de <b>${esc(d.empresa)}</b>` : ""} terminó${d.vence ? ` el <b>${esc(d.vence)}</b>` : ""}.`, "Renuévalo hoy para que el servicio no se interrumpa. Si ya pagaste, ignora este correo."],
    boton: { texto: "Renovar ahora", href: url(`/contratar?plan=${encodeURIComponent(String(d.plan_id ?? "pro"))}`, "renovacion_vencida") } }) }),

  cuenta_suspendida: (d: Datos): Correo => ({ asunto: "Tu cuenta de Regenta está suspendida", ...marco({
    previa: "Escríbenos para reactivarla.", titulo: "Tu cuenta está suspendida",
    parrafos: [`${hola(d.nombre)}, la cuenta de <b>${esc(txt(d.empresa, "tu droguería"))}</b> en Regenta está suspendida. Tus datos siguen guardados.`, "Escríbenos por WhatsApp y la reactivamos. Si prefieres una copia completa de tus datos (productos, ventas, clientes y documentos DIAN), pídela por el mismo medio."],
    boton: { texto: "Escribir por WhatsApp", href: wa(`Hola, quiero reactivar la cuenta de ${txt(d.empresa, "mi droguería")} en Regenta.`) } }) }),

  cuenta_por_suspender: (d: Datos): Correo => ({ asunto: "Tu plan de Regenta venció: renuévalo para no perder la caja", ...marco({
    previa: "En pocos días la cuenta se suspende.", titulo: "Renueva tu plan",
    parrafos: [`${hola(d.nombre)}, el plan de <b>${esc(txt(d.empresa, "tu droguería"))}</b> venció${d.vence ? ` el ${esc(String(d.vence))}` : ""}. Si no se renueva, la cuenta se suspende el <b>${esc(txt(d.suspende, "en pocos días"))}</b> (tus datos quedan guardados).`],
    boton: { texto: "Renovar mi plan", href: url("/contratar", "por_suspender") } }) }),

  resolucion_por_vencer: (d: Datos): Correo => ({ asunto: `Tu numeración DIAN ${d.prefijo ?? ""} está por ${d.motivo === "agotarse" ? "agotarse" : "vencer"}`, ...marco({
    previa: "Pide la nueva resolución antes de que la caja se detenga.", titulo: "Pide tu nueva resolución de numeración",
    parrafos: [`${hola(d.nombre)}, la numeración <b>${esc(txt(d.prefijo, ""))}</b> de <b>${esc(txt(d.empresa, "tu droguería"))}</b> ${d.motivo === "agotarse" ? `está por agotarse: quedan <b>${esc(String(d.quedan ?? ""))}</b> números` : `vence el <b>${esc(String(d.vence ?? ""))}</b>`}.`,
      "Solicita la nueva resolución en el portal MUISCA de la DIAN y envíanosla por WhatsApp: la cargamos el mismo día para que la caja no se detenga."],
    boton: { texto: "Enviar la resolución por WhatsApp", href: wa(`Hola, adjunto la nueva resolución DIAN de ${txt(d.empresa, "mi droguería")}.`) } }) }),

  documento_rechazado: (d: Datos): Correo => ({ asunto: `La DIAN rechazó el documento ${d.documento ?? ""}`, ...marco({
    previa: "Revísalo y reenvíalo desde Regenta.", titulo: "Un documento necesita tu revisión",
    parrafos: [`${hola(d.nombre)}, el documento <b>${esc(txt(d.documento, ""))}</b> de <b>${esc(txt(d.empresa, "tu droguería"))}</b> no fue aceptado: ${esc(txt(d.error, "sin detalle"))}.`,
      "Corrige el dato que indica (por ejemplo, el correo o el documento del cliente) y pulsa «Reenviar a la DIAN» en el detalle de la venta."],
    boton: { texto: "Ver la venta", href: url(String(d.ruta ?? "/ventas?dian=rechazado"), "rechazado") } }) }),

  // ── Embudo comercial (solicitudes de demo con autorización)
  embudo_1: (d: Datos): Correo => ({ asunto: "¿Cuánta plata se te vence al año?", ...marco({
    previa: "Haz la cuenta en 30 segundos.", titulo: primer(d.nombre) ? `${primer(d.nombre)}, la plata se va en lo que se vence` : "La plata se va en lo que se vence",
    parrafos: ["En una droguería, cada caja vencida es plata que ya pagaste y no vuelve. Con un 2 % de vencidos sobre un inventario de $40 millones, son $800.000 al año.",
      "Regenta te muestra, lote por lote, qué no alcanzarás a vender antes de su fecha, y la caja vende primero lo que vence antes."],
    boton: { texto: "Hacer la cuenta con mis cifras", href: url("/#demo", "embudo_1") }, baja: String(d.baja) }) }),

  embudo_2: (d: Datos): Correo => ({ asunto: "La alerta del INVIMA que nadie alcanzó a leer", ...marco({
    previa: "Regenta la cruza con tus lotes.", titulo: "Alertas del INVIMA, cruzadas con tu inventario",
    parrafos: ["Cuando el INVIMA publica una alerta de un lote falsificado o defectuoso, alguien tiene que leerla y buscar en la estantería. Casi nunca pasa a tiempo.",
      "Regenta lee las alertas oficiales y te avisa solo si tienes ese lote, ese registro sanitario o ese producto. Y guarda la constancia para la visita de la secretaría de salud.",
      "De 15 programas para droguerías que revisamos, ninguno ofrece este cruce."],
    boton: { texto: "Ver cómo funciona", href: url("/funciones/alertas-invima", "embudo_2") }, baja: String(d.baja) }) }),

  embudo_3: (d: Datos): Correo => ({ asunto: "POS genérico vs. software para droguería", ...marco({
    previa: "12 criterios para elegir bien.", titulo: "Un POS genérico cobra. Regenta piensa como un regente.",
    parrafos: ["El programa de la tienda de la esquina no sabe de lotes, vencimientos ni alertas sanitarias. Te dejamos los 12 criterios que usamos como distribuidor para elegir software de droguería."],
    boton: { texto: "Leer los 12 criterios", href: url("/guias/como-elegir-software-drogueria", "embudo_3") }, baja: String(d.baja) }) }),

  embudo_4: (d: Datos): Correo => ({ asunto: "Precios claros (y la forma de tenerlo gratis)", ...marco({
    previa: "Certificado digital incluido. Sin permanencia.", titulo: "Lo que cuesta Regenta",
    parrafos: ["Esencial $89.900 y Pro $139.900 al mes, con certificado digital y habilitación DIAN incluidos, sin instalación y sin permanencia. Pagando el año, 2 meses gratis.",
      "Y si le compras a Farmagenéricos Colombia, con el Plan Socio Regenta te sale a mitad de precio o gratis."],
    boton: { texto: "Ver planes", href: url("/precios", "embudo_4") }, baja: String(d.baja) }) }),

  embudo_5: (d: Datos): Correo => ({ asunto: "¿Lo vemos juntos en 15 minutos?", ...marco({
    previa: "Te mostramos Regenta con tus productos.", titulo: primer(d.nombre) ? `${primer(d.nombre)}, ¿lo vemos juntos?` : "¿Lo vemos juntos?",
    parrafos: ["En 15 minutos por videollamada te mostramos Regenta con productos como los tuyos: la caja, el pedido sugerido, los vencimientos y las alertas del INVIMA.", "Respóndenos este correo o escríbenos por WhatsApp y agendamos."],
    boton: { texto: "Agendar por WhatsApp", href: wa(`Hola, quiero agendar la demostración de Regenta${d.drogueria ? ` para ${d.drogueria}` : ""}.`) }, baja: String(d.baja) }) }),
} as const;

export type Plantilla = keyof typeof PLANTILLAS;
export const COMERCIALES: Plantilla[] = ["embudo_1", "embudo_2", "embudo_3", "embudo_4", "embudo_5"];
/** Días después de la solicitud de demo en que sale cada correo del embudo. */
export const EMBUDO: [Plantilla, number][] = [["embudo_1", 1], ["embudo_2", 3], ["embudo_3", 6], ["embudo_4", 10], ["embudo_5", 15]];
