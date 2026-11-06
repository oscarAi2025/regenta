-- Regenta · cumplimiento (frente B):
--  1) Planilla de temperatura y humedad relativa: dos jornadas al día (mañana y tarde) por área (almacenamiento general
--     y cadena de frío). Los registros son inmutables: un error se corrige con un registro nuevo que anula al anterior
--     con su motivo; el anterior queda a la vista. El rango aceptable lo configura cada droguería (hay valores de partida).
--  2) Documentos electrónicos: índice para listar los documentos DIAN de una empresa por fecha (pantalla Documentos).

-- ───────────────────────── Documentos electrónicos ─────────────────────────
create index if not exists documentos_empresa_creado on documentos_dian (empresa_id, creado desc, id desc);

-- ───────────────────────── Rangos por droguería ─────────────────────────
-- Sin fila = valores de partida (rangos_temperatura los completa). Humedad null = no se controla en esa área.
create table if not exists temperatura_rangos (
  empresa_id uuid not null references empresas on delete cascade,
  area text not null check (area in ('general', 'frio')),
  temp_min numeric(4, 1) not null check (temp_min between -30 and 60),
  temp_max numeric(4, 1) not null check (temp_max between -30 and 60),
  hum_min numeric(4, 1) check (hum_min between 0 and 100),
  hum_max numeric(4, 1) check (hum_max between 0 and 100),
  actualizado timestamptz not null default now(),
  actualizado_por uuid,
  primary key (empresa_id, area),
  check (temp_min < temp_max),
  check ((hum_min is null) = (hum_max is null) and (hum_min is null or hum_min < hum_max))
);

-- ───────────────────────── Registros ─────────────────────────
create table if not exists temperatura_registros (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  sede_id uuid not null references sedes on delete cascade,
  fecha date not null,
  jornada text not null check (jornada in ('manana', 'tarde')),
  area text not null check (area in ('general', 'frio')),
  temperatura numeric(4, 1) not null check (temperatura between -30 and 60),
  humedad numeric(4, 1) check (humedad between 0 and 100),
  -- Rango vigente al registrar (si la droguería lo cambia después, el registro conserva contra qué se midió).
  temp_min numeric(4, 1) not null,
  temp_max numeric(4, 1) not null,
  hum_min numeric(4, 1),
  hum_max numeric(4, 1),
  fuera_rango boolean not null,
  accion text check (accion is null or length(accion) <= 500),
  observacion text check (observacion is null or length(observacion) <= 500),
  responsable_id uuid not null,
  responsable text not null,
  anula_id uuid references temperatura_registros, -- este registro corrige (y deja sin efecto) a otro
  motivo text check (motivo is null or length(motivo) <= 300),
  creado timestamptz not null default now(),
  check (not fuera_rango or length(trim(coalesce(accion, ''))) >= 5),
  check (anula_id is null or length(trim(coalesce(motivo, ''))) >= 4)
);
create index if not exists temperatura_registros_mes on temperatura_registros (empresa_id, sede_id, fecha);
-- Un registro se corrige una sola vez (la corrección, a su vez, puede corregirse).
create unique index if not exists temperatura_registros_anula on temperatura_registros (anula_id) where anula_id is not null;

drop trigger if exists temperatura_inmutable on temperatura_registros;
create trigger temperatura_inmutable before update or delete on temperatura_registros for each row execute function no_modificar();

-- ───────────────────────── Seguridad ─────────────────────────
alter table temperatura_rangos enable row level security;
alter table temperatura_registros enable row level security;
drop policy if exists inventario_lee on temperatura_rangos;
drop policy if exists inventario_lee on temperatura_registros;
create policy inventario_lee on temperatura_rangos for select to authenticated
  using (empresa_id in (select mis_empresas(array['dueno', 'admin', 'bodeguero'])));
create policy inventario_lee on temperatura_registros for select to authenticated
  using (empresa_id in (select mis_empresas(array['dueno', 'admin', 'bodeguero'])));
revoke all on temperatura_rangos, temperatura_registros from public, anon, authenticated;
grant select on temperatura_rangos, temperatura_registros to authenticated;

-- Rangos de una empresa por área: los configurados o los de partida (respeta la RLS de quien consulta).
create or replace function rangos_temperatura(p_empresa uuid)
returns table (area text, temp_min numeric, temp_max numeric, hum_min numeric, hum_max numeric, personalizado boolean)
language sql stable set search_path = public as $$
  select d.area, coalesce(r.temp_min, d.temp_min), coalesce(r.temp_max, d.temp_max),
         case when r.area is null then d.hum_min else r.hum_min end, case when r.area is null then d.hum_max else r.hum_max end,
         r.area is not null
  from (values ('general', 15.0, 30.0, 30.0, 70.0), ('frio', 2.0, 8.0, null, null)) as d(area, temp_min, temp_max, hum_min, hum_max)
  left join temperatura_rangos r on r.empresa_id = p_empresa and r.area = d.area
  order by d.area = 'frio', d.area
