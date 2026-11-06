-- Regenta · control de inventario: ajustes y bajas con motivo (acta de baja), kardex por producto y conteo físico.
-- Reglas:
--   · Todo ajuste entra por registrar_entrada (tipo 'ajuste'): mismas validaciones de rol, motivo, lote en negativo,
--     candados por producto, auditoría e idempotencia. Aquí solo se le pone encabezado (motivo de una lista, número
--     consecutivo por empresa para el acta) y se guardan sus líneas.
--   · Ajustes, sus líneas y los conteos cerrados no se modifican ni se borran (como los movimientos).
--   · El costo NO se copia en estas tablas: se lee de lote_costos, cuya seguridad por fila solo deja verlo al dueño y al
--     administrador. Así la bodega hace bajas y conteos sin ver costos.
--   · Un conteo se cierra en una sola transacción: las diferencias contra las existencias de ese momento se vuelven un
--     ajuste «Diferencia de conteo» y las existencias quedan iguales a lo contado.

-- ───────────────────────── Ajustes ─────────────────────────
create table if not exists ajustes (
  id uuid primary key,                       -- = ref_id de sus movimientos (lo genera registrar_entrada)
  empresa_id uuid not null references empresas on delete cascade,
  sede_id uuid not null references sedes,
  numero integer not null check (numero > 0),
  motivo text not null check (motivo in ('vencido', 'averia', 'perdida', 'conteo', 'devolucion_proveedor', 'otro')),
  detalle text check (detalle is null or length(detalle) <= 300),
  conteo_id uuid,
  usuario_id uuid,
  creado timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists ajustes_empresa on ajustes (empresa_id, creado desc);

create table if not exists ajuste_lineas (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  ajuste_id uuid not null references ajustes on delete restrict,
  producto_id uuid not null references productos,
  lote_id uuid not null references lotes,
  unidades integer not null check (unidades <> 0),   -- + entra, − sale (en unidades base)
  antes integer not null                             -- existencias del lote justo antes del ajuste
);
create index if not exists ajuste_lineas_ajuste on ajuste_lineas (ajuste_id);
create index if not exists ajuste_lineas_lote on ajuste_lineas (lote_id);

create trigger ajustes_inmutables before update or delete on ajustes for each row execute function no_modificar();
create trigger ajuste_lineas_inmutables before update or delete on ajuste_lineas for each row execute function no_modificar();

-- Nombre del motivo tal como se imprime.
create or replace function motivo_ajuste_texto(m text) returns text language sql immutable as $$
  select case m when 'vencido' then 'Vencido' when 'averia' then 'Avería o rotura' when 'perdida' then 'Pérdida o robo'
    when 'conteo' then 'Diferencia de conteo' when 'devolucion_proveedor' then 'Devolución a proveedor' when 'otro' then 'Otro' else m end
$$;

-- Aplica un ajuste (uso interno: lo llaman registrar_ajuste y cerrar_conteo, que ya validaron quién y por qué).
-- p_lineas = [{ lote_id, unidades }]. Devuelve { id, numero, repetida }.
create or replace function aplicar_ajuste(p_emp uuid, p_motivo text, p_detalle text, p_conteo uuid, p_lineas jsonb, p_idem text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  x jsonb; l lotes; v_unid integer; v_sede uuid; v_para_entrada jsonb := '[]'; r jsonb; v_id uuid; v_num integer; v_antes jsonb;
  v_texto text := motivo_ajuste_texto(p_motivo) || coalesce(': ' || nullif(trim(p_detalle), ''), '');
begin
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Agrega al menos un producto con su lote y cantidad' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_lineas) > 2000 then raise exception 'Máximo 2.000 lotes por ajuste' using errcode = 'P0001'; end if;
  for x in select * from jsonb_array_elements(p_lineas) loop
    select * into l from lotes where id = (x ->> 'lote_id')::uuid and empresa_id = p_emp;
    if not found then raise exception 'Lote no válido' using errcode = 'P0001'; end if;
    v_unid := (x ->> 'unidades')::integer;
    if v_unid is null or v_unid = 0 then raise exception 'La cantidad del lote % no puede ser cero', l.lote using errcode = 'P0001'; end if;
    if p_motivo <> 'conteo' and v_unid > 0 then
      raise exception 'Una baja resta unidades: para sumar usa el motivo «Diferencia de conteo»' using errcode = 'P0001';
    end if;
    if v_sede is null then v_sede := l.sede_id;
    elsif v_sede <> l.sede_id then raise exception 'Todos los lotes de un ajuste deben ser de la misma sede' using errcode = 'P0001';
    end if;
    v_para_entrada := v_para_entrada || jsonb_build_object('producto_id', l.producto_id, 'lote', l.lote, 'unidades', v_unid);
  end loop;

  -- Existencias de cada lote antes del ajuste (para el acta), con los productos ya bloqueados en el mismo orden que la venta.
  perform pg_advisory_xact_lock(hashtext(y)) from (select distinct e ->> 'producto_id' y from jsonb_array_elements(v_para_entrada) e order by 1) s;
  select coalesce(jsonb_object_agg(s.lote_id::text, s.unidades), '{}') into v_antes from v_stock_lotes s
    where s.lote_id in (select (e ->> 'lote_id')::uuid from jsonb_array_elements(p_lineas) e);

  -- Las validaciones de siempre (rol, motivo, negativos, auditoría, idempotencia) las hace registrar_entrada.
  r := registrar_entrada(jsonb_build_object('empresa_id', p_emp, 'sede_id', v_sede, 'tipo', 'ajuste', 'motivo', v_texto,
                                            'idem_key', p_idem, 'lineas', v_para_entrada));
  v_id := (r ->> 'ref')::uuid;
  if coalesce((r ->> 'repetida')::boolean, false) then
    return jsonb_build_object('id', v_id, 'numero', (select numero from ajustes where id = v_id), 'repetida', true);
  end if;

  perform pg_advisory_xact_lock(hashtext('ajuste:' || p_emp::text));
  select coalesce(max(numero), 0) + 1 into v_num from ajustes where empresa_id = p_emp;
  insert into ajustes (id, empresa_id, sede_id, numero, motivo, detalle, conteo_id, usuario_id)
  values (v_id, p_emp, v_sede, v_num, p_motivo, nullif(trim(p_detalle), ''), p_conteo, auth.uid());
  -- Un mismo lote repetido en la lista queda en una línea con la suma.
  insert into ajuste_lineas (empresa_id, ajuste_id, producto_id, lote_id, unidades, antes)
  select p_emp, v_id, lo.producto_id, lo.id, sum((e ->> 'unidades')::integer)::integer, coalesce((v_antes ->> lo.id::text)::integer, 0)
  from jsonb_array_elements(p_lineas) e join lotes lo on lo.id = (e ->> 'lote_id')::uuid
  group by lo.producto_id, lo.id
  having sum((e ->> 'unidades')::integer) <> 0;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (p_emp, auth.uid(), 'ajuste_inventario', 'ajustes', v_id::text,
          jsonb_build_object('numero', v_num, 'motivo', p_motivo, 'detalle', nullif(trim(p_detalle), ''), 'lineas', jsonb_array_length(p_lineas)));
  return jsonb_build_object('id', v_id, 'numero', v_num, 'repetida', false);
end $$;
revoke execute on function aplicar_ajuste(uuid, text, text, uuid, jsonb, text) from public;

-- Ajuste o baja desde la pantalla. p = { empresa_id, motivo, detalle?, idem_key?, lineas: [{ lote_id, unidades }] }
create or replace function registrar_ajuste(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := (p ->> 'empresa_id')::uuid; v_motivo text := p ->> 'motivo'; v_detalle text := nullif(trim(coalesce(p ->> 'detalle', '')), '');
begin
  if coalesce(rol_en(v_emp), '') not in ('dueno', 'admin', 'bodeguero') then
    raise exception 'Solo el dueño, el administrador o la bodega ajustan el inventario' using errcode = '42501';
  end if;
  if coalesce(v_motivo, '') not in ('vencido', 'averia', 'perdida', 'conteo', 'devolucion_proveedor', 'otro') then
    raise exception 'Elige el motivo del ajuste' using errcode = 'P0001';
  end if;
  if v_motivo = 'otro' and length(coalesce(v_detalle, '')) < 4 then
    raise exception 'Con el motivo «Otro» escribe el detalle (qué pasó)' using errcode = 'P0001';
  end if;
  return aplicar_ajuste(v_emp, v_motivo, v_detalle, null, p -> 'lineas', p ->> 'idem_key');
end $$;

-- ───────────────────────── Conteo físico ─────────────────────────
create table if not exists conteos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  sede_id uuid not null references sedes,
  numero integer not null check (numero > 0),
  estado text not null default 'abierto' check (estado in ('abierto', 'cerrado')),
  alcance text not null default 'todo' check (alcance in ('todo', 'laboratorio', 'categoria')),
  filtro text check (filtro is null or length(filtro) <= 160),
  observaciones text check (observaciones is null or length(observaciones) <= 500),
  usuario_id uuid not null,
  creado timestamptz not null default now(),
  cerrado timestamptz,
  cierra_usuario uuid,
  sin_contar_en_cero boolean not null default false,
  ajuste_id uuid references ajustes,
  resumen jsonb,
  unique (empresa_id, numero),
  check ((alcance = 'todo') = (filtro is null))
);
create unique index if not exists conteo_abierto_por_sede on conteos (sede_id) where estado = 'abierto';
create index if not exists conteos_empresa on conteos (empresa_id, creado desc);
alter table ajustes add constraint ajustes_conteo_fk foreign key (conteo_id) references conteos;

create table if not exists conteo_lineas (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  conteo_id uuid not null references conteos on delete restrict,
  producto_id uuid not null references productos,
  lote_id uuid not null references lotes,
  contado integer check (contado >= 0 and contado <= 10000000),  -- null = aún sin contar
  sistema integer,                                               -- existencias del sistema al cerrar
  nuevo boolean not null default false,                          -- lote que apareció al contar (no estaba al iniciar)
  usuario_id uuid,
  actualizado timestamptz,
  unique (conteo_id, lote_id)
);
create index if not exists conteo_lineas_conteo on conteo_lineas (conteo_id);

-- Un conteo cerrado no se modifica; ningún conteo se borra. Solo cambia de «abierto» a «cerrado» con sus datos de cierre.
create or replace function conteo_proteger() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Los conteos no se borran' using errcode = 'P0001'; end if;
  if old.estado = 'cerrado' then raise exception 'Un conteo cerrado no se modifica' using errcode = 'P0001'; end if;
  if (to_jsonb(new) - array['estado', 'cerrado', 'cierra_usuario', 'ajuste_id', 'resumen', 'sin_contar_en_cero', 'observaciones'])
     <> (to_jsonb(old) - array['estado', 'cerrado', 'cierra_usuario', 'ajuste_id', 'resumen', 'sin_contar_en_cero', 'observaciones']) then
    raise exception 'Los datos del conteo no se cambian' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger conteos_proteger before update or delete on conteos for each row execute function conteo_proteger();

create or replace function conteo_linea_proteger() returns trigger language plpgsql as $$
declare v_estado text;
begin
  if tg_op = 'DELETE' then raise exception 'Las líneas de un conteo no se borran' using errcode = 'P0001'; end if;
  select estado into v_estado from conteos where id = new.conteo_id;
  if v_estado is distinct from 'abierto' then raise exception 'Un conteo cerrado no se modifica' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' and (new.conteo_id, new.producto_id, new.lote_id, new.empresa_id) is distinct from (old.conteo_id, old.producto_id, old.lote_id, old.empresa_id) then
    raise exception 'Los datos del conteo no se cambian' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger conteo_lineas_proteger before insert or update or delete on conteo_lineas for each row execute function conteo_linea_proteger();

-- Inicia un conteo. p = { empresa_id, sede_id, alcance: 'todo'|'laboratorio'|'categoria', filtro?, observaciones? }
-- Entran todos los lotes con existencias de la sede (también vencidos o bloqueados: están en la estantería).
create or replace function iniciar_conteo(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := (p ->> 'empresa_id')::uuid; v_sede uuid := (p ->> 'sede_id')::uuid;
  v_alcance text := coalesce(nullif(p ->> 'alcance', ''), 'todo'); v_filtro text := nullif(trim(coalesce(p ->> 'filtro', '')), '');
  v_id uuid; v_num integer; v_n integer;
begin
  if coalesce(rol_en(v_emp), '') not in ('dueno', 'admin', 'bodeguero') then
    raise exception 'Solo el dueño, el administrador o la bodega hacen conteos de inventario' using errcode = '42501';
  end if;
  if not exists (select 1 from sedes where id = v_sede and empresa_id = v_emp) then raise exception 'Sede no válida' using errcode = 'P0001'; end if;
  if v_alcance not in ('todo', 'laboratorio', 'categoria') then raise exception 'Elige qué vas a contar' using errcode = 'P0001'; end if;
  if v_alcance = 'todo' then v_filtro := null;
  elsif v_filtro is null then raise exception 'Elige el % que vas a contar', case v_alcance when 'laboratorio' then 'laboratorio' else 'categoría' end using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('conteo:' || v_emp::text));
  if exists (select 1 from conteos where sede_id = v_sede and estado = 'abierto') then
    raise exception 'Ya hay un conteo abierto en esta sede: termínalo antes de empezar otro' using errcode = 'P0001';
  end if;
  select coalesce(max(numero), 0) + 1 into v_num from conteos where empresa_id = v_emp;
  insert into conteos (empresa_id, sede_id, numero, alcance, filtro, observaciones, usuario_id)
  values (v_emp, v_sede, v_num, v_alcance, v_filtro, nullif(trim(coalesce(p ->> 'observaciones', '')), ''), auth.uid()) returning id into v_id;
  insert into conteo_lineas (empresa_id, conteo_id, producto_id, lote_id)
  select v_emp, v_id, s.producto_id, s.lote_id
  from v_stock_lotes s join productos pr on pr.id = s.producto_id
  where s.empresa_id = v_emp and s.sede_id = v_sede and s.unidades > 0
    and (v_alcance = 'todo'
      or (v_alcance = 'laboratorio' and lower(trim(coalesce(pr.laboratorio, ''))) = lower(v_filtro))
      or (v_alcance = 'categoria' and lower(trim(coalesce(pr.categoria, ''))) = lower(v_filtro)));
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'No hay productos con existencias para contar en ese filtro' using errcode = 'P0001'; end if;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v_emp, auth.uid(), 'iniciar_conteo', 'conteos', v_id::text, jsonb_build_object('numero', v_num, 'alcance', v_alcance, 'filtro', v_filtro, 'lotes', v_n));
  return jsonb_build_object('id', v_id, 'numero', v_num, 'lotes', v_n);
end $$;

-- Registra lo contado de un lote. p = { conteo_id, modo: 'sumar'|'fijar', cantidad,
--   lote_id  (un lote que ya existe)  ó  producto_id + lote + vence (un lote que no estaba en el sistema) }
-- «sumar» es atómico: dos celulares escaneando el mismo producto no se pisan.
create or replace function contar_conteo(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  k conteos; v_lote lotes; v_modo text := coalesce(p ->> 'modo', 'sumar'); v_cant integer; v_nuevo boolean := false;
  v_codigo text; v_vence date; ln conteo_lineas;
begin
  select * into k from conteos where id = (p ->> 'conteo_id')::uuid;
  if not found or coalesce(rol_en(k.empresa_id), '') not in ('dueno', 'admin', 'bodeguero') then
    raise exception 'No puedes contar en este conteo' using errcode = '42501';
  end if;
  if k.estado <> 'abierto' then raise exception 'Un conteo cerrado no se modifica' using errcode = 'P0001'; end if;
  if v_modo not in ('sumar', 'fijar') then raise exception 'Operación no válida' using errcode = 'P0001'; end if;
  v_cant := (p ->> 'cantidad')::integer;
  if v_cant is null or v_cant < 0 or v_cant > 1000000 or (v_modo = 'sumar' and v_cant = 0) then
    raise exception 'Cantidad no válida' using errcode = 'P0001';
  end if;
  if (p ->> 'lote_id') is not null then
    select * into v_lote from lotes where id = (p ->> 'lote_id')::uuid and empresa_id = k.empresa_id and sede_id = k.sede_id;
    if not found then raise exception 'Ese lote no es de esta sede' using errcode = 'P0001'; end if;
  else
    -- Lote que no estaba en el sistema: se crea vacío (sin unidades); el cierre del conteo le da sus existencias.
    v_codigo := upper(trim(coalesce(p ->> 'lote', '')));
    if length(v_codigo) = 0 or length(v_codigo) > 40 then raise exception 'Escribe el código del lote' using errcode = 'P0001'; end if;
    if not exists (select 1 from productos where id = (p ->> 'producto_id')::uuid and empresa_id = k.empresa_id) then
      raise exception 'Producto no válido' using errcode = 'P0001';
    end if;
    select * into v_lote from lotes where sede_id = k.sede_id and producto_id = (p ->> 'producto_id')::uuid and lote = v_codigo;
    if not found then
      v_vence := (p ->> 'vence')::date;
      if v_vence is null then raise exception 'Pon el vencimiento del lote %', v_codigo using errcode = 'P0001'; end if;
      insert into lotes (empresa_id, sede_id, producto_id, lote, vence) values (k.empresa_id, k.sede_id, (p ->> 'producto_id')::uuid, v_codigo, v_vence)
      returning * into v_lote;
      v_nuevo := true;
    end if;
  end if;
  insert into conteo_lineas (empresa_id, conteo_id, producto_id, lote_id, contado, nuevo, usuario_id, actualizado)
  values (k.empresa_id, k.id, v_lote.producto_id, v_lote.id, v_cant, true, auth.uid(), now())
  on conflict (conteo_id, lote_id) do update
    set contado = case when v_modo = 'sumar' then coalesce(conteo_lineas.contado, 0) + v_cant else v_cant end,
        usuario_id = auth.uid(), actualizado = now()
  returning * into ln;
  return jsonb_build_object('linea_id', ln.id, 'lote_id', ln.lote_id, 'producto_id', ln.producto_id, 'lote', v_lote.lote,
    'vence', v_lote.vence::text, 'contado', ln.contado, 'nuevo', ln.nuevo, 'lote_creado', v_nuevo,
    'sistema', (select unidades from v_stock_lotes where lote_id = v_lote.id));
end $$;

-- Cierra el conteo: compara lo contado con las existencias de ESTE momento (con los productos bloqueados para que
-- ninguna venta se cruce) y registra un solo ajuste «Diferencia de conteo». Los lotes sin contar no se tocan, salvo que
-- se indique que no estaban (p_sin_contar_en_cero): entonces quedan en cero.
create or replace function cerrar_conteo(p_conteo uuid, p_sin_contar_en_cero boolean default false, p_observaciones text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k conteos; v_lineas jsonb; v_aj jsonb; v_res jsonb;
begin
  select * into k from conteos where id = p_conteo for update;
  if not found or coalesce(rol_en(k.empresa_id), '') not in ('dueno', 'admin', 'bodeguero') then
    raise exception 'No puedes cerrar este conteo' using errcode = '42501';
  end if;
  if k.estado <> 'abierto' then raise exception 'El conteo ya está cerrado' using errcode = 'P0001'; end if;
  if not exists (select 1 from conteo_lineas where conteo_id = k.id and contado is not null) and not coalesce(p_sin_contar_en_cero, false) then
    raise exception 'Todavía no has contado ningún lote' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext(y)) from (select distinct producto_id::text y from conteo_lineas where conteo_id = k.id order by 1) s;
  -- Foto de las existencias al cerrar.
  update conteo_lineas cl set sistema = coalesce((select s.unidades from v_stock_lotes s where s.lote_id = cl.lote_id), 0)
  where cl.conteo_id = k.id;
  if coalesce(p_sin_contar_en_cero, false) then
    update conteo_lineas set contado = 0, actualizado = now(), usuario_id = auth.uid() where conteo_id = k.id and contado is null;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('lote_id', lote_id, 'unidades', contado - sistema) order by id), '[]') into v_lineas
  from conteo_lineas where conteo_id = k.id and contado is not null and contado <> sistema;
  if jsonb_array_length(v_lineas) > 0 then
    v_aj := aplicar_ajuste(k.empresa_id, 'conteo', 'conteo físico N.º ' || k.numero, k.id, v_lineas, null);
  end if;
  select jsonb_build_object(
      'lotes', count(*), 'contados', count(*) filter (where contado is not null), 'sin_contar', count(*) filter (where contado is null),
      'con_diferencia', count(*) filter (where contado is not null and contado <> sistema),
      'sobrantes', coalesce(sum(contado - sistema) filter (where contado > sistema), 0),
      'faltantes', coalesce(sum(sistema - contado) filter (where contado < sistema), 0))
    into v_res from conteo_lineas where conteo_id = k.id;
  update conteos set estado = 'cerrado', cerrado = now(), cierra_usuario = auth.uid(), ajuste_id = (v_aj ->> 'id')::uuid, resumen = v_res,
    sin_contar_en_cero = coalesce(p_sin_contar_en_cero, false),
    observaciones = coalesce(nullif(trim(coalesce(p_observaciones, '')), ''), observaciones)
  where id = k.id;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (k.empresa_id, auth.uid(), 'cerrar_conteo', 'conteos', k.id::text, v_res || jsonb_build_object('numero', k.numero, 'ajuste', v_aj ->> 'numero'));
  return v_res || jsonb_build_object('ajuste_id', v_aj ->> 'id', 'ajuste_numero', (v_aj ->> 'numero')::integer);
