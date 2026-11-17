-- Regenta: migración 049 (17/11/2026: modo «droguería interna (sin DIAN)» — entregas internas con lote por vencimiento, fórmula, comprobante y anulación; la base no deja vender en ese modo). Una sola transacción. Repetible. Requiere la 048 aplicada antes. Ninguna droguería cambia de modo: se activa por cliente desde la consola.
begin;
-- 049 · Modo «droguería interna (sin DIAN)» (17/11/2026). Aditiva y repetible.
--  · Para el servicio farmacéutico de una clínica o IPS, el botiquín de una empresa o la bodega que abastece a sus sedes:
--    no vende ni factura, ENTREGA. Lo activa la consola de Regenta (empresas.modo), nunca la droguería.
--  · En modo interno la base no deja crear ventas (disparador): no hay forma de usarlo para vender sin factura. Las ventas
--    históricas importadas (origen no nulo) sí entran.
--  · entregas / entrega_lineas / entrega_formulas: la entrega interna con su número consecutivo (EI), a quién se entregó,
--    para qué servicio y quién la autorizó; los lotes salen por vencimiento (FEFO, igual que la caja: nada vencido ni
--    separado por el INVIMA) y la fórmula se exige con las mismas reglas que en la caja. Todo inmutable: la anulación
--    (solo gerencia) devuelve las unidades con movimientos nuevos y marca la entrega, no la borra.
--  · movimientos.tipo admite 'entrega' (salida negativa; la anulación, positiva). El libro de control especial y la
--    predicción de compras cuentan las entregas igual que las ventas. Las droguerías que venden no cambian: no tienen
--    movimientos de entrega.

-- ───────────── Modo de la droguería ─────────────
alter table empresas add column if not exists modo text not null default 'venta';
alter table empresas drop constraint if exists empresas_modo_check;
alter table empresas add constraint empresas_modo_check check (modo in ('venta', 'interno'));

-- ───────────── Movimientos de entrega ─────────────
alter table movimientos drop constraint if exists movimientos_tipo_check;
alter table movimientos add constraint movimientos_tipo_check
  check (tipo in ('inicial', 'compra', 'venta', 'ajuste', 'devolucion', 'anulacion', 'entrega'));

-- ───────────── Entregas internas ─────────────
create table if not exists entregas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  sede_id uuid not null references sedes on delete cascade,
  numero integer not null check (numero > 0),
  destinatario_tipo text not null check (destinatario_tipo in ('empleado', 'paciente', 'servicio', 'sede', 'otro')),
  destinatario text not null check (length(destinatario) between 3 and 120),
  documento text check (documento is null or documento ~ '^[0-9A-Z]{3,20}$'),
  servicio text check (servicio is null or length(servicio) between 2 and 80),
  autoriza text not null check (length(autoriza) between 3 and 120),
  observacion text check (observacion is null or length(observacion) <= 300),
  unidades integer not null check (unidades > 0),
  idem_key text check (idem_key is null or length(idem_key) between 8 and 80),
  usuario_id uuid not null,
  creado timestamptz not null default now(),
  anulada timestamptz,
  anulada_por uuid,
  anulada_motivo text check (anulada_motivo is null or length(anulada_motivo) between 4 and 300),
  unique (empresa_id, numero),
  unique (empresa_id, idem_key),
  check ((anulada is null) = (anulada_motivo is null) and (anulada is null) = (anulada_por is null))
);
create index if not exists entregas_fecha on entregas (empresa_id, creado desc);

create table if not exists entrega_lineas (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  entrega_id uuid not null references entregas on delete cascade,
  producto_id uuid not null references productos,
  lote_id uuid not null references lotes on delete cascade,
  descripcion text not null,
  presentacion text not null check (presentacion in ('caja', 'unidad')),
  cantidad numeric(12, 3) not null check (cantidad > 0),
  unidades integer not null check (unidades > 0)
);
create index if not exists entrega_lineas_entrega on entrega_lineas (entrega_id);
create index if not exists entrega_lineas_producto on entrega_lineas (empresa_id, producto_id);