$$;

-- p = { empresa_id, sede_id, fecha, jornada, area, temperatura, humedad?, accion?, observacion?, anula_id?, motivo? }
-- Con anula_id es una corrección: toma sede, fecha, jornada y área del registro corregido.
create or replace function registrar_temperatura(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := (p ->> 'empresa_id')::uuid;
  v_rol text := rol_en(v_emp);
  v_sede uuid := nullif(p ->> 'sede_id', '')::uuid;
  v_fecha date := nullif(p ->> 'fecha', '')::date;
  v_jornada text := p ->> 'jornada';
  v_area text := p ->> 'area';
  v_temp numeric := round((p ->> 'temperatura')::numeric, 1);
  v_hum numeric := round(nullif(p ->> 'humedad', '')::numeric, 1);
  v_accion text := nullif(trim(coalesce(p ->> 'accion', '')), '');
  v_obs text := nullif(trim(coalesce(p ->> 'observacion', '')), '');
  v_anula uuid := nullif(p ->> 'anula_id', '')::uuid;
  v_motivo text := nullif(trim(coalesce(p ->> 'motivo', '')), '');
  o temperatura_registros; rg record; v_fuera boolean; v_id uuid; v_nombre text;
begin
  if coalesce(v_rol, '') not in ('dueno', 'admin', 'bodeguero') then
    raise exception 'No tienes permiso para registrar la temperatura' using errcode = '42501';
  end if;
  if (select estado from empresas where id = v_emp) <> 'activa' then
    raise exception 'La suscripción de esta empresa está suspendida' using errcode = 'P0001';
  end if;
  if v_anula is not null then
    select * into o from temperatura_registros where id = v_anula and empresa_id = v_emp for update;
    if not found then raise exception 'El registro que quieres corregir no existe' using errcode = 'P0001'; end if;
    if length(coalesce(v_motivo, '')) < 4 then raise exception 'Escribe el motivo de la corrección' using errcode = 'P0001'; end if;
    v_sede := o.sede_id; v_fecha := o.fecha; v_jornada := o.jornada; v_area := o.area;
  end if;
  if v_jornada is null or v_jornada not in ('manana', 'tarde') then raise exception 'Elige la jornada (mañana o tarde)' using errcode = 'P0001'; end if;
  if v_area is null or v_area not in ('general', 'frio') then raise exception 'Elige el área' using errcode = 'P0001'; end if;
  if not exists (select 1 from sedes where id = v_sede and empresa_id = v_emp) then raise exception 'Sede no válida' using errcode = 'P0001'; end if;
  if v_fecha is null or v_fecha > current_date then raise exception 'La fecha no puede ser futura' using errcode = 'P0001'; end if;
  if v_anula is null and v_fecha < current_date - 7 then
    raise exception 'Solo se registran jornadas de los últimos 7 días' using errcode = 'P0001';
  end if;
  if v_temp is null or v_temp < -30 or v_temp > 60 then raise exception 'Revisa la temperatura: debe estar entre -30 y 60 °C' using errcode = 'P0001'; end if;
  if v_hum is not null and (v_hum < 0 or v_hum > 100) then raise exception 'La humedad relativa va de 0 a 100 %%' using errcode = 'P0001'; end if;
  if v_area = 'general' and v_hum is null then raise exception 'Escribe la humedad relativa' using errcode = 'P0001'; end if;
  if length(coalesce(v_obs, '')) > 500 or length(coalesce(v_accion, '')) > 500 then raise exception 'El texto es demasiado largo (máximo 500 caracteres)' using errcode = 'P0001'; end if;

  -- Una jornada por área, sede y día: dos registros a la vez del mismo puesto no se cruzan.
  perform pg_advisory_xact_lock(hashtext('temperatura:' || v_sede::text || v_fecha::text || v_jornada || v_area));
  if v_anula is null then
    if exists (select 1 from temperatura_registros r where r.sede_id = v_sede and r.fecha = v_fecha and r.jornada = v_jornada and r.area = v_area
               and not exists (select 1 from temperatura_registros x where x.anula_id = r.id)) then
      raise exception 'Esa jornada ya está registrada: si hay un error, usa «Corregir»' using errcode = 'P0001';
    end if;
  elsif exists (select 1 from temperatura_registros x where x.anula_id = v_anula) then
    raise exception 'Ese registro ya fue corregido: corrige el registro vigente' using errcode = 'P0001';
  end if;

  select * into rg from rangos_temperatura(v_emp) x where x.area = v_area;
  v_fuera := v_temp < rg.temp_min or v_temp > rg.temp_max
             or (v_hum is not null and rg.hum_min is not null and (v_hum < rg.hum_min or v_hum > rg.hum_max));
  if v_fuera and length(coalesce(v_accion, '')) < 5 then
    raise exception 'El valor está fuera del rango configurado por tu droguería: escribe la acción correctiva' using errcode = 'P0001';
  end if;
  select nombre into v_nombre from miembros where empresa_id = v_emp and user_id = auth.uid();

  insert into temperatura_registros (empresa_id, sede_id, fecha, jornada, area, temperatura, humedad, temp_min, temp_max, hum_min, hum_max,
                                     fuera_rango, accion, observacion, responsable_id, responsable, anula_id, motivo)
  values (v_emp, v_sede, v_fecha, v_jornada, v_area, v_temp, v_hum, rg.temp_min, rg.temp_max, rg.hum_min, rg.hum_max,
          v_fuera, case when v_fuera then v_accion end, v_obs, auth.uid(), coalesce(v_nombre, 'Usuario'), v_anula, case when v_anula is not null then v_motivo end)
  returning id into v_id;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v_emp, auth.uid(), case when v_anula is null then 'registrar_temperatura' else 'corregir_temperatura' end, 'temperatura_registros', v_id::text,
          jsonb_build_object('fecha', v_fecha, 'jornada', v_jornada, 'area', v_area, 'temperatura', v_temp, 'humedad', v_hum, 'fuera_rango', v_fuera,
                             'corrige', v_anula, 'motivo', v_motivo));
  return jsonb_build_object('id', v_id, 'fuera_rango', v_fuera, 'fecha', v_fecha, 'jornada', v_jornada, 'area', v_area);
