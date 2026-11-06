-- Regenta · resultados, gastos, auxiliar de IVA y bitácora (Bloque 3-A).
-- Reglas:
--   · Un gasto es un documento inmutable (consecutivo G-n por droguería): fecha, categoría fija, descripción, medio y valor.
--     Solo se anula, con motivo, y queda en la auditoría. Lo registran y anulan el dueño o el administrador.
--   · Un gasto en efectivo que sale de la caja exige el turno abierto de esa caja y sale como egreso del turno en la misma
--     transacción (igual que el pago a proveedores de la 031). Al anularlo, el efectivo vuelve como ingreso del turno
--     abierto de esa caja (si el turno del gasto ya se cerró, entra en el turno abierto ahora; como anular_pago_proveedor).
--   · La categoría «nomina» es el valor total pagado, sin liquidar la nómina.
--   · El estado de resultados, el auxiliar de IVA y el cierre del día se calculan en la app (src/lib/reportes.ts) con la
--     seguridad por fila del usuario: aquí solo hacen falta los gastos y dos índices.
--   · La bitácora lee la tabla auditoria: dueño y administrador ya la leen desde la 002 (política gerencia_lee, acelerada
--     en la 023); se comprueba y, si faltara, se crea igual. Solo lectura: nadie escribe la auditoría directamente.

-- ───────────────────────── Gastos ─────────────────────────
create table if not exists gastos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  sede_id uuid not null references sedes,
  numero integer not null check (numero > 0),
  fecha date not null,
  categoria text not null check (categoria in ('arriendo', 'servicios', 'nomina', 'transporte', 'impuestos', 'mantenimiento', 'otros')),
  descripcion text not null check (length(trim(descripcion)) between 3 and 200),
  medio text not null check (medio in ('efectivo', 'transferencia', 'consignacion', 'cheque', 'nequi', 'daviplata', 'bre_b', 'tarjeta')),
  valor numeric(14, 2) not null check (valor > 0 and valor <= 10000000000),
  referencia text check (referencia is null or length(referencia) <= 60),
  caja_id uuid references cajas,
  turno_id uuid references turnos,
  movimiento_caja_id bigint references movimientos_caja,
  anulado boolean not null default false,
  motivo text check (motivo is null or length(trim(motivo)) between 4 and 300),
  anulado_en timestamptz,
  anula_usuario uuid,
  idem_key text check (idem_key is null or length(idem_key) <= 80),
  usuario_id uuid not null,
  creado timestamptz not null default now(),
  unique (empresa_id, numero),
  unique (empresa_id, idem_key),
  check (anulado = (motivo is not null)),
  check ((caja_id is null) = (turno_id is null) and (caja_id is null) = (movimiento_caja_id is null)),
  check (caja_id is null or (medio = 'efectivo' and valor = trunc(valor)))
);
create index if not exists gastos_empresa_fecha on gastos (empresa_id, fecha desc);
create index if not exists gastos_turno on gastos (turno_id) where turno_id is not null;

-- Un gasto solo cambia para anularse (con motivo, quién y cuándo) y nunca se borra, salvo al eliminar una droguería de
-- prueba desde la consola (misma excepción que compras: solo el servidor y solo para la empresa que se elimina).
create or replace function gasto_proteger() returns trigger language plpgsql as $$
declare v text[] := array['anulado', 'motivo', 'anulado_en', 'anula_usuario'];
begin
  if tg_op = 'DELETE' then
    if current_user not in ('authenticated', 'anon') and current_setting('regenta.eliminar_empresa', true) = old.empresa_id::text then return old; end if;
    raise exception 'Los gastos no se borran: se anulan' using errcode = 'P0001';
  end if;
  if old.anulado or not new.anulado or (to_jsonb(new) - v) <> (to_jsonb(old) - v) then
    raise exception 'Un gasto solo puede anularse' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists gastos_proteger on gastos;
create trigger gastos_proteger before update or delete on gastos for each row execute function gasto_proteger();

-- Nombre de la categoría para los textos (conceptos de caja, auditoría). Uso interno.
create or replace function categoria_gasto_texto(c text) returns text language sql immutable as $$
  select case c when 'arriendo' then 'Arriendo' when 'servicios' then 'Servicios públicos' when 'nomina' then 'Nómina'
    when 'transporte' then 'Transporte' when 'impuestos' then 'Impuestos' when 'mantenimiento' then 'Mantenimiento' else 'Otros' end
$$;

