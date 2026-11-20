-- Pegar en Supabase → SQL Editor → Run. Una sola transacción: si algo no cuadra, falla entera y no cambia nada.
-- 055: pedido sugerido solo con lo que rota (≥ 2 días de venta) · 056: explicación de cada diferencia de los conteos.
begin;
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

-- 056 · Justificación de cada diferencia de un conteo físico (20/11/2026, pedido de Oscar: que quede guardado para cada
-- droguería qué se contó, el informe y la explicación de cada error). Por cada lote con diferencia se registra la causa,
-- el detalle y el documento que lo soporta (factura, remisión, nota crédito, acta). Nunca se edita ni se borra: una
-- explicación nueva queda encima de la anterior (vale la última) y todas quedan en el historial con quién y cuándo.
create table if not exists conteo_justificaciones (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  conteo_id uuid not null references conteos on delete cascade,
  linea_id bigint not null references conteo_lineas on delete cascade,
  causa text not null check (causa in ('error_conteo', 'error_ingreso', 'venta_sin_descargar', 'no_llego', 'pedido_no_entregado',
    'devolucion_sin_registrar', 'muestra', 'averia', 'vencido', 'trueque', 'perdida', 'otro')),
  detalle text not null check (length(detalle) between 3 and 400),
  documento text check (documento is null or length(documento) <= 80),
  usuario_id uuid not null,
  creado timestamptz not null default now()
);
create index if not exists conteo_justificaciones_conteo on conteo_justificaciones (conteo_id, linea_id, creado desc);

alter table conteo_justificaciones enable row level security;
drop policy if exists inventario_lee on conteo_justificaciones;
create policy inventario_lee on conteo_justificaciones for select to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin', 'bodeguero'])));
revoke all on conteo_justificaciones from anon, authenticated;
grant select on conteo_justificaciones to authenticated;

create or replace function conteo_justificacion_inmutable() returns trigger language plpgsql as $$
begin
  raise exception 'Las justificaciones del conteo no se cambian ni se borran: registra una nueva' using errcode = 'P0001';
end $$;
drop trigger if exists conteo_justificaciones_inmutables on conteo_justificaciones;
create trigger conteo_justificaciones_inmutables before update on conteo_justificaciones for each row execute function conteo_justificacion_inmutable();

-- Registrar la explicación de una línea con diferencia (dueño, administrador o bodega de esa droguería).
create or replace function justificar_diferencia(p_empresa uuid, p_linea bigint, p_causa text, p_detalle text, p_documento text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_conteo uuid; v_id bigint;
begin
  if coalesce(rol_en(p_empresa), '') not in ('dueno', 'admin', 'bodeguero') then
    raise exception 'Las diferencias del conteo las explica el dueño, el administrador o la bodega' using errcode = '42501';
  end if;
  select cl.conteo_id into v_conteo from conteo_lineas cl join conteos k on k.id = cl.conteo_id
   where cl.id = p_linea and cl.empresa_id = p_empresa and k.estado <> 'anulado';
  if v_conteo is null then raise exception 'Esa línea no es de un conteo de tu droguería' using errcode = 'P0001'; end if;
  insert into conteo_justificaciones (empresa_id, conteo_id, linea_id, causa, detalle, documento, usuario_id)
  values (p_empresa, v_conteo, p_linea, p_causa, trim(p_detalle), nullif(trim(coalesce(p_documento, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function justificar_diferencia(uuid, bigint, text, text, text) from public, anon;
grant execute on function justificar_diferencia(uuid, bigint, text, text, text) to authenticated;

insert into regenta_migraciones (nombre) values ('055_prediccion_recurrente.sql'), ('056_conteo_justificaciones.sql') on conflict do nothing;
commit;
