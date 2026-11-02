-- Regenta · endurecimiento tras la auditoría de seguridad:
--  · pagos con Stripe: se guarda la suscripción para validar los eventos de renovación contra la orden correcta;
--  · límites de uso en la base (comunes a todas las instancias del servidor): IA de la demo, correos a direcciones nuevas;
--  · turnos: solo dueño, administrador y cajero; la cajera no registra salidas grandes; la demo no se puede bloquear.

alter table pagos_suscripcion add column if not exists suscripcion text;
alter table empresas add column if not exists egreso_max_cajero numeric(14, 2) not null default 200000 check (egreso_max_cajero >= 0);

create table if not exists limites_uso (
  id bigint generated always as identity primary key,
  clave text not null,
  creado timestamptz not null default now()
);
create index if not exists limites_uso_clave on limites_uso (clave, creado desc);
alter table limites_uso enable row level security; -- sin políticas: solo el servidor (sin RLS) la usa
revoke all on limites_uso from public;

-- Cuenta el uso de una clave en la ventana y lo registra si cabe. Devuelve si se permite.
create or replace function usar_limite(p_clave text, p_max integer, p_ventana interval) returns boolean
language plpgsql as $$
declare n integer;
begin
  perform pg_advisory_xact_lock(hashtext('limite:' || p_clave));
  select count(*) into n from limites_uso where clave = p_clave and creado > now() - p_ventana;
  if n >= p_max then return false; end if;
  insert into limites_uso (clave) values (p_clave);
  delete from limites_uso where creado < now() - interval '2 days' and random() < 0.01; -- limpieza ocasional
  return true;
end $$;
revoke execute on function usar_limite(text, integer, interval) from public;

create or replace function abrir_turno(p_caja uuid, p_base numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare c cajas; v_id uuid;
begin
  select * into c from cajas where id = p_caja;
  if not found or coalesce(rol_en(c.empresa_id), '') not in ('dueno', 'admin', 'cajero') then
    raise exception 'No puedes abrir turno en esta caja' using errcode = '42501';
  end if;
  if p_base is null or p_base < 0 or p_base <> trunc(p_base) then raise exception 'La base debe ser un valor en pesos (0 o más)' using errcode = 'P0001'; end if;
  if exists (select 1 from turnos where caja_id = p_caja and estado = 'abierto') then raise exception 'Esta caja ya tiene un turno abierto' using errcode = 'P0001'; end if;
  insert into turnos (empresa_id, caja_id, base, abre_usuario) values (c.empresa_id, p_caja, p_base, auth.uid()) returning id into v_id;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (c.empresa_id, auth.uid(), 'abrir_turno', 'turnos', v_id::text, jsonb_build_object('base', p_base));
  return v_id;
end $$;

create or replace function movimiento_caja(p_turno uuid, p_tipo text, p_valor numeric, p_concepto text) returns bigint
language plpgsql security definer set search_path = public as $$
declare t turnos; v_id bigint;
begin
  select * into t from turnos where id = p_turno for update;
  if not found or coalesce(rol_en(t.empresa_id), '') not in ('dueno', 'admin', 'cajero') then
    raise exception 'No puedes registrar movimientos en este turno' using errcode = '42501';
  end if;
  if t.estado <> 'abierto' then raise exception 'El turno ya está cerrado' using errcode = 'P0001'; end if;
  if p_tipo not in ('ingreso', 'egreso') then raise exception 'Tipo de movimiento no válido' using errcode = 'P0001'; end if;
  if p_valor is null or p_valor <= 0 or p_valor <> trunc(p_valor) then raise exception 'El valor debe ser en pesos y mayor que cero' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p_concepto, ''))) < 3 then raise exception 'Escribe el concepto (por ejemplo: pago domicilio, compra de bolsas)' using errcode = 'P0001'; end if;
  -- Una salida grande no la hace la cajera sola: así no se tapa un faltante antes del arqueo.
  if p_tipo = 'egreso' and rol_en(t.empresa_id) = 'cajero'
     and p_valor > (select egreso_max_cajero from empresas where id = t.empresa_id) then
    raise exception 'Salidas de más de % las registra el dueño o el administrador', (select to_char(egreso_max_cajero, 'FM999G999G999') from empresas where id = t.empresa_id) using errcode = '42501';
  end if;
  insert into movimientos_caja (empresa_id, turno_id, tipo, valor, concepto, usuario_id)
  values (t.empresa_id, p_turno, p_tipo, p_valor, trim(p_concepto), auth.uid()) returning id into v_id;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (t.empresa_id, auth.uid(), 'movimiento_caja', 'turnos', p_turno::text, jsonb_build_object('tipo', p_tipo, 'valor', p_valor, 'concepto', trim(p_concepto)));
  return v_id;
