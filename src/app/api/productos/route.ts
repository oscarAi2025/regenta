import { NextResponse } from "next/server";
import { comoUsuario, mensajeError, sinComodines } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { ProductoEntrada, primerError } from "@/lib/validar";
import { leerSesion, puede } from "@/lib/sesion";
import { normalizarCodigo } from "@/lib/precios";

/** Búsqueda para la caja: por código de barras exacto (principal o alterno) o por palabras (todas deben aparecer en nombre o laboratorio). */
export async function GET(req: Request) {
  const s = await leerSesion();
  if (!s) return NextResponse.json({ error: "Sesión vencida" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").replace(/\0/g, "").trim().slice(0, 80);
  if (sp.get("vencen") === "1") {
    // Para la caja en reposo: lo que conviene vender primero (lotes con existencias que vencen en 60 días).
    try {
      const productos = await comoUsuario(s, async (c) => (await c.query(
        `select p.id, p.nombre, p.laboratorio, p.ean, p.iva::float, p.unidades_por_caja, p.precio_caja::float, p.precio_unidad::float,
                p.stock_minimo, st.unidades::int, st.proximo_vence::text, false as exacto, p.requiere_formula, p.control_especial
         from productos p
         join lateral (select sum(unidades) unidades, min(vence) filter (where unidades > 0) proximo_vence from v_stock_vigente where producto_id = p.id) st on true
         where p.empresa_id = $1 and p.activo and st.unidades > 0 and st.proximo_vence <= current_date + 60
         order by st.proximo_vence, p.nombre limit 8`, [s.empresa])).rows);
      return NextResponse.json({ productos });
    } catch (e) { const { status, error } = mensajeError(e); return NextResponse.json({ error }, { status }); }
  }
  if (sp.get("catalogo") === "1") {
    // Catálogo completo para buscar en la caja sin internet (se guarda en el navegador de la caja).
    try {
      const productos = await comoUsuario(s, async (c) => (await c.query(
        `select p.id, p.nombre, p.laboratorio, p.ean, p.iva::float, p.unidades_por_caja, p.precio_caja::float, p.precio_unidad::float,
                p.stock_minimo, coalesce(st.unidades, 0)::int unidades, st.proximo_vence::text, false as exacto, p.requiere_formula, p.control_especial,
                coalesce((select array_agg(pc.codigo order by pc.codigo) from producto_codigos pc where pc.producto_id = p.id), '{}') codigos
         from productos p
         left join lateral (select sum(unidades) unidades, min(vence) filter (where unidades > 0) proximo_vence from v_stock_vigente where producto_id = p.id) st on true
         where p.empresa_id = $1 and p.activo order by p.nombre limit 20000`, [s.empresa])).rows);
      return NextResponse.json({ empresa: s.empresa, productos }, { headers: { "cache-control": "no-store" } });
    } catch (e) { const { status, error } = mensajeError(e); return NextResponse.json({ error }, { status }); }
  }
  if (!q) return NextResponse.json({ productos: [] });
  const palabras = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6).map(sinComodines);
  // Código de barras exacto: el principal (ean) o cualquiera de los códigos alternos del producto.
  const codigo = normalizarCodigo(q);
  try {
    const productos = await comoUsuario(s, async (c) => (await c.query(
      `select p.id, p.nombre, p.laboratorio, p.ean, p.iva::float, p.unidades_por_caja, p.precio_caja::float, p.precio_unidad::float,
              p.stock_minimo, coalesce(st.unidades, 0)::int as unidades, st.proximo_vence::text as proximo_vence,
              (coalesce(p.ean = $2, false) or alt.id is not null) as exacto, p.requiere_formula, p.control_especial
       from productos p
       left join producto_codigos alt on alt.producto_id = p.id and alt.empresa_id = $1 and alt.codigo = $4
       left join lateral (select sum(unidades) unidades, min(vence) filter (where unidades > 0) proximo_vence
                          from v_stock_vigente where producto_id = p.id) st on true
       where p.empresa_id = $1 and p.activo
         and (p.ean = $2 or alt.id is not null or (select bool_and(lower(p.nombre || ' ' || coalesce(p.laboratorio, '')) like '%' || w || '%') from unnest($3::text[]) w))
       order by (coalesce(p.ean = $2, false) or alt.id is not null) desc, (coalesce(st.unidades, 0) > 0) desc, p.nombre
       limit 30`, [s.empresa, q, palabras, codigo])).rows);
    return NextResponse.json({ productos });
  } catch (e) {
    const { status, error } = mensajeError(e);
    return NextResponse.json({ error }, { status });
  }
}

/** Crea un producto en la droguería (desde el catálogo maestro o propio). Solo dueño o administrador (lo exige la RLS). */
export const POST = conSesion(async (s, req) => {
  if (!puede.verCostos(s.rol)) return json({ error: "Solo el dueño o el administrador crean productos" }, 403); // el permiso se mira antes que los datos
  const p = ProductoEntrada.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: primerError(p.error) }, 400);
  const d = p.data;
  if (d.unidades_por_caja === 1) d.precio_unidad = null;
  const r = await comoUsuario(s, async (c) => {
    if (d.ean) {
      const ya = (await c.query(`select nombre from productos where empresa_id = $1 and ean = $2 and activo`, [s.empresa, d.ean])).rows[0];
      if (ya) return { error: `Ya tienes un producto con ese código de barras: ${ya.nombre}` };
      const alt = (await c.query(`select p.nombre from producto_codigos pc join productos p on p.id = pc.producto_id where pc.empresa_id = $1 and pc.codigo = $2`, [s.empresa, normalizarCodigo(d.ean)])).rows[0];
      if (alt) return { error: `Ese código de barras ya es un código alterno de ${alt.nombre}` };
    }
    const { rows } = await c.query(
      `insert into productos (empresa_id, maestro_id, nombre, laboratorio, ean, iva, categoria, unidades_por_caja, precio_caja, precio_unidad, stock_minimo, registro_sanitario, requiere_formula, control_especial)
       values ($1, $2, $3, $4, nullif($5, ''), $6, $7, $8, $9, $10, $11, nullif(upper($12), ''), $13, $14) returning id`,
      [s.empresa, d.maestro_id ?? null, d.nombre, d.laboratorio || null, d.ean ?? "", d.iva, d.categoria || null, d.unidades_por_caja, d.precio_caja, d.precio_unidad ?? null, d.stock_minimo, d.registro_sanitario ?? "",
        !!(d.requiere_formula || d.control_especial), !!d.control_especial]);
    return { id: rows[0].id };
  });
  return "error" in r ? json(r, 409) : json(r, 201);
});
