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
