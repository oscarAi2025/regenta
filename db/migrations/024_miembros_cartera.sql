-- Regenta · defensa en profundidad tras la revisión independiente.
-- 1) Los usuarios de las droguerías no escriben la tabla de miembros directamente: el equipo se administra solo por las
--    rutas del servidor (que validan rol, cupo del plan y que la cuenta no sea de otra droguería). Leer sigue igual.
revoke insert, update, delete on miembros from authenticated;
drop policy if exists dueno_gestiona on miembros;

-- 2) Cartera con el filtro rápido (las empresas del usuario se calculan una vez por consulta, no por fila). Mismas columnas.
create or replace view v_cartera with (security_invoker = true) as
  select v.id venta_id, v.empresa_id, v.prefijo, v.numero, v.creado, v.vence_pago, v.plazo_dias, v.total,
         c.id cliente_id, c.nombre cliente, c.tipo_doc, c.numero_doc, c.dv, c.telefono, c.email,
         coalesce(a.abonado, 0) abonado, v.total - v.devuelto - coalesce(a.abonado, 0) saldo,
         greatest(0, current_date - v.vence_pago) dias_mora, v.devuelto
  from ventas v
  join clientes c on c.id = v.cliente_id
  left join (select venta_id, sum(valor) abonado from abonos where not anulado group by venta_id) a on a.venta_id = v.id
  where v.condicion = 'credito' and v.estado = 'cerrada' and v.empresa_id in (select mis_empresas(array['dueno', 'admin']));

-- 3) Por qué está suspendida una droguería: «impago» (lo hace la tarea automática; un pago la reactiva sola) o «manual»
--    (lo decide la consola; un pago NO la reactiva). Las suspendidas de antes quedan como manuales (lo prudente).
alter table empresas add column if not exists suspension text check (suspension in ('impago', 'manual'));
update empresas set suspension = 'manual' where estado = 'suspendida' and suspension is null;

-- 4) Una nota crédito de una venta que ya está en la DIAN (numeración de producción) nunca sale en pruebas/simulada:
--    si la numeración de notas crédito sigue en pruebas, la anulación o devolución se detiene con un mensaje claro.
create or replace function nc_exige_produccion() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_orig boolean; v_nc boolean;
begin
  if new.tipo <> 'nota_credito' then return new; end if;
  select r.pruebas into v_orig from documentos_dian o
    join resoluciones_dian r on r.empresa_id = o.empresa_id and r.tipo = o.tipo and r.prefijo = o.prefijo and o.numero between r.desde and r.hasta
    where o.venta_id = new.venta_id and o.tipo <> 'nota_credito' order by r.activa desc limit 1;
  select r.pruebas into v_nc from resoluciones_dian r
    where r.empresa_id = new.empresa_id and r.tipo = 'nota_credito' and r.prefijo = new.prefijo and new.numero between r.desde and r.hasta order by r.activa desc limit 1;
  if v_orig = false and coalesce(v_nc, true) then
    raise exception 'Esta venta ya está en la DIAN, pero la numeración de notas crédito sigue en pruebas: carga la resolución de notas crédito de producción (Consola → Facturación electrónica) antes de anular o devolver'
      using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists documentos_nc_produccion on documentos_dian;
create trigger documentos_nc_produccion before insert on documentos_dian for each row execute function nc_exige_produccion();

-- 5) Anular una venta:
--    · si su documento ya se intentó enviar (pudo quedar validado en la DIAN aunque no llegó la respuesta), NO se descarta:
--      se envía el original y después su nota crédito de anulación. Solo se descarta si nunca salió (0 intentos) o si la
--      DIAN lo rechazó.
--    · si la venta es de un turno anterior y se pagó en efectivo, la devolución del dinero sale del turno abierto de esa
--      caja como egreso (si no, el cierre del turno actual mostraría un faltante).
create or replace function anular_venta(p_venta uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v ventas; ln venta_lineas; d documentos_dian; v_res resoluciones_dian; v_turno turnos; v_efectivo numeric;
begin
  select * into v from ventas where id = p_venta for update;
  if not found or coalesce(rol_en(v.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador pueden anular ventas' using errcode = '42501';
  end if;
  if v.estado <> 'cerrada' then raise exception 'La venta ya está anulada' using errcode = 'P0001'; end if;
  if v.devuelto > 0 then
    raise exception 'Esta venta ya tiene devoluciones: devuelve lo que queda con «Devolver productos»' using errcode = 'P0001';
  end if;
  if exists (select 1 from abonos where venta_id = p_venta and not anulado) then
    raise exception 'Esta venta a crédito tiene abonos vigentes: devuelve lo abonado y anula esos abonos en el detalle de la venta' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indica el motivo de la anulación' using errcode = 'P0001'; end if;
  update ventas set estado = 'anulada' where id = p_venta;
  select * into d from documentos_dian where venta_id = p_venta and tipo <> 'nota_credito' for update;
  if found and (d.estado = 'rechazado' or (d.estado = 'pendiente' and d.intentos = 0)) then
    update documentos_dian set estado = 'anulado', ultimo_error = 'Venta anulada antes de emitirse', actualizado = now() where id = d.id;
  elsif found and d.estado in ('aceptado', 'enviando', 'pendiente') then
    select * into v_res from resoluciones_dian where empresa_id = v.empresa_id and tipo = 'nota_credito' and activa for update;
    if not found then raise exception 'Para anular un documento ya emitido necesitas una numeración de notas crédito activa' using errcode = 'P0001'; end if;
    if v_res.actual + 1 > v_res.hasta then raise exception 'Se agotó la numeración de notas crédito' using errcode = 'P0001'; end if;
    update resoluciones_dian set actual = actual + 1 where id = v_res.id;
    insert into documentos_dian (empresa_id, venta_id, tipo, prefijo, numero) values (v.empresa_id, p_venta, 'nota_credito', v_res.prefijo, v_res.actual + 1);
  end if;
  for ln in select * from venta_lineas where venta_id = p_venta loop
    insert into movimientos (empresa_id, sede_id, producto_id, lote_id, cantidad, tipo, ref_id, motivo, usuario_id)
    values (v.empresa_id, v.sede_id, ln.producto_id, ln.lote_id, ln.unidades, 'anulacion', p_venta, p_motivo, auth.uid());
  end loop;
  select * into v_turno from turnos where caja_id = v.caja_id and estado = 'abierto' order by abierto desc limit 1;
  if found and v.creado < v_turno.abierto then
    select coalesce(sum(valor), 0) - coalesce(v.cambio, 0) into v_efectivo from pagos where venta_id = p_venta and medio = 'efectivo';
    if v_efectivo > 0 then
      insert into movimientos_caja (empresa_id, turno_id, tipo, valor, concepto, usuario_id)
      values (v.empresa_id, v_turno.id, 'egreso', round(v_efectivo), left('Devolución por anulación de ' || v.prefijo || v.numero, 120), auth.uid());
    end if;
  end if;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v.empresa_id, auth.uid(), 'anular_venta', 'ventas', p_venta::text, jsonb_build_object('motivo', p_motivo, 'total', v.total));
end $$;