end $$;

-- Rango de un área (dueño o administrador). Humedad null = no se controla.
create or replace function configurar_rango_temperatura(p_empresa uuid, p_area text, p_tmin numeric, p_tmax numeric, p_hmin numeric, p_hmax numeric) returns void
language plpgsql security definer set search_path = public as $$
declare antes record;
begin
  if coalesce(rol_en(p_empresa), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador cambian los rangos' using errcode = '42501';
  end if;
  if p_area is null or p_area not in ('general', 'frio') then raise exception 'Área no válida' using errcode = 'P0001'; end if;
  if p_tmin is null or p_tmax is null or p_tmin < -30 or p_tmax > 60 or p_tmin >= p_tmax then
    raise exception 'La temperatura mínima debe ser menor que la máxima (entre -30 y 60 °C)' using errcode = 'P0001';
  end if;
  if (p_hmin is null) <> (p_hmax is null) then raise exception 'Escribe la humedad mínima y la máxima, o deja las dos vacías' using errcode = 'P0001'; end if;
  if p_hmin is not null and (p_hmin < 0 or p_hmax > 100 or p_hmin >= p_hmax) then
    raise exception 'La humedad mínima debe ser menor que la máxima (entre 0 y 100 %%)' using errcode = 'P0001';
  end if;
  if p_area = 'general' and p_hmin is null then raise exception 'El almacenamiento general necesita rango de humedad' using errcode = 'P0001'; end if;
  select * into antes from rangos_temperatura(p_empresa) x where x.area = p_area;
  insert into temperatura_rangos (empresa_id, area, temp_min, temp_max, hum_min, hum_max, actualizado, actualizado_por)
  values (p_empresa, p_area, round(p_tmin, 1), round(p_tmax, 1), round(p_hmin, 1), round(p_hmax, 1), now(), auth.uid())
  on conflict (empresa_id, area) do update set temp_min = excluded.temp_min, temp_max = excluded.temp_max, hum_min = excluded.hum_min,
    hum_max = excluded.hum_max, actualizado = now(), actualizado_por = auth.uid();
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (p_empresa, auth.uid(), 'rango_temperatura', 'temperatura_rangos', p_area,
          jsonb_build_object('antes', jsonb_build_array(antes.temp_min, antes.temp_max, antes.hum_min, antes.hum_max),
                             'despues', jsonb_build_array(round(p_tmin, 1), round(p_tmax, 1), round(p_hmin, 1), round(p_hmax, 1))));
end $$;

revoke execute on function rangos_temperatura(uuid), registrar_temperatura(jsonb), configurar_rango_temperatura(uuid, text, numeric, numeric, numeric, numeric) from public, anon;
grant execute on function rangos_temperatura(uuid), registrar_temperatura(jsonb), configurar_rango_temperatura(uuid, text, numeric, numeric, numeric, numeric) to authenticated;
