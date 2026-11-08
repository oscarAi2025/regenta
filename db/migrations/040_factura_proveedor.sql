-- 040 · Compras desde la factura del proveedor (08/11/2026)
--  · proveedor_productos: lo que la droguería ya emparejó de cada proveedor (código o descripción de la factura →
--    producto del catálogo, y si viene por caja o por unidad). La próxima factura de ese proveedor sale emparejada sola.
--  · compra_archivos: el archivo original (ZIP/XML de la DIAN, PDF o foto) en el espacio privado de la droguería,
--    con lo que se leyó de él, enlazado a la compra. Solo lo ven el dueño, el administrador y la bodega de esa droguería.
--  · Se escriben solo por las funciones de abajo (security definer, con el rol de quien llama).

create table if not exists proveedor_productos (
  empresa_id uuid not null references empresas on delete cascade,
  proveedor_id uuid not null references proveedores on delete cascade,
  clave text not null check (length(clave) between 1 and 200),
  producto_id uuid not null references productos on delete cascade,
  como text not null default 'caja' check (como in ('caja', 'unidad')),
  veces integer not null default 1 check (veces > 0),
  actualizado timestamptz not null default now(),
  primary key (empresa_id, proveedor_id, clave)
);
create index if not exists proveedor_productos_producto on proveedor_productos (empresa_id, producto_id);

create table if not exists compra_archivos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  compra_id uuid references compras on delete set null,
  nombre text not null check (length(nombre) between 1 and 160),
  tipo text not null check (tipo in ('application/zip', 'application/xml', 'application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  tamano integer not null check (tamano between 1 and 12582912),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  datos bytea not null,
  documento jsonb,
  usuario_id uuid,
  creado timestamptz not null default now(),
  unique (empresa_id, sha256)
);
create index if not exists compra_archivos_compra on compra_archivos (compra_id) where compra_id is not null;
create index if not exists compra_archivos_creado on compra_archivos (empresa_id, creado desc);

alter table proveedor_productos enable row level security;
alter table compra_archivos enable row level security;
create policy inventario_lee on proveedor_productos for select to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin', 'bodeguero'])));
create policy inventario_lee on compra_archivos for select to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin', 'bodeguero'])));
revoke all on proveedor_productos, compra_archivos from anon, authenticated;
grant select on proveedor_productos, compra_archivos to authenticated;

-- Guarda el archivo (si ya estaba, el mismo: así se nota que esa factura ya se cargó). En la demostración no se guarda
-- nada: la droguería de ejemplo es compartida y un archivo de un visitante no debe verlo otro.
create or replace function guardar_archivo_compra(p_empresa uuid, p_nombre text, p_tipo text, p_datos bytea, p_sha256 text, p_documento jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v compra_archivos;
begin
  if coalesce(rol_en(p_empresa), '') not in ('dueno', 'admin', 'bodeguero') then
    raise exception 'Solo el dueño, el administrador o la bodega cargan facturas de compra' using errcode = '42501';
  end if;
  if (select demo from empresas where id = p_empresa) then return jsonb_build_object('id', null, 'demo', true); end if;
  insert into compra_archivos (empresa_id, nombre, tipo, tamano, sha256, datos, documento, usuario_id)
  values (p_empresa, left(coalesce(nullif(trim(p_nombre), ''), 'factura'), 160), p_tipo, octet_length(p_datos), p_sha256, p_datos, p_documento, auth.uid())
  on conflict (empresa_id, sha256) do update set documento = coalesce(excluded.documento, compra_archivos.documento)
  returning * into v;
  return jsonb_build_object('id', v.id, 'compra_id', v.compra_id,
    'compra_numero', (select numero from compras where id = v.compra_id and estado <> 'anulada'));
end $$;

-- Enlaza el archivo con la compra que se registró a partir de él.
create or replace function vincular_archivo_compra(p_empresa uuid, p_archivo uuid, p_compra uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(rol_en(p_empresa), '') not in ('dueno', 'admin', 'bodeguero') then
    raise exception 'Sin permiso para esta compra' using errcode = '42501';
  end if;
  update compra_archivos a set compra_id = p_compra
   where a.id = p_archivo and a.empresa_id = p_empresa
     and exists (select 1 from compras c where c.id = p_compra and c.empresa_id = p_empresa);
end $$;

-- Recuerda los emparejamientos de una factura: p = [{ clave, producto_id, como }].
create or replace function recordar_productos_proveedor(p_empresa uuid, p_proveedor uuid, p jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if coalesce(rol_en(p_empresa), '') not in ('dueno', 'admin', 'bodeguero') then
    raise exception 'Sin permiso para este proveedor' using errcode = '42501';
  end if;
  if not exists (select 1 from proveedores where id = p_proveedor and empresa_id = p_empresa) then return 0; end if;
  with x as (
    select distinct on (left(lower(trim(e ->> 'clave')), 200)) left(lower(trim(e ->> 'clave')), 200) clave, (e ->> 'producto_id')::uuid producto_id,
           case when e ->> 'como' = 'unidad' then 'unidad' else 'caja' end como
      from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) e
     where length(trim(coalesce(e ->> 'clave', ''))) > 0 and (e ->> 'producto_id') ~ '^[0-9a-f-]{36}$'
     limit 500
  ), ok as (
    select x.* from x join productos pr on pr.id = x.producto_id and pr.empresa_id = p_empresa
  ), up as (
    insert into proveedor_productos (empresa_id, proveedor_id, clave, producto_id, como)
    select p_empresa, p_proveedor, clave, producto_id, como from ok
    on conflict (empresa_id, proveedor_id, clave) do update
      set producto_id = excluded.producto_id, como = excluded.como, actualizado = now(),
          veces = case when proveedor_productos.producto_id = excluded.producto_id then proveedor_productos.veces + 1 else 1 end
    returning 1
  ) select count(*) into n from up;
  return n;
end $$;

revoke execute on function guardar_archivo_compra(uuid, text, text, bytea, text, jsonb), vincular_archivo_compra(uuid, uuid, uuid),
  recordar_productos_proveedor(uuid, uuid, jsonb) from public, anon;
grant execute on function guardar_archivo_compra(uuid, text, text, bytea, text, jsonb), vincular_archivo_compra(uuid, uuid, uuid),
  recordar_productos_proveedor(uuid, uuid, jsonb) to authenticated;
