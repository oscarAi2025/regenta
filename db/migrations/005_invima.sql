-- Regenta · alertas sanitarias del INVIMA cruzadas con el inventario de cada droguería.
-- Las alertas son públicas y comunes a todas las empresas (las carga el servidor desde invima.gov.co).
-- El cruce se hace por tres caminos, de más a menos seguro:
--   lote     → tienes en existencias un lote que la alerta nombra (y el producto coincide por registro o por nombre)
--   registro → el registro sanitario de tu producto es el de la alerta
--   nombre   → tu producto contiene las palabras clave del producto alertado: hay que revisarlo

alter table productos add column registro_sanitario text;
alter table productos_maestro add column registro_sanitario text;

create table alertas_invima (
  id bigint generated always as identity primary key,
  numero text not null unique,                 -- 329-2026
  tipo text not null check (tipo in ('alerta', 'informe')),
  titulo text not null,
  motivo text,                                 -- «Producto fraudulento», «Producto defectuoso»…
  fecha date not null,
  url text not null,
  pdf text,
  direccion text not null default 'medicamentos',
  registros text[] not null default '{}',      -- normalizados: INVIMA 2020M-003171-R4
  lotes text[] not null default '{}',          -- en mayúsculas
  palabras text[] not null default '{}',       -- palabras clave del producto, en minúsculas y sin tildes
  resumen text,
  recomendacion text,
  creado timestamptz not null default now()
);
create index on alertas_invima (fecha desc);
alter table alertas_invima enable row level security;
create policy alertas_lectura on alertas_invima for select to authenticated using (true);
grant select on alertas_invima to authenticated;

-- Lo que hizo la droguería con cada alerta (evidencia para la visita de la secretaría de salud).
create table alertas_revision (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  alerta_id bigint not null references alertas_invima on delete cascade,
  producto_id uuid references productos,
  resultado text not null check (resultado in ('no_aplica', 'sin_lote', 'separado')),
  nota text,
  usuario_id uuid not null default auth.uid(),
  creado timestamptz not null default now()
);
create index on alertas_revision (empresa_id, alerta_id);
alter table alertas_revision enable row level security;
create policy revision_ver on alertas_revision for select to authenticated using (rol_en(empresa_id) is not null);
create policy revision_crear on alertas_revision for insert to authenticated
  with check (rol_en(empresa_id) in ('dueno', 'admin', 'bodeguero') and usuario_id = auth.uid());
grant select, insert on alertas_revision to authenticated;
grant usage on sequence alertas_revision_id_seq to authenticated;
create trigger alertas_revision_inmutable before update or delete on alertas_revision for each row execute function no_modificar();

create function sin_tildes(t text) returns text language sql immutable as $$
  select translate(lower(t), 'áéíóúüñ', 'aeiouun')
$$;
create function norm_registro(t text) returns text language sql immutable as $$
  select upper(regexp_replace(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g'), '^\s+|\s+$', '', 'g'))
$$;

-- Cruce de alertas con los productos de la empresa (seguridad por fila: solo ve su empresa).
create function alertas_empresa(p_empresa uuid, p_dias integer default 365)
returns table (
  alerta_id bigint, numero text, tipo text, titulo text, motivo text, fecha date, url text, pdf text, recomendacion text,
  producto_id uuid, producto text, nivel text, lote text, unidades integer, revisada text, revisada_el timestamptz
)
language sql stable security invoker set search_path = public as $$
  with a as (select * from alertas_invima where fecha >= current_date - p_dias),
  cand as (
    select a.id, p.id producto_id, p.nombre,
           (norm_registro(p.registro_sanitario) = any (a.registros)) por_registro,
           (cardinality(a.palabras) > 0 and (select bool_and(sin_tildes(p.nombre) like '%' || w || '%') from unnest(a.palabras) w)) por_nombre
    from a join productos p on p.empresa_id = p_empresa and p.activo
  ), m as (
    select c.id, c.producto_id, c.nombre, c.por_registro,
           (select s.lote from v_stock_lotes s join alertas_invima x on x.id = c.id
             where s.producto_id = c.producto_id and s.unidades > 0 and upper(s.lote) = any (x.lotes) limit 1) lote_hit
    from cand c where c.por_registro or c.por_nombre
  )
  select a.id, a.numero, a.tipo, a.titulo, a.motivo, a.fecha, a.url, a.pdf, a.recomendacion,
         m.producto_id, m.nombre,
         case when m.lote_hit is not null then 'lote' when m.por_registro then 'registro' when m.producto_id is not null then 'nombre' end,
         m.lote_hit,
         case when m.lote_hit is not null then (select sum(s.unidades)::integer from v_stock_lotes s where s.producto_id = m.producto_id and upper(s.lote) = m.lote_hit) end,
         r.resultado, r.creado
  from a
  left join m on m.id = a.id
  left join lateral (select resultado, creado from alertas_revision r where r.empresa_id = p_empresa and r.alerta_id = a.id
                     and (r.producto_id is not distinct from m.producto_id) order by r.creado desc limit 1) r on true
$$;
grant execute on function alertas_empresa(uuid, integer) to authenticated;
