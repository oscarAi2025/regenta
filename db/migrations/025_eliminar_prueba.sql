-- Regenta · eliminar una droguería de PRUEBA desde la consola de superadministración.
-- Ventas, movimientos, pagos y auditoría son inmutables (triggers). Solo esta función, ejecutada por el servidor (nunca
-- por un usuario de la app), puede borrarlas, y solo si la droguería:
--   · no es la demo,
--   · está suspendida (primero se suspende, luego se elimina: dos pasos para no borrar por error),
--   · nunca tuvo una numeración DIAN en producción (sus facturas reales se conservan por ley: esas solo se suspenden).
-- Las cuentas que solo eran de esa droguería se borran; los pagos de suscripción y la bitácora quedan (sin empresa).

create or replace function no_modificar() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_user not in ('authenticated', 'anon')
     and current_setting('regenta.eliminar_empresa', true) = old.empresa_id::text then
    return old;
  end if;
  raise exception 'Los registros de % no se modifican ni se borran', tg_table_name using errcode = 'P0001';
end $$;

create or replace function venta_solo_anular() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if current_user not in ('authenticated', 'anon') and current_setting('regenta.eliminar_empresa', true) = old.empresa_id::text then return old; end if;
    raise exception 'Las ventas no se borran' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - 'estado' - 'devuelto') <> (to_jsonb(old) - 'estado' - 'devuelto') then
    raise exception 'Una venta solo puede anularse o recibir devoluciones' using errcode = 'P0001';
  end if;
  if new.estado is distinct from old.estado then
    if not (old.estado = 'cerrada' and new.estado = 'anulada') or new.devuelto <> old.devuelto then
      raise exception 'Una venta solo puede anularse' using errcode = 'P0001';
    end if;
  elsif new.devuelto <> old.devuelto then
    if old.estado <> 'cerrada' or new.devuelto < old.devuelto or new.devuelto > new.total then
      raise exception 'Lo devuelto no puede bajar ni pasar del total de la venta' using errcode = 'P0001';
    end if;
  else
    raise exception 'Una venta solo puede anularse' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function eliminar_empresa_prueba(p_empresa uuid) returns int
language plpgsql set search_path = public as $$
declare e record; usuarios uuid[]; n int;
begin
  select * into e from empresas where id = p_empresa for update;
  if not found then raise exception 'Cliente no encontrado' using errcode = 'P0001'; end if;
  if e.demo then raise exception 'La demostración no se elimina' using errcode = 'P0001'; end if;
  if e.estado <> 'suspendida' then raise exception 'Primero suspende la droguería; luego podrás eliminarla' using errcode = 'P0001'; end if;
  if exists (select 1 from resoluciones_dian where empresa_id = p_empresa and not pruebas) then
    raise exception 'Esta droguería facturó con numeración DIAN en producción: sus documentos se conservan por ley. Solo se puede suspender' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct user_id), '{}') into usuarios from miembros where empresa_id = p_empresa;
  perform set_config('regenta.eliminar_empresa', p_empresa::text, true);

  -- Hijos primero (algunas llaves son RESTRICT), luego la empresa (el resto cae en cascada).
  delete from venta_lineas where empresa_id = p_empresa;
  delete from pagos where empresa_id = p_empresa;
  delete from abonos where empresa_id = p_empresa;
  delete from documentos_dian where empresa_id = p_empresa;
  delete from devolucion_lineas where empresa_id = p_empresa;
  delete from devoluciones where empresa_id = p_empresa;
  delete from movimientos_caja where empresa_id = p_empresa;
  delete from ventas where empresa_id = p_empresa;
  delete from turnos where empresa_id = p_empresa;
  delete from movimientos where empresa_id = p_empresa;
  delete from alertas_revision where empresa_id = p_empresa;
  delete from auditoria where empresa_id = p_empresa;
  delete from lote_costos where empresa_id = p_empresa;
  delete from lotes where empresa_id = p_empresa;
  delete from empresas where id = p_empresa;

  -- Cuentas que ya no pertenecen a ninguna droguería ni a la consola.
  delete from cuentas c where c.id = any (usuarios)
    and not exists (select 1 from miembros m where m.user_id = c.id)
    and not exists (select 1 from superadmins s where s.user_id = c.id);
  get diagnostics n = row_count;

  perform set_config('regenta.eliminar_empresa', '', true);
  return n;
end $$;
revoke execute on function eliminar_empresa_prueba(uuid) from public;
revoke execute on function eliminar_empresa_prueba(uuid) from authenticated, anon;
