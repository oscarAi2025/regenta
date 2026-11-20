-- 057 · Alertas INVIMA más rápidas (20/11/2026). En producción alertas_empresa tardaba ~600 ms y era lo más lento del
-- Inicio. Mismo resultado y misma firma; cambia el cómo: los nombres y registros de los productos se normalizan una sola vez
-- (no una vez por alerta), las palabras clave se comparan con LIKE ALL, y el lote se busca directo en los lotes del producto
-- alertado en vez de recorrer la vista de existencias de todos los lotes. Si varios lotes tuyos coinciden con la alerta, se
-- muestra el primero en orden alfabético (antes era uno cualquiera).
create or replace function alertas_empresa(p_empresa uuid, p_dias integer default 365)
returns table (
  alerta_id bigint, numero text, tipo text, titulo text, motivo text, fecha date, url text, pdf text, recomendacion text,
  producto_id uuid, producto text, nivel text, lote text, unidades integer, revisada text, revisada_el timestamptz
)
language sql stable security invoker set search_path = public set jit = off as $$
  with a as materialized (
    select x.*, case when cardinality(x.palabras) > 0 then array(select '%' || w || '%' from unnest(x.palabras) w) end patrones
    from alertas_invima x where x.fecha >= current_date - p_dias
  ), p as materialized (
    select p.id, p.nombre, sin_tildes(p.nombre) nombre_n, norm_registro(p.registro_sanitario) registro_n
    from productos p where p.empresa_id = p_empresa and p.activo
  ), cand as (
    select a.id, a.lotes, p.id producto_id, p.nombre, coalesce(p.registro_n = any (a.registros), false) por_registro
    from a cross join p
    where p.registro_n = any (a.registros) or p.nombre_n like all (a.patrones)
  ), m as (
    select c.id, c.producto_id, c.nombre, c.por_registro, h.lote lote_hit, h.unidades
    from cand c
    left join lateral (
      select upper(l.lote) lote, sum(s.u)::integer unidades
      from lotes l
      cross join lateral (select coalesce(sum(mv.cantidad), 0) u from movimientos mv where mv.lote_id = l.id) s
      where cardinality(c.lotes) > 0 and l.producto_id = c.producto_id and upper(l.lote) = any (c.lotes)
      group by upper(l.lote)
      having bool_or(s.u > 0)
      order by 1
      limit 1
    ) h on true
  )
  select a.id, a.numero, a.tipo, a.titulo, a.motivo, a.fecha, a.url, a.pdf, a.recomendacion,
         m.producto_id, m.nombre,
         case when m.lote_hit is not null then 'lote' when m.por_registro then 'registro' when m.producto_id is not null then 'nombre' end,
         m.lote_hit,
         m.unidades,
         r.resultado, r.creado
  from a
  left join m on m.id = a.id
  left join lateral (select resultado, creado from alertas_revision r where r.empresa_id = p_empresa and r.alerta_id = a.id
                     and (r.producto_id is not distinct from m.producto_id) order by r.creado desc limit 1) r on true
$$;
