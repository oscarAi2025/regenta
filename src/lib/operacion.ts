import "server-only";
import { sinRLS } from "./db";
import { encolar } from "./correo";
import { CUPO_DOCS, DOC_EXTRA, limite } from "./planes";
import { datosQr } from "./pagos";

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
      select e.id, e.plan, coalesce(e.nombre_comercial, e.razon_social) nombre, max(p.vence) vence
      from empresas e join pagos_suscripcion p on p.empresa_id = e.id and p.estado = 'aprobado'
      where not e.demo and e.estado = 'activa' group by e.id having max(p.vence) < current_date`)).rows as { id: string; plan: string; nombre: string; vence: Date }[];
    let avisos = 0, suspendidas = 0;
    for (const f of filas) {
      const vence = new Date(f.vence).toISOString().slice(0, 10);
      const limite = new Date(new Date(vence + "T12:00:00Z").getTime() + GRACIA_DIAS * 86400000);
      const suspender = Date.now() > limite.getTime() + 86400000 / 2;
      if (suspender) await c.query(`update empresas set estado = 'suspendida', suspension = 'impago' where id = $1 and estado = 'activa'`, [f.id]);
      for (const d of await duenos(c, f.id)) {
        const ok = await encolar(c, suspender
          ? { clave: `suspendida-auto:${f.id}:${vence}:${d.email}`, para: d.email, plantilla: "cuenta_suspendida", empresa: f.id, datos: { nombre: d.nombre, empresa: f.nombre, impago: 1, plan_id: f.plan } }
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

/** Documentos electrónicos reales (numeración de producción) de una empresa en un mes: los que cuentan para el cupo. */
const DOCS_MES = `select count(*)::int n from documentos_dian d join resoluciones_dian r on r.empresa_id = d.empresa_id and r.prefijo = d.prefijo and r.tipo = d.tipo and not r.pruebas
  where d.empresa_id = $1 and not d.simulado and d.creado >= ($2::date at time zone 'America/Bogota') and d.creado < (($2::date + interval '1 month') at time zone 'America/Bogota')`;

/** Cierre del mes anterior: los documentos por encima del cupo del plan se cobran (términos, punto 2) y se avisa al dueño
 *  con el valor y cómo pagarlo. Un cargo por empresa y mes (aunque la tarea corra muchas veces). */
export async function cobrarDocumentosExtra() {
  return sinRLS(async (c) => {
    const mes = (await c.query(`select to_char(date_trunc('month', (now() at time zone 'America/Bogota') - interval '1 month'), 'YYYY-MM-DD') m`)).rows[0].m as string;
    const empresas = (await c.query(`select id, plan, nit, coalesce(nombre_comercial, razon_social) nombre from empresas e where not demo
      and not exists (select 1 from cargos_documentos g where g.empresa_id = e.id and g.mes = $1)`, [mes])).rows;
    let cargos = 0;
    for (const e of empresas) {
      const cupo = CUPO_DOCS[e.plan] ?? null;
      if (cupo === null) continue;
      const n = (await c.query(DOCS_MES, [e.id, mes])).rows[0].n as number;
      if (n <= cupo) continue;
      const extra = n - cupo, monto = extra * DOC_EXTRA, referencia = `DOC-${e.nit}-${mes.slice(0, 7).replace("-", "")}`;
      const r = await c.query(`insert into cargos_documentos (empresa_id, mes, documentos, cupo, extra, valor_unidad, monto, referencia) values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (empresa_id, mes) do nothing`, [e.id, mes, n, cupo, extra, DOC_EXTRA, monto, referencia]);
      if (!r.rowCount) continue;
      cargos++;
      const q = datosQr(), mesTxt = new Date(mes + "T12:00:00Z").toLocaleDateString("es-CO", { month: "long", year: "numeric", timeZone: "UTC" });
      for (const d of await duenos(c, e.id))
        await encolar(c, { clave: `cargo-docs:${e.id}:${mes}:${d.email}`, para: d.email, plantilla: "cargo_documentos", empresa: e.id,
          datos: { nombre: d.nombre, empresa: e.nombre, mes: mesTxt, documentos: n.toLocaleString("es-CO"), cupo: cupo.toLocaleString("es-CO"), extra: extra.toLocaleString("es-CO"), monto, referencia, llave: q.llave, titular: q.titular } });
    }
    return { mes, cargos };
  });
}

/** Aviso al llegar al 90 % del cupo de documentos del mes (una vez por mes), para que pase a Pro antes de pagar extra. */
export async function avisarCupoDocumentos() {
  return sinRLS(async (c) => {
    const mes = (await c.query(`select to_char(date_trunc('month', now() at time zone 'America/Bogota'), 'YYYY-MM-DD') m`)).rows[0].m as string;
    const empresas = (await c.query(`select id, plan, coalesce(nombre_comercial, razon_social) nombre from empresas where not demo and estado = 'activa'`)).rows;
    let avisos = 0;
    for (const e of empresas) {
      const cupo = CUPO_DOCS[e.plan] ?? null;
      if (!cupo) continue;
      const n = (await c.query(DOCS_MES, [e.id, mes])).rows[0].n as number;
      if (n < cupo * 0.9) continue;
      for (const d of await duenos(c, e.id))
        if (await encolar(c, { clave: `cupo90:${e.id}:${mes}:${d.email}`, para: d.email, plantilla: "cupo_documentos", empresa: e.id,
          datos: { nombre: d.nombre, empresa: e.nombre, documentos: n.toLocaleString("es-CO"), cupo: cupo.toLocaleString("es-CO"), plan: e.plan === "pro" ? "Pro" : "Esencial", valor: DOC_EXTRA } })) avisos++;
    }
    return { avisos };
  });
}

/** Deja activas solo las cajas y personas que caben en el plan (al bajar de plan). Nunca toca al dueño ni una caja con
 *  turno abierto. Devuelve lo que desactivó. */
export async function recortarAlPlan(c: Parameters<Parameters<typeof sinRLS>[0]>[0], empresa: string, plan: string) {
  const l = limite(plan);
  let cajas = 0, usuarios = 0;
  if (l.cajas !== null) cajas = (await c.query(`update cajas set activa = false where id in (
      select id from (select cj.id, row_number() over (order by exists (select 1 from turnos t where t.caja_id = cj.id and t.estado = 'abierto') desc, cj.nombre, cj.id) n
        from cajas cj where cj.empresa_id = $1 and cj.activa) x where n > $2)
      and not exists (select 1 from turnos t where t.caja_id = cajas.id and t.estado = 'abierto')`, [empresa, l.cajas])).rowCount ?? 0;
  if (l.usuarios !== null) usuarios = (await c.query(`update miembros set activo = false where empresa_id = $1 and user_id in (
      select user_id from (select user_id, row_number() over (order by rol = 'dueno' desc, creado) n from miembros where empresa_id = $1 and activo) x where n > $2)
      and rol <> 'dueno'`, [empresa, l.usuarios])).rowCount ?? 0;
  return { cajas, usuarios };
}

/** Bajadas de plan pendientes: cuando termina el periodo ya pagado del plan mayor, se aplica el plan nuevo, se recorta lo
 *  que no cabe y se avisa al dueño. */
export async function aplicarBajadas() {
  return sinRLS(async (c) => {
    const filas = (await c.query(`select e.id, e.plan, e.plan_siguiente, coalesce(e.nombre_comercial, e.razon_social) nombre from empresas e
      where e.plan_siguiente is not null and not e.demo
        and coalesce((select max(p.vence) from pagos_suscripcion p where p.empresa_id = e.id and p.estado = 'aprobado' and p.plan = e.plan), current_date - 1) < current_date`)).rows;
    for (const f of filas) {
      await c.query(`update empresas set plan = plan_siguiente, plan_siguiente = null where id = $1`, [f.id]);
      const r = await recortarAlPlan(c, f.id, f.plan_siguiente);
      for (const d of await duenos(c, f.id))
        await encolar(c, { clave: `bajada:${f.id}:${f.plan_siguiente}:${new Date().toISOString().slice(0, 10)}:${d.email}`, para: d.email, plantilla: "plan_cambiado", empresa: f.id,
          datos: { nombre: d.nombre, empresa: f.nombre, plan: f.plan_siguiente === "pro" ? "Pro" : "Esencial", cajas: r.cajas, usuarios: r.usuarios } });
    }
    return { bajadas: filas.length };
  });
}

/** Al quedar la facturación en producción (ventas y notas crédito), avisa una sola vez a los dueños que ya facturan ante
 *  la DIAN. Se llama dentro de la transacción de la consola; devuelve las claves para enviarlas al instante. */
export async function avisarHabilitacion(c: Parameters<Parameters<typeof sinRLS>[0]>[0], empresa: string): Promise<string[]> {
  const q = (await c.query(`select bool_or(r.tipo in ('pos', 'factura') and not r.pruebas) ventas, bool_or(r.tipo = 'nota_credito' and not r.pruebas) nc,
      max(coalesce(e.nombre_comercial, e.razon_social)) nombre from resoluciones_dian r join empresas e on e.id = r.empresa_id where r.empresa_id = $1 and r.activa`, [empresa])).rows[0];
  if (!q?.ventas || !q.nc) return [];
  const claves: string[] = [];
  for (const d of await duenos(c, empresa)) {
    const k = `habilitado:${empresa}:${d.email}`;
    if (await encolar(c, { clave: k, para: d.email, plantilla: "habilitado", empresa, datos: { nombre: d.nombre, empresa: q.nombre } })) claves.push(k);
  }
  return claves;
}
