-- Regenta · control especial y venta con fórmula médica.
--  · Cada producto puede marcarse «venta con fórmula médica» y/o «medicamento de control especial» (control especial
--    implica fórmula). El cambio de marca queda en la auditoría.
--  · La droguería configura el plazo de vigencia de la fórmula de control especial (por defecto 30 días) y si exige
--    registrar los datos de la fórmula también en los productos que solo piden fórmula.
--  · La fórmula se registra en la MISMA transacción de la venta (registrar_formulas_venta) y una restricción diferida
--    impide confirmar una venta con productos que piden fórmula sin su registro: ninguna ruta del servidor (ni una
--    llamada directa) puede saltársela. No hace falta tocar registrar_venta.
--  · Libro de control especial (v_libro_control): las dispensaciones salen de venta_formulas + venta_lineas (lote y
--    unidades reales) y los reintegros de los movimientos de anulación y devolución de esas ventas. Todo lo que lo forma
--    es inmutable: una anulación no borra la dispensación, la compensa con un reintegro.

-- ───────────── Marcas del producto ─────────────
alter table productos add column if not exists requiere_formula boolean not null default false;
alter table productos add column if not exists control_especial boolean not null default false;
alter table productos drop constraint if exists control_implica_formula;
alter table productos add constraint control_implica_formula check (not control_especial or requiere_formula);

-- Control especial implica fórmula (se completa sola, también al importar) y todo cambio de marca queda auditado.
create or replace function productos_formula() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.control_especial then new.requiere_formula := true; end if;
  if tg_op = 'UPDATE' and (new.control_especial is distinct from old.control_especial or new.requiere_formula is distinct from old.requiere_formula) then
    insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
    values (new.empresa_id, case when nullif(current_setting('request.jwt.claims', true), '') is not null then auth.uid() end, -- sin usuario: proceso del servidor
            'cambio_formula', 'productos', new.id::text,
            jsonb_build_object('antes', jsonb_build_object('formula', old.requiere_formula, 'control', old.control_especial),
                               'despues', jsonb_build_object('formula', new.requiere_formula, 'control', new.control_especial)));
  end if;
  return new;
end $$;
drop trigger if exists productos_formula on productos;
create trigger productos_formula before insert or update of requiere_formula, control_especial on productos
  for each row execute function productos_formula();

-- ───────────── Configuración de la droguería ─────────────
alter table empresas add column if not exists formula_vigencia_dias integer not null default 30 check (formula_vigencia_dias between 1 and 365);
alter table empresas add column if not exists formula_exige_datos boolean not null default false;