create table if not exists entrega_formulas (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  entrega_id uuid not null references entregas on delete cascade,
  producto_id uuid not null references productos,
  control boolean not null,
  verificada boolean not null,
  paciente_tipo_doc text check (paciente_tipo_doc in ('CC', 'TI', 'RC', 'CE', 'PA', 'PPT', 'PEP')),
  paciente_doc text check (paciente_doc ~ '^[0-9A-Z]{3,20}$'),
  paciente_nombre text check (length(paciente_nombre) between 3 and 120),
  medico_nombre text check (length(medico_nombre) between 3 and 120),
  medico_registro text check (length(medico_registro) between 2 and 40),
  formula_numero text check (length(formula_numero) between 1 and 40),
  formula_fecha date,
  usuario_id uuid not null,
  creado timestamptz not null default now(),
  unique (entrega_id, producto_id),
  check (not control or (verificada and paciente_tipo_doc is not null and paciente_doc is not null and paciente_nombre is not null
         and medico_nombre is not null and medico_registro is not null and formula_numero is not null and formula_fecha is not null))
);
create index if not exists entrega_formulas_empresa on entrega_formulas (empresa_id, creado desc);

-- Líneas y fórmulas: inmutables (no_modificar deja borrar solo al eliminar una droguería de prueba).
drop trigger if exists entrega_lineas_inmutables on entrega_lineas;
create trigger entrega_lineas_inmutables before update or delete on entrega_lineas for each row execute function no_modificar();
drop trigger if exists entrega_formulas_inmutables on entrega_formulas;
create trigger entrega_formulas_inmutables before update or delete on entrega_formulas for each row execute function no_modificar();

-- La entrega: lo único que cambia, una sola vez, es la marca de anulación.
create or replace function entregas_inmutables() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if current_user not in ('authenticated', 'anon') and current_setting('regenta.eliminar_empresa', true) = old.empresa_id::text then return old; end if;
    raise exception 'Las entregas no se borran: se anulan' using errcode = 'P0001';
  end if;
  if old.anulada is null and new.anulada is not null
     and (to_jsonb(new) - array['anulada', 'anulada_por', 'anulada_motivo']) = (to_jsonb(old) - array['anulada', 'anulada_por', 'anulada_motivo']) then
    return new;
  end if;
  raise exception 'Las entregas no se modifican: se anulan' using errcode = 'P0001';
end $$;
drop trigger if exists entregas_inmutables on entregas;
create trigger entregas_inmutables before update or delete on entregas for each row execute function entregas_inmutables();

-- Lectura: los miembros de la droguería (como sus movimientos); escritura solo por las funciones.
alter table entregas enable row level security;
alter table entrega_lineas enable row level security;
alter table entrega_formulas enable row level security;
drop policy if exists miembro_lee on entregas;
create policy miembro_lee on entregas for select to authenticated using (rol_en(empresa_id) is not null);
drop policy if exists miembro_lee on entrega_lineas;
create policy miembro_lee on entrega_lineas for select to authenticated using (rol_en(empresa_id) is not null);
drop policy if exists miembro_lee on entrega_formulas;
create policy miembro_lee on entrega_formulas for select to authenticated using (rol_en(empresa_id) is not null);
revoke all on entregas, entrega_lineas, entrega_formulas from anon, authenticated;
grant select on entregas, entrega_lineas, entrega_formulas to authenticated;

-- ───────────── En modo interno no se vende ─────────────
create or replace function ventas_modo_interno() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.origen is null and (select modo from empresas where id = new.empresa_id) = 'interno' then
    raise exception 'Esta droguería funciona en modo interno (sin DIAN): no vende ni factura. Registra la salida en Entregas' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists ventas_modo_interno on ventas;
create trigger ventas_modo_interno before insert on ventas for each row execute function ventas_modo_interno();

