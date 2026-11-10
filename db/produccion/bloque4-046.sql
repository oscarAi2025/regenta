-- Regenta: migración 046 (10/11/2026: revisión independiente — índice de ventas por cliente, formato de la factura por droguería, la bodega no revive lotes vencidos, calidades tributarias). Una sola transacción. Repetible.
begin;
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
insert into regenta_migraciones (nombre) values ('046_revision_independiente.sql') on conflict do nothing;
commit;