-- p = { empresa_id, sede_id, fecha, categoria, descripcion, medio, valor, referencia?, desde_caja?, caja_id?, idem_key? }
-- En efectivo, por defecto sale de la caja (desde_caja = true): exige turno abierto, la fecha de hoy y valor en pesos.
create or replace function registrar_gasto(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := (p ->> 'empresa_id')::uuid; v_sede uuid := (p ->> 'sede_id')::uuid; v_ya gastos; v_id uuid := gen_random_uuid(); v_num integer;
  v_cat text := p ->> 'categoria'; v_desc text := trim(coalesce(p ->> 'descripcion', '')); v_medio text := p ->> 'medio';
  v_valor numeric := (p ->> 'valor')::numeric; v_fecha date := (p ->> 'fecha')::date; v_ref text := nullif(trim(coalesce(p ->> 'referencia', '')), '');
  v_desde_caja boolean; v_caja cajas; v_turno turnos; v_mov bigint;
begin
  if coalesce(rol_en(v_emp), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador registran gastos' using errcode = '42501';
  end if;
  if (p ->> 'idem_key') is not null then
    perform pg_advisory_xact_lock(hashtext('gasto-idem:' || v_emp::text || ':' || (p ->> 'idem_key')));
    select * into v_ya from gastos where empresa_id = v_emp and idem_key = p ->> 'idem_key';
    if found then return jsonb_build_object('id', v_ya.id, 'numero', v_ya.numero, 'valor', v_ya.valor, 'egreso_caja', v_ya.caja_id is not null, 'repetido', true); end if;
  end if;
  if not exists (select 1 from sedes where id = v_sede and empresa_id = v_emp) then raise exception 'Sede no válida' using errcode = 'P0001'; end if;
  if coalesce(v_cat, '') not in ('arriendo', 'servicios', 'nomina', 'transporte', 'impuestos', 'mantenimiento', 'otros') then
    raise exception 'Elige la categoría del gasto' using errcode = 'P0001';
  end if;
  if length(v_desc) < 3 then raise exception 'Escribe en qué se gastó (por ejemplo: arriendo de noviembre)' using errcode = 'P0001'; end if;
  if length(v_desc) > 200 then raise exception 'La descripción admite máximo 200 caracteres' using errcode = 'P0001'; end if;
  if length(v_ref) > 60 then raise exception 'La referencia admite máximo 60 caracteres' using errcode = 'P0001'; end if;
  if coalesce(v_medio, '') not in ('efectivo', 'transferencia', 'consignacion', 'cheque', 'nequi', 'daviplata', 'bre_b', 'tarjeta') then
    raise exception 'Elige el medio de pago' using errcode = 'P0001';
  end if;
  if v_valor is null or v_valor <= 0 or v_valor > 10000000000 or v_valor <> round(v_valor, 2) then raise exception 'Escribe el valor del gasto' using errcode = 'P0001'; end if;
  if v_fecha is null then raise exception 'Pon la fecha del gasto' using errcode = 'P0001'; end if;
  if v_fecha > current_date then raise exception 'La fecha del gasto no puede ser futura' using errcode = 'P0001'; end if;
  if v_fecha < current_date - 730 then raise exception 'La fecha del gasto tiene más de dos años: revísala' using errcode = 'P0001'; end if;

  v_desde_caja := v_medio = 'efectivo' and coalesce((p ->> 'desde_caja')::boolean, true);
  if v_desde_caja then
    select * into v_caja from cajas where id = (p ->> 'caja_id')::uuid and empresa_id = v_emp and activa;
    if not found then raise exception 'Elige la caja de donde sale el efectivo' using errcode = 'P0001'; end if;
    select * into v_turno from turnos where caja_id = v_caja.id and estado = 'abierto' for update;
    if not found then
      raise exception 'Para pagar un gasto en efectivo desde la caja abre primero el turno de %. Si el dinero no sale de la caja, marca «No sale de la caja».', v_caja.nombre
        using errcode = 'P0001';
    end if;
    if v_valor <> trunc(v_valor) then raise exception 'El gasto en efectivo desde la caja va en pesos, sin centavos' using errcode = 'P0001'; end if;
    if v_fecha <> current_date then raise exception 'Un gasto que sale hoy de la caja lleva la fecha de hoy' using errcode = 'P0001'; end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('gasto:' || v_emp::text));
  select coalesce(max(numero), 0) + 1 into v_num from gastos where empresa_id = v_emp;
  if v_desde_caja then
    insert into movimientos_caja (empresa_id, turno_id, tipo, valor, concepto, usuario_id)
    values (v_emp, v_turno.id, 'egreso', v_valor, left('Gasto G-' || v_num || ' · ' || categoria_gasto_texto(v_cat) || ': ' || v_desc, 120), auth.uid())
    returning id into v_mov;
  end if;
  insert into gastos (id, empresa_id, sede_id, numero, fecha, categoria, descripcion, medio, valor, referencia, caja_id, turno_id, movimiento_caja_id, idem_key, usuario_id)
  values (v_id, v_emp, v_sede, v_num, v_fecha, v_cat, v_desc, v_medio, v_valor, v_ref, case when v_desde_caja then v_caja.id end,
          case when v_desde_caja then v_turno.id end, v_mov, p ->> 'idem_key', auth.uid());
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v_emp, auth.uid(), 'registrar_gasto', 'gastos', v_id::text, jsonb_build_object('numero', v_num, 'categoria', v_cat, 'descripcion', v_desc,
    'valor', v_valor, 'medio', v_medio, 'fecha', v_fecha, 'caja', v_desde_caja));
  return jsonb_build_object('id', v_id, 'numero', v_num, 'valor', v_valor, 'egreso_caja', v_desde_caja, 'turno_id', v_turno.id, 'repetido', false);
