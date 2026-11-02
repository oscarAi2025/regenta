-- Regenta · turnos de caja (como Alegra POS): apertura con base, ingresos y egresos de efectivo, cierre con el dinero
-- contado, diferencia contra lo esperado y reporte imprimible. Las ventas del turno son las de esa caja entre la apertura
-- y el cierre (no hace falta tocar registrar_venta).

create table turnos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  caja_id uuid not null references cajas on delete restrict,
  estado text not null default 'abierto' check (estado in ('abierto', 'cerrado')),
  base numeric(14, 2) not null check (base >= 0 and base = trunc(base)),
  abierto timestamptz not null default now(),
  abre_usuario uuid not null,
  cerrado timestamptz,
  cierra_usuario uuid,
  efectivo_esperado numeric(14, 2),
  efectivo_contado numeric(14, 2) check (efectivo_contado >= 0),
  diferencia numeric(14, 2),
  resumen jsonb,                          -- foto del cierre (ventas por medio, movimientos, totales)
  observaciones text check (length(observaciones) <= 500),
  check ((estado = 'abierto') = (cerrado is null))
);
create unique index turno_abierto_por_caja on turnos (caja_id) where estado = 'abierto';
create index turnos_empresa on turnos (empresa_id, abierto desc);

create table movimientos_caja (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  turno_id uuid not null references turnos on delete restrict,
  tipo text not null check (tipo in ('ingreso', 'egreso')),
  valor numeric(14, 2) not null check (valor > 0 and valor = trunc(valor)),
  concepto text not null check (length(trim(concepto)) between 3 and 120),
  usuario_id uuid not null,
  creado timestamptz not null default now()
);
create index movimientos_caja_turno on movimientos_caja (turno_id);

-- Exigir turno abierto para vender (lo activa el dueño; apagado por defecto).
alter table empresas add column if not exists exige_turno boolean not null default false;

alter table turnos enable row level security;
alter table movimientos_caja enable row level security;
create policy miembros_leen on turnos for select to authenticated using (rol_en(empresa_id) is not null);
create policy miembros_leen on movimientos_caja for select to authenticated using (rol_en(empresa_id) is not null);
grant select on turnos, movimientos_caja to authenticated;

-- Cifras del turno (en vivo si está abierto, o hasta el cierre). El efectivo de las ventas es lo recibido en efectivo
-- menos el cambio; los abonos en efectivo de cartera entran al cajón si la empresa tiene una sola caja activa.
create or replace function resumen_turno(p_turno uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t turnos; v_hasta timestamptz; r jsonb; v_cajas int;
  v_ventas numeric; v_n int; v_anuladas int; v_iva numeric; v_credito numeric; v_efectivo numeric; v_abonos numeric;
  v_ingresos numeric; v_egresos numeric; v_medios jsonb;
begin
  select * into t from turnos where id = p_turno;
  if not found or rol_en(t.empresa_id) is null then raise exception 'Turno no encontrado' using errcode = 'P0002'; end if;
  v_hasta := coalesce(t.cerrado, now());
  select coalesce(sum(total) filter (where estado = 'cerrada'), 0), count(*) filter (where estado = 'cerrada'), count(*) filter (where estado = 'anulada'),
         coalesce(sum(iva) filter (where estado = 'cerrada'), 0), coalesce(sum(total) filter (where estado = 'cerrada' and condicion = 'credito'), 0)
    into v_ventas, v_n, v_anuladas, v_iva, v_credito
    from ventas where caja_id = t.caja_id and creado >= t.abierto and creado < v_hasta;
  -- Por medio de pago: lo aplicado a la venta (el efectivo descuenta el cambio).
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
  r := jsonb_build_object('ventas', v_ventas, 'n_ventas', v_n, 'anuladas', v_anuladas, 'iva', v_iva, 'credito', v_credito, 'medios', v_medios,
    'efectivo_ventas', v_efectivo, 'abonos_efectivo', v_abonos, 'ingresos', v_ingresos, 'egresos', v_egresos, 'base', t.base,
    'efectivo_esperado', t.base + v_efectivo + v_abonos + v_ingresos - v_egresos);
  return r;
end $$;

create or replace function abrir_turno(p_caja uuid, p_base numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare c cajas; v_id uuid;
begin
  select * into c from cajas where id = p_caja;
  if not found or coalesce(rol_en(c.empresa_id), '') not in ('dueno', 'admin', 'cajero', 'vendedor') then
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
  if not found or coalesce(rol_en(t.empresa_id), '') not in ('dueno', 'admin', 'cajero', 'vendedor') then
    raise exception 'No puedes registrar movimientos en este turno' using errcode = '42501';
  end if;
  if t.estado <> 'abierto' then raise exception 'El turno ya está cerrado' using errcode = 'P0001'; end if;
  if p_tipo not in ('ingreso', 'egreso') then raise exception 'Tipo de movimiento no válido' using errcode = 'P0001'; end if;
  if p_valor is null or p_valor <= 0 or p_valor <> trunc(p_valor) then raise exception 'El valor debe ser en pesos y mayor que cero' using errcode = 'P0001'; end if;
  if length(trim(coalesce(p_concepto, ''))) < 3 then raise exception 'Escribe el concepto (por ejemplo: pago domicilio, compra de bolsas)' using errcode = 'P0001'; end if;
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
  if not found or coalesce(rol_en(t.empresa_id), '') not in ('dueno', 'admin', 'cajero', 'vendedor') then
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
  update empresas set exige_turno = p_valor where id = p_empresa;
end $$;

revoke execute on function resumen_turno(uuid), abrir_turno(uuid, numeric), movimiento_caja(uuid, text, numeric, text),
  cerrar_turno(uuid, numeric, text), exigir_turno(uuid, boolean) from public;
grant execute on function resumen_turno(uuid), abrir_turno(uuid, numeric), movimiento_caja(uuid, text, numeric, text),
  cerrar_turno(uuid, numeric, text), exigir_turno(uuid, boolean) to authenticated;
