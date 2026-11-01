import { comoUsuario, sinComodines } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { ClienteEntrada, dvNit, primerError } from "@/lib/validar";
import { puede } from "@/lib/sesion";

const CAMPOS = `id, tipo_doc, numero_doc, dv, nombre, email, telefono`;

/** Buscar clientes por documento o nombre (para facturar). */
export const GET = conSesion(async (s, req) => {
  if (!puede.vender(s.rol)) return json({ error: "No tienes permiso" }, 403);
  const sp = new URL(req.url).searchParams;
  if (sp.get("recientes") === "1") {
    // Los últimos clientes a los que se les facturó (o los últimos creados), para elegir sin escribir.
    const clientes = await comoUsuario(s, async (c) => (await c.query(
      `select ${CAMPOS} from clientes cl left join lateral (select max(creado) u from ventas v where v.cliente_id = cl.id) x on true
       where cl.empresa_id = $1 order by coalesce(x.u, cl.creado) desc limit 6`, [s.empresa])).rows);
    return json({ clientes });
  }
  const q = (sp.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return json({ clientes: [] });
  const clientes = await comoUsuario(s, async (c) => (await c.query(
    `select ${CAMPOS} from clientes where empresa_id = $1 and (numero_doc like $2 || '%' or lower(nombre) like '%' || $3 || '%')
     order by (numero_doc = $2) desc, nombre limit 8`, [s.empresa, sinComodines(q.replace(/[.\s-]/g, "")), sinComodines(q.toLowerCase())])).rows);
  return json({ clientes });
});

/** Crear un cliente (o devolver el que ya existe con ese documento, actualizando sus datos de contacto). */
export const POST = conSesion(async (s, req) => {
  if (!puede.vender(s.rol)) return json({ error: "No tienes permiso" }, 403);
  const p = ClienteEntrada.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: primerError(p.error) }, 400);
  const d = p.data;
  const cliente = await comoUsuario(s, async (c) => (await c.query(
    `insert into clientes (empresa_id, tipo_doc, numero_doc, dv, nombre, email, telefono, autoriza_datos)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (empresa_id, tipo_doc, numero_doc) do update set nombre = excluded.nombre,
       email = coalesce(excluded.email, clientes.email), telefono = coalesce(excluded.telefono, clientes.telefono),
       autoriza_datos = clientes.autoriza_datos or excluded.autoriza_datos
     returning ${CAMPOS}`,
    [s.empresa, d.tipo_doc, d.numero_doc, d.tipo_doc === "NIT" ? dvNit(d.numero_doc) : null, d.nombre, d.email || null, d.telefono || null, d.autoriza_datos])).rows[0]);
  return json({ cliente }, 201);
});