-- ───────────── Registrar una entrega ─────────────
-- p = { empresa_id, sede_id, idem_key?, destinatario_tipo, destinatario, documento?, servicio?, autoriza, observacion?,
--       lineas: [{ producto_id, presentacion: 'caja'|'unidad', cantidad }],
--       formula?: { verificada, paciente_tipo_doc, paciente_doc, paciente_nombre, medico_nombre, medico_registro,
--                   formula_numero, formula_fecha } }
create or replace function registrar_entrega(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := (p ->> 'empresa_id')::uuid;
  v_sede uuid := (p ->> 'sede_id')::uuid;
  v_rol text := rol_en(v_emp);
  e empresas;
  v_id uuid := gen_random_uuid();
  v_num integer;
  v_ex entregas;
  v_idem text := nullif(trim(coalesce(p ->> 'idem_key', '')), '');
  v_tipo text := p ->> 'destinatario_tipo';
  v_dest text := nullif(regexp_replace(trim(coalesce(p ->> 'destinatario', '')), '\s+', ' ', 'g'), '');
  v_docu text := upper(nullif(regexp_replace(coalesce(p ->> 'documento', ''), '[[:space:].-]', '', 'g'), ''));
  v_serv text := nullif(regexp_replace(trim(coalesce(p ->> 'servicio', '')), '\s+', ' ', 'g'), '');
  v_aut text := nullif(regexp_replace(trim(coalesce(p ->> 'autoriza', '')), '\s+', ' ', 'g'), '');
  v_obs text := nullif(trim(coalesce(p ->> 'observacion', '')), '');
  ln jsonb; v_prod productos; v_pres text; v_cant numeric; v_unid integer; v_total integer := 0;
  v_falta integer; v_toma integer; r record; v_parte numeric; v_asig numeric;
  f jsonb := coalesce(p -> 'formula', '{}'::jsonb);
  v_ftdoc text; v_fdoc text; v_fpac text; v_fmed text; v_freg text; v_fnum text; v_ffecha date; v_datos boolean; v_nform integer := 0;
begin
  if v_rol is null or v_rol not in ('dueno', 'admin', 'cajero', 'bodeguero') then
    raise exception 'No tienes permiso para registrar entregas en esta droguería' using errcode = '42501';
  end if;
  select * into e from empresas where id = v_emp;
  if e.modo <> 'interno' then
    raise exception 'Las entregas internas son del modo droguería interna: esta droguería vende con factura desde la caja' using errcode = 'P0001';
  end if;
  if e.estado <> 'activa' then raise exception 'La suscripción de esta droguería está suspendida' using errcode = 'P0001'; end if;
  if not exists (select 1 from sedes where id = v_sede and empresa_id = v_emp) then raise exception 'Sede no válida' using errcode = 'P0001'; end if;

  -- La misma entrega enviada dos veces (doble clic, corte de red) se registra una sola vez.
  if v_idem is not null then
    perform pg_advisory_xact_lock(hashtext(v_emp::text || ':entrega:' || v_idem));
    select * into v_ex from entregas where empresa_id = v_emp and idem_key = v_idem;
    if found then return jsonb_build_object('entrega_id', v_ex.id, 'numero', v_ex.numero, 'unidades', v_ex.unidades, 'repetida', true); end if;
  end if;

  if v_tipo is null or v_tipo not in ('empleado', 'paciente', 'servicio', 'sede', 'otro') then raise exception 'Elige a quién se entrega' using errcode = 'P0001'; end if;
  if v_dest is null or length(v_dest) < 3 or length(v_dest) > 120 then raise exception 'Escribe el nombre de quien recibe (de 3 a 120 caracteres)' using errcode = 'P0001'; end if;
  if v_docu is not null and v_docu !~ '^[0-9A-Z]{3,20}$' then raise exception 'El documento de quien recibe va sin puntos (de 3 a 20 letras o dígitos)' using errcode = 'P0001'; end if;
  if v_serv is not null and (length(v_serv) < 2 or length(v_serv) > 80) then raise exception 'El servicio o área va de 2 a 80 caracteres' using errcode = 'P0001'; end if;
  if v_aut is null or length(v_aut) < 3 or length(v_aut) > 120 then raise exception 'Escribe quién autoriza la entrega' using errcode = 'P0001'; end if;
  if v_obs is not null and length(v_obs) > 300 then raise exception 'La observación va hasta 300 caracteres' using errcode = 'P0001'; end if;
  if jsonb_typeof(p -> 'lineas') is distinct from 'array' or jsonb_array_length(p -> 'lineas') = 0 then
    raise exception 'Agrega al menos un producto a la entrega' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p -> 'lineas') > 100 then raise exception 'Una entrega lleva hasta 100 productos' using errcode = 'P0001'; end if;

  -- Unidades de la entrega (con validación de cada línea) antes de tocar nada.
  for ln in select * from jsonb_array_elements(p -> 'lineas') loop
    select * into v_prod from productos where id = (ln ->> 'producto_id')::uuid and empresa_id = v_emp and activo;
    if not found then raise exception 'Producto no válido' using errcode = 'P0001'; end if;
    v_pres := coalesce(ln ->> 'presentacion', 'caja');
    if v_pres not in ('caja', 'unidad') then raise exception 'Presentación no válida' using errcode = 'P0001'; end if;
    v_cant := (ln ->> 'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 or v_cant <> trunc(v_cant) or v_cant > 100000 then raise exception 'Cantidad no válida en %', v_prod.nombre using errcode = 'P0001'; end if;
    v_total := v_total + (v_cant * case when v_pres = 'caja' then v_prod.unidades_por_caja else 1 end)::integer;
  end loop;

  perform pg_advisory_xact_lock(hashtext('entregas:' || v_emp::text));
  select coalesce(max(numero), 0) + 1 into v_num from entregas where empresa_id = v_emp;
  insert into entregas (id, empresa_id, sede_id, numero, destinatario_tipo, destinatario, documento, servicio, autoriza, observacion, unidades, idem_key, usuario_id)
  values (v_id, v_emp, v_sede, v_num, v_tipo, v_dest, v_docu, v_serv, v_aut, v_obs, v_total, v_idem, auth.uid());

  -- Candados por producto en orden fijo (evita bloqueos mutuos con una venta, otra entrega o un ajuste).
  perform pg_advisory_xact_lock(hashtext(x)) from (select distinct e2 ->> 'producto_id' x from jsonb_array_elements(p -> 'lineas') e2 order by 1) s;

  for ln in select * from jsonb_array_elements(p -> 'lineas') loop
    select * into v_prod from productos where id = (ln ->> 'producto_id')::uuid;
    v_pres := coalesce(ln ->> 'presentacion', 'caja');
    v_cant := (ln ->> 'cantidad')::numeric;
    v_unid := (v_cant * case when v_pres = 'caja' then v_prod.unidades_por_caja else 1 end)::integer;
    perform pg_advisory_xact_lock(hashtext(v_prod.id::text));
    v_falta := v_unid; v_asig := 0;
    -- Lotes vigentes de esta sede, el que vence antes primero (FEFO); nunca vencidos ni separados por una alerta.
    for r in
      select s.lote_id, s.unidades from v_stock_lotes s
      where s.producto_id = v_prod.id and s.sede_id = v_sede and s.unidades > 0 and (s.vence is null or s.vence >= current_date) and not s.bloqueado
      order by s.vence nulls last, s.lote_id
    loop
      exit when v_falta = 0;
      v_toma := least(v_falta, r.unidades);
      v_parte := case when v_toma = v_falta then v_cant - v_asig else round(v_cant * v_toma / v_unid, 3) end;
      v_asig := v_asig + v_parte;
      insert into entrega_lineas (empresa_id, entrega_id, producto_id, lote_id, descripcion, presentacion, cantidad, unidades)
      values (v_emp, v_id, v_prod.id, r.lote_id, v_prod.nombre, v_pres, v_parte, v_toma);
      insert into movimientos (empresa_id, sede_id, producto_id, lote_id, cantidad, tipo, ref_id, motivo, usuario_id)
      values (v_emp, v_sede, v_prod.id, r.lote_id, -v_toma, 'entrega', v_id, 'Entrega interna EI-' || v_num, auth.uid());
      v_falta := v_falta - v_toma;
    end loop;
    if v_falta > 0 then
      if exists (select 1 from v_stock_lotes s where s.producto_id = v_prod.id and s.sede_id = v_sede and s.unidades > 0 and s.bloqueado) then
        raise exception 'No hay existencias suficientes de % para entregar (faltan % unidades; hay lotes separados por una alerta del INVIMA)', v_prod.nombre, v_falta using errcode = 'P0001';
      end if;
      if exists (select 1 from v_stock_lotes s where s.producto_id = v_prod.id and s.sede_id = v_sede and s.unidades > 0 and s.vence < current_date) then
        raise exception 'No hay existencias vigentes suficientes de % (faltan % unidades; lo demás está vencido y no se entrega)', v_prod.nombre, v_falta using errcode = 'P0001';
      end if;
      raise exception 'No hay existencias suficientes de % (faltan % unidades)', v_prod.nombre, v_falta using errcode = 'P0001';
    end if;
  end loop;

  -- Fórmula médica: las mismas reglas que la caja (control especial siempre con todos los datos y vigente).
  v_ftdoc := upper(nullif(trim(coalesce(f ->> 'paciente_tipo_doc', '')), ''));
  v_fdoc := upper(nullif(regexp_replace(coalesce(f ->> 'paciente_doc', ''), '[[:space:].-]', '', 'g'), ''));
  v_fpac := nullif(regexp_replace(trim(coalesce(f ->> 'paciente_nombre', '')), '\s+', ' ', 'g'), '');
  v_fmed := nullif(regexp_replace(trim(coalesce(f ->> 'medico_nombre', '')), '\s+', ' ', 'g'), '');
  v_freg := upper(nullif(trim(coalesce(f ->> 'medico_registro', '')), ''));
  v_fnum := upper(nullif(trim(coalesce(f ->> 'formula_numero', '')), ''));
  begin
    v_ffecha := nullif(f ->> 'formula_fecha', '')::date;
  exception when others then
    raise exception 'La fecha de la fórmula no es válida' using errcode = 'P0001';
  end;
  for r in
    select distinct pr.id, pr.nombre, pr.control_especial from entrega_lineas el join productos pr on pr.id = el.producto_id
    where el.entrega_id = v_id and (pr.requiere_formula or pr.control_especial) order by pr.nombre
  loop
    v_datos := r.control_especial or e.formula_exige_datos;
    if v_datos then
      if v_ftdoc is null or v_ftdoc not in ('CC', 'TI', 'RC', 'CE', 'PA', 'PPT', 'PEP') then raise exception 'Elige el tipo de documento del paciente' using errcode = 'P0001'; end if;
      if v_fdoc is null or v_fdoc !~ '^[0-9A-Z]{3,20}$' then raise exception 'Escribe el número de documento del paciente (sin puntos)' using errcode = 'P0001'; end if;
      if v_fpac is null or length(v_fpac) < 3 or length(v_fpac) > 120 then raise exception 'Escribe el nombre completo del paciente' using errcode = 'P0001'; end if;
      if v_fmed is null or length(v_fmed) < 3 or length(v_fmed) > 120 then raise exception 'Escribe el nombre del médico que firma la fórmula' using errcode = 'P0001'; end if;
      if v_freg is null or length(v_freg) < 2 or length(v_freg) > 40 then raise exception 'Escribe el registro profesional del médico' using errcode = 'P0001'; end if;
      if v_fnum is null or length(v_fnum) > 40 then raise exception 'Escribe el número de la fórmula' using errcode = 'P0001'; end if;
      if v_ffecha is null then raise exception 'Escribe la fecha de la fórmula' using errcode = 'P0001'; end if;
      if v_ffecha > (now() at time zone 'America/Bogota')::date then raise exception 'La fecha de la fórmula no puede ser posterior a hoy' using errcode = 'P0001'; end if;
      if r.control_especial and v_ffecha < (now() at time zone 'America/Bogota')::date - e.formula_vigencia_dias then
        raise exception 'La fórmula de % ya no está vigente: tiene más de % días (plazo configurado por tu droguería)', r.nombre, e.formula_vigencia_dias using errcode = 'P0001';
      end if;
    elsif not coalesce((f ->> 'verificada')::boolean, false) then
      raise exception '% se entrega con fórmula médica: confirma que la verificaste', r.nombre using errcode = 'P0001';
    end if;
    insert into entrega_formulas (empresa_id, entrega_id, producto_id, control, verificada, paciente_tipo_doc, paciente_doc, paciente_nombre,
                                  medico_nombre, medico_registro, formula_numero, formula_fecha, usuario_id)
    values (v_emp, v_id, r.id, r.control_especial, true,
            case when v_datos then v_ftdoc end, case when v_datos then v_fdoc end, case when v_datos then v_fpac end,
            case when v_datos then v_fmed end, case when v_datos then v_freg end, case when v_datos then v_fnum end,
            case when v_datos then v_ffecha end, auth.uid());
    v_nform := v_nform + 1;
  end loop;

  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v_emp, auth.uid(), 'entrega_interna', 'entregas', v_id::text, jsonb_build_object('numero', 'EI-' || v_num, 'destinatario', v_dest,
          'servicio', v_serv, 'autoriza', v_aut, 'unidades', v_total, 'formulas', v_nform));
  return jsonb_build_object('entrega_id', v_id, 'numero', v_num, 'unidades', v_total, 'repetida', false);