create or replace function configurar_formulas(p_empresa uuid, p_vigencia integer, p_exige boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(rol_en(p_empresa), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador cambian esta configuración' using errcode = '42501';
  end if;
  if (select demo from empresas where id = p_empresa) then
    raise exception 'En la demostración esta configuración no se cambia' using errcode = 'P0001';
  end if;
  if p_vigencia is null or p_vigencia < 1 or p_vigencia > 365 then
    raise exception 'La vigencia de la fórmula debe estar entre 1 y 365 días' using errcode = 'P0001';
  end if;
  update empresas set formula_vigencia_dias = p_vigencia, formula_exige_datos = coalesce(p_exige, false) where id = p_empresa;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (p_empresa, auth.uid(), 'configurar_formulas', 'empresas', p_empresa::text,
          jsonb_build_object('vigencia_dias', p_vigencia, 'exige_datos', coalesce(p_exige, false)));
end $$;

-- ───────────── Fórmulas de cada venta ─────────────
create table if not exists venta_formulas (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  venta_id uuid not null references ventas on delete cascade,
  producto_id uuid not null references productos,
  control boolean not null,                 -- era de control especial al venderse (el libro no cambia si se desmarca)
  verificada boolean not null,              -- quien vendió confirmó que vio la fórmula
  paciente_tipo_doc text check (paciente_tipo_doc in ('CC', 'TI', 'RC', 'CE', 'PA', 'PPT', 'PEP')),
  paciente_doc text check (paciente_doc ~ '^[0-9A-Z]{3,20}$'),
  paciente_nombre text check (length(paciente_nombre) between 3 and 120),
  medico_nombre text check (length(medico_nombre) between 3 and 120),
  medico_registro text check (length(medico_registro) between 2 and 40),
  formula_numero text check (length(formula_numero) between 1 and 40),
  formula_fecha date,
  usuario_id uuid not null,
  creado timestamptz not null default now(),
  unique (venta_id, producto_id),
  check (not control or (verificada and paciente_tipo_doc is not null and paciente_doc is not null and paciente_nombre is not null
         and medico_nombre is not null and medico_registro is not null and formula_numero is not null and formula_fecha is not null))
);
create index if not exists venta_formulas_empresa on venta_formulas (empresa_id, creado desc);
create index if not exists venta_formulas_producto on venta_formulas (producto_id) where control;
create index if not exists movimientos_ref on movimientos (ref_id) where ref_id is not null;

drop trigger if exists venta_formulas_inmutables on venta_formulas;
create trigger venta_formulas_inmutables before update or delete on venta_formulas for each row execute function no_modificar();

-- Datos de pacientes: solo la gerencia los lee (la cajera los escribe al vender, por la función).
alter table venta_formulas enable row level security;
drop policy if exists gerencia_lee on venta_formulas;
create policy gerencia_lee on venta_formulas for select to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin'])));
revoke all on venta_formulas from anon, authenticated;
grant select on venta_formulas to authenticated;

-- p = { verificada, paciente_tipo_doc, paciente_doc, paciente_nombre, medico_nombre, medico_registro, formula_numero, formula_fecha }
-- Se llama en la misma transacción que registrar_venta, con la venta recién creada. Un reintento de una venta ya
-- registrada no duplica nada (devuelve 0).
create or replace function registrar_formulas_venta(p_venta uuid, p jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v ventas; e empresas; r record; n integer := 0; v_rol text;
  v_tdoc text := upper(nullif(trim(coalesce(p ->> 'paciente_tipo_doc', '')), ''));
  v_doc text := upper(nullif(regexp_replace(coalesce(p ->> 'paciente_doc', ''), '[[:space:].-]', '', 'g'), ''));
  v_pac text := nullif(regexp_replace(trim(coalesce(p ->> 'paciente_nombre', '')), '\s+', ' ', 'g'), '');
  v_med text := nullif(regexp_replace(trim(coalesce(p ->> 'medico_nombre', '')), '\s+', ' ', 'g'), '');
  v_reg text := upper(nullif(trim(coalesce(p ->> 'medico_registro', '')), ''));
  v_num text := upper(nullif(trim(coalesce(p ->> 'formula_numero', '')), ''));
  v_fecha date;
  v_verif boolean := coalesce((p ->> 'verificada')::boolean, false);
  v_datos boolean;
begin
  select * into v from ventas where id = p_venta;
  v_rol := case when found then rol_en(v.empresa_id) end;
  if v_rol is null or v_rol not in ('dueno', 'admin', 'cajero') then
    raise exception 'No tienes permiso para registrar fórmulas en esta empresa' using errcode = '42501';
  end if;
  if exists (select 1 from venta_formulas where venta_id = p_venta) then return 0; end if; -- reintento de la misma venta
  -- La fórmula entra con su venta, nunca después (no se completa el libro a posteriori).
  if v.creado <> now() then raise exception 'La fórmula se registra al momento de la venta' using errcode = 'P0001'; end if;
  if v.usuario_id is distinct from auth.uid() then raise exception 'La fórmula la registra quien hace la venta' using errcode = '42501'; end if;
  select * into e from empresas where id = v.empresa_id;
  begin
    v_fecha := nullif(p ->> 'formula_fecha', '')::date;
  exception when others then
    raise exception 'La fecha de la fórmula no es válida' using errcode = 'P0001';
  end;

  for r in
    select distinct pr.id, pr.nombre, pr.control_especial from venta_lineas vl join productos pr on pr.id = vl.producto_id
    where vl.venta_id = p_venta and (pr.requiere_formula or pr.control_especial) order by pr.nombre
  loop
    v_datos := r.control_especial or e.formula_exige_datos;
    if v_datos then
      if v_tdoc is null or v_tdoc not in ('CC', 'TI', 'RC', 'CE', 'PA', 'PPT', 'PEP') then raise exception 'Elige el tipo de documento del paciente' using errcode = 'P0001'; end if;
      if v_doc is null or v_doc !~ '^[0-9A-Z]{3,20}$' then raise exception 'Escribe el número de documento del paciente (sin puntos)' using errcode = 'P0001'; end if;
      if v_pac is null or length(v_pac) < 3 or length(v_pac) > 120 then raise exception 'Escribe el nombre completo del paciente' using errcode = 'P0001'; end if;
      if v_med is null or length(v_med) < 3 or length(v_med) > 120 then raise exception 'Escribe el nombre del médico que firma la fórmula' using errcode = 'P0001'; end if;
      if v_reg is null or length(v_reg) < 2 or length(v_reg) > 40 then raise exception 'Escribe el registro profesional del médico' using errcode = 'P0001'; end if;
      if v_num is null or length(v_num) > 40 then raise exception 'Escribe el número de la fórmula' using errcode = 'P0001'; end if;
      if v_fecha is null then raise exception 'Escribe la fecha de la fórmula' using errcode = 'P0001'; end if;
      if v_fecha > current_date then raise exception 'La fecha de la fórmula no puede ser posterior a hoy' using errcode = 'P0001'; end if;
      if r.control_especial and v_fecha < current_date - e.formula_vigencia_dias then
        raise exception 'La fórmula de % ya no está vigente: tiene más de % días (plazo configurado por tu droguería)', r.nombre, e.formula_vigencia_dias using errcode = 'P0001';
      end if;
    elsif not v_verif then
      raise exception '% se vende con fórmula médica: confirma que la verificaste', r.nombre using errcode = 'P0001';
    end if;
    insert into venta_formulas (empresa_id, venta_id, producto_id, control, verificada, paciente_tipo_doc, paciente_doc, paciente_nombre,
                                medico_nombre, medico_registro, formula_numero, formula_fecha, usuario_id)
    values (v.empresa_id, p_venta, r.id, r.control_especial, true,  -- sin datos exigidos solo queda la confirmación
            case when v_datos then v_tdoc end, case when v_datos then v_doc end, case when v_datos then v_pac end,
            case when v_datos then v_med end, case when v_datos then v_reg end, case when v_datos then v_num end,
            case when v_datos then v_fecha end, auth.uid());
    n := n + 1;
  end loop;
  if n > 0 then
    insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
    values (v.empresa_id, auth.uid(), 'formula_venta', 'ventas', p_venta::text, jsonb_build_object('productos', n, 'numero', v.prefijo || v.numero));
  end if;
  return n;
end $$;

-- Ninguna venta con productos que piden fórmula se confirma sin su registro (se comprueba al confirmar la transacción).
create or replace function exigir_formula_venta() returns trigger
language plpgsql security definer set search_path = public as $$
declare x text;
begin
  select pr.nombre into x from venta_lineas vl join productos pr on pr.id = vl.producto_id
  where vl.venta_id = new.id and (pr.requiere_formula or pr.control_especial)
    and not exists (select 1 from venta_formulas f where f.venta_id = new.id and f.producto_id = vl.producto_id)
  limit 1;
  if x is not null then
    raise exception '% se vende con fórmula médica: registra la fórmula para cobrar', x using errcode = 'P0001';
  end if;
  return null;
end $$;
drop trigger if exists ventas_exigen_formula on ventas;
create constraint trigger ventas_exigen_formula after insert on ventas deferrable initially deferred
  for each row execute function exigir_formula_venta();

-- ───────────── Libro de control especial ─────────────
create or replace view v_libro_control with (security_invoker = true) as
  select 'D' || vl.id::text as id, f.empresa_id, v.sede_id, 'dispensacion'::text as tipo, v.creado as fecha, vl.producto_id, vl.lote_id,
         vl.unidades as salida, 0 as reintegro, f.paciente_tipo_doc, f.paciente_doc, f.paciente_nombre, f.medico_nombre, f.medico_registro,
         f.formula_numero, f.formula_fecha, v.id as venta_id, v.prefijo, v.numero, v.usuario_id, null::text as motivo
  from venta_formulas f
  join ventas v on v.id = f.venta_id
  join venta_lineas vl on vl.venta_id = f.venta_id and vl.producto_id = f.producto_id
  where f.control
  union all
  select 'R' || m.id::text, f.empresa_id, m.sede_id, 'reintegro', m.creado, m.producto_id, m.lote_id,
         0, m.cantidad, f.paciente_tipo_doc, f.paciente_doc, f.paciente_nombre, f.medico_nombre, f.medico_registro,
         f.formula_numero, f.formula_fecha, v.id, v.prefijo, v.numero, m.usuario_id,
         case m.tipo when 'anulacion' then 'Anulación de la venta' else 'Devolución' end || coalesce(': ' || nullif(trim(m.motivo), ''), '')
  from movimientos m
  join venta_formulas f on f.venta_id = m.ref_id and f.producto_id = m.producto_id
  join ventas v on v.id = m.ref_id
  where f.control and m.tipo in ('anulacion', 'devolucion') and m.cantidad > 0;
revoke all on v_libro_control from anon, authenticated;
grant select on v_libro_control to authenticated;

revoke execute on function registrar_formulas_venta(uuid, jsonb), configurar_formulas(uuid, integer, boolean),
  exigir_formula_venta(), productos_formula() from public;
grant execute on function registrar_formulas_venta(uuid, jsonb), configurar_formulas(uuid, integer, boolean) to authenticated;
