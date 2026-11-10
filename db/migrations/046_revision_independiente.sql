-- 046 · Correcciones de la revisión independiente (10/11/2026). Repetible.
-- 1) Índice de ventas por cliente: la lista de Clientes calcula las compras de cada cliente sin recorrer toda la tabla.
create index if not exists ventas_cliente on ventas (cliente_id, creado) where cliente_id is not null and origen is null;

-- 2) Formato de la factura electrónica al imprimir: lo decide la droguería (cada caja puede cambiarlo en su equipo).
--    Las droguerías que ya venían imprimiendo en la térmica siguen igual (tirilla); las nuevas empiezan en carta.
alter table empresas add column if not exists factura_formato text;
update empresas set factura_formato = 'tirilla' where factura_formato is null;
alter table empresas alter column factura_formato set default 'carta';
alter table empresas alter column factura_formato set not null;
alter table empresas drop constraint if exists empresas_factura_formato_check;
alter table empresas add constraint empresas_factura_formato_check check (factura_formato in ('carta', 'tirilla'));

-- 3) Corregir lote: volver vendible un lote vencido (pasarlo a una fecha futura) es decisión del dueño o del
--    administrador, no de la bodega. Acortar la fecha o cambiar el código sí lo puede hacer la bodega.
create or replace function corregir_lote(p_lote uuid, p_codigo text, p_vence date, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l lotes; v_codigo text := upper(trim(coalesce(p_codigo, ''))); v_motivo text := trim(coalesce(p_motivo, '')); v_u integer; v_rol text;
begin
  select * into l from lotes where id = p_lote;
  v_rol := case when found then coalesce(rol_en(l.empresa_id), '') else '' end;
  if v_rol not in ('dueno', 'admin', 'bodeguero') then
    raise exception 'Solo el dueño, el administrador o la bodega corrigen lotes' using errcode = '42501';
  end if;
  if length(v_codigo) < 1 or length(v_codigo) > 60 then raise exception 'Escribe el código del lote (hasta 60 caracteres)' using errcode = 'P0001'; end if;
  if p_vence is null then raise exception 'Escribe la fecha de vencimiento' using errcode = 'P0001'; end if;
  if p_vence < date '2000-01-01' or p_vence > current_date + interval '20 years' then
    raise exception 'La fecha de vencimiento % no es válida', to_char(p_vence, 'DD/MM/YYYY') using errcode = 'P0001';
  end if;
  if length(v_motivo) < 4 or length(v_motivo) > 200 then raise exception 'Escribe por qué se corrige el lote (entre 4 y 200 caracteres)' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext(l.producto_id::text));  -- igual que la venta: no se cruza con una venta del mismo producto
  select * into l from lotes where id = p_lote for update;
  if v_codigo = l.lote and p_vence is not distinct from l.vence then raise exception 'El lote ya tiene ese código y esa fecha' using errcode = 'P0001'; end if;
  if l.vence < current_date and p_vence >= current_date and v_rol = 'bodeguero' then
    raise exception 'El lote % está vencido: volverlo vendible con otra fecha lo decide el dueño o el administrador', l.lote using errcode = '42501';
  end if;
  if v_codigo <> l.lote and l.bloqueado and l.bloqueo_tipo = 'invima' then
    raise exception 'El lote % tiene una alerta del INVIMA: su código no se cambia (sí la fecha)', l.lote using errcode = 'P0001';
  end if;
  if v_codigo <> l.lote and exists (select 1 from lotes where sede_id = l.sede_id and producto_id = l.producto_id and lote = v_codigo and id <> l.id) then
    raise exception 'Este producto ya tiene un lote %: si son el mismo, pasa las unidades con un ajuste', v_codigo using errcode = 'P0001';
  end if;
  select unidades into v_u from v_stock_lotes where lote_id = l.id;
  update lotes set lote = v_codigo, vence = p_vence where id = l.id;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (l.empresa_id, auth.uid(), case when l.vence < current_date and p_vence >= current_date then 'lote_vencido_reactivado' else 'corregir_lote' end, 'lotes', l.id::text,
          jsonb_build_object('producto', l.producto_id, 'unidades', coalesce(v_u, 0),
          'antes', jsonb_build_object('lote', l.lote, 'vence', l.vence), 'despues', jsonb_build_object('lote', v_codigo, 'vence', p_vence), 'motivo', v_motivo));
  return jsonb_build_object('lote_id', l.id, 'lote', v_codigo, 'vence', p_vence, 'unidades', coalesce(v_u, 0));
end $$;

revoke execute on function corregir_lote(uuid, text, date, text) from public, anon;
grant execute on function corregir_lote(uuid, text, date, text) to authenticated;

-- 4) Calidades tributarias del emisor (art. 11 num. 12 de la Resolución DIAN 165 de 2023, «cuando corresponda»):
--    agente retenedor de IVA, autorretenedor, gran contribuyente o régimen SIMPLE. Salen en la factura carta.
alter table empresas add column if not exists calidades_tributarias text;
alter table empresas drop constraint if exists empresas_calidades_tributarias_check;
alter table empresas add constraint empresas_calidades_tributarias_check check (calidades_tributarias is null or length(calidades_tributarias) <= 200);


