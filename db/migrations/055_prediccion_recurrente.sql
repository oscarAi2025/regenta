-- 055 · Predicción solo con lo que de verdad rota (20/11/2026). Un pedido puntual (p. ej. 3 cajas de un producto que se
-- compró para un cliente y se le vendió el mismo día) no es un ritmo de venta: con una sola fecha de venta en 8 semanas
-- el producto no entra al pedido sugerido ni a «se agotan esta semana» (venta_dia = 0). La última venta se sigue
-- informando igual. Misma firma: no cambia a quien la llama.
create or replace function prediccion_productos(p_empresa uuid, p_dias_reposicion integer default 3, p_dias_cobertura integer default 15)
returns table (producto_id uuid, nombre text, laboratorio text, unidades_por_caja integer, stock_minimo integer, existencias integer,
               venta_dia numeric, dias_cobertura numeric, tendencia numeric, sugerido_unidades integer, sugerido_cajas integer, ultima_venta date)
language sql stable set search_path = public set jit = off as $$
  with vend as (
    select m.producto_id,
           -sum(m.cantidad) filter (where m.creado >= now() - interval '14 days') u14,
           -sum(m.cantidad) filter (where m.creado < now() - interval '14 days') u42,
           max(m.creado) ultima,
           count(distinct (m.creado at time zone 'America/Bogota')::date) dias_venta
    from movimientos m
    left join ventas v on m.tipo = 'venta' and v.id = m.ref_id
    left join entregas en on m.tipo = 'entrega' and en.id = m.ref_id
    where m.empresa_id = p_empresa and m.tipo in ('venta', 'entrega') and m.creado >= now() - interval '56 days'
      and ((m.tipo = 'venta' and v.estado = 'cerrada') or (m.tipo = 'entrega' and en.anulada is null))
    group by m.producto_id
  ), stock as (
    select s.producto_id, sum(s.unidades)::integer unidades from v_stock_vigente s where s.empresa_id = p_empresa group by s.producto_id
  ), base as (
    select p.id, p.nombre, p.laboratorio, p.unidades_por_caja, p.stock_minimo,
           coalesce(st.unidades, 0) existencias,
           case when coalesce(v.dias_venta, 0) >= 2 then round(0.6 * coalesce(v.u14, 0) / 14.0 + 0.4 * coalesce(v.u42, 0) / 42.0, 3) else 0 end venta_dia,
           case when coalesce(v.dias_venta, 0) >= 2 and coalesce(v.u42, 0) > 0 then round((coalesce(v.u14, 0) / 14.0) / (v.u42 / 42.0), 2) end tendencia,
           (v.ultima at time zone 'America/Bogota')::date ultima
    from productos p
    left join vend v on v.producto_id = p.id
    left join stock st on st.producto_id = p.id
    where p.empresa_id = p_empresa and p.activo
  )
  select b.id, b.nombre, b.laboratorio, b.unidades_por_caja, b.stock_minimo, b.existencias, b.venta_dia,
         case when b.venta_dia > 0 then round(b.existencias / b.venta_dia, 1) end,
         b.tendencia, n.unidades, ceil(n.unidades::numeric / b.unidades_por_caja)::integer, b.ultima
  from base b
  cross join lateral (select greatest(0, ceil(greatest(b.venta_dia * (p_dias_reposicion + p_dias_cobertura), b.stock_minimo * b.unidades_por_caja) - b.existencias))::integer unidades) n
$$;
