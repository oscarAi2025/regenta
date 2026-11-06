-- Regenta · mostrador ágil: ventas en espera, domicilios y cotizaciones (pedidos del mostrador).
--  · Un pedido es un borrador de venta guardado en el servidor: «espera» (cliente que fue por algo y vuelve; otra caja
--    puede cobrarla), «domicilio» (sale con el domiciliario y se cobra al volver) y «cotización» (con validez, se
--    imprime o se manda por WhatsApp y se convierte en venta).
--  · Nada reserva existencias: el stock solo se mueve cuando la venta se registra con registrar_venta.
--  · Se cobra SIEMPRE al precio vigente (lo fija registrar_venta). precio_mostrado guarda el precio que se le dijo al
--    cliente, solo para avisar «antes X, ahora Y».
--  · cobrar_pedido(pedido, venta) se llama en la MISMA transacción que registrar_venta (que no se modifica): marca el
--    pedido cobrado y lo enlaza a su venta, con bloqueo de fila (dos cajas no lo cobran dos veces).
--  · Las tablas solo se leen (RLS por empresa); se escriben únicamente por las funciones de abajo.

create table if not exists pedidos_mostrador (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  sede_id uuid not null references sedes,
  tipo text not null check (tipo in ('espera', 'domicilio', 'cotizacion')),
  estado text not null default 'abierto' check (estado in ('abierto', 'en_camino', 'cobrado', 'cancelado', 'vencido')),
  numero integer not null check (numero > 0),          -- consecutivo por empresa y tipo
  cliente_id uuid references clientes,
  contacto text check (contacto is null or length(contacto) between 1 and 80),
  telefono text check (telefono is null or telefono ~ '^[0-9 +()-]{7,20}$'),
  direccion text check (direccion is null or length(direccion) between 3 and 200),
  nota text check (nota is null or length(nota) <= 300),
  vence date,                                           -- validez de la cotización
  descuento_pct numeric(5, 2) not null default 0 check (descuento_pct >= 0 and descuento_pct < 100),  -- descuento general
  motivo text check (motivo is null or length(motivo) between 3 and 200),  -- motivo de la cancelación
  venta_id uuid unique references ventas,
  creado_por uuid not null,
  caja_id uuid references cajas,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  unique (empresa_id, tipo, numero),
  check ((estado = 'cobrado') = (venta_id is not null)),
  check (estado <> 'en_camino' or tipo = 'domicilio'),
  check (estado <> 'vencido' or tipo = 'cotizacion'),
  check (tipo <> 'cotizacion' or vence is not null),
  check (estado <> 'cancelado' or motivo is not null)
);
create index if not exists pedidos_mostrador_lista on pedidos_mostrador (empresa_id, tipo, estado, creado desc);

create table if not exists pedido_lineas (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  pedido_id uuid not null references pedidos_mostrador on delete cascade,
  producto_id uuid not null references productos,
  presentacion text not null check (presentacion in ('caja', 'unidad')),
  cantidad integer not null check (cantidad between 1 and 10000),
  descuento_pct numeric(5, 2) not null default 0 check (descuento_pct >= 0 and descuento_pct < 100),
  precio_mostrado numeric(14, 2) not null check (precio_mostrado >= 0)   -- precio de la presentación al armar el pedido
);
create index if not exists pedido_lineas_pedido on pedido_lineas (pedido_id);
create index if not exists pedido_lineas_producto on pedido_lineas (empresa_id, producto_id);