-- 5) Recibo de caja también al abonar una factura concreta desde Cartera (antes ese abono no dejaba recibo): el recibo se
--    aplica solo a esa factura. Sin factura, igual que antes: el pago se reparte desde la que vence primero.
drop function if exists registrar_recibo(uuid, text, numeric, text, uuid);
create or replace function registrar_recibo(p_cliente uuid, p_medio text, p_valor numeric, p_referencia text default null, p_caja uuid default null, p_venta uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cl clientes; v_rol text; v_caja uuid; v_turno uuid; f record; v_saldo_total numeric := 0; v_resta numeric; v_toma numeric;
  v_aplicado jsonb := '[]'; v_num integer; v_id bigint; x jsonb; v_ref text := nullif(trim(coalesce(p_referencia, '')), '');
begin
  select * into cl from clientes where id = p_cliente;
  v_rol := case when found then rol_en(cl.empresa_id) end;
  if coalesce(v_rol, '') not in ('dueno', 'admin', 'cajero') then raise exception 'No tienes permiso para recibir pagos en esta droguería' using errcode = '42501'; end if;
  if (select estado from empresas where id = cl.empresa_id) <> 'activa' then raise exception 'La suscripción de esta empresa está suspendida' using errcode = 'P0001'; end if;
  if p_medio is null or p_medio not in ('efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'bre_b', 'qr') then raise exception 'Medio de pago no válido' using errcode = 'P0001'; end if;
  if p_valor is null or p_valor <= 0 or p_valor <> trunc(p_valor) then raise exception 'El pago debe ser un valor en pesos mayor que cero' using errcode = 'P0001'; end if;
  if length(v_ref) > 60 then raise exception 'La referencia va hasta 60 caracteres' using errcode = 'P0001'; end if;
  select c.caja_id, c.turno_id into v_caja, v_turno from caja_y_turno(cl.empresa_id, p_caja) c;
  if v_rol = 'cajero' and v_turno is null then
    raise exception 'Abre el turno de tu caja para recibir abonos (Caja → Turno); si no, lo registra el dueño o el administrador' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('credito:' || cl.id::text));
  v_resta := p_valor;
  for f in
    select v.id, v.prefijo || v.numero factura, v.vence_pago, saldo_factura(v.id) saldo
    from ventas v where v.cliente_id = cl.id and v.empresa_id = cl.empresa_id and v.condicion = 'credito' and v.estado = 'cerrada'
      and (p_venta is null or v.id = p_venta)
    order by v.vence_pago, v.creado, v.numero for update of v
  loop
    continue when f.saldo <= 0;
    v_saldo_total := v_saldo_total + f.saldo;
    if v_resta > 0 then
      v_toma := least(v_resta, f.saldo);
      v_aplicado := v_aplicado || jsonb_build_object('venta_id', f.id, 'factura', f.factura, 'vence', f.vence_pago, 'valor', v_toma, 'saldo', f.saldo - v_toma);
      v_resta := v_resta - v_toma;
    end if;
  end loop;
  if v_saldo_total = 0 then raise exception '%', case when p_venta is null then 'Este cliente no tiene saldo pendiente' else 'Esa factura no tiene saldo pendiente' end using errcode = 'P0001'; end if;
  if v_resta > 0 then
    raise exception 'El pago (%) supera lo que debe % (%): recibe como máximo el saldo', pesos_texto(p_valor), case when p_venta is null then 'el cliente' else 'esa factura' end, pesos_texto(v_saldo_total) using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('recibo:' || cl.empresa_id::text));
  select coalesce(max(numero), 0) + 1 into v_num from recibos_caja where empresa_id = cl.empresa_id;
  insert into recibos_caja (empresa_id, numero, cliente_id, medio, valor, referencia, caja_id, turno_id, usuario_id, saldo_anterior, aplicado)
  values (cl.empresa_id, v_num, cl.id, p_medio, p_valor, v_ref, v_caja, v_turno, auth.uid(), v_saldo_total, v_aplicado) returning id into v_id;
  for x in select * from jsonb_array_elements(v_aplicado) loop
    insert into abonos (empresa_id, venta_id, medio, valor, referencia, usuario_id, caja_id, turno_id, recibo_id)
    values (cl.empresa_id, (x ->> 'venta_id')::uuid, p_medio, (x ->> 'valor')::numeric, left('RC-' || v_num || coalesce(' · ' || v_ref, ''), 60), auth.uid(), v_caja, v_turno, v_id);
  end loop;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (cl.empresa_id, auth.uid(), 'recibo_caja', 'clientes', cl.id::text,
          jsonb_build_object('recibo', v_id, 'numero', 'RC-' || v_num, 'valor', p_valor, 'medio', p_medio, 'facturas', jsonb_array_length(v_aplicado)));
  return jsonb_build_object('id', v_id, 'numero', v_num, 'valor', p_valor, 'medio', p_medio, 'aplicado', v_aplicado,
                            'saldo_anterior', v_saldo_total, 'saldo', v_saldo_total - p_valor, 'turno_id', v_turno);
end $$;

revoke execute on function registrar_recibo(uuid, text, numeric, text, uuid, uuid) from public, anon;
grant execute on function registrar_recibo(uuid, text, numeric, text, uuid, uuid) to authenticated;
