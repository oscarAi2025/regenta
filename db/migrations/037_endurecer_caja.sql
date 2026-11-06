-- 037 · Endurecer la caja y la auditoría (revisión de seguridad del 06/11/2026)
--  1. El tope de salidas de efectivo de la cajera es por TURNO (suma de sus salidas), no por movimiento: con un tope por
--     movimiento, diez salidas pequeñas tapaban un faltante grande antes del arqueo.
--  2. Lo que hace el soporte de Regenta dentro de una droguería queda en la auditoría con el superadministrador que lo hizo
--     (antes salía solo a nombre del dueño).
--  3. Una venta hecha sin internet que se sincroniza cuando no hay turno abierto (con «exigir turno») queda en la bitácora.

-- 1 · movimiento_caja (parte de su versión más reciente, 022_endurecer.sql)
create or replace function movimiento_caja(p_turno uuid, p_tipo text, p_valor numeric, p_concepto text) returns bigint
language plpgsql security definer set search_path = public as $$
declare t turnos; v_id bigint; v_tope numeric; v_hechas numeric;
begin
  select * into t from turnos where id = p_turno for update;
  if not found or coalesce(rol_en(t.empresa_id), '') not in ('dueno', 'admin', 'cajero') then
    raise exception 'No puedes registrar movimientos en este turno' using errcode = '42501';
  end if;
  if t.estado <> 'abierto' then raise exception 'El turno ya está cerrado' using errcode = 'P0001'; end if;
  if p_tipo not in ('ingreso', 'egreso') then raise exception 'Tipo de movimiento no válido' using errcode = 'P0001'; end if;
  if p_valor is null or p_valor <= 0 or p_valor <> trunc(p_valor) then raise exception 'El valor debe ser en pesos y mayor que cero' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p_concepto, ''))) < 3 then raise exception 'Escribe el concepto (por ejemplo: pago domicilio, compra de bolsas)' using errcode = 'P0001'; end if;
  -- Las salidas de las cajeras suman contra el tope del turno: así no se tapa un faltante a pedacitos antes del arqueo.
  -- (El candado del turno, arriba, pone en fila dos salidas simultáneas.)
  if p_tipo = 'egreso' and rol_en(t.empresa_id) = 'cajero' then
    select egreso_max_cajero into v_tope from empresas where id = t.empresa_id;
    select coalesce(sum(m.valor), 0) into v_hechas from movimientos_caja m
      where m.turno_id = p_turno and m.tipo = 'egreso'
        and exists (select 1 from miembros x where x.empresa_id = t.empresa_id and x.user_id = m.usuario_id and x.rol = 'cajero');
    if v_hechas + p_valor > v_tope then
      raise exception 'Las salidas de la cajera en este turno van hasta % (ya lleva %): esta la registra el dueño o el administrador',
        replace(to_char(v_tope, 'FM999,999,999,990'), ',', '.'), replace(to_char(v_hechas, 'FM999,999,999,990'), ',', '.') using errcode = '42501';
    end if;
  end if;
  insert into movimientos_caja (empresa_id, turno_id, tipo, valor, concepto, usuario_id)
  values (t.empresa_id, p_turno, p_tipo, p_valor, trim(p_concepto), auth.uid()) returning id into v_id;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (t.empresa_id, auth.uid(), 'movimiento_caja', 'turnos', p_turno::text, jsonb_build_object('tipo', p_tipo, 'valor', p_valor, 'concepto', trim(p_concepto)));
  return v_id;
end $$;

-- 2 · Soporte en la auditoría: el servidor pone `soporte` en los datos de la sesión cuando un superadministrador entra
--     como el cliente; cada registro de auditoría lo toma de ahí (sin tocar las funciones que escriben en ella).
alter table auditoria add column if not exists soporte_id uuid;
create or replace function auditoria_soporte() returns trigger
language plpgsql set search_path = public as $$
begin
  new.soporte_id := coalesce(new.soporte_id, nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'soporte', '')::uuid);
  return new;
end $$;
revoke all on function auditoria_soporte() from public;
drop trigger if exists auditoria_soporte on auditoria;
create trigger auditoria_soporte before insert on auditoria for each row execute function auditoria_soporte();

-- 3 · Venta sin internet sincronizada sin turno abierto: queda en la bitácora del dueño.
create or replace function marcar_venta_sin_turno(p_venta uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v ventas;
begin
  select * into v from ventas where id = p_venta;
  if not found or coalesce(rol_en(v.empresa_id), '') not in ('dueno', 'admin', 'cajero') then
    raise exception 'No puedes marcar esta venta' using errcode = '42501';
  end if;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v.empresa_id, auth.uid(), 'venta_sin_turno', 'ventas', v.id::text,
          jsonb_build_object('total', v.total, 'caja', (select nombre from cajas where id = v.caja_id)));
end $$;
revoke all on function marcar_venta_sin_turno(uuid) from public, anon;
grant execute on function marcar_venta_sin_turno(uuid) to authenticated;

