-- Regenta · predicción con los datos de la propia droguería.
-- Todo se calcula con los movimientos reales (ventas menos anulaciones). Las funciones son security invoker:
-- la seguridad por fila decide qué ve cada usuario (los costos solo los ve dueño/administrador).

-- Ritmo de venta por producto: unidades/día de los últimos 56 días, con más peso a los últimos 14
-- (60 % los 14 días recientes, 40 % los 42 anteriores) para que reaccione a cambios sin saltar por un día raro.
create function prediccion_productos(p_empresa uuid, p_dias_reposicion integer default 3, p_dias_cobertura integer default 15)
returns table (
  producto_id uuid, nombre text, laboratorio text, unidades_por_caja integer, stock_minimo integer,
  existencias integer, venta_dia numeric, dias_cobertura numeric, tendencia numeric,
  sugerido_unidades integer, sugerido_cajas integer, ultima_venta date
)
language sql stable security invoker set search_path = public as $$
  with ventas as (
    select m.producto_id,
           -sum(m.cantidad) filter (where m.creado >= now() - interval '14 days') u14,
           -sum(m.cantidad) filter (where m.creado < now() - interval '14 days') u42,
           max(m.creado) filter (where m.tipo = 'venta') ultima
    from movimientos m
    where m.empresa_id = p_empresa and m.tipo in ('venta', 'anulacion') and m.creado >= now() - interval '56 days'
    group by m.producto_id
  ), stock as (
    select s.producto_id, sum(s.unidades) filter (where s.vence is null or s.vence >= current_date)::integer unidades
    from v_stock_lotes s where s.empresa_id = p_empresa group by s.producto_id
  ), base as (
    select p.id, p.nombre, p.laboratorio, p.unidades_por_caja, p.stock_minimo,
           coalesce(st.unidades, 0) existencias,
           round(0.6 * coalesce(v.u14, 0) / 14.0 + 0.4 * coalesce(v.u42, 0) / 42.0, 3) venta_dia,
           case when coalesce(v.u42, 0) > 0 then round((coalesce(v.u14, 0) / 14.0) / (v.u42 / 42.0), 2) end tendencia,
           (v.ultima at time zone 'America/Bogota')::date ultima
    from productos p
    left join ventas v on v.producto_id = p.id
    left join stock st on st.producto_id = p.id
    where p.empresa_id = p_empresa and p.activo
  )
  select b.id, b.nombre, b.laboratorio, b.unidades_por_caja, b.stock_minimo, b.existencias, b.venta_dia,
         case when b.venta_dia > 0 then round(b.existencias / b.venta_dia, 1) end,
         b.tendencia,
         -- lo necesario para cubrir reposición + cobertura, sin bajar del mínimo (en cajas), redondeado a cajas completas
         n.unidades, ceil(n.unidades::numeric / b.unidades_por_caja)::integer, b.ultima
  from base b
  cross join lateral (select greatest(0, ceil(greatest(b.venta_dia * (p_dias_reposicion + p_dias_cobertura), b.stock_minimo * b.unidades_por_caja) - b.existencias))::integer unidades) n
$$;

-- Riesgo de vencimiento por lote: con el ritmo de venta actual y vendiendo primero lo que vence antes (FEFO),
-- cuántas unidades de cada lote NO alcanzarán a venderse antes de su fecha. Valor a costo solo si el usuario lo puede ver.
create function riesgo_vencimiento(p_empresa uuid)
returns table (
  lote_id uuid, producto_id uuid, nombre text, laboratorio text, unidades_por_caja integer, lote text, vence date,
  dias integer, unidades integer, venta_dia numeric, unidades_en_riesgo integer, costo_unidad numeric, valor_en_riesgo numeric
)
language sql stable security invoker set search_path = public as $$
  with ritmo as (select producto_id, venta_dia from prediccion_productos(p_empresa)),
  lotes as (
    select s.lote_id, s.producto_id, s.lote, s.vence, s.unidades,
           coalesce(sum(s.unidades) over (partition by s.producto_id order by s.vence, s.lote_id rows between unbounded preceding and 1 preceding), 0) antes
    from v_stock_lotes s
    where s.empresa_id = p_empresa and s.unidades > 0 and s.vence is not null and s.vence >= current_date
  )
  select l.lote_id, l.producto_id, p.nombre, p.laboratorio, p.unidades_por_caja, l.lote, l.vence, (l.vence - current_date)::integer,
         l.unidades, r.venta_dia, x.riesgo, lc.costo_unidad, x.riesgo * lc.costo_unidad
  from lotes l
  join productos p on p.id = l.producto_id
  join ritmo r on r.producto_id = l.producto_id
  left join lote_costos lc on lc.lote_id = l.lote_id
  cross join lateral (select (l.unidades - least(l.unidades, greatest(0, floor(r.venta_dia * (l.vence - current_date) - l.antes))))::integer riesgo) x
  where x.riesgo > 0 and l.vence <= current_date + 180
$$;

grant execute on function prediccion_productos(uuid, integer, integer) to authenticated;
grant execute on function riesgo_vencimiento(uuid) to authenticated;
