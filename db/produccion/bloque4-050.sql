-- Regenta: migración 050 (17/11/2026: ubicación del producto en la estantería o la bodega — columna productos.ubicacion y función cambiar_ubicacion con auditoría). Una sola transacción. Repetible. Solo agrega.
begin;
-- 050 · Ubicación del producto en la droguería (17/11/2026). Aditiva y repetible.
--  · productos.ubicacion: dónde está en la estantería o la bodega (texto libre corto: «E3-N2», «Pasillo 2 · nivel 1»,
--    «Nevera»). Se guarda en mayúscula y sin espacios de más. Vacío = sin ubicación.
--  · cambiar_ubicacion: la única vía de escritura fuera de crear/editar el producto. La pueden cambiar el dueño, el
--    administrador y la bodega (quien acomoda la mercancía); queda en la auditoría.

alter table productos add column if not exists ubicacion text;
alter table productos drop constraint if exists productos_ubicacion_check;
alter table productos add constraint productos_ubicacion_check
  check (ubicacion is null or (length(ubicacion) between 1 and 40 and ubicacion !~ '[[:cntrl:]]'));

create or replace function cambiar_ubicacion(p_producto uuid, p_ubicacion text) returns text
language plpgsql security definer set search_path = public as $$
declare pr productos; v text := nullif(upper(regexp_replace(trim(coalesce(p_ubicacion, '')), '\s+', ' ', 'g')), '');
begin
  select * into pr from productos where id = p_producto;
  if not found or coalesce(rol_en(pr.empresa_id), '') not in ('dueno', 'admin', 'bodeguero') then
    raise exception 'La ubicación la cambian el dueño, el administrador o la bodega' using errcode = '42501';
  end if;
  if v is not null and (length(v) > 40 or v ~ '[[:cntrl:]]') then
    raise exception 'La ubicación va hasta 40 caracteres, por ejemplo E3-N2' using errcode = 'P0001';
  end if;
  if v is not distinct from pr.ubicacion then return v; end if;
  update productos set ubicacion = v where id = p_producto;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (pr.empresa_id, auth.uid(), 'ubicacion_producto', 'productos', p_producto::text,
          jsonb_build_object('producto', pr.nombre, 'antes', pr.ubicacion, 'despues', v));
  return v;
end $$;
revoke all on function cambiar_ubicacion(uuid, text) from public, anon;
grant execute on function cambiar_ubicacion(uuid, text) to authenticated;

create index if not exists productos_ubicacion on productos (empresa_id, ubicacion) where ubicacion is not null;
insert into regenta_migraciones (nombre) values ('050_ubicacion.sql') on conflict do nothing;
commit;