-- ───────────── Guardar (crear o reemplazar) un pedido ─────────────
-- p = {id?, empresa_id, sede_id, caja_id?, tipo, cliente_id?, contacto?, telefono?, direccion?, nota?, vence?, descuento_pct?,
--      lineas: [{producto_id, presentacion, cantidad, descuento_pct?}]}
create or replace function guardar_pedido(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := (p ->> 'empresa_id')::uuid;
  v_sede uuid := (p ->> 'sede_id')::uuid;
  v_caja uuid := nullif(p ->> 'caja_id', '')::uuid;
  v_tipo text := p ->> 'tipo';
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_cli uuid := nullif(p ->> 'cliente_id', '')::uuid;
  v_contacto text := nullif(regexp_replace(trim(coalesce(p ->> 'contacto', '')), '\s+', ' ', 'g'), '');
  v_tel text := nullif(trim(coalesce(p ->> 'telefono', '')), '');
  v_dir text := nullif(regexp_replace(trim(coalesce(p ->> 'direccion', '')), '\s+', ' ', 'g'), '');
  v_nota text := nullif(trim(coalesce(p ->> 'nota', '')), '');
  v_vence date;
  v_dgen numeric := coalesce((p ->> 'descuento_pct')::numeric, 0);
  v_rol text; v_dmax numeric; v_ped pedidos_mostrador; v_num integer;
  ln jsonb; v_prod productos; v_pres text; v_cant numeric; v_dpct numeric; v_precio numeric; n integer := 0;
begin
  v_rol := rol_en(v_emp);
  if coalesce(v_rol, '') not in ('dueno', 'admin', 'cajero', 'vendedor') then
    raise exception 'No tienes permiso para armar pedidos en esta empresa' using errcode = '42501';
  end if;
  if (select estado from empresas where id = v_emp) <> 'activa' then
    raise exception 'La suscripción de esta empresa está suspendida' using errcode = 'P0001';
  end if;
  if not exists (select 1 from sedes where id = v_sede and empresa_id = v_emp) then raise exception 'Sede no válida' using errcode = 'P0001'; end if;
  if v_caja is not null and not exists (select 1 from cajas where id = v_caja and empresa_id = v_emp) then raise exception 'Caja no válida' using errcode = 'P0001'; end if;
  if v_cli is not null and not exists (select 1 from clientes where id = v_cli and empresa_id = v_emp) then raise exception 'Cliente no válido' using errcode = 'P0001'; end if;
  if v_tipo is null or v_tipo not in ('espera', 'domicilio', 'cotizacion') then raise exception 'Tipo de pedido no válido' using errcode = 'P0001'; end if;
  if jsonb_array_length(coalesce(p -> 'lineas', '[]')) = 0 then raise exception 'El pedido no tiene productos' using errcode = 'P0001'; end if;
  if jsonb_array_length(p -> 'lineas') > 200 then raise exception 'El pedido tiene demasiados productos' using errcode = 'P0001'; end if;
  if v_dgen < 0 or v_dgen >= 100 then raise exception 'El descuento general debe estar entre 0 y 99 %%' using errcode = 'P0001'; end if;
  if v_tipo = 'domicilio' then
    if v_contacto is null then raise exception 'Escribe a nombre de quién va el domicilio' using errcode = 'P0001'; end if;
    if v_tel is null or v_tel !~ '^[0-9 +()-]{7,20}$' then raise exception 'Escribe un teléfono de contacto válido' using errcode = 'P0001'; end if;
    if v_dir is null or length(v_dir) < 3 then raise exception 'Escribe la dirección de entrega' using errcode = 'P0001'; end if;
  elsif v_tel is not null and v_tel !~ '^[0-9 +()-]{7,20}$' then raise exception 'Escribe un teléfono válido' using errcode = 'P0001';
  end if;
  if v_tipo = 'cotizacion' then
    begin v_vence := coalesce(nullif(p ->> 'vence', '')::date, current_date + 8);
    exception when others then raise exception 'La fecha de validez no es válida' using errcode = 'P0001'; end;
    if v_vence < current_date or v_vence > current_date + 90 then raise exception 'La validez de la cotización debe estar entre hoy y 90 días' using errcode = 'P0001'; end if;
  end if;
  if length(coalesce(v_contacto, '')) > 80 then raise exception 'El nombre es demasiado largo (máximo 80 caracteres)' using errcode = 'P0001'; end if;
  if length(coalesce(v_dir, '')) > 200 then raise exception 'La dirección es demasiado larga' using errcode = 'P0001'; end if;
  if length(coalesce(v_nota, '')) > 300 then raise exception 'La nota es demasiado larga (máximo 300 caracteres)' using errcode = 'P0001'; end if;
  -- El tope de descuento de la cajera vale también para el vendedor (así el pedido se puede cobrar tal cual).
  select descuento_max_cajero into v_dmax from empresas where id = v_emp;

  if v_id is not null then
    select * into v_ped from pedidos_mostrador where id = v_id and empresa_id = v_emp for update;
    if not found then raise exception 'Pedido no encontrado' using errcode = 'P0001'; end if;
    if v_ped.estado <> 'abierto' then raise exception 'Este pedido ya no se puede cambiar (está %)', replace(v_ped.estado, '_', ' ') using errcode = 'P0001'; end if;
    if v_ped.tipo <> v_tipo then raise exception 'El tipo del pedido no se cambia' using errcode = 'P0001'; end if;
    if v_tipo = 'cotizacion' and nullif(p ->> 'vence', '') is null then v_vence := greatest(v_ped.vence, current_date); end if; -- conserva su validez
    update pedidos_mostrador set cliente_id = v_cli, contacto = v_contacto, telefono = v_tel, direccion = v_dir, nota = v_nota,
      vence = v_vence, descuento_pct = v_dgen, actualizado = now()
    where id = v_id;
    delete from pedido_lineas where pedido_id = v_id;
  else
    perform pg_advisory_xact_lock(hashtext('pedido:' || v_emp::text || ':' || v_tipo));
    select coalesce(max(numero), 0) + 1 into v_num from pedidos_mostrador where empresa_id = v_emp and tipo = v_tipo;
    insert into pedidos_mostrador (empresa_id, sede_id, tipo, numero, cliente_id, contacto, telefono, direccion, nota, vence, descuento_pct, creado_por, caja_id)
    values (v_emp, v_sede, v_tipo, v_num, v_cli, v_contacto, v_tel, v_dir, v_nota, v_vence, v_dgen, auth.uid(), v_caja)
    returning * into v_ped;
    v_id := v_ped.id;
  end if;

  for ln in select * from jsonb_array_elements(p -> 'lineas') loop
    select * into v_prod from productos where id = (ln ->> 'producto_id')::uuid and empresa_id = v_emp and activo;
    if not found then raise exception 'Producto no válido' using errcode = 'P0001'; end if;
    v_pres := coalesce(ln ->> 'presentacion', 'caja');
    v_cant := (ln ->> 'cantidad')::numeric;
    if v_cant is null or v_cant < 1 or v_cant > 10000 or v_cant <> trunc(v_cant) then raise exception 'Cantidad no válida en %', v_prod.nombre using errcode = 'P0001'; end if;
    if v_pres = 'caja' then v_precio := v_prod.precio_caja;
    elsif v_pres = 'unidad' then
      if v_prod.precio_unidad is null then raise exception '% no se vende por unidad', v_prod.nombre using errcode = 'P0001'; end if;
      v_precio := v_prod.precio_unidad;
    else raise exception 'Presentación no válida' using errcode = 'P0001';
    end if;
    v_dpct := coalesce((ln ->> 'descuento_pct')::numeric, 0);
    if v_dpct < 0 or v_dpct >= 100 then raise exception 'Descuento no válido en %', v_prod.nombre using errcode = 'P0001'; end if;
    if v_rol in ('cajero', 'vendedor') and 100 - (100 - v_dpct) * (100 - v_dgen) / 100 > v_dmax + 0.001 then
      raise exception 'El descuento de % supera el máximo permitido (% %%)', v_prod.nombre, v_dmax using errcode = '42501';
    end if;
    insert into pedido_lineas (empresa_id, pedido_id, producto_id, presentacion, cantidad, descuento_pct, precio_mostrado)
    values (v_emp, v_id, v_prod.id, v_pres, v_cant::integer, v_dpct, v_precio);
    n := n + 1;
  end loop;

  return jsonb_build_object('id', v_id, 'tipo', v_ped.tipo, 'numero', v_ped.numero, 'lineas', n);
end $$;

-- ───────────── Cambiar el estado (en camino, cancelar) ─────────────
create or replace function cambiar_estado_pedido(p_pedido uuid, p_estado text, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v pedidos_mostrador; v_motivo text := nullif(regexp_replace(trim(coalesce(p_motivo, '')), '\s+', ' ', 'g'), '');
begin
  select * into v from pedidos_mostrador where id = p_pedido for update;
  if not found or coalesce(rol_en(v.empresa_id), '') not in ('dueno', 'admin', 'cajero', 'vendedor') then
    raise exception 'Pedido no encontrado' using errcode = 'P0001';
  end if;
  if p_estado = 'en_camino' then
    if v.tipo <> 'domicilio' then raise exception 'Solo un domicilio sale «en camino»' using errcode = 'P0001'; end if;
    if v.estado <> 'abierto' then raise exception 'Este domicilio no está abierto (está %)', replace(v.estado, '_', ' ') using errcode = 'P0001'; end if;
  elsif p_estado = 'abierto' then
    -- El domiciliario volvió sin entregar: el pedido se puede corregir o cancelar.
    if v.estado <> 'en_camino' then raise exception 'Solo un domicilio en camino vuelve a quedar abierto' using errcode = 'P0001'; end if;
  elsif p_estado = 'cancelado' then
    if v.estado not in ('abierto', 'en_camino', 'vencido') then raise exception 'Este pedido ya no se puede cancelar (está %)', replace(v.estado, '_', ' ') using errcode = 'P0001'; end if;
    if v_motivo is null or length(v_motivo) < 3 then raise exception 'Escribe el motivo de la cancelación' using errcode = 'P0001'; end if;
    if length(v_motivo) > 200 then raise exception 'El motivo es demasiado largo (máximo 200 caracteres)' using errcode = 'P0001'; end if;
  else
    raise exception 'Estado no válido' using errcode = 'P0001';
  end if;
  update pedidos_mostrador set estado = p_estado, motivo = case when p_estado = 'cancelado' then v_motivo else motivo end, actualizado = now()
  where id = p_pedido;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v.empresa_id, auth.uid(), 'pedido_' || p_estado, 'pedidos_mostrador', p_pedido::text,
          jsonb_build_object('tipo', v.tipo, 'numero', v.numero, 'antes', v.estado, 'motivo', case when p_estado = 'cancelado' then v_motivo end));
  return jsonb_build_object('id', p_pedido, 'estado', p_estado);
end $$;

-- ───────────── Cotizaciones vencidas ─────────────
-- Las cotizaciones abiertas cuya validez pasó quedan «vencidas» (se pueden convertir igual: se cobra al precio de hoy).
create or replace function vencer_cotizaciones(p_empresa uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if rol_en(p_empresa) is null then return 0; end if;
  update pedidos_mostrador set estado = 'vencido', actualizado = now()
  where empresa_id = p_empresa and tipo = 'cotizacion' and estado = 'abierto' and vence < current_date;
  get diagnostics n = row_count;
  return n;
end $$;

-- ───────────── Cobrar: enlaza la venta recién registrada ─────────────
-- Va en la misma transacción que registrar_venta, con la venta que esta acaba de crear. Un reintento de la misma venta
-- (misma clave de idempotencia) devuelve el mismo resultado; otra venta sobre un pedido ya cobrado falla y la
-- transacción entera se deshace (no queda una segunda venta).
create or replace function cobrar_pedido(p_pedido uuid, p_venta uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v pedidos_mostrador; ve ventas;
begin
  select * into v from pedidos_mostrador where id = p_pedido for update;
  if not found or rol_en(v.empresa_id) is null then raise exception 'Pedido no encontrado' using errcode = 'P0001'; end if;
  if coalesce(rol_en(v.empresa_id), '') not in ('dueno', 'admin', 'cajero') then
    raise exception 'Tu usuario no puede cobrar' using errcode = '42501';
  end if;
  select * into ve from ventas where id = p_venta and empresa_id = v.empresa_id;
  if not found then raise exception 'Venta no válida' using errcode = 'P0001'; end if;
  if v.estado = 'cobrado' then
    if v.venta_id = p_venta then return jsonb_build_object('id', v.id, 'estado', 'cobrado', 'repetido', true); end if;
    raise exception 'Este pedido ya se cobró en otra venta' using errcode = 'P0001';
  end if;
  if v.estado = 'cancelado' then raise exception 'Este pedido está cancelado: no se puede cobrar' using errcode = 'P0001'; end if;
  -- Solo la venta de esta misma transacción y de este mismo usuario (no se enlaza una venta vieja ni ajena).
  if ve.creado <> now() or ve.usuario_id is distinct from auth.uid() then
    raise exception 'El pedido se cobra con su propia venta' using errcode = 'P0001';
  end if;
  update pedidos_mostrador set estado = 'cobrado', venta_id = p_venta, actualizado = now() where id = p_pedido;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v.empresa_id, auth.uid(), 'pedido_cobrado', 'pedidos_mostrador', p_pedido::text,
          jsonb_build_object('tipo', v.tipo, 'numero', v.numero, 'venta', ve.prefijo || ve.numero, 'total', ve.total));
  return jsonb_build_object('id', v.id, 'estado', 'cobrado', 'repetido', false);
end $$;

-- ───────────────────────── Seguridad ─────────────────────────
alter table pedidos_mostrador enable row level security;
alter table pedido_lineas enable row level security;
create policy miembros_leen on pedidos_mostrador for select to authenticated using (empresa_id in (select mis_empresas()));
create policy miembros_leen on pedido_lineas for select to authenticated using (empresa_id in (select mis_empresas()));
revoke all on pedidos_mostrador, pedido_lineas from public, anon, authenticated;
grant select on pedidos_mostrador, pedido_lineas to authenticated;

revoke execute on function guardar_pedido(jsonb), cambiar_estado_pedido(uuid, text, text), vencer_cotizaciones(uuid), cobrar_pedido(uuid, uuid) from public, anon;
grant execute on function guardar_pedido(jsonb), cambiar_estado_pedido(uuid, text, text), vencer_cotizaciones(uuid), cobrar_pedido(uuid, uuid) to authenticated;
