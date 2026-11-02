-- Regenta · devoluciones parciales (como Alegra POS): el cliente devuelve parte de lo que compró.
-- Cada devolución guarda qué se devolvió (por línea de la venta y lote), cuánto se reembolsó y por qué medio.
-- Las unidades vuelven a su lote, la venta queda con su valor devuelto, la cartera baja el saldo y, si la venta ya
-- tiene documento electrónico, se genera la nota crédito por lo devuelto (concepto DIAN 1: devolución parcial).

alter table ventas add column if not exists devuelto numeric(14, 2) not null default 0 check (devuelto >= 0);

create table if not exists devoluciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  venta_id uuid not null references ventas on delete restrict,
  caja_id uuid references cajas,
  motivo text not null check (length(trim(motivo)) between 4 and 200),
  base numeric(14, 2) not null,
  iva numeric(14, 2) not null,
  total numeric(14, 2) not null check (total > 0),
  a_saldo numeric(14, 2) not null default 0,      -- lo que se descontó del saldo de una venta a crédito
  reembolso numeric(14, 2) not null default 0,    -- lo que se le devolvió al cliente
  medio text not null default 'efectivo' check (medio in ('efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'bre_b')),
  usuario_id uuid not null,
  creado timestamptz not null default now()
);
create index if not exists devoluciones_venta on devoluciones (venta_id);
create index if not exists devoluciones_caja on devoluciones (caja_id, creado);

create table if not exists devolucion_lineas (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  devolucion_id uuid not null references devoluciones on delete cascade,
  venta_linea_id bigint not null references venta_lineas on delete restrict,
  cantidad numeric(14, 3) not null check (cantidad > 0),
  unidades integer not null check (unidades > 0),
  base numeric(14, 2) not null,
  iva numeric(14, 2) not null,
  total numeric(14, 2) not null,
  descuento numeric(14, 2) not null default 0
);
create index if not exists devolucion_lineas_linea on devolucion_lineas (venta_linea_id);
create index if not exists devolucion_lineas_dev on devolucion_lineas (devolucion_id);

alter table documentos_dian add column if not exists devolucion_id uuid references devoluciones on delete restrict;

alter table devoluciones enable row level security;
alter table devolucion_lineas enable row level security;
drop policy if exists miembros_leen on devoluciones;
drop policy if exists miembros_leen on devolucion_lineas;
create policy miembros_leen on devoluciones for select to authenticated using (rol_en(empresa_id) is not null);
create policy miembros_leen on devolucion_lineas for select to authenticated using (rol_en(empresa_id) is not null);
grant select on devoluciones, devolucion_lineas to authenticated;

-- p = { venta_id, motivo, medio?, caja_id?, lineas: [{ producto_id, presentacion, cantidad }] }
-- La cantidad va en la presentación vendida y se reparte entre los lotes de esa línea (primero el primero vendido).
create or replace function devolver_venta(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v ventas; d documentos_dian; v_res resoluciones_dian; x jsonb; ln record;
  v_dev uuid := gen_random_uuid(); v_motivo text := trim(coalesce(p ->> 'motivo', ''));
  v_medio text := coalesce(nullif(p ->> 'medio', ''), 'efectivo');
  v_pedido numeric; v_resta numeric; v_q numeric; v_disp numeric; v_und numeric; v_tot numeric; v_base numeric; v_desc numeric;
  v_sum_base numeric := 0; v_sum_iva numeric := 0; v_sum_total numeric := 0; v_abonado numeric; v_saldo numeric; v_a_saldo numeric := 0;
  v_caja uuid;
begin
  select * into v from ventas where id = (p ->> 'venta_id')::uuid for update;
  if not found or coalesce(rol_en(v.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador pueden registrar devoluciones' using errcode = '42501';
  end if;
  if v.estado <> 'cerrada' then raise exception 'La venta está anulada' using errcode = 'P0001'; end if;
  if length(v_motivo) < 4 then raise exception 'Escribe el motivo de la devolución' using errcode = 'P0001'; end if;
  if v_medio not in ('efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'bre_b') then raise exception 'Medio de reembolso no válido' using errcode = 'P0001'; end if;
  if jsonb_typeof(p -> 'lineas') <> 'array' or jsonb_array_length(p -> 'lineas') = 0 then raise exception 'Elige qué productos devuelve el cliente' using errcode = 'P0001'; end if;
  v_caja := coalesce((select id from cajas where id = nullif(p ->> 'caja_id', '')::uuid and empresa_id = v.empresa_id), v.caja_id);

  insert into devoluciones (id, empresa_id, venta_id, caja_id, motivo, base, iva, total, medio, usuario_id)
  values (v_dev, v.empresa_id, v.id, v_caja, v_motivo, 0, 0, 1, v_medio, auth.uid());

  for x in select * from jsonb_array_elements(p -> 'lineas') loop
    v_pedido := (x ->> 'cantidad')::numeric;
    if v_pedido is null or v_pedido <= 0 then continue; end if;
    v_resta := v_pedido;
    for ln in
      select vl.*, vl.cantidad - coalesce((select sum(dl.cantidad) from devolucion_lineas dl where dl.venta_linea_id = vl.id), 0) disponible,
             coalesce((select sum(dl.total) from devolucion_lineas dl where dl.venta_linea_id = vl.id), 0) tot_dev,
             coalesce((select sum(dl.descuento) from devolucion_lineas dl where dl.venta_linea_id = vl.id), 0) desc_dev
      from venta_lineas vl
      where vl.venta_id = v.id and vl.producto_id = (x ->> 'producto_id')::uuid and vl.presentacion = coalesce(x ->> 'presentacion', 'unidad')
      order by vl.id for update of vl
    loop
      exit when v_resta <= 0;
      v_disp := ln.disponible;
      continue when v_disp <= 0;
      v_q := least(v_resta, v_disp);
      v_und := ln.unidades * v_q / ln.cantidad;
      if v_und <> trunc(v_und) then raise exception 'La cantidad a devolver de % debe ser entera', ln.descripcion using errcode = 'P0001'; end if;
      if v_q = v_disp then  -- lo último que queda de la línea: se lleva el resto exacto (sin errores de redondeo)
        v_tot := ln.total - ln.tot_dev; v_desc := ln.descuento - ln.desc_dev;
      else
        v_tot := round(ln.total * v_q / ln.cantidad, 0); v_desc := round(ln.descuento * v_q / ln.cantidad, 2);
      end if;
      v_base := round(v_tot / (1 + ln.iva_pct / 100), 2);
      insert into devolucion_lineas (empresa_id, devolucion_id, venta_linea_id, cantidad, unidades, base, iva, total, descuento)
      values (v.empresa_id, v_dev, ln.id, v_q, v_und::int, v_base, v_tot - v_base, v_tot, v_desc);
      insert into movimientos (empresa_id, sede_id, producto_id, lote_id, cantidad, tipo, ref_id, motivo, usuario_id)
      values (v.empresa_id, v.sede_id, ln.producto_id, ln.lote_id, v_und::int, 'devolucion', v.id, v_motivo, auth.uid());
      v_sum_base := v_sum_base + v_base; v_sum_iva := v_sum_iva + (v_tot - v_base); v_sum_total := v_sum_total + v_tot;
      v_resta := v_resta - v_q;
    end loop;
    if v_resta > 0 then raise exception 'Se pide devolver más de lo que queda por devolver de un producto' using errcode = 'P0001'; end if;
  end loop;
  if v_sum_total <= 0 then raise exception 'Elige qué productos devuelve el cliente' using errcode = 'P0001'; end if;

  -- Venta a crédito: primero baja el saldo; si ya estaba pagada en parte, el resto se le devuelve al cliente.
  if v.condicion = 'credito' then
    select coalesce(sum(valor), 0) into v_abonado from abonos where venta_id = v.id and not anulado;
    v_saldo := v.total - v.devuelto - v_abonado;
    v_a_saldo := greatest(0, least(v_sum_total, v_saldo));
  end if;
  update devoluciones set base = v_sum_base, iva = v_sum_iva, total = v_sum_total, a_saldo = v_a_saldo, reembolso = v_sum_total - v_a_saldo where id = v_dev;
  update ventas set devuelto = devuelto + v_sum_total where id = v.id;

  -- Nota crédito por lo devuelto, si la venta tiene documento electrónico vigente (espera su CUFE si aún no lo tiene).
  select * into d from documentos_dian where venta_id = v.id and tipo <> 'nota_credito' and estado <> 'anulado';
  if found then
    select * into v_res from resoluciones_dian where empresa_id = v.empresa_id and tipo = 'nota_credito' and activa for update;
    if not found then raise exception 'Para devolver productos de un documento electrónico necesitas una numeración de notas crédito activa' using errcode = 'P0001'; end if;
    if v_res.actual + 1 > v_res.hasta then raise exception 'Se agotó la numeración de notas crédito' using errcode = 'P0001'; end if;
    update resoluciones_dian set actual = actual + 1 where id = v_res.id;
    insert into documentos_dian (empresa_id, venta_id, tipo, prefijo, numero, devolucion_id)
    values (v.empresa_id, v.id, 'nota_credito', v_res.prefijo, v_res.actual + 1, v_dev);
  end if;

  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v.empresa_id, auth.uid(), 'devolucion', 'ventas', v.id::text,
          jsonb_build_object('devolucion', v_dev, 'total', v_sum_total, 'reembolso', v_sum_total - v_a_saldo, 'medio', v_medio, 'motivo', v_motivo));
  return jsonb_build_object('id', v_dev, 'total', v_sum_total, 'a_saldo', v_a_saldo, 'reembolso', v_sum_total - v_a_saldo, 'medio', v_medio);
end $$;
revoke execute on function devolver_venta(jsonb) from public;
grant execute on function devolver_venta(jsonb) to authenticated;

-- Anular: una venta con devoluciones ya no se anula entera (se devuelve lo que queda).
create or replace function anular_venta(p_venta uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v ventas; ln venta_lineas; d documentos_dian; v_res resoluciones_dian;
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
  if found and d.estado in ('pendiente', 'rechazado') then
    update documentos_dian set estado = 'anulado', ultimo_error = 'Venta anulada antes de emitirse', actualizado = now() where id = d.id;
  elsif found and d.estado in ('aceptado', 'enviando') then
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
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v.empresa_id, auth.uid(), 'anular_venta', 'ventas', p_venta::text, jsonb_build_object('motivo', p_motivo, 'total', v.total));
end $$;

-- Abonos y cartera: el saldo descuenta lo devuelto.
create or replace function registrar_abono(p_venta uuid, p_medio text, p_valor numeric, p_referencia text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v ventas; v_abonado numeric; v_saldo numeric;
begin
  select * into v from ventas where id = p_venta for update;
  if not found or coalesce(rol_en(v.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador registran abonos' using errcode = '42501';
  end if;
  if v.condicion <> 'credito' then raise exception 'Esta venta no es a crédito' using errcode = 'P0001'; end if;
  if v.estado <> 'cerrada' then raise exception 'La venta está anulada' using errcode = 'P0001'; end if;
  if p_valor is null or p_valor <= 0 or p_valor <> trunc(p_valor) then raise exception 'El abono debe ser un valor en pesos mayor que cero' using errcode = 'P0001'; end if;
  select coalesce(sum(valor), 0) into v_abonado from abonos where venta_id = p_venta and not anulado;
  v_saldo := v.total - v.devuelto - v_abonado;
  if p_valor > v_saldo then raise exception 'El abono (%) supera el saldo de la factura (%)', p_valor, v_saldo using errcode = 'P0001'; end if;
  insert into abonos (empresa_id, venta_id, medio, valor, referencia, usuario_id)
  values (v.empresa_id, p_venta, p_medio, p_valor, nullif(trim(coalesce(p_referencia, '')), ''), auth.uid());
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v.empresa_id, auth.uid(), 'abono', 'ventas', p_venta::text, jsonb_build_object('valor', p_valor, 'medio', p_medio));
  return jsonb_build_object('abonado', v_abonado + p_valor, 'saldo', v_saldo - p_valor);
end $$;

create or replace view v_cartera with (security_invoker = true) as
  select v.id venta_id, v.empresa_id, v.prefijo, v.numero, v.creado, v.vence_pago, v.plazo_dias, v.total,
         c.id cliente_id, c.nombre cliente, c.tipo_doc, c.numero_doc, c.dv, c.telefono, c.email,
         coalesce(a.abonado, 0) abonado, v.total - v.devuelto - coalesce(a.abonado, 0) saldo,
         greatest(0, current_date - v.vence_pago) dias_mora, v.devuelto
  from ventas v
  join clientes c on c.id = v.cliente_id
  left join (select venta_id, sum(valor) abonado from abonos where not anulado group by venta_id) a on a.venta_id = v.id
  where v.condicion = 'credito' and v.estado = 'cerrada' and rol_en(v.empresa_id) in ('dueno', 'admin');

-- Turno: las devoluciones hechas en la caja durante el turno restan de las ventas, y el reembolso en efectivo sale del cajón.
create or replace function resumen_turno(p_turno uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t turnos; v_hasta timestamptz; r jsonb; v_cajas int;
  v_ventas numeric; v_n int; v_anuladas int; v_iva numeric; v_credito numeric; v_efectivo numeric; v_abonos numeric;
  v_ingresos numeric; v_egresos numeric; v_medios jsonb; v_dev numeric; v_dev_ef numeric; v_n_dev int;
begin
  select * into t from turnos where id = p_turno;
  if not found or rol_en(t.empresa_id) is null then raise exception 'Turno no encontrado' using errcode = 'P0002'; end if;
  v_hasta := coalesce(t.cerrado, now());
  select coalesce(sum(total) filter (where estado = 'cerrada'), 0), count(*) filter (where estado = 'cerrada'), count(*) filter (where estado = 'anulada'),
         coalesce(sum(iva) filter (where estado = 'cerrada'), 0), coalesce(sum(total) filter (where estado = 'cerrada' and condicion = 'credito'), 0)
    into v_ventas, v_n, v_anuladas, v_iva, v_credito
    from ventas where caja_id = t.caja_id and creado >= t.abierto and creado < v_hasta;
  select coalesce(jsonb_object_agg(medio, valor), '{}'::jsonb) into v_medios from (
    select p.medio, sum(p.valor) - case when p.medio = 'efectivo' then coalesce((select sum(v2.cambio) from ventas v2 where v2.caja_id = t.caja_id
             and v2.estado = 'cerrada' and v2.creado >= t.abierto and v2.creado < v_hasta), 0) else 0 end as valor
    from pagos p join ventas v on v.id = p.venta_id
    where v.caja_id = t.caja_id and v.estado = 'cerrada' and v.creado >= t.abierto and v.creado < v_hasta group by p.medio) x;
  v_efectivo := coalesce((v_medios ->> 'efectivo')::numeric, 0);
  select count(*) into v_cajas from cajas where empresa_id = t.empresa_id and activa;
  select coalesce(sum(valor), 0) into v_abonos from abonos
   where empresa_id = t.empresa_id and medio = 'efectivo' and not anulado and creado >= t.abierto and creado < v_hasta and v_cajas = 1;
  select coalesce(sum(valor) filter (where tipo = 'ingreso'), 0), coalesce(sum(valor) filter (where tipo = 'egreso'), 0)
    into v_ingresos, v_egresos from movimientos_caja where turno_id = t.id;
  select coalesce(sum(total), 0), coalesce(sum(reembolso) filter (where medio = 'efectivo'), 0), count(*)
    into v_dev, v_dev_ef, v_n_dev from devoluciones where caja_id = t.caja_id and creado >= t.abierto and creado < v_hasta;
  r := jsonb_build_object('ventas', v_ventas, 'n_ventas', v_n, 'anuladas', v_anuladas, 'iva', v_iva, 'credito', v_credito, 'medios', v_medios,
    'efectivo_ventas', v_efectivo, 'abonos_efectivo', v_abonos, 'ingresos', v_ingresos, 'egresos', v_egresos, 'base', t.base,
    'devoluciones', v_dev, 'n_devoluciones', v_n_dev, 'devoluciones_efectivo', v_dev_ef, 'ventas_netas', v_ventas - v_dev,
    'efectivo_esperado', t.base + v_efectivo + v_abonos + v_ingresos - v_egresos - v_dev_ef);
  return r;
end $$;