end $$;

create or replace function cerrar_turno(p_turno uuid, p_contado numeric, p_observaciones text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t turnos; r jsonb; v_esperado numeric;
begin
  select * into t from turnos where id = p_turno for update;
  if not found or coalesce(rol_en(t.empresa_id), '') not in ('dueno', 'admin', 'cajero') then
    raise exception 'No puedes cerrar este turno' using errcode = '42501';
  end if;
  if t.estado <> 'abierto' then raise exception 'El turno ya está cerrado' using errcode = 'P0001'; end if;
  if p_contado is null or p_contado < 0 or p_contado <> trunc(p_contado) then raise exception 'Escribe el dinero real que hay en la caja' using errcode = 'P0001'; end if;
  r := resumen_turno(p_turno);
  v_esperado := (r ->> 'efectivo_esperado')::numeric;
  update turnos set estado = 'cerrado', cerrado = now(), cierra_usuario = auth.uid(), efectivo_esperado = v_esperado, efectivo_contado = p_contado,
    diferencia = p_contado - v_esperado, resumen = r, observaciones = nullif(trim(coalesce(p_observaciones, '')), '') where id = p_turno;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (t.empresa_id, auth.uid(), 'cerrar_turno', 'turnos', p_turno::text, jsonb_build_object('esperado', v_esperado, 'contado', p_contado, 'diferencia', p_contado - v_esperado));
  return r || jsonb_build_object('efectivo_contado', p_contado, 'diferencia', p_contado - v_esperado);
end $$;

create or replace function exigir_turno(p_empresa uuid, p_valor boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(rol_en(p_empresa), '') <> 'dueno' then raise exception 'Solo el dueño cambia esta opción' using errcode = '42501'; end if;
  if (select demo from empresas where id = p_empresa) then raise exception 'En la droguería de demostración esta opción no se cambia' using errcode = 'P0001'; end if;
  update empresas set exige_turno = p_valor where id = p_empresa;
end $$;



-- Ventas: cantidades exactas al repartir entre lotes, IVA solo si la droguería es responsable, factura con correo del
-- cliente y sin ventas reales antes de la habilitación DIAN.
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
  v_linea numeric; v_asignado numeric;
  v_bruto numeric; v_desc_linea numeric; v_desc_asig numeric; l_desc numeric; v_dpct numeric; v_dgen numeric; v_dmax numeric;
  v_cant_asig numeric; l_cant numeric; v_ivapct numeric; v_resp_iva boolean; v_demo boolean;
begin
  v_rol := rol_en(v_emp);
  if v_rol is null or v_rol not in ('dueno', 'admin', 'cajero') then
    raise exception 'No tienes permiso para vender en esta empresa' using errcode = '42501';
  end if;
  select responsable_iva, demo into v_resp_iva, v_demo from empresas where id = v_emp;
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
  -- La factura electrónica se entrega por correo al adquirente: sin un correo válido la DIAN/MATIAS la rechaza.
  if v_tipo = 'factura' and not exists (select 1 from clientes where id = (p ->> 'cliente_id')::uuid and empresa_id = v_emp
      and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'La factura electrónica necesita el correo del cliente: edítalo en sus datos' using errcode = 'P0001';
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
  -- Descuentos: por línea (descuento_pct de cada línea) y general sobre toda la venta (p.descuento_pct). La cajera tiene un
  -- tope (empresas.descuento_max_cajero); el dueño y el administrador no.
  v_dgen := coalesce((p ->> 'descuento_pct')::numeric, 0);
  if v_dgen < 0 or v_dgen >= 100 then raise exception 'El descuento general debe estar entre 0 y 99 %%' using errcode = 'P0001'; end if;
  select descuento_max_cajero into v_dmax from empresas where id = v_emp;

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
  -- Antes de la habilitación ante la DIAN no se vende de verdad (el documento no tendría validez fiscal). La demo sí.
  if v_res.pruebas and not v_demo then
    raise exception 'Tu droguería aún no está habilitada ante la DIAN: ya puedes cargar productos, inventario y usuarios; la caja vende en cuanto quede cargada tu resolución' using errcode = 'P0001';
  end if;
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
    -- El total de la línea se calcula una vez; el último lote recibe el resto (sin centavos sueltos al repartir).
    v_dpct := coalesce((ln ->> 'descuento_pct')::numeric, 0);
    if v_dpct < 0 or v_dpct >= 100 then raise exception 'Descuento no válido en %', v_prod.nombre using errcode = 'P0001'; end if;
    v_dpct := 100 - (100 - v_dpct) * (100 - v_dgen) / 100;  -- descuento efectivo de la línea (el general se suma encima)
    if v_rol = 'cajero' and v_dpct > v_dmax + 0.001 then
      raise exception 'El descuento de % (% %%) supera el máximo permitido a la cajera (% %%)', v_prod.nombre, round(v_dpct, 2), v_dmax using errcode = '42501';
    end if;
    v_bruto := round(v_precio * v_cant, 2);
    v_linea := case when v_dpct > 0 then round(v_bruto * (100 - v_dpct) / 100, 0) else v_bruto end; v_asignado := 0;  -- con descuento, en pesos enteros
    v_desc_linea := v_bruto - v_linea; v_desc_asig := 0; v_cant_asig := 0;
    -- Quien no es responsable de IVA no lo discrimina: la línea va sin IVA aunque el producto lo tenga.
    v_ivapct := case when v_resp_iva then v_prod.iva else 0 end;
    for r in
      select s.lote_id, s.unidades from v_stock_lotes s
      where s.producto_id = v_prod.id and s.sede_id = v_sede and s.unidades > 0 and (s.vence is null or s.vence >= current_date) and not s.bloqueado
      order by s.vence nulls last, s.lote_id
    loop
      exit when v_falta = 0;
      v_toma := least(v_falta, r.unidades);
      v_parte := v_toma::numeric / v_unid;
      l_total := case when v_toma = v_falta then v_linea - v_asignado else round(v_linea * v_parte, 2) end;
      v_asignado := v_asignado + l_total;
      l_desc := case when v_toma = v_falta then v_desc_linea - v_desc_asig else round(v_desc_linea * v_parte, 2) end;
      v_desc_asig := v_desc_asig + l_desc;
      l_cant := case when v_toma = v_falta then v_cant - v_cant_asig else round(v_cant * v_parte, 3) end; -- sin 0,999 al repartir
      v_cant_asig := v_cant_asig + l_cant;
      l_base := round(l_total / (1 + v_ivapct / 100), 2);
      l_iva := l_total - l_base;
      insert into venta_lineas (empresa_id, venta_id, producto_id, lote_id, descripcion, presentacion, cantidad, unidades,
                                precio, iva_pct, base, iva, total, descuento, descuento_pct)
      values (v_emp, v_venta, v_prod.id, r.lote_id, v_prod.nombre, v_pres, l_cant, v_toma,
              v_precio, v_ivapct, l_base, l_iva, l_total, l_desc, round(v_dpct, 2));
      insert into movimientos (empresa_id, sede_id, producto_id, lote_id, cantidad, tipo, ref_id, usuario_id)
      values (v_emp, v_sede, v_prod.id, r.lote_id, -v_toma, 'venta', v_venta, v_user);
      v_base := v_base + l_base; v_iva := v_iva + l_iva; v_total := v_total + l_total;
      v_falta := v_falta - v_toma;
    end loop;
    if v_falta > 0 then
      if exists (select 1 from v_stock_lotes s where s.producto_id = v_prod.id and s.sede_id = v_sede and s.unidades > 0 and s.bloqueado) then
        raise exception 'No hay existencias vendibles suficientes de % (faltan % unidades; hay lotes separados por una alerta del INVIMA)', v_prod.nombre, v_falta using errcode = 'P0001';
      end if;
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
  v_cambio := greatest(0, v_recibido - v_total);
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

-- Numeraciones de producción: con número de resolución y prefijo DIAN de hasta 4 caracteres.
alter table resoluciones_dian drop constraint if exists produccion_completa;
alter table resoluciones_dian add constraint produccion_completa check (pruebas or (numero_resolucion is not null and length(prefijo) <= 4)) not valid;

-- Un documento rechazado se puede corregir y reenviar: el plazo de 72 h cuenta desde el reenvío.
alter table documentos_dian add column if not exists reenviado timestamptz;
