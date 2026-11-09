import { comoUsuario, sinComodines } from "@/lib/db";
import { conSesion, json } from "@/lib/api";

/** Busca en el catálogo maestro de Regenta lo que la droguería todavía no tiene. */
export const GET = conSesion(async (s, req) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").replace(/\0/g, "").trim().toLowerCase().slice(0, 80);
  const palabras = q.split(/\s+/).filter(Boolean).slice(0, 6).map(sinComodines);
  if (!palabras.length) return json({ productos: [] });
  const productos = await comoUsuario(s, async (c) => (await c.query(
    `select m.id, m.nombre, m.laboratorio, m.ean, m.iva::float, m.categoria
     from productos_maestro m
     where (m.ean = $2 or (select bool_and(sin_tildes(m.nombre || ' ' || coalesce(m.laboratorio, '')) like '%' || sin_tildes(w) || '%') from unnest($3::text[]) w))
       and not exists (select 1 from productos p where p.empresa_id = $1 and p.maestro_id = m.id)
     order by (m.ean = $2) desc, m.nombre limit 25`, [s.empresa, q, palabras])).rows);
  return json({ productos });
});
