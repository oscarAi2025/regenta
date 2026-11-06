-- Regenta · precios masivos, códigos alternos, etiquetas y cuarentena (Bloque 3-C). 06/11/2026.
-- Reglas:
--   · Un producto puede tener varios códigos de barras (el del fabricante, el de otra presentación, uno interno): la caja,
--     la búsqueda, la caja sin internet y la importación lo encuentran por cualquiera. Un código es único en la droguería
--     y no puede ser el código principal (ean) de otro producto.
--   · Un cambio masivo de precios es un documento: se calcula en la base (la vista previa usa la MISMA función que lo
--     aplica), guarda el antes y el después de cada producto, queda en la auditoría (trigger de productos) y se puede
--     revertir mientras esos precios no hayan cambiado después.
--   · Margen = (precio sin IVA − costo) ÷ precio sin IVA, como en el resto de Regenta. El costo es el último costo SIN IVA:
--     el de la última compra registrada (031) o, si no hay, el del lote más reciente. Los costos «heredados» (anteriores a
--     la 031: no se sabe si llevaban IVA) se advierten.
--   · Un lote separado no se vende ni cuenta como existencia vendible (lotes.bloqueado, igual que desde la 010). Ahora el
--     bloqueo dice por qué: alerta del INVIMA, cuarentena (la puso alguien con un motivo) o devolución de un cliente que
--     se revisa antes de volver a la estantería. La cuarentena se libera o se da de baja (con acta); el bloqueo por INVIMA
--     no se libera desde la cuarentena.

-- ───────────────────────── 1 · Códigos alternos ─────────────────────────
create table if not exists producto_codigos (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  producto_id uuid not null references productos on delete cascade,
  codigo text not null check (codigo ~ '^[0-9A-Z.-]{3,40}$'),
  usuario_id uuid,
  creado timestamptz not null default now(),
  unique (empresa_id, codigo)
);
create index if not exists producto_codigos_producto on producto_codigos (producto_id);

alter table producto_codigos enable row level security;
drop policy if exists miembros_leen on producto_codigos;
create policy miembros_leen on producto_codigos for select to authenticated using (empresa_id in (select mis_empresas()));
grant select on producto_codigos to authenticated;

-- Código como se guarda: sin espacios y en mayúsculas.
create or replace function normalizar_codigo(t text) returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(t, ''), '\s', '', 'g'))
$$;

create or replace function agregar_codigo_producto(p_producto uuid, p_codigo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p productos; v_cod text := normalizar_codigo(p_codigo); v_otro text; v_id bigint;
begin
  select * into p from productos where id = p_producto;
  if not found or coalesce(rol_en(p.empresa_id), '') not in ('dueno', 'admin', 'bodeguero') then
    raise exception 'Solo el dueño, el administrador o la bodega agregan códigos a un producto' using errcode = '42501';
  end if;
  if v_cod !~ '^[0-9A-Z.-]{3,40}$' then
    raise exception 'El código debe tener entre 3 y 40 letras o números (sin espacios)' using errcode = 'P0001';
  end if;
  if normalizar_codigo(p.ean) = v_cod then
    raise exception 'Ese ya es el código de barras principal de este producto' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('codigo:' || p.empresa_id::text || ':' || v_cod));
  select o.nombre into v_otro from productos o where o.empresa_id = p.empresa_id and o.activo and o.id <> p.id and normalizar_codigo(o.ean) = v_cod limit 1;
  if found then raise exception 'El código % ya es el código de barras de «%»', v_cod, v_otro using errcode = '23505'; end if;
  select o.nombre into v_otro from producto_codigos pc join productos o on o.id = pc.producto_id where pc.empresa_id = p.empresa_id and pc.codigo = v_cod;
  if found then
    raise exception '%', case when v_otro = p.nombre then 'Este producto ya tiene el código ' || v_cod else 'El código ' || v_cod || ' ya está asignado a «' || v_otro || '»' end using errcode = '23505';
  end if;
  insert into producto_codigos (empresa_id, producto_id, codigo, usuario_id) values (p.empresa_id, p.id, v_cod, auth.uid()) returning id into v_id;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (p.empresa_id, auth.uid(), 'codigo_alterno_agregar', 'productos', p.id::text, jsonb_build_object('codigo', v_cod));
  return jsonb_build_object('id', v_id, 'codigo', v_cod);
end $$;