end $$;

-- ───────────────────────── Kardex ─────────────────────────
-- Movimientos de un producto (opcional: de un lote y en un rango de fechas de Bogotá) con su saldo acumulado. El saldo se
-- calcula sobre TODA la historia (no solo el rango), así que la última fila cuadra con las existencias actuales.
-- Security invoker: la seguridad por fila de quien consulta decide qué ve.
create or replace function kardex(p_producto uuid, p_desde date default null, p_hasta date default null, p_lote uuid default null)
returns table (id bigint, fecha timestamptz, tipo text, documento text, lote text, vence date, usuario text, entrada integer, salida integer, saldo integer)
language sql stable set search_path = public set jit = off as $$
  select * from (
    select m.id, m.creado, m.tipo,
      case m.tipo
        when 'venta' then coalesce(v.prefijo || v.numero::text, 'Venta')
        when 'devolucion' then 'Devolución de ' || coalesce(v.prefijo || v.numero::text, 'venta')
        when 'anulacion' then 'Anulación de ' || coalesce(v.prefijo || v.numero::text, 'venta')
        when 'ajuste' then coalesce('Ajuste N.º ' || a.numero || ' · ' || motivo_ajuste_texto(a.motivo) || coalesce(': ' || a.detalle, ''), coalesce(m.motivo, 'Ajuste'))
        when 'compra' then coalesce(nullif(m.motivo, ''), 'Compra')
        when 'inicial' then 'Inventario inicial'
        else coalesce(m.motivo, m.tipo) end,
      l.lote, l.vence, mi.nombre,
      greatest(m.cantidad, 0), greatest(-m.cantidad, 0),
      (sum(m.cantidad) over (order by m.creado, m.id))::integer
    from movimientos m
    join lotes l on l.id = m.lote_id
    left join ventas v on v.id = m.ref_id and m.tipo in ('venta', 'devolucion', 'anulacion')
    left join ajustes a on a.id = m.ref_id and m.tipo = 'ajuste'
    left join miembros mi on mi.empresa_id = m.empresa_id and mi.user_id = m.usuario_id
    where m.producto_id = p_producto and (p_lote is null or m.lote_id = p_lote)
  ) k
  where (p_desde is null or (k.creado at time zone 'America/Bogota')::date >= p_desde)
    and (p_hasta is null or (k.creado at time zone 'America/Bogota')::date <= p_hasta)
  order by k.creado, k.id
