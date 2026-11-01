-- Regenta · venta a crédito, cartera y abonos (facturación para distribuidoras y droguerías que fían a clientes con NIT).

alter table ventas add column condicion text not null default 'contado' check (condicion in ('contado', 'credito'));
alter table ventas add column plazo_dias integer check (plazo_dias between 1 and 180);
alter table ventas add column vence_pago date;
alter table ventas add constraint credito_completo check (condicion = 'contado' or (plazo_dias is not null and vence_pago is not null and cliente_id is not null and tipo_doc = 'factura'));

-- Abonos a facturas a crédito. Inmutables: un abono mal registrado se anula con otro registro (anulado = true), nunca se borra.
create table abonos (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  venta_id uuid not null references ventas on delete restrict,
  medio text not null check (medio in ('efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'bre_b')),
  valor numeric(14, 2) not null check (valor > 0 and valor = trunc(valor)),
  referencia text check (length(referencia) <= 60),
  usuario_id uuid not null,
  creado timestamptz not null default now()
);
create index abonos_venta on abonos (venta_id);
create index ventas_credito on ventas (empresa_id, vence_pago) where condicion = 'credito';
alter table abonos enable row level security;
create policy gerencia_lee on abonos for select to authenticated using (rol_en(empresa_id) in ('dueno', 'admin'));
grant select on abonos to authenticated;

-- Cartera: facturas a crédito vigentes con lo abonado, el saldo y los días de mora. Solo la ve la gerencia (RLS de abonos y
-- filtro por rol: el cajero vende, no cobra cartera).
create view v_cartera with (security_invoker = true) as
  select v.id venta_id, v.empresa_id, v.prefijo, v.numero, v.creado, v.vence_pago, v.plazo_dias, v.total,
         c.id cliente_id, c.nombre cliente, c.tipo_doc, c.numero_doc, c.dv, c.telefono, c.email,
         coalesce(a.abonado, 0) abonado, v.total - coalesce(a.abonado, 0) saldo,
         greatest(0, current_date - v.vence_pago) dias_mora
  from ventas v
  join clientes c on c.id = v.cliente_id
  left join (select venta_id, sum(valor) abonado from abonos group by venta_id) a on a.venta_id = v.id
  where v.condicion = 'credito' and v.estado = 'cerrada' and rol_en(v.empresa_id) in ('dueno', 'admin');
grant select on v_cartera to authenticated;

-- Registrar un abono: nunca más que el saldo; candado por venta para que dos abonos simultáneos no lo superen.
create function registrar_abono(p_venta uuid, p_medio text, p_valor numeric, p_referencia text default null) returns jsonb
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
  select coalesce(sum(valor), 0) into v_abonado from abonos where venta_id = p_venta;
  v_saldo := v.total - v_abonado;
  if p_valor > v_saldo then raise exception 'El abono (%) supera el saldo de la factura (%)', p_valor, v_saldo using errcode = 'P0001'; end if;
  insert into abonos (empresa_id, venta_id, medio, valor, referencia, usuario_id)
  values (v.empresa_id, p_venta, p_medio, p_valor, nullif(trim(coalesce(p_referencia, '')), ''), auth.uid());
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v.empresa_id, auth.uid(), 'abono', 'ventas', p_venta::text, jsonb_build_object('valor', p_valor, 'medio', p_medio));
  return jsonb_build_object('abonado', v_abonado + p_valor, 'saldo', v_saldo - p_valor);
end $$;
revoke execute on function registrar_abono(uuid, text, numeric, text) from public;
grant execute on function registrar_abono(uuid, text, numeric, text) to authenticated;

-- Venta: acepta condición 'credito' (con plazo, factura y cliente; sin pago en caja).
create or replace function registrar_venta(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := (p ->> 'empresa_id')::uuid;
  v_sede uuid := (p ->> 'sede_id')::uuid;
  v_caja uuid := (p ->> 'caja_id')::uuid;
  v_tipo text := coalesce(p ->> 'tipo_doc', 'pos');
  v_user uuid := auth.uid();
  v_rol text;
  v_venta uuid;
  v_existente ventas;
  v_res resoluciones_dian;
  v_num bigint;
  ln jsonb; pg jsonb;
  v_prod productos;
  v_pres text; v_cant numeric; v_unid integer; v_precio numeric;
  v_falta integer; v_toma integer; v_parte numeric;
  r record;
  v_base numeric := 0; v_iva numeric := 0; v_total numeric := 0;
  l_total numeric; l_base numeric; l_iva numeric;
  v_recibido numeric := 0; v_efectivo numeric := 0; v_cambio numeric;
  v_doc uuid;
  v_credito boolean := coalesce(p ->> 'condicion', 'contado') = 'credito';
  v_plazo integer;
begin
  v_rol := rol_en(v_emp);
  if v_rol is null or v_rol not in ('dueno', 'admin', 'cajero') then
    raise exception 'No tienes permiso para vender en esta empresa' using errcode = '42501';
  end if;
  if (select estado from empresas where id = v_emp) <> 'activa' then
    raise exception 'La suscripción de esta empresa está suspendida' using errcode = 'P0001';
  end if;
  if not exists (select 1 from cajas where id = v_caja and empresa_id = v_emp and sede_id = v_sede and activa) then
    raise exception 'Caja no válida' using errcode = 'P0001';
  end if;
  if v_tipo not in ('pos', 'factura') then raise exception 'Tipo de documento no válido' using errcode = 'P0001'; end if;
  if v_tipo = 'factura' and (p ->> 'cliente_id') is null then
    raise exception 'La factura electrónica necesita los datos del cliente' using errcode = 'P0001';
  end if;
  if (p ->> 'cliente_id') is not null and not exists (select 1 from clientes where id = (p ->> 'cliente_id')::uuid and empresa_id = v_emp) then
    raise exception 'Cliente no válido' using errcode = 'P0001';
  end if;
  if coalesce(p ->> 'condicion', 'contado') not in ('contado', 'credito') then raise exception 'Condición de pago no válida' using errcode = 'P0001'; end if;
  if v_credito then
    -- A crédito solo vende quien responde por la cartera, con factura electrónica a un cliente identificado.
    if v_rol not in ('dueno', 'admin') then raise exception 'Solo el dueño o el administrador pueden vender a crédito' using errcode = '42501'; end if;
    if v_tipo <> 'factura' then raise exception 'La venta a crédito se hace con factura electrónica' using errcode = 'P0001'; end if;
    v_plazo := (p ->> 'plazo_dias')::integer;
    if v_plazo is null or v_plazo < 1 or v_plazo > 180 then raise exception 'El plazo de pago debe estar entre 1 y 180 días' using errcode = 'P0001'; end if;
    if jsonb_array_length(coalesce(p -> 'pagos', '[]')) > 0 then raise exception 'La venta a crédito no lleva pago en caja: registra los abonos en Cartera' using errcode = 'P0001'; end if;
  end if;
  if jsonb_array_length(coalesce(p -> 'lineas', '[]')) = 0 then raise exception 'La venta no tiene productos' using errcode = 'P0001'; end if;

  -- Reintento de una venta ya registrada (la caja volvió a enviarla): se devuelve la misma. El candado sobre la clave
  -- evita que dos envíos simultáneos de la misma venta choquen.
  perform pg_advisory_xact_lock(hashtext(v_emp::text || ':' || (p ->> 'idem_key')));
  select * into v_existente from ventas where empresa_id = v_emp and idem_key = p ->> 'idem_key';
  if found then
    return jsonb_build_object('venta_id', v_existente.id, 'prefijo', v_existente.prefijo, 'numero', v_existente.numero,
                              'total', v_existente.total, 'cambio', v_existente.cambio, 'repetida', true);
  end if;

  -- Numeración de la resolución activa (bloqueo de fila: dos cajas no pueden tomar el mismo número).
  select * into v_res from resoluciones_dian where empresa_id = v_emp and tipo = v_tipo and activa for update;
  if not found then raise exception 'No hay resolución de numeración activa para %', v_tipo using errcode = 'P0001'; end if;
  if v_res.vigente_hasta is not null and v_res.vigente_hasta < current_date then
    raise exception 'La resolución de numeración venció el %', v_res.vigente_hasta using errcode = 'P0001';
  end if;
  v_num := v_res.actual + 1;
  if v_num > v_res.hasta then raise exception 'Se agotó la numeración autorizada (%-%)', v_res.prefijo, v_res.hasta using errcode = 'P0001'; end if;
  update resoluciones_dian set actual = v_num where id = v_res.id;

  -- Candados por producto en orden fijo (evita bloqueos mutuos con otra venta o un ajuste).
  perform pg_advisory_xact_lock(hashtext(x)) from (select distinct e ->> 'producto_id' x from jsonb_array_elements(p -> 'lineas') e order by 1) s;

  -- La venta se inserta al final, ya con sus totales: las líneas y pagos la referencian con FK diferida.
  v_venta := gen_random_uuid();

  for ln in select * from jsonb_array_elements(p -> 'lineas') loop
    select * into v_prod from productos where id = (ln ->> 'producto_id')::uuid and empresa_id = v_emp and activo;
    if not found then raise exception 'Producto no válido' using errcode = 'P0001'; end if;
    v_pres := coalesce(ln ->> 'presentacion', 'caja');
    v_cant := (ln ->> 'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 or v_cant <> trunc(v_cant) then raise exception 'Cantidad no válida en %', v_prod.nombre using errcode = 'P0001'; end if;
    if v_pres = 'caja' then
      v_unid := v_cant * v_prod.unidades_por_caja; v_precio := v_prod.precio_caja;
    elsif v_pres = 'unidad' then
      if v_prod.precio_unidad is null then raise exception '% no se vende por unidad', v_prod.nombre using errcode = 'P0001'; end if;
      v_unid := v_cant; v_precio := v_prod.precio_unidad;
    else raise exception 'Presentación no válida' using errcode = 'P0001';
    end if;

    -- Lotes con existencias de esta sede, el que vence antes primero (FEFO). Una línea puede repartirse en varios lotes.
    -- Nunca se vende un lote vencido. Bloqueo por producto: dos cajas no pueden descontar el mismo lote a la vez.
    perform pg_advisory_xact_lock(hashtext(v_prod.id::text));
    v_falta := v_unid;
    for r in
      select s.lote_id, s.unidades from v_stock_lotes s
      where s.producto_id = v_prod.id and s.sede_id = v_sede and s.unidades > 0 and (s.vence is null or s.vence >= current_date)
      order by s.vence nulls last, s.lote_id
    loop
      exit when v_falta = 0;
      v_toma := least(v_falta, r.unidades);
      v_parte := v_toma::numeric / v_unid;
      l_total := round(v_precio * v_cant * v_parte, 2);
      l_base := round(l_total / (1 + v_prod.iva / 100), 2);
      l_iva := l_total - l_base;
      insert into venta_lineas (empresa_id, venta_id, producto_id, lote_id, descripcion, presentacion, cantidad, unidades,
                                precio, iva_pct, base, iva, total)
      values (v_emp, v_venta, v_prod.id, r.lote_id, v_prod.nombre, v_pres, round(v_cant * v_parte, 3), v_toma,
              v_precio, v_prod.iva, l_base, l_iva, l_total);
      insert into movimientos (empresa_id, sede_id, producto_id, lote_id, cantidad, tipo, ref_id, usuario_id)
      values (v_emp, v_sede, v_prod.id, r.lote_id, -v_toma, 'venta', v_venta, v_user);
      v_base := v_base + l_base; v_iva := v_iva + l_iva; v_total := v_total + l_total;
      v_falta := v_falta - v_toma;
    end loop;
    if v_falta > 0 then
      if exists (select 1 from v_stock_lotes s where s.producto_id = v_prod.id and s.sede_id = v_sede and s.unidades > 0 and s.vence < current_date) then
        raise exception 'No hay existencias vigentes suficientes de % (faltan % unidades; lo demás está vencido y no se puede vender)', v_prod.nombre, v_falta using errcode = 'P0001';
      end if;
      raise exception 'No hay existencias suficientes de % (faltan % unidades)', v_prod.nombre, v_falta using errcode = 'P0001';
    end if;
  end loop;

  for pg in select * from jsonb_array_elements(coalesce(p -> 'pagos', '[]')) loop
    if (pg ->> 'valor')::numeric > 0 then
      insert into pagos (empresa_id, venta_id, medio, valor, referencia)
      values (v_emp, v_venta, pg ->> 'medio', (pg ->> 'valor')::numeric, pg ->> 'referencia');
      v_recibido := v_recibido + (pg ->> 'valor')::numeric;
      if pg ->> 'medio' = 'efectivo' then v_efectivo := v_efectivo + (pg ->> 'valor')::numeric; end if;
    end if;
  end loop;
  if not v_credito and v_recibido < v_total then
    raise exception 'El pago (%) no cubre el total (%)', v_recibido, v_total using errcode = 'P0001';
  end if;
  v_cambio := v_recibido - v_total;
  if v_cambio > v_efectivo then
    raise exception 'Solo se da cambio sobre el efectivo recibido' using errcode = 'P0001';
  end if;

  insert into ventas (id, empresa_id, sede_id, caja_id, cliente_id, usuario_id, idem_key, tipo_doc, prefijo, numero,
                      base, iva, total, recibido, cambio, condicion, plazo_dias, vence_pago)
  values (v_venta, v_emp, v_sede, v_caja, (p ->> 'cliente_id')::uuid, v_user, p ->> 'idem_key', v_tipo, v_res.prefijo, v_num,
          v_base, v_iva, v_total, v_recibido, v_cambio, case when v_credito then 'credito' else 'contado' end, v_plazo,
          case when v_credito then current_date + v_plazo end);

  insert into documentos_dian (empresa_id, venta_id, tipo, prefijo, numero)
  values (v_emp, v_venta, v_tipo, v_res.prefijo, v_num) returning id into v_doc;

  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v_emp, v_user, 'venta', 'ventas', v_venta::text, jsonb_build_object('total', v_total, 'numero', v_res.prefijo || v_num, 'credito', v_credito));

  return jsonb_build_object('venta_id', v_venta, 'documento_id', v_doc, 'prefijo', v_res.prefijo, 'numero', v_num,
                            'base', v_base, 'iva', v_iva, 'total', v_total, 'cambio', v_cambio, 'repetida', false,
                            'credito', v_credito, 'vence_pago', case when v_credito then current_date + v_plazo end);
end $$;

-- Anular: no se anula una venta a crédito que ya tiene abonos.
create or replace function anular_venta(p_venta uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v ventas; ln venta_lineas; d documentos_dian; v_res resoluciones_dian;
begin
  select * into v from ventas where id = p_venta for update;
  if not found or coalesce(rol_en(v.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador pueden anular ventas' using errcode = '42501';
  end if;
  if v.estado <> 'cerrada' then raise exception 'La venta ya está anulada' using errcode = 'P0001'; end if;
  if exists (select 1 from abonos where venta_id = p_venta) then
    raise exception 'Esta venta a crédito ya tiene abonos: devuelve primero lo abonado y anula los abonos en Cartera' using errcode = 'P0001';
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