end $$;

-- ───────────── Anular una entrega (dueño o administrador) ─────────────
-- Devuelve cada unidad a su mismo lote con un movimiento nuevo y deja la entrega marcada: nada se borra.
create or replace function anular_entrega(p_entrega uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare en entregas; v_mot text := nullif(regexp_replace(trim(coalesce(p_motivo, '')), '\s+', ' ', 'g'), ''); n integer := 0; l record;
begin
  select * into en from entregas where id = p_entrega for update;
  if not found or coalesce(rol_en(en.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador anulan entregas' using errcode = '42501';
  end if;
  if en.anulada is not null then raise exception 'La entrega EI-% ya estaba anulada', en.numero using errcode = 'P0001'; end if;
  if v_mot is null or length(v_mot) < 4 or length(v_mot) > 300 then raise exception 'Escribe el motivo de la anulación (de 4 a 300 caracteres)' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext(x)) from (select distinct producto_id::text x from entrega_lineas where entrega_id = p_entrega order by 1) s;
  for l in select producto_id, lote_id, unidades from entrega_lineas where entrega_id = p_entrega order by id loop
    insert into movimientos (empresa_id, sede_id, producto_id, lote_id, cantidad, tipo, ref_id, motivo, usuario_id)
    values (en.empresa_id, en.sede_id, l.producto_id, l.lote_id, l.unidades, 'entrega', p_entrega, 'Anulación de la entrega EI-' || en.numero || ': ' || v_mot, auth.uid());
    n := n + l.unidades;
  end loop;
  update entregas set anulada = now(), anulada_por = auth.uid(), anulada_motivo = v_mot where id = p_entrega;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (en.empresa_id, auth.uid(), 'anular_entrega', 'entregas', p_entrega::text, jsonb_build_object('numero', 'EI-' || en.numero, 'motivo', v_mot, 'unidades', n));
  return jsonb_build_object('numero', en.numero, 'unidades', n);
end $$;

revoke all on function registrar_entrega(jsonb), anular_entrega(uuid, text), ventas_modo_interno(), entregas_inmutables() from public, anon;
grant execute on function registrar_entrega(jsonb), anular_entrega(uuid, text) to authenticated;

-- ───────────── Libro de control especial: las entregas con fórmula de control son dispensaciones ─────────────
-- Mismas columnas y mismo orden que en la 030; se agrega entrega_id al final (null en las ventas).
create or replace view v_libro_control with (security_invoker = true) as
  select 'D' || vl.id::text as id, f.empresa_id, v.sede_id, 'dispensacion'::text as tipo, v.creado as fecha, vl.producto_id, vl.lote_id,
         vl.unidades as salida, 0 as reintegro, f.paciente_tipo_doc, f.paciente_doc, f.paciente_nombre, f.medico_nombre, f.medico_registro,
         f.formula_numero, f.formula_fecha, v.id as venta_id, v.prefijo, v.numero, v.usuario_id, null::text as motivo, null::uuid as entrega_id
  from venta_formulas f
  join ventas v on v.id = f.venta_id
  join venta_lineas vl on vl.venta_id = f.venta_id and vl.producto_id = f.producto_id
  where f.control
  union all
  select 'R' || m.id::text, f.empresa_id, m.sede_id, 'reintegro', m.creado, m.producto_id, m.lote_id, 0, m.cantidad,
         f.paciente_tipo_doc, f.paciente_doc, f.paciente_nombre, f.medico_nombre, f.medico_registro, f.formula_numero, f.formula_fecha,
         v.id, v.prefijo, v.numero, m.usuario_id,
         case m.tipo when 'anulacion' then 'Anulación de la venta' else 'Devolución' end || coalesce(': ' || nullif(trim(m.motivo), ''), ''), null::uuid
  from movimientos m
  join venta_formulas f on f.venta_id = m.ref_id and f.producto_id = m.producto_id
  join ventas v on v.id = m.ref_id
  where f.control and m.tipo in ('anulacion', 'devolucion') and m.cantidad > 0
  union all
  select 'E' || el.id::text, f.empresa_id, en.sede_id, 'dispensacion', en.creado, el.producto_id, el.lote_id, el.unidades, 0,
         f.paciente_tipo_doc, f.paciente_doc, f.paciente_nombre, f.medico_nombre, f.medico_registro, f.formula_numero, f.formula_fecha,
         null::uuid, 'EI-'::text, en.numero::bigint, en.usuario_id, null::text, en.id
  from entrega_formulas f
  join entregas en on en.id = f.entrega_id
  join entrega_lineas el on el.entrega_id = f.entrega_id and el.producto_id = f.producto_id
  where f.control
  union all
  select 'R' || m.id::text, f.empresa_id, m.sede_id, 'reintegro', m.creado, m.producto_id, m.lote_id, 0, m.cantidad,
         f.paciente_tipo_doc, f.paciente_doc, f.paciente_nombre, f.medico_nombre, f.medico_registro, f.formula_numero, f.formula_fecha,
         null::uuid, 'EI-'::text, en.numero::bigint, m.usuario_id, coalesce(nullif(trim(m.motivo), ''), 'Anulación de la entrega'), en.id
  from movimientos m
  join entrega_formulas f on f.entrega_id = m.ref_id and f.producto_id = m.producto_id
  join entregas en on en.id = m.ref_id
  where f.control and m.tipo = 'entrega' and m.cantidad > 0;

-- ───────────── Predicción de compras: también con el consumo de las entregas ─────────────
-- Igual que antes para las ventas (solo cerradas); las entregas cuentan si no están anuladas.
create or replace function prediccion_productos(p_empresa uuid, p_dias_reposicion integer default 3, p_dias_cobertura integer default 15)
returns table (producto_id uuid, nombre text, laboratorio text, unidades_por_caja integer, stock_minimo integer, existencias integer,
               venta_dia numeric, dias_cobertura numeric, tendencia numeric, sugerido_unidades integer, sugerido_cajas integer, ultima_venta date)
language sql stable set search_path = public set jit = off as $$
  with vend as (
    select m.producto_id,
           -sum(m.cantidad) filter (where m.creado >= now() - interval '14 days') u14,
           -sum(m.cantidad) filter (where m.creado < now() - interval '14 days') u42,
           max(m.creado) ultima
    from movimientos m
    left join ventas v on m.tipo = 'venta' and v.id = m.ref_id
    left join entregas en on m.tipo = 'entrega' and en.id = m.ref_id
    where m.empresa_id = p_empresa and m.tipo in ('venta', 'entrega') and m.creado >= now() - interval '56 days'
      and ((m.tipo = 'venta' and v.estado = 'cerrada') or (m.tipo = 'entrega' and en.anulada is null))
    group by m.producto_id
  ), stock as (
    select s.producto_id, sum(s.unidades)::integer unidades from v_stock_vigente s where s.empresa_id = p_empresa group by s.producto_id
  ), base as (
    select p.id, p.nombre, p.laboratorio, p.unidades_por_caja, p.stock_minimo,
           coalesce(st.unidades, 0) existencias,
           round(0.6 * coalesce(v.u14, 0) / 14.0 + 0.4 * coalesce(v.u42, 0) / 42.0, 3) venta_dia,
           case when coalesce(v.u42, 0) > 0 then round((coalesce(v.u14, 0) / 14.0) / (v.u42 / 42.0), 2) end tendencia,
           (v.ultima at time zone 'America/Bogota')::date ultima
    from productos p
    left join vend v on v.producto_id = p.id
    left join stock st on st.producto_id = p.id
    where p.empresa_id = p_empresa and p.activo
  )
  select b.id, b.nombre, b.laboratorio, b.unidades_por_caja, b.stock_minimo, b.existencias, b.venta_dia,
         case when b.venta_dia > 0 then round(b.existencias / b.venta_dia, 1) end,
         b.tendencia, n.unidades, ceil(n.unidades::numeric / b.unidades_por_caja)::integer, b.ultima
  from base b
  cross join lateral (select greatest(0, ceil(greatest(b.venta_dia * (p_dias_reposicion + p_dias_cobertura), b.stock_minimo * b.unidades_por_caja) - b.existencias))::integer unidades) n
$$;
insert into regenta_migraciones (nombre) values ('049_modo_interno.sql') on conflict do nothing;
commit;
