import "server-only";
import { sinRLS } from "./db";
import { encolar } from "./correo";

// Tareas de operación que corren con la tarea programada: suscripciones vencidas (aviso y suspensión), numeraciones
// DIAN por vencer o agotarse, y documentos rechazados por la DIAN. Cada correo lleva una clave única: aunque la tarea
// corra muchas veces, cada aviso sale una sola vez.

const GRACIA_DIAS = 3; // días después del vencimiento antes de suspender

const duenos = (c: Parameters<Parameters<typeof sinRLS>[0]>[0], empresa: string) =>
  c.query(`select cu.email, cu.nombre from miembros m join cuentas cu on cu.id = m.user_id where m.empresa_id = $1 and m.activo and m.rol = 'dueno' and cu.activa`, [empresa])
    .then((r) => r.rows as { email: string; nombre: string }[]);

/** Planes vencidos: avisa durante la gracia y suspende después. Solo empresas que pagan en línea (tienen pagos). */
export async function revisarSuscripciones() {
  return sinRLS(async (c) => {
    const filas = (await c.query(`
      select e.id, coalesce(e.nombre_comercial, e.razon_social) nombre, max(p.vence) vence
      from empresas e join pagos_suscripcion p on p.empresa_id = e.id and p.estado = 'aprobado'
      where not e.demo and e.estado = 'activa' group by e.id having max(p.vence) < current_date`)).rows as { id: string; nombre: string; vence: Date }[];
    let avisos = 0, suspendidas = 0;
    for (const f of filas) {
      const vence = new Date(f.vence).toISOString().slice(0, 10);
      const limite = new Date(new Date(vence + "T12:00:00Z").getTime() + GRACIA_DIAS * 86400000);
      const suspender = Date.now() > limite.getTime() + 86400000 / 2;
      if (suspender) await c.query(`update empresas set estado = 'suspendida', suspension = 'impago' where id = $1 and estado = 'activa'`, [f.id]);
      for (const d of await duenos(c, f.id)) {
        const ok = await encolar(c, suspender
          ? { clave: `suspendida-auto:${f.id}:${vence}:${d.email}`, para: d.email, plantilla: "cuenta_suspendida", empresa: f.id, datos: { nombre: d.nombre, empresa: f.nombre } }
          : { clave: `por-suspender:${f.id}:${vence}:${d.email}`, para: d.email, plantilla: "cuenta_por_suspender", empresa: f.id,
              datos: { nombre: d.nombre, empresa: f.nombre, vence: vence.split("-").reverse().join("/"), suspende: limite.toISOString().slice(0, 10).split("-").reverse().join("/") } });
        if (ok) avisos++;
      }
      if (suspender) suspendidas++;
    }
    return { vencidas: filas.length, suspendidas, avisos };
  });
}

/** Numeraciones de producción por vencer (30 y 7 días) o por agotarse (menos del 10 % o de 200 números). */
export async function avisarNumeraciones() {
  return sinRLS(async (c) => {
    const filas = (await c.query(`
      select r.id, r.empresa_id, r.prefijo, r.hasta - r.actual quedan, to_char(r.vigente_hasta, 'DD/MM/YYYY') vence,
             (r.vigente_hasta - current_date) dias, coalesce(e.nombre_comercial, e.razon_social) nombre,
             r.hasta - r.actual <= greatest(200, (r.hasta - r.desde) / 10) agota
      from resoluciones_dian r join empresas e on e.id = r.empresa_id
      where r.activa and not r.pruebas and not e.demo and e.estado = 'activa'
        and ((r.vigente_hasta is not null and r.vigente_hasta <= current_date + 30) or r.hasta - r.actual <= greatest(200, (r.hasta - r.desde) / 10))`)).rows;
    let avisos = 0;
    for (const f of filas) {
      const agota = !!f.agota && !(f.dias !== null && Number(f.dias) <= 30);
      const tramo = agota ? `agota` : Number(f.dias) <= 7 ? "vence7" : "vence30";
      for (const d of await duenos(c, f.empresa_id))
        if (await encolar(c, { clave: `numeracion:${f.id}:${tramo}:${d.email}`, para: d.email, plantilla: "resolucion_por_vencer", empresa: f.empresa_id,
          datos: { nombre: d.nombre, empresa: f.nombre, prefijo: f.prefijo, motivo: agota ? "agotarse" : "vencer", quedan: Number(f.quedan).toLocaleString("es-CO"), vence: f.vence } })) avisos++;
    }
    return { numeraciones: filas.length, avisos };
  });
}

/** Documentos que la DIAN rechazó en las últimas 24 horas: aviso al dueño con el motivo y el enlace a la venta. */
export async function avisarRechazos() {
  return sinRLS(async (c) => {
    const filas = (await c.query(`
      select d.id, d.empresa_id, d.venta_id, d.prefijo || d.numero doc, d.ultimo_error, extract(epoch from d.actualizado)::bigint marca,
             coalesce(e.nombre_comercial, e.razon_social) nombre
      from documentos_dian d join empresas e on e.id = d.empresa_id
      where d.estado = 'rechazado' and not e.demo and d.actualizado > now() - interval '1 day' and not d.simulado`)).rows;
    let avisos = 0;
    for (const f of filas)
      for (const d of await duenos(c, f.empresa_id))
        if (await encolar(c, { clave: `rechazado:${f.id}:${f.marca}:${d.email}`, para: d.email, plantilla: "documento_rechazado", empresa: f.empresa_id,
          datos: { nombre: d.nombre, empresa: f.nombre, documento: f.doc, error: String(f.ultimo_error ?? "").slice(0, 300), ruta: `/ventas/${f.venta_id}` } })) avisos++;
    return { rechazados: filas.length, avisos };
  });
}
