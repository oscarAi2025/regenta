import "server-only";
import { sinRLS } from "./db";
import { encolar } from "./correo";
import { nombreMes, plazo } from "./anexo13";
import { hoyBogota } from "./reportes";

/** Recordatorio del informe mensual de control especial (Res. 1478/2006, art. 94: primeros 10 días calendario).
 *  Corre con la tarea horaria. Del día 1 al 10, a los dueños de droguerías con productos de control especial que aún no
 *  marcaron presentado el informe del mes anterior: un correo al empezar el mes y otro desde el día 7 (urgente). Cada
 *  correo sale una sola vez (clave única). Sin la migración 048, no hace nada. */
export async function avisarAnexo13(hoy = hoyBogota()) {
  const p = plazo(hoy);
  if (p.vencido) return { omitido: "fuera del plazo" };
  const etapa = p.dia >= 7 ? "final" : "inicio";
  return sinRLS(async (c) => {
    if (!(await c.query(`select to_regclass('public.control_informes') is not null listo`)).rows[0]?.listo) return { omitido: "sin migración 048" };
    const filas = (await c.query(`select e.id, coalesce(e.nombre_comercial, e.razon_social) nombre from empresas e
      where e.estado = 'activa' and not e.demo
        and exists (select 1 from productos p where p.empresa_id = e.id and p.control_especial)
        and not exists (select 1 from control_informes i where i.empresa_id = e.id and i.periodo = $1::date)`, [`${p.periodo}-01`])).rows;
    let avisos = 0;
    for (const f of filas) {
      const duenos = (await c.query(`select cu.email, cu.nombre from miembros m join cuentas cu on cu.id = m.user_id
        where m.empresa_id = $1 and m.activo and m.rol = 'dueno' and cu.activa`, [f.id])).rows as { email: string; nombre: string }[];
      for (const d of duenos)
        if (await encolar(c, { clave: `anexo13:${f.id}:${p.periodo}:${etapa}:${d.email}`, para: d.email, plantilla: "anexo13_pendiente", empresa: f.id,
          datos: { nombre: d.nombre, empresa: f.nombre, mes: nombreMes(p.periodo), vence: p.vence.split("-").reverse().join("/"), urgente: etapa === "final",
            ruta: `/control-especial/anexo-13?mes=${p.periodo}` } })) avisos++;
    }
    return { droguerias: filas.length, avisos };
  });
}