end $$;

-- Anular un gasto (con motivo). Si salió de la caja, el efectivo vuelve como ingreso del turno abierto de esa caja.
create or replace function anular_gasto(p_gasto uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g gastos; v_turno turnos; v_motivo text := nullif(trim(coalesce(p_motivo, '')), ''); v_caja text;
begin
  select * into g from gastos where id = p_gasto for update;
  if not found or coalesce(rol_en(g.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador anulan gastos' using errcode = '42501';
  end if;
  if g.anulado then raise exception 'El gasto ya está anulado' using errcode = 'P0001'; end if;
  if length(coalesce(v_motivo, '')) < 4 then raise exception 'Escribe el motivo de la anulación' using errcode = 'P0001'; end if;
  if length(v_motivo) > 300 then raise exception 'El motivo admite máximo 300 caracteres' using errcode = 'P0001'; end if;
  if g.caja_id is not null then
    select * into v_turno from turnos where caja_id = g.caja_id and estado = 'abierto' for update;
    if not found then
      select nombre into v_caja from cajas where id = g.caja_id;
      raise exception 'Este gasto salió de la caja %: abre el turno de esa caja para devolver el efectivo y anular el gasto', v_caja using errcode = 'P0001';
    end if;
    insert into movimientos_caja (empresa_id, turno_id, tipo, valor, concepto, usuario_id)
    values (g.empresa_id, v_turno.id, 'ingreso', g.valor, left('Anulación del gasto G-' || g.numero || ' · ' || categoria_gasto_texto(g.categoria), 120), auth.uid());
  end if;
  update gastos set anulado = true, motivo = v_motivo, anulado_en = now(), anula_usuario = auth.uid() where id = g.id;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (g.empresa_id, auth.uid(), 'anular_gasto', 'gastos', g.id::text, jsonb_build_object('numero', g.numero, 'categoria', g.categoria, 'descripcion', g.descripcion,
    'valor', g.valor, 'motivo', v_motivo, 'caja', g.caja_id is not null));
  return jsonb_build_object('id', g.id, 'anulado', true, 'ingreso_caja', g.caja_id is not null, 'turno_id', v_turno.id);
end $$;

-- ───────────────────────── Seguridad ─────────────────────────
alter table gastos enable row level security;
drop policy if exists gerencia_lee on gastos;
create policy gerencia_lee on gastos for select to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin'])));
revoke all on gastos from anon, authenticated;
grant select on gastos to authenticated;  -- solo lectura: se escribe únicamente por registrar_gasto y anular_gasto

-- Bitácora: la auditoría la leen solo el dueño y el administrador (ya existe desde la 002; si faltara, se crea).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'auditoria' and cmd in ('SELECT', 'ALL')) then
    execute 'create policy gerencia_lee on auditoria for select to authenticated using (empresa_id in (select mis_empresas(array[''dueno'', ''admin''])))';
  end if;
end $$;
revoke insert, update, delete on auditoria from anon, authenticated;
grant select on auditoria to authenticated;

-- Índices de la bitácora: por tipo de acción y los descuentos de cada venta (la mayoría de líneas no lleva descuento).
create index if not exists auditoria_empresa_accion on auditoria (empresa_id, accion, creado desc);
create index if not exists venta_lineas_con_descuento on venta_lineas (venta_id) where descuento_pct > 0;

revoke execute on function gasto_proteger(), categoria_gasto_texto(text), registrar_gasto(jsonb), anular_gasto(uuid, text) from public, anon;
revoke execute on function gasto_proteger(), categoria_gasto_texto(text) from authenticated;
grant execute on function registrar_gasto(jsonb), anular_gasto(uuid, text) to authenticated;
-- El registro en regenta_migraciones lo hace scripts/db-reset.mjs al aplicarla; el SQL de producción (db/produccion) lleva
-- al final: insert into regenta_migraciones (nombre) values ('034_resultados.sql');
