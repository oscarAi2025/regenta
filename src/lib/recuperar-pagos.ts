import "server-only";
import { sinRLS } from "./db";
import { encolar } from "./correo";
import { pagoDePrueba } from "./interno";
import { SITIO } from "./sitio";

/**
 * Recuperación de pagos (21/11/2026). Un cliente que llega a pagar ya decidió comprar: perderlo en el último paso es lo
 * más caro del embudo. Caso real: «franco» pidió pagar por QR el 04/11 y su orden quedó 17 días «pendiente» sin que
 * nadie lo llamara ni confirmara el dinero.
 *
 * Pagos por QR sin confirmar (dependen de nosotros y del cliente):
 *   · 2 h  → correo al cliente («¿pudiste pagar?»: comprobante por WhatsApp o pago inmediato con tarjeta/PSE)
 *            (la gerencia recibe copia con el WhatsApp del cliente: revisar la cuenta y llamarlo).
 *   · 24 h → segundo correo (lo que gana activando hoy) con copia a la gerencia.
 *   · 72 h → último correo, con ayuda directa por WhatsApp.
 * Pagos con pasarela que no se completaron: el correo de ayuda de la 1.ª hora ya existe (programarRecordatorios); aquí
 * se suma un segundo a las 24 h que ofrece el QR y la ayuda por WhatsApp.
 * Se detiene en cuanto el pago cambia de estado o la misma persona (correo o NIT) paga otra orden. Nunca a pruebas.
 * Cada paso sale una sola vez (clave única) y solo el que corresponde a la edad de la orden: una orden vieja no recibe
 * de golpe todos los correos atrasados.
 */
const PLANTILLA_QR = ["pago_qr_recordatorio_1", "pago_qr_recordatorio_2", "pago_qr_recordatorio_3"] as const;
const PASOS_QR = [{ paso: 1, desde: 2, hasta: 24 }, { paso: 2, desde: 24, hasta: 72 }, { paso: 3, desde: 72, hasta: 168 }];

export async function recuperarPagos() {
  return sinRLS(async (c) => {
    const pendientes = (await c.query(`
      select p.referencia, p.plan, p.periodo, p.monto, p.proveedor, p.nombre, p.empresa, p.nit, p.email, p.telefono,
             extract(epoch from (now() - p.creado)) / 3600 horas
      from pagos_suscripcion p
      where p.estado = 'pendiente' and p.creado between now() - interval '7 days' and now() - interval '2 hours'
        and not ${pagoDePrueba("p")}
        and not exists (select 1 from pagos_suscripcion q where q.estado = 'aprobado' and q.creado > p.creado
                          and (lower(q.email) = lower(p.email) or (p.nit is not null and regexp_replace(q.nit, '\\D', '', 'g') = regexp_replace(p.nit, '\\D', '', 'g'))))`)).rows;
    let clientes = 0;
    for (const p of pendientes) {
      const horas = Number(p.horas);
      const plan = p.plan === "pro" ? "Pro" : "Esencial";
      const base = { nombre: p.nombre, empresa: p.empresa, plan, plan_id: p.plan, periodo: p.periodo, monto: p.monto, referencia: p.referencia };
      if (p.proveedor === "qr") {
        const s = PASOS_QR.find((x) => horas >= x.desde && horas < x.hasta);
        if (!s) continue;
        // La gerencia recibe la copia de cada correo (encolar la avisa) con el celular y el WhatsApp del cliente.
        if (await encolar(c, { clave: `qr-recuperar:${p.referencia}:${s.paso}`, para: p.email, plantilla: PLANTILLA_QR[s.paso - 1],
          datos: { ...base, horas: Math.floor(horas), telefono: p.telefono, nit: p.nit, enlace: `${SITIO}/contratar/resultado?ref=${encodeURIComponent(p.referencia)}` } })) clientes++;
      } else if (horas >= 24 && horas < 96) {
        if (await encolar(c, { clave: `abandonado-2:${String(p.email).toLowerCase()}:${p.plan}`, para: p.email, plantilla: "pago_abandonado_2", datos: { ...base, telefono: p.telefono } })) clientes++;
      }
    }
    return { pendientes: pendientes.length, correos: clientes };
  });
}
