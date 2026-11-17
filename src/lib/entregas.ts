// Modo «droguería interna (sin DIAN)»: entregas internas. Reglas y nombres compartidos por el navegador y el servidor.
// Módulo puro: sin base de datos ni React. La base vuelve a comprobarlo todo en registrar_entrega.

export const DESTINATARIOS = {
  servicio: "Servicio o área", paciente: "Paciente", empleado: "Empleado", sede: "Otra sede", otro: "Otro",
} as const;
export type TipoDestinatario = keyof typeof DESTINATARIOS;
export const esDestinatario = (t: string): t is TipoDestinatario => t in DESTINATARIOS;

/** Número visible de una entrega: EI-12. */
export const numeroEntrega = (n: number | string) => `EI-${n}`;

/** Lo que se pide en el formulario (los datos de la fórmula van aparte, como en la caja). */
export type DatosEntrega = { destinatario_tipo: TipoDestinatario; destinatario: string; documento: string; servicio: string; autoriza: string; observacion: string };
export const ENTREGA_VACIA: DatosEntrega = { destinatario_tipo: "servicio", destinatario: "", documento: "", servicio: "", autoriza: "", observacion: "" };

const t = (s: unknown) => String(s ?? "").trim().replace(/\s+/g, " ");
export const limpiarDocumento = (s: string) => s.replace(/[\s.\-]/g, "").toUpperCase();

/** Primer dato que falta o no sirve (mensaje para quien entrega), o null si está completo. */
export function errorEntrega(d: Partial<DatosEntrega>, lineas: number): string | null {
  if (!esDestinatario(String(d.destinatario_tipo ?? ""))) return "Elige a quién se entrega";
  const dest = t(d.destinatario);
  if (dest.length < 3 || dest.length > 120) return d.destinatario_tipo === "servicio" ? "Escribe el servicio o área que recibe" : "Escribe el nombre de quien recibe";
  const doc = limpiarDocumento(t(d.documento));
  if (doc && !/^[0-9A-Z]{3,20}$/.test(doc)) return "El documento de quien recibe va sin puntos (de 3 a 20 letras o dígitos)";
  const serv = t(d.servicio);
  if (serv && (serv.length < 2 || serv.length > 80)) return "El servicio o área va de 2 a 80 caracteres";
  const aut = t(d.autoriza);
  if (aut.length < 3 || aut.length > 120) return "Escribe quién autoriza la entrega";
  if (t(d.observacion).length > 300) return "La observación va hasta 300 caracteres";
  if (lineas === 0) return "Agrega al menos un producto a la entrega";
  if (lineas > 100) return "Una entrega lleva hasta 100 productos";
  return null;
}

/** «Servicio» con el que se agrupa el consumo: el servicio o área si se escribió; si no, el destinatario cuando es un
 *  servicio u otra sede; si no, «Sin servicio». */
export const servicioDe = (e: { destinatario_tipo: string; destinatario: string; servicio: string | null }) =>
  e.servicio || (e.destinatario_tipo === "servicio" || e.destinatario_tipo === "sede" ? e.destinatario : "Sin servicio");