create or replace function quitar_codigo_producto(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare pc producto_codigos;
begin
  select * into pc from producto_codigos where id = p_id for update;
  if not found or coalesce(rol_en(pc.empresa_id), '') not in ('dueno', 'admin', 'bodeguero') then
    raise exception 'Solo el dueño, el administrador o la bodega quitan códigos de un producto' using errcode = '42501';
  end if;
  delete from producto_codigos where id = p_id;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (pc.empresa_id, auth.uid(), 'codigo_alterno_quitar', 'productos', pc.producto_id::text, jsonb_build_object('codigo', pc.codigo));
end $$;

-- El código principal de un producto tampoco puede ser el código alterno de otro (al crear, editar o importar).
create or replace function productos_ean_sin_choque() returns trigger language plpgsql security definer set search_path = public as $$
declare v_otro text;
begin
  if new.ean is null or (tg_op = 'UPDATE' and new.ean is not distinct from old.ean) then return new; end if;
  select o.nombre into v_otro from producto_codigos pc join productos o on o.id = pc.producto_id
  where pc.empresa_id = new.empresa_id and pc.codigo = normalizar_codigo(new.ean) and pc.producto_id <> new.id;
  if found then
    raise exception 'El código de barras % ya es un código alterno de «%»', new.ean, v_otro using errcode = '23505';
  end if;
  return new;
end $$;
drop trigger if exists productos_ean_sin_choque on productos;
create trigger productos_ean_sin_choque before insert or update of ean on productos for each row execute function productos_ean_sin_choque();

-- ───────────────────────── 2 · Cambios masivos de precio ─────────────────────────
create table if not exists cambios_precio (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  numero integer not null check (numero > 0),
  filtro jsonb not null,                                   -- { tipo, valor }
  regla jsonb not null,                                    -- { tipo: 'porcentaje' | 'margen', valor }
  redondeo integer not null check (redondeo in (50, 100)),
  descripcion text not null check (length(descripcion) <= 300),
  productos integer not null check (productos > 0),
  idem_key text check (idem_key is null or length(idem_key) <= 80),
  usuario_id uuid,
  creado timestamptz not null default now(),
  revertido timestamptz,
  revertido_por uuid,
  revertidos integer check (revertidos is null or revertidos > 0),
  unique (empresa_id, numero),
  unique (empresa_id, idem_key),
  check ((revertido is null) = (revertidos is null))
);
create index if not exists cambios_precio_empresa on cambios_precio (empresa_id, creado desc);

create table if not exists cambio_precio_lineas (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  cambio_id uuid not null references cambios_precio on delete cascade,
  producto_id uuid not null references productos on delete cascade,
  caja_antes numeric(14, 2) not null,
  unidad_antes numeric(14, 2),
  caja_despues numeric(14, 2) not null,
  unidad_despues numeric(14, 2),
  costo_unidad numeric(18, 6),          -- costo sin IVA por unidad que se usó (o se mostró) al calcular
  costo_heredado boolean not null default false,
  revertida boolean not null default false
);
create index if not exists cambio_precio_lineas_cambio on cambio_precio_lineas (cambio_id);
create index if not exists cambio_precio_lineas_producto on cambio_precio_lineas (producto_id);

-- Un cambio solo se marca como revertido (una vez); sus líneas solo pasan a «revertida». Nada se borra, salvo al eliminar
-- una droguería de prueba desde la consola (misma excepción que no_modificar).
create or replace function cambio_precio_proteger() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if current_user not in ('authenticated', 'anon') and current_setting('regenta.eliminar_empresa', true) = old.empresa_id::text then return old; end if;
    raise exception 'Los cambios de precio no se borran: se revierten' using errcode = 'P0001';
  end if;
  if tg_table_name = 'cambios_precio' then
    if (to_jsonb(new) - 'revertido' - 'revertido_por' - 'revertidos') <> (to_jsonb(old) - 'revertido' - 'revertido_por' - 'revertidos')
       or old.revertido is not null or new.revertido is null then
      raise exception 'Un cambio de precios solo puede revertirse' using errcode = 'P0001';
    end if;
  elsif (to_jsonb(new) - 'revertida') <> (to_jsonb(old) - 'revertida') or old.revertida or not new.revertida then
    raise exception 'Una línea de un cambio de precios solo puede revertirse' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists cambios_precio_proteger on cambios_precio;
create trigger cambios_precio_proteger before update or delete on cambios_precio for each row execute function cambio_precio_proteger();
drop trigger if exists cambio_precio_lineas_proteger on cambio_precio_lineas;
create trigger cambio_precio_lineas_proteger before update or delete on cambio_precio_lineas for each row execute function cambio_precio_proteger();

alter table cambios_precio enable row level security;
alter table cambio_precio_lineas enable row level security;
drop policy if exists gerencia_lee on cambios_precio;
drop policy if exists gerencia_lee on cambio_precio_lineas;
create policy gerencia_lee on cambios_precio for select to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin'])));
create policy gerencia_lee on cambio_precio_lineas for select to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin'])));
grant select on cambios_precio, cambio_precio_lineas to authenticated;

-- Último costo SIN IVA por unidad de un producto: el de la última compra registrada; si no hay, el del lote más reciente
-- con costo (heredado = costo anterior a la 031, no se sabe si incluye IVA). Uso interno.
create or replace function ultimo_costo(p_producto uuid, out costo numeric, out heredado boolean, out origen text)
language plpgsql stable set search_path = public as $$
begin
  select cl.costo_lote, false, 'compra' into costo, heredado, origen
  from compra_lineas cl join compras c on c.id = cl.compra_id
  where cl.producto_id = p_producto and c.estado = 'registrada' and cl.costo_lote is not null
  order by coalesce(c.costeada, c.creado) desc, cl.id desc limit 1;
  if found then return; end if;
  select lc.costo_unidad, lc.heredado, 'lote' into costo, heredado, origen
  from lote_costos lc join lotes l on l.id = lc.lote_id
  where l.producto_id = p_producto
  order by coalesce(lc.actualizado, l.creado) desc, l.creado desc limit 1;
end $$;

-- Texto de un porcentaje con coma decimal («5», «2,5»).
create or replace function pct_texto(v numeric) returns text language sql immutable as $$
  select replace(trim(trailing '.' from trim(trailing '0' from to_char(abs(v), 'FM999990.00'))), '.', ',')
$$;

-- Calcula un cambio masivo (uso interno: lo usa aplicar_cambio_precios para la vista previa y para aplicar).
-- Una fila por producto activo del filtro; «aplica» = cambia el precio. «omitido» dice por qué no cambia.
create or replace function calcular_cambio_precios(p_emp uuid, p_filtro jsonb, p_regla jsonb, p_redondeo integer, p_excluir uuid[])
returns table (producto_id uuid, nombre text, laboratorio text, iva numeric, upc integer, caja_antes numeric, unidad_antes numeric,
  caja_despues numeric, unidad_despues numeric, costo numeric, heredado boolean, margen_antes numeric, margen_despues numeric,
  omitido text, aplica boolean)
language plpgsql stable set search_path = public as $$
declare
  v_tipo text := p_filtro ->> 'tipo'; v_val text := p_filtro ->> 'valor';
  v_regla text := p_regla ->> 'tipo'; v_x numeric := (p_regla ->> 'valor')::numeric; r numeric := p_redondeo;
  v_ids uuid[];
begin
  if v_tipo = 'productos' then
    select coalesce(array_agg(e::uuid), '{}') into v_ids from jsonb_array_elements_text(coalesce(p_filtro -> 'valor', '[]')) e;
  end if;
  return query
  with base as (
    select p.id, p.nombre, p.laboratorio, p.iva, p.unidades_por_caja upc, p.precio_caja ca, p.precio_unidad ua, uc.costo, coalesce(uc.heredado, false) heredado
    from productos p
    left join lateral ultimo_costo(p.id) uc on true
    where p.empresa_id = p_emp and p.activo
      and not (p.id = any (coalesce(p_excluir, '{}')))
      and case v_tipo
        when 'laboratorio' then lower(trim(p.laboratorio)) = lower(trim(v_val))
        when 'categoria' then lower(trim(p.categoria)) = lower(trim(v_val))
        when 'iva' then p.iva = v_val::numeric
        when 'proveedor' then p.id in (select cl.producto_id from compra_lineas cl join compras c on c.id = cl.compra_id
                                       where c.empresa_id = p_emp and c.proveedor_id = v_val::uuid and c.estado <> 'anulada')
        when 'productos' then p.id = any (v_ids)
        else false end
  ), bruto as (
    select b.*,
      case when v_regla = 'porcentaje' then case when b.ca > 0 then b.ca * (1 + v_x / 100) end
           when b.costo is not null and b.costo > 0 then b.costo * b.upc / (1 - v_x / 100) * (1 + b.iva / 100) end cb
    from base b
  ), nuevo as (
    select x.*,
      case when x.cb is not null then ceil(x.cb / r) * r end cn,
      case when x.cb is null or x.ua is null then null
           when x.ca > 0 then least(ceil(x.ua * x.cb / x.ca / r) * r, ceil(x.cb / r) * r)
           else least(ceil(x.cb / x.upc / r) * r, ceil(x.cb / r) * r) end un
    from bruto x
  )
  select n.id, n.nombre, n.laboratorio, n.iva, n.upc, n.ca, n.ua,
         coalesce(n.cn, n.ca), case when n.cn is null then n.ua else n.un end,
         round(n.costo, 4), n.heredado,
         case when n.costo is not null and n.ca > 0 then round((n.ca / (1 + n.iva / 100) - n.costo * n.upc) / (n.ca / (1 + n.iva / 100)) * 100, 1) end,
         case when n.costo is not null and coalesce(n.cn, n.ca) > 0 then round((coalesce(n.cn, n.ca) / (1 + n.iva / 100) - n.costo * n.upc) / (coalesce(n.cn, n.ca) / (1 + n.iva / 100)) * 100, 1) end,
         case when n.cn is null and v_regla = 'margen' then 'Sin costo registrado'
              when n.cn is null then 'Sin precio de venta'
              when n.cn = n.ca and n.un is not distinct from n.ua then 'Queda igual' end,
         n.cn is not null and (n.cn <> n.ca or n.un is distinct from n.ua)
  from nuevo n
  order by n.nombre, n.id;
end $$;

-- p = { empresa_id, filtro: { tipo: 'laboratorio'|'categoria'|'proveedor'|'iva'|'productos', valor }, regla: { tipo: 'porcentaje'|'margen', valor },
--       redondeo: 50|100, excluir?: [uuid], simular: bool, firma?: text (la de la vista previa), idem_key? }
-- simular = true → { lineas, resumen, firma, descripcion } sin escribir nada. simular = false → aplica si la firma coincide.
create or replace function aplicar_cambio_precios(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := (p ->> 'empresa_id')::uuid; v_filtro jsonb := p -> 'filtro'; v_regla jsonb := p -> 'regla';
  v_tipo text := p -> 'filtro' ->> 'tipo'; v_val text := p -> 'filtro' ->> 'valor';
  v_rtipo text := p -> 'regla' ->> 'tipo'; v_x numeric; v_red integer; v_excluir uuid[];
  v_desc text; v_ftexto text; v_firma text; v_lineas jsonb; v_resumen jsonb; v_n integer; v_upd integer; v_id uuid := gen_random_uuid(); v_num integer;
  v_ya cambios_precio;
begin
  if coalesce(rol_en(v_emp), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador cambian precios' using errcode = '42501';
  end if;
  begin v_x := (v_regla ->> 'valor')::numeric; v_red := (p ->> 'redondeo')::integer;
  exception when others then raise exception 'Revisa la regla del cambio de precios' using errcode = 'P0001'; end;
  if v_rtipo = 'porcentaje' then
    if v_x is null or v_x = 0 or v_x < -90 or v_x > 300 or v_x <> round(v_x, 2) then
      raise exception 'El porcentaje debe estar entre −90 %% y +300 %% (distinto de cero)' using errcode = 'P0001';
    end if;
  elsif v_rtipo = 'margen' then
    if v_x is null or v_x < 1 or v_x > 90 or v_x <> round(v_x, 2) then
      raise exception 'El margen objetivo debe estar entre 1 %% y 90 %%' using errcode = 'P0001';
    end if;
  else raise exception 'Elige la regla: subir o bajar un porcentaje, o un margen objetivo' using errcode = 'P0001';
  end if;
  if v_red is null or v_red not in (50, 100) then raise exception 'El redondeo debe ser a $50 o a $100' using errcode = 'P0001'; end if;
  begin
    select coalesce(array_agg(e::uuid), '{}') into v_excluir from jsonb_array_elements_text(coalesce(p -> 'excluir', '[]')) e;
  exception when others then raise exception 'Hay un producto excluido no válido' using errcode = 'P0001'; end;

  -- Filtro y su texto
  if v_tipo = 'laboratorio' or v_tipo = 'categoria' then
    if length(trim(coalesce(v_val, ''))) = 0 or length(v_val) > 120 then raise exception 'Elige %', case v_tipo when 'laboratorio' then 'el laboratorio' else 'la categoría' end using errcode = 'P0001'; end if;
    v_ftexto := case v_tipo when 'laboratorio' then 'Laboratorio ' else 'Categoría ' end || '«' || trim(v_val) || '»';
  elsif v_tipo = 'proveedor' then
    if v_val !~* '^[0-9a-f-]{36}$' then raise exception 'Elige el proveedor' using errcode = 'P0001'; end if;
    select 'Proveedor «' || nombre || '»' into v_ftexto from proveedores where id = v_val::uuid and empresa_id = v_emp;
    if not found then raise exception 'Proveedor no válido' using errcode = 'P0001'; end if;
  elsif v_tipo = 'iva' then
    if coalesce(v_val, '') not in ('0', '5', '19') then raise exception 'El IVA debe ser 0, 5 o 19 %%' using errcode = 'P0001'; end if;
    v_ftexto := 'IVA ' || v_val || ' %';
  elsif v_tipo = 'productos' then
    if jsonb_typeof(v_filtro -> 'valor') <> 'array' or jsonb_array_length(v_filtro -> 'valor') = 0 then raise exception 'Elige los productos' using errcode = 'P0001'; end if;
    if jsonb_array_length(v_filtro -> 'valor') > 2000 then raise exception 'Máximo 2.000 productos por cambio' using errcode = 'P0001'; end if;
    if exists (select 1 from jsonb_array_elements_text(v_filtro -> 'valor') e where e !~* '^[0-9a-f-]{36}$') then raise exception 'Hay un producto no válido en la lista' using errcode = 'P0001'; end if;
    v_ftexto := jsonb_array_length(v_filtro -> 'valor') || ' producto' || case when jsonb_array_length(v_filtro -> 'valor') = 1 then '' else 's' end || ' elegido' || case when jsonb_array_length(v_filtro -> 'valor') = 1 then '' else 's' end;
  else raise exception 'Elige a qué productos aplicar el cambio' using errcode = 'P0001';
  end if;
  v_desc := v_ftexto || ' · ' || case when v_rtipo = 'porcentaje' then case when v_x > 0 then '+' else '−' end || pct_texto(v_x) || ' %'
                                      else 'margen ' || pct_texto(v_x) || ' % sobre el último costo sin IVA' end || ' · redondeo a $' || v_red;

  -- Un cambio masivo a la vez por droguería; la misma petición dos veces devuelve el mismo cambio.
  perform pg_advisory_xact_lock(hashtext('precios:' || v_emp::text));
  if not coalesce((p ->> 'simular')::boolean, true) and (p ->> 'idem_key') is not null then
    select * into v_ya from cambios_precio where empresa_id = v_emp and idem_key = p ->> 'idem_key';
    if found then return jsonb_build_object('id', v_ya.id, 'numero', v_ya.numero, 'productos', v_ya.productos, 'repetido', true); end if;
  end if;

  if to_regclass('pg_temp._cambio_calc') is null then
    create temporary table _cambio_calc on commit drop as select * from calcular_cambio_precios(v_emp, v_filtro, v_regla, v_red, v_excluir) limit 0;
  else
    truncate _cambio_calc;
  end if;
  insert into _cambio_calc select * from calcular_cambio_precios(v_emp, v_filtro, v_regla, v_red, v_excluir);
  select count(*) filter (where aplica) into v_n from _cambio_calc;
  select md5(coalesce(string_agg(c.producto_id || ':' || c.caja_antes || ':' || coalesce(c.unidad_antes::text, '-') || ':' || c.caja_despues || ':' || coalesce(c.unidad_despues::text, '-'), ',' order by c.producto_id), ''))
    into v_firma from _cambio_calc c where c.aplica;

  if coalesce((p ->> 'simular')::boolean, true) then
    select coalesce(jsonb_agg(jsonb_build_object('producto_id', c.producto_id, 'nombre', c.nombre, 'laboratorio', c.laboratorio, 'iva', c.iva, 'upc', c.upc,
             'caja_antes', c.caja_antes, 'unidad_antes', c.unidad_antes, 'caja_despues', c.caja_despues, 'unidad_despues', c.unidad_despues,
             'costo', c.costo, 'heredado', c.heredado, 'margen_antes', c.margen_antes, 'margen_despues', c.margen_despues, 'omitido', c.omitido, 'aplica', c.aplica)
             order by c.aplica desc, c.nombre), '[]')
      into v_lineas from (select * from _cambio_calc order by aplica desc, nombre limit 3000) c;
    select jsonb_build_object('productos', count(*), 'cambian', count(*) filter (where aplica),
        'suben', count(*) filter (where aplica and caja_despues > caja_antes), 'bajan', count(*) filter (where aplica and caja_despues < caja_antes),
        'sin_costo', count(*) filter (where omitido = 'Sin costo registrado'), 'heredados', count(*) filter (where aplica and heredado),
        'margen_antes', round(avg(margen_antes) filter (where aplica), 1), 'margen_despues', round(avg(margen_despues) filter (where aplica), 1))
      into v_resumen from _cambio_calc;
    return jsonb_build_object('lineas', v_lineas, 'resumen', v_resumen, 'firma', v_firma, 'descripcion', v_desc);
  end if;

  if v_n = 0 then raise exception 'Ningún producto cambia de precio con esta regla' using errcode = 'P0001'; end if;
  if coalesce(p ->> 'firma', '') <> v_firma then
    raise exception 'Los precios o los costos cambiaron desde la vista previa: vuelve a calcularla antes de aplicar' using errcode = 'P0001';
  end if;

  -- Se aplica solo si cada precio sigue igual que en el cálculo (el trigger de productos deja cada cambio en la auditoría).
  update productos p2 set precio_caja = c.caja_despues, precio_unidad = c.unidad_despues
  from _cambio_calc c
  where c.aplica and p2.id = c.producto_id and p2.empresa_id = v_emp and p2.precio_caja = c.caja_antes and p2.precio_unidad is not distinct from c.unidad_antes;
  get diagnostics v_upd = row_count;
  if v_upd <> v_n then
    raise exception 'Otro usuario cambió precios de estos productos mientras tanto: vuelve a calcular la vista previa' using errcode = 'P0001';
  end if;

  select coalesce(max(numero), 0) + 1 into v_num from cambios_precio where empresa_id = v_emp;
  insert into cambios_precio (id, empresa_id, numero, filtro, regla, redondeo, descripcion, productos, idem_key, usuario_id)
  values (v_id, v_emp, v_num, v_filtro, jsonb_build_object('tipo', v_rtipo, 'valor', v_x), v_red, v_desc, v_n, nullif(p ->> 'idem_key', ''), auth.uid());
  insert into cambio_precio_lineas (empresa_id, cambio_id, producto_id, caja_antes, unidad_antes, caja_despues, unidad_despues, costo_unidad, costo_heredado)
  select v_emp, v_id, c.producto_id, c.caja_antes, c.unidad_antes, c.caja_despues, c.unidad_despues, c.costo, c.heredado from _cambio_calc c where c.aplica;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v_emp, auth.uid(), 'cambio_precios_masivo', 'cambios_precio', v_id::text, jsonb_build_object('numero', v_num, 'descripcion', v_desc, 'productos', v_n));
  return jsonb_build_object('id', v_id, 'numero', v_num, 'productos', v_n, 'repetido', false);
end $$;

-- Revertir: vuelve cada producto a su precio de antes, solo si su precio sigue siendo el que dejó este cambio. Si alguno
-- cambió después, sin p_parcial no toca nada y devuelve cuáles; con p_parcial revierte los demás.
create or replace function revertir_cambio_precios(p_cambio uuid, p_parcial boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k cambios_precio; v_conf jsonb; v_n integer;
begin
  select * into k from cambios_precio where id = p_cambio for update;
  if not found or coalesce(rol_en(k.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador revierten cambios de precio' using errcode = '42501';
  end if;
  if k.revertido is not null then raise exception 'Este cambio de precios ya se revirtió' using errcode = 'P0001'; end if;
  perform 1 from productos where id in (select producto_id from cambio_precio_lineas where cambio_id = k.id) order by id for update;
  select coalesce(jsonb_agg(jsonb_build_object('producto_id', p.id, 'nombre', p.nombre, 'caja_hoy', p.precio_caja, 'unidad_hoy', p.precio_unidad,
           'caja_despues', l.caja_despues, 'unidad_despues', l.unidad_despues) order by p.nombre), '[]')
    into v_conf
  from cambio_precio_lineas l join productos p on p.id = l.producto_id
  where l.cambio_id = k.id and (p.precio_caja <> l.caja_despues or p.precio_unidad is distinct from l.unidad_despues);
  if jsonb_array_length(v_conf) > 0 and not coalesce(p_parcial, false) then
    return jsonb_build_object('revertido', false, 'conflictos', v_conf);
  end if;
  with vueltos as (
    update productos p set precio_caja = l.caja_antes, precio_unidad = l.unidad_antes
    from cambio_precio_lineas l
    where l.cambio_id = k.id and p.id = l.producto_id and p.precio_caja = l.caja_despues and p.precio_unidad is not distinct from l.unidad_despues
    returning p.id
  )
  update cambio_precio_lineas l set revertida = true from vueltos u where l.cambio_id = k.id and l.producto_id = u.id;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Ningún producto se puede revertir: todos cambiaron de precio después de este cambio' using errcode = 'P0001'; end if;
  update cambios_precio set revertido = now(), revertido_por = auth.uid(), revertidos = v_n where id = k.id;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (k.empresa_id, auth.uid(), 'revertir_cambio_precios', 'cambios_precio', k.id::text,
          jsonb_build_object('numero', k.numero, 'revertidos', v_n, 'sin_revertir', jsonb_array_length(v_conf)));
  return jsonb_build_object('revertido', true, 'revertidos', v_n, 'conflictos', v_conf);
end $$;

-- ───────────────────────── 3 · Lotes separados: INVIMA, cuarentena y devolución ─────────────────────────
alter table lotes add column if not exists bloqueo_tipo text check (bloqueo_tipo in ('invima', 'cuarentena', 'devolucion'));
alter table lotes add column if not exists bloqueo_desde timestamptz;
-- Los lotes que ya estaban bloqueados solo pudieron serlo por una alerta del INVIMA (010): se marcan así (pocas filas;
-- no vuelve a marcar nada si la migración se repite).
update lotes set bloqueo_tipo = 'invima' where bloqueado and bloqueo_tipo is null;

-- Coherencia del bloqueo: bloquear sin decir por qué es INVIMA (así lo hacía la 010); al desbloquear se limpia todo; la
-- fecha se pone al bloquear o al cambiar de tipo.
create or replace function lotes_bloqueo() returns trigger language plpgsql as $$
begin
  if new.bloqueado then
    new.bloqueo_tipo := coalesce(new.bloqueo_tipo, 'invima');
    if (not old.bloqueado or new.bloqueo_tipo is distinct from old.bloqueo_tipo) and new.bloqueo_desde is not distinct from old.bloqueo_desde then
      new.bloqueo_desde := now();
    end if;
  else
    new.bloqueo_tipo := null; new.bloqueo_desde := null; new.bloqueo_motivo := null;
  end if;
  return new;
end $$;
drop trigger if exists lotes_bloqueo on lotes;
create trigger lotes_bloqueo before update of bloqueado, bloqueo_tipo, bloqueo_desde, bloqueo_motivo on lotes for each row execute function lotes_bloqueo();
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'lotes_bloqueo_coherente') then
    alter table lotes add constraint lotes_bloqueo_coherente check ((bloqueo_tipo is not null) = bloqueado);
  end if;
end $$;
create index if not exists lotes_bloqueados on lotes (empresa_id) where bloqueado;

-- «Separé el producto» en una alerta (desde la 010): ahora dice que el bloqueo es del INVIMA, también si el lote estaba en
-- cuarentena (la alerta manda: ya no se libera desde la cuarentena).
create or replace function bloquear_por_alerta() returns trigger language plpgsql security definer set search_path = public as $$
declare a alertas_invima;
begin
  if new.resultado <> 'separado' or new.producto_id is null then return new; end if;
  select * into a from alertas_invima where id = new.alerta_id;
  update lotes set bloqueado = true, bloqueo_tipo = 'invima', bloqueo_motivo = 'Alerta INVIMA ' || a.numero
  where producto_id = new.producto_id and empresa_id = new.empresa_id
    and (cardinality(a.lotes) = 0 or upper(lote) = any(a.lotes));
  return new;
end $$;

-- La venta (registrar_venta, última versión) decía «separados por una alerta del INVIMA» para todo lote bloqueado. Se
-- corrige solo ese texto sobre la versión vigente, sin copiar la función (así no se pisa ningún otro cambio).
do $$
declare d text; viejo text := 'hay lotes separados por una alerta del INVIMA'; nuevo text := 'hay lotes separados: alerta del INVIMA o cuarentena';
begin
  select pg_get_functiondef('registrar_venta(jsonb)'::regprocedure) into d;
  if position(viejo in d) > 0 then execute replace(d, viejo, nuevo);
  else raise notice 'registrar_venta no trae el texto del bloqueo INVIMA: no se cambió';
  end if;
end $$;

-- Destino por defecto de lo que devuelve un cliente (lo configura la droguería).
alter table empresas add column if not exists devolucion_destino text not null default 'vendible' check (devolucion_destino in ('vendible', 'cuarentena'));
alter table devoluciones add column if not exists destino text not null default 'vendible' check (destino in ('vendible', 'cuarentena'));

create or replace function configurar_devoluciones(p_empresa uuid, p_destino text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(rol_en(p_empresa), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador cambian esta configuración' using errcode = '42501';
  end if;
  if (select demo from empresas where id = p_empresa) then
    raise exception 'En la demostración esta configuración no se cambia' using errcode = 'P0001';
  end if;
  if coalesce(p_destino, '') not in ('vendible', 'cuarentena') then
    raise exception 'Elige a dónde van las devoluciones: a la venta o a cuarentena' using errcode = 'P0001';
  end if;
  update empresas set devolucion_destino = p_destino where id = p_empresa;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (p_empresa, auth.uid(), 'configurar_devoluciones', 'empresas', p_empresa::text, jsonb_build_object('destino', p_destino));
end $$;

create or replace function poner_cuarentena(p_lote uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l lotes; v_motivo text := trim(coalesce(p_motivo, '')); v_u integer;
begin
  select * into l from lotes where id = p_lote;
  if not found or coalesce(rol_en(l.empresa_id), '') not in ('dueno', 'admin', 'bodeguero') then
    raise exception 'Solo el dueño, el administrador o la bodega ponen lotes en cuarentena' using errcode = '42501';
  end if;
  if length(v_motivo) < 4 or length(v_motivo) > 200 then raise exception 'Escribe por qué se separa el lote (entre 4 y 200 caracteres)' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext(l.producto_id::text));  -- igual que la venta: no se cruza con una venta del mismo producto
  select * into l from lotes where id = p_lote for update;
  if l.bloqueado then
    raise exception 'El lote % ya está separado (%)', l.lote, case l.bloqueo_tipo when 'invima' then 'alerta del INVIMA' when 'devolucion' then 'devolución en revisión' else 'cuarentena' end using errcode = 'P0001';
  end if;
  select unidades into v_u from v_stock_lotes where lote_id = l.id;
  if coalesce(v_u, 0) <= 0 then raise exception 'El lote % no tiene existencias', l.lote using errcode = 'P0001'; end if;
  update lotes set bloqueado = true, bloqueo_tipo = 'cuarentena', bloqueo_motivo = v_motivo where id = l.id;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (l.empresa_id, auth.uid(), 'cuarentena_poner', 'lotes', l.id::text, jsonb_build_object('lote', l.lote, 'producto', l.producto_id, 'unidades', v_u, 'motivo', v_motivo));
  return jsonb_build_object('lote_id', l.id, 'unidades', v_u);
end $$;

create or replace function liberar_cuarentena(p_lote uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l lotes; v_motivo text := trim(coalesce(p_motivo, '')); v_u integer;
begin
  select * into l from lotes where id = p_lote for update;
  if not found or coalesce(rol_en(l.empresa_id), '') not in ('dueno', 'admin', 'bodeguero') then
    raise exception 'Solo el dueño, el administrador o la bodega liberan lotes de la cuarentena' using errcode = '42501';
  end if;
  if not l.bloqueado then raise exception 'El lote % no está en cuarentena', l.lote using errcode = 'P0001'; end if;
  if l.bloqueo_tipo = 'invima' then
    raise exception 'El lote % está separado por una alerta del INVIMA: no se libera desde la cuarentena (si no se puede vender, dalo de baja)', l.lote using errcode = 'P0001';
  end if;
  if length(v_motivo) < 4 or length(v_motivo) > 200 then raise exception 'Escribe qué se revisó antes de liberarlo (entre 4 y 200 caracteres)' using errcode = 'P0001'; end if;
  select unidades into v_u from v_stock_lotes where lote_id = l.id;
  update lotes set bloqueado = false where id = l.id;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (l.empresa_id, auth.uid(), 'cuarentena_liberar', 'lotes', l.id::text, jsonb_build_object('lote', l.lote, 'producto', l.producto_id, 'unidades', v_u,
          'tipo', l.bloqueo_tipo, 'motivo_bloqueo', l.bloqueo_motivo, 'desde', l.bloqueo_desde, 'motivo', v_motivo));
  return jsonb_build_object('lote_id', l.id, 'unidades', v_u);
end $$;

-- ───────────── devolver_venta con destino (parte EXACTAMENTE de la versión de la 020, la más reciente) ─────────────
-- p = { venta_id, motivo, medio?, caja_id?, destino?: 'vendible'|'cuarentena', lineas: [{ producto_id, presentacion, cantidad }] }
-- Sin destino se usa el de la droguería. Con «cuarentena», el lote al que vuelven las unidades queda separado (tipo
-- devolución) hasta que alguien lo revise y lo libere o lo dé de baja; si ya estaba separado, sigue como estaba.
create or replace function devolver_venta(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v ventas; d documentos_dian; v_res resoluciones_dian; x jsonb; ln record;
  v_dev uuid := gen_random_uuid(); v_motivo text := trim(coalesce(p ->> 'motivo', ''));
  v_medio text := coalesce(nullif(p ->> 'medio', ''), 'efectivo');
  v_pedido numeric; v_resta numeric; v_q numeric; v_disp numeric; v_und numeric; v_tot numeric; v_base numeric; v_desc numeric;
  v_sum_base numeric := 0; v_sum_iva numeric := 0; v_sum_total numeric := 0; v_abonado numeric; v_saldo numeric; v_a_saldo numeric := 0;
  v_caja uuid; v_destino text; v_lotes uuid[] := '{}';
begin
  select * into v from ventas where id = (p ->> 'venta_id')::uuid for update;
  if not found or coalesce(rol_en(v.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador pueden registrar devoluciones' using errcode = '42501';
  end if;
  if v.estado <> 'cerrada' then raise exception 'La venta está anulada' using errcode = 'P0001'; end if;
  if length(v_motivo) < 4 then raise exception 'Escribe el motivo de la devolución' using errcode = 'P0001'; end if;
  if v_medio not in ('efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'bre_b') then raise exception 'Medio de reembolso no válido' using errcode = 'P0001'; end if;
  v_destino := coalesce(nullif(p ->> 'destino', ''), (select devolucion_destino from empresas where id = v.empresa_id), 'vendible');
  if v_destino not in ('vendible', 'cuarentena') then raise exception 'Elige si lo devuelto vuelve a la venta o va a cuarentena' using errcode = 'P0001'; end if;
  if jsonb_typeof(p -> 'lineas') <> 'array' or jsonb_array_length(p -> 'lineas') = 0 then raise exception 'Elige qué productos devuelve el cliente' using errcode = 'P0001'; end if;
  v_caja := coalesce((select id from cajas where id = nullif(p ->> 'caja_id', '')::uuid and empresa_id = v.empresa_id), v.caja_id);

  insert into devoluciones (id, empresa_id, venta_id, caja_id, motivo, base, iva, total, medio, usuario_id, destino)
  values (v_dev, v.empresa_id, v.id, v_caja, v_motivo, 0, 0, 1, v_medio, auth.uid(), v_destino);

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
      if v_destino = 'cuarentena' then v_lotes := v_lotes || ln.lote_id; end if;
      v_sum_base := v_sum_base + v_base; v_sum_iva := v_sum_iva + (v_tot - v_base); v_sum_total := v_sum_total + v_tot;
      v_resta := v_resta - v_q;
    end loop;
    if v_resta > 0 then raise exception 'Se pide devolver más de lo que queda por devolver de un producto' using errcode = 'P0001'; end if;
  end loop;
  if v_sum_total <= 0 then raise exception 'Elige qué productos devuelve el cliente' using errcode = 'P0001'; end if;

  -- Cuarentena: los lotes a los que volvió la mercancía quedan separados hasta revisarlos (en orden fijo, con el mismo
  -- candado por producto que la venta).
  if cardinality(v_lotes) > 0 then
    perform pg_advisory_xact_lock(hashtext(y)) from (select distinct l.producto_id::text y from lotes l where l.id = any (v_lotes) order by 1) s;
    update lotes set bloqueado = true, bloqueo_tipo = 'devolucion',
           bloqueo_motivo = left('Devolución de ' || v.prefijo || v.numero || ': ' || v_motivo, 300)
    where id = any (v_lotes) and not bloqueado;
  end if;

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
          jsonb_build_object('devolucion', v_dev, 'total', v_sum_total, 'reembolso', v_sum_total - v_a_saldo, 'medio', v_medio, 'motivo', v_motivo, 'destino', v_destino));
  return jsonb_build_object('id', v_dev, 'total', v_sum_total, 'a_saldo', v_a_saldo, 'reembolso', v_sum_total - v_a_saldo, 'medio', v_medio, 'destino', v_destino,
                            'lotes_cuarentena', (select count(distinct u) from unnest(v_lotes) u));
end $$;

-- ───────────────────────── Permisos ─────────────────────────
alter function calcular_cambio_precios(uuid, jsonb, jsonb, integer, uuid[]) set jit = off;
revoke execute on function normalizar_codigo(text), agregar_codigo_producto(uuid, text), quitar_codigo_producto(bigint), productos_ean_sin_choque(),
  cambio_precio_proteger(), ultimo_costo(uuid), pct_texto(numeric), calcular_cambio_precios(uuid, jsonb, jsonb, integer, uuid[]),
  aplicar_cambio_precios(jsonb), revertir_cambio_precios(uuid, boolean), lotes_bloqueo(), configurar_devoluciones(uuid, text),
  poner_cuarentena(uuid, text), liberar_cuarentena(uuid, text), devolver_venta(jsonb) from public, anon;
grant execute on function normalizar_codigo(text), agregar_codigo_producto(uuid, text), quitar_codigo_producto(bigint), aplicar_cambio_precios(jsonb),
  revertir_cambio_precios(uuid, boolean), configurar_devoluciones(uuid, text), poner_cuarentena(uuid, text), liberar_cuarentena(uuid, text),
  devolver_venta(jsonb) to authenticated;
