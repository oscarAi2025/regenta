-- Regenta · correcciones de la revisión de código del 1/11/2026.

-- «Hoy» es el día de Bogotá, no el del servidor (Supabase corre en UTC: de 7 p. m. a medianoche ya sería mañana).
do $$ begin execute format('alter database %I set timezone = %L', current_database(), 'America/Bogota'); end $$;
set timezone = 'America/Bogota';

-- Índices para las consultas por producto y por venta.
create index if not exists lotes_producto on lotes (producto_id, sede_id);
create index if not exists documentos_venta on documentos_dian (venta_id);

-- Existencias que se pueden vender (sin lotes vencidos): una sola definición para todas las pantallas.
create view v_stock_vigente with (security_invoker = true) as
  select * from v_stock_lotes where vence is null or vence >= current_date;
grant select on v_stock_vigente to authenticated;

-- Idempotencia de entradas de inventario (la usa registrar_entrada).
create table entradas_idem (
  empresa_id uuid not null references empresas on delete cascade,
  idem_key text not null,
  resultado jsonb not null,
  creado timestamptz not null default now(),
  primary key (empresa_id, idem_key)
);
alter table entradas_idem enable row level security;

-- Precios en pesos enteros: la caja cobra en pesos y los medios electrónicos no admiten centavos.
alter table productos add constraint precio_caja_entero check (precio_caja = trunc(precio_caja));
alter table productos add constraint precio_unidad_entero check (precio_unidad is null or precio_unidad = trunc(precio_unidad));

-- Registro sanitario normalizado igual que en las alertas («2020m-3171-r4» → «INVIMA 2020M-3171-R4»).
create or replace function norm_registro(t text) returns text language sql immutable as $$
  select case when m is null then nullif(upper(trim(coalesce(t, ''))), '')
              else 'INVIMA ' || m[1] || 'M-' || m[2] || coalesce('-R' || m[3], '') end
  from (select regexp_match(upper(coalesce(t, '')), '(?:INVIMA\s*)?(\d{4})\s*M\s*-\s*(\d{3,8})(?:\s*-\s*R\s*(\d+))?') m) x
$$;
create function normalizar_registro_producto() returns trigger language plpgsql as $$
begin new.registro_sanitario := norm_registro(new.registro_sanitario); return new; end $$;
create trigger productos_registro before insert or update of registro_sanitario on productos for each row execute function normalizar_registro_producto();

-- Una revisión de alerta solo puede citar productos de la misma empresa.
drop policy revision_crear on alertas_revision;
create policy revision_crear on alertas_revision for insert to authenticated
  with check (rol_en(empresa_id) in ('dueno', 'admin', 'bodeguero') and usuario_id = auth.uid()
              and (producto_id is null or exists (select 1 from productos p where p.id = producto_id and p.empresa_id = alertas_revision.empresa_id)));

-- Alertas del INVIMA ya vistas que no son de medicamentos (para no volver a descargarlas).
create table invima_descartadas (numero text primary key, creado timestamptz not null default now());

-- Empresas de demostración: cualquiera puede entrar, nadie puede romperlas (ni sus usuarios ni sus datos de empresa).
alter table empresas add column demo boolean not null default false;
create function proteger_demo() returns trigger language plpgsql as $$
declare e uuid := coalesce(old.empresa_id, new.empresa_id);
begin
  if current_user = 'authenticated' and exists (select 1 from empresas where id = e and demo) then
    raise exception 'En la demostración no se pueden cambiar los usuarios' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger miembros_demo before insert or update or delete on miembros for each row execute function proteger_demo();
create function proteger_empresa_demo() returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' and old.demo then raise exception 'En la demostración no se pueden cambiar los datos de la empresa' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger empresas_demo before update on empresas for each row execute function proteger_empresa_demo();

-- Ritmo de venta sin las ventas anuladas (antes la anulación restaba en la fecha en que se anulaba).
create or replace function prediccion_productos(p_empresa uuid, p_dias_reposicion integer default 3, p_dias_cobertura integer default 15)
returns table (
  producto_id uuid, nombre text, laboratorio text, unidades_por_caja integer, stock_minimo integer,
  existencias integer, venta_dia numeric, dias_cobertura numeric, tendencia numeric,
  sugerido_unidades integer, sugerido_cajas integer, ultima_venta date
)
language sql stable security invoker set search_path = public as $$
  with vend as (
    select m.producto_id,
           -sum(m.cantidad) filter (where m.creado >= now() - interval '14 days') u14,
           -sum(m.cantidad) filter (where m.creado < now() - interval '14 days') u42,
           max(m.creado) ultima
    from movimientos m join ventas v on v.id = m.ref_id and v.estado = 'cerrada'
    where m.empresa_id = p_empresa and m.tipo = 'venta' and m.creado >= now() - interval '56 days'
    group by m.producto_id
  ), stock as (
    select s.producto_id, sum(s.unidades)::integer unidades from v_stock_vigente s where s.empresa_id = p_empresa group by s.producto_id
  ), base as (
    select p.id, p.nombre, p.laboratorio, p.unidades_por_caja, p.stock_minimo,
           coalesce(st.unidades, 0) existencias,
           round(0.6 * coalesce(v.u14, 0) / 14.0 + 0.4 * coalesce(v.u42, 0) / 42.0, 3) venta_dia,
           case when coalesce(v.u42, 0) > 0 then round((coalesce(v.u14, 0) / 14.0) / (v.u42 / 42.0), 2) end tendencia,
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