$$;

-- ───────────────────────── Seguridad ─────────────────────────
alter table ajustes enable row level security;
alter table ajuste_lineas enable row level security;
alter table conteos enable row level security;
alter table conteo_lineas enable row level security;
create policy miembros_leen on ajustes for select to authenticated using (empresa_id in (select mis_empresas()));
create policy miembros_leen on ajuste_lineas for select to authenticated using (empresa_id in (select mis_empresas()));
create policy miembros_leen on conteos for select to authenticated using (empresa_id in (select mis_empresas()));
create policy miembros_leen on conteo_lineas for select to authenticated using (empresa_id in (select mis_empresas()));
-- Solo lectura: se escriben únicamente por las funciones de arriba.
grant select on ajustes, ajuste_lineas, conteos, conteo_lineas to authenticated;

revoke execute on function motivo_ajuste_texto(text), registrar_ajuste(jsonb), iniciar_conteo(jsonb), contar_conteo(jsonb),
  cerrar_conteo(uuid, boolean, text), kardex(uuid, date, date, uuid) from public;
grant execute on function motivo_ajuste_texto(text), registrar_ajuste(jsonb), iniciar_conteo(jsonb), contar_conteo(jsonb),
  cerrar_conteo(uuid, boolean, text), kardex(uuid, date, date, uuid) to authenticated;
