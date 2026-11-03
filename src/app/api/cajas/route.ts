import { z } from "zod";
import { sinRLS } from "@/lib/db";
import { conSesion, json, esUuid } from "@/lib/api";
import { limite } from "@/lib/planes";

// Cajas (puestos de venta) de la droguería. Cada caja tiene su propio turno y su cajón; todas comparten el inventario y
// la numeración DIAN. El dueño las crea hasta el tope de su plan, las renombra y las activa o desactiva.
const Nueva = z.object({ nombre: z.string().trim().min(2, "Ponle un nombre a la caja (p. ej. «Caja 2» o «Mostrador»)").max(40) });
const Cambio = z.object({ id: z.string().refine(esUuid, "Caja no válida"), nombre: z.string().trim().min(2).max(40).optional(), activa: z.boolean().optional() });
const negar = (m: string, status = 400) => Object.assign(new Error(m), { status });
const responder = (e: unknown) => { const x = e as { status?: number; message: string }; if (x.status) return json({ error: x.message }, x.status); throw e; };

/** Cajas activas de la droguería (para elegir con cuál trabaja esta computadora), con su turno abierto si lo hay. */
export const GET = conSesion(async (s) => json({ cajas: await sinRLS(async (c) => (await c.query(`select cj.id, cj.nombre, cj.activa,
    exists (select 1 from turnos t where t.caja_id = cj.id and t.estado = 'abierto') turno_abierto
  from cajas cj where cj.empresa_id = $1 order by cj.activa desc, cj.nombre`, [s.empresa])).rows) }));

export const POST = conSesion(async (s, req) => {
  if (s.rol !== "dueno") return json({ error: "Solo el dueño crea cajas" }, 403);
  const p = Nueva.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Revisa el nombre" }, 400);
  try {
    const caja = await sinRLS(async (c) => {
      const e = (await c.query(`select demo, plan from empresas where id = $1 for update`, [s.empresa])).rows[0];
      if (e.demo) throw negar("En la demostración no se crean cajas. Al contratar, las creas aquí mismo.");
      const tope = limite(e.plan).cajas;
      const n = Number((await c.query(`select count(*) n from cajas where empresa_id = $1 and activa`, [s.empresa])).rows[0].n);
      if (tope !== null && n >= tope) throw negar(e.plan === "esencial" ? "Tu plan Esencial incluye 1 caja. Con Pro tienes hasta 3 cajas." : `Tu plan incluye hasta ${tope} cajas. Escríbenos para ampliarlo.`, 409);
      if ((await c.query(`select 1 from cajas where empresa_id = $1 and lower(nombre) = lower($2)`, [s.empresa, p.data.nombre])).rowCount) throw negar("Ya tienes una caja con ese nombre", 409);
      const sede = (await c.query(`select id from sedes where empresa_id = $1 order by creado limit 1`, [s.empresa])).rows[0];
      const r = (await c.query(`insert into cajas (empresa_id, sede_id, nombre) values ($1, $2, $3) returning id, nombre`, [s.empresa, sede.id, p.data.nombre])).rows[0];
      await c.query(`insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos) values ($1, $2, 'crear_caja', 'cajas', $3, $4)`, [s.empresa, s.uid, r.id, JSON.stringify({ nombre: r.nombre })]);
      return r;
    });
    return json({ caja, mensaje: `Listo: «${caja.nombre}» creada. En la computadora de esa caja, elígela en la pantalla de Caja.` }, 201);
  } catch (e) { return responder(e); }
});

export const PATCH = conSesion(async (s, req) => {
  if (s.rol !== "dueno") return json({ error: "Solo el dueño cambia las cajas" }, 403);
  const p = Cambio.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos no válidos" }, 400);
  try {
    await sinRLS(async (c) => {
      const e = (await c.query(`select demo, plan from empresas where id = $1 for update`, [s.empresa])).rows[0];
      if (e.demo) throw negar("En la demostración no se cambian las cajas.");
      const cj = (await c.query(`select id, activa from cajas where id = $1 and empresa_id = $2`, [p.data.id, s.empresa])).rows[0];
      if (!cj) throw negar("Esa caja no es de tu droguería", 404);
      if (p.data.activa === false && cj.activa) {
        if ((await c.query(`select 1 from turnos where caja_id = $1 and estado = 'abierto'`, [cj.id])).rowCount) throw negar("Esa caja tiene un turno abierto: ciérralo antes de desactivarla", 409);
        if (Number((await c.query(`select count(*) n from cajas where empresa_id = $1 and activa`, [s.empresa])).rows[0].n) <= 1) throw negar("Necesitas al menos una caja activa", 409);
      }
      if (p.data.activa === true && !cj.activa) {
        const tope = limite(e.plan).cajas;
        const n = Number((await c.query(`select count(*) n from cajas where empresa_id = $1 and activa`, [s.empresa])).rows[0].n);
        if (tope !== null && n >= tope) throw negar(`Tu plan incluye ${tope} caja${tope === 1 ? "" : "s"} activa${tope === 1 ? "" : "s"}. Desactiva otra o pásate a Pro.`, 409);
      }
      if (p.data.nombre && (await c.query(`select 1 from cajas where empresa_id = $1 and lower(nombre) = lower($2) and id <> $3`, [s.empresa, p.data.nombre, cj.id])).rowCount) throw negar("Ya tienes una caja con ese nombre", 409);
      await c.query(`update cajas set nombre = coalesce($3, nombre), activa = coalesce($4, activa) where id = $1 and empresa_id = $2`, [cj.id, s.empresa, p.data.nombre ?? null, p.data.activa ?? null]);
      await c.query(`insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos) values ($1, $2, 'cambiar_caja', 'cajas', $3, $4)`, [s.empresa, s.uid, cj.id, JSON.stringify(p.data)]);
    });
    return json({ ok: true });
  } catch (e) { return responder(e); }
});
