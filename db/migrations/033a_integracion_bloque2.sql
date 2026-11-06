-- Regenta · integración del Bloque 2 (compras 031, mostrador 032, cuentas de clientes 033). 06/11/2026.
--   1. eliminar_empresa_prueba (consola) parte EXACTAMENTE de la versión de 030a y además borra las tablas nuevas, hijos
--      primero: recibos de caja (tras sus abonos), pedidos del mostrador (antes de ventas, clientes, cajas y sedes) y
--      compras, pagos y devoluciones a proveedores (antes de movimientos_caja, turnos, lotes y proveedores).
--   2. Los recibos de caja no se borran nunca, salvo al eliminar una droguería de prueba (misma excepción que no_modificar:
--      solo el servidor, nunca un usuario de la app, y solo para la empresa que se está eliminando).

-- ───────────── 1 · Recibos de caja: la excepción de la consola ─────────────
create or replace function recibo_solo_anular() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if current_user not in ('authenticated', 'anon') and current_setting('regenta.eliminar_empresa', true) = old.empresa_id::text then return old; end if;
    raise exception 'Los recibos de caja no se borran: se anulan' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - 'anulado' - 'motivo' - 'anulado_por' - 'anulado_en') <> (to_jsonb(old) - 'anulado' - 'motivo' - 'anulado_por' - 'anulado_en')
     or old.anulado or not new.anulado then
    raise exception 'Un recibo de caja solo puede anularse' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ───────────── 2 · Eliminar una droguería de prueba (desde 030a) ─────────────
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
  delete from venta_formulas where empresa_id = p_empresa;
  delete from venta_lineas where empresa_id = p_empresa;
  delete from pagos where empresa_id = p_empresa;
  delete from abonos where empresa_id = p_empresa;
  delete from recibos_caja where empresa_id = p_empresa;              -- 033: después de abonos (abonos.recibo_id)
  delete from documentos_dian where empresa_id = p_empresa;
  delete from devolucion_lineas where empresa_id = p_empresa;
  delete from devoluciones where empresa_id = p_empresa;
  -- 032 · Mostrador: antes de ventas, productos, clientes, cajas y sedes.
  delete from pedido_lineas where empresa_id = p_empresa;
  delete from pedidos_mostrador where empresa_id = p_empresa;
  -- 031 · Compras: antes de movimientos_caja y turnos (pagos desde la caja), lotes y proveedores.
  delete from devolucion_proveedor_lineas where empresa_id = p_empresa;
  delete from devoluciones_proveedor where empresa_id = p_empresa;
  delete from pago_aplicaciones where empresa_id = p_empresa;
  delete from pagos_proveedor where empresa_id = p_empresa;
  delete from compra_lineas where empresa_id = p_empresa;
  delete from compras where empresa_id = p_empresa;
  delete from proveedores where empresa_id = p_empresa;
  delete from movimientos_caja where empresa_id = p_empresa;
  delete from ventas where empresa_id = p_empresa;
  delete from turnos where empresa_id = p_empresa;
  -- Conteos y ajustes se apuntan entre sí: primero se suelta el enlace.
  update conteos set ajuste_id = null where empresa_id = p_empresa and ajuste_id is not null;
  delete from conteo_lineas where empresa_id = p_empresa;
  delete from ajuste_lineas where empresa_id = p_empresa;
  delete from ajustes where empresa_id = p_empresa;
  delete from conteos where empresa_id = p_empresa;
  delete from temperatura_registros where empresa_id = p_empresa;
  delete from movimientos where empresa_id = p_empresa;
  delete from alertas_revision where empresa_id = p_empresa;
  delete from auditoria where empresa_id = p_empresa;
  delete from lote_costos where empresa_id = p_empresa;
  delete from lotes where empresa_id = p_empresa;
  delete from empresas where id = p_empresa;

  delete from cuentas c where c.id = any (usuarios)
    and not exists (select 1 from miembros m where m.user_id = c.id)
    and not exists (select 1 from superadmins s where s.user_id = c.id);
  get diagnostics n = row_count;

  perform set_config('regenta.eliminar_empresa', '', true);
  return n;
end $$;
revoke execute on function eliminar_empresa_prueba(uuid) from public;
revoke execute on function eliminar_empresa_prueba(uuid) from authenticated, anon;
