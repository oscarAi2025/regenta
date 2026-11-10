-- 044 · Corregir un lote (10/11/2026). Repetible.
-- Si el código o la fecha de vencimiento de un lote quedaron mal (al recibir, al importar o al migrar), el dueño, el
-- administrador o la bodega los corrigen con un motivo. Queda en la auditoría con el antes y el después. Las existencias
-- no cambian: para eso están los ajustes. El código de un lote con alerta del INVIMA no se cambia (la alerta lo busca
-- por ese código).

create or replace function corregir_lote(p_lote uuid, p_codigo text, p_vence date, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l lotes; v_codigo text := upper(trim(coalesce(p_codigo, ''))); v_motivo text := trim(coalesce(p_motivo, '')); v_u integer;
begin
  select * into l from lotes where id = p_lote;
  if not found or coalesce(rol_en(l.empresa_id), '') not in ('dueno', 'admin', 'bodeguero') then
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
  if v_codigo <> l.lote and l.bloqueado and l.bloqueo_tipo = 'invima' then
    raise exception 'El lote % tiene una alerta del INVIMA: su código no se cambia (sí la fecha)', l.lote using errcode = 'P0001';
  end if;
  if v_codigo <> l.lote and exists (select 1 from lotes where sede_id = l.sede_id and producto_id = l.producto_id and lote = v_codigo and id <> l.id) then
    raise exception 'Este producto ya tiene un lote %: si son el mismo, pasa las unidades con un ajuste', v_codigo using errcode = 'P0001';
  end if;
  select unidades into v_u from v_stock_lotes where lote_id = l.id;
  update lotes set lote = v_codigo, vence = p_vence where id = l.id;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (l.empresa_id, auth.uid(), 'corregir_lote', 'lotes', l.id::text, jsonb_build_object('producto', l.producto_id, 'unidades', coalesce(v_u, 0),
          'antes', jsonb_build_object('lote', l.lote, 'vence', l.vence), 'despues', jsonb_build_object('lote', v_codigo, 'vence', p_vence), 'motivo', v_motivo));
  return jsonb_build_object('lote_id', l.id, 'lote', v_codigo, 'vence', p_vence, 'unidades', coalesce(v_u, 0));
end $$;

revoke execute on function corregir_lote(uuid, text, date, text) from public, anon;
grant execute on function corregir_lote(uuid, text, date, text) to authenticated;
