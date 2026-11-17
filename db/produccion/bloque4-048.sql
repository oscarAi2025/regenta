-- Regenta: migración 048 (17/11/2026: control especial — ficha del medicamento, configuración del informe mensual Anexo 13 y registro de informes presentados). Una sola transacción. Repetible. Solo agrega; no modifica nada existente.
begin;
-- 048 · Control especial: ficha del medicamento, configuración del informe mensual (Anexo 13) y registro de informes
--       presentados (17/11/2026). Aditiva y repetible: solo crea tablas y funciones nuevas; no toca productos, empresas,
--       ventas, movimientos ni nada de la migración 030.
--  · Las CANTIDADES del libro y del informe salen de los movimientos de inventario (ya inmutables): aquí no se guarda
--    ninguna cantidad propia, así el informe cuadra con el inventario por construcción.
--  · control_fichas: datos farmacológicos que pide el informe (principio activo —DCI—, concentración, forma farmacéutica,
--    CUM y listado de la Res. 315/2020 al que pertenece). Uno por producto. Los cambios quedan en la auditoría.
--  · control_config: por droguería, departamento y fondo rotatorio al que reporta, canal de envío, responsable y la
--    plantilla de columnas del informe (JSON: [{campo, titulo}]); null = plantilla base de Regenta.
--  · control_informes: cada informe mensual marcado como presentado (fecha, canal, radicado y los totales que se
--    presentaron). Inmutable: una corrección es un registro nuevo que reemplaza al anterior.
--  · Solo dueño y administrador leen y escriben (datos regulatorios); se escribe únicamente por las funciones.

-- ───────────── Ficha del medicamento de control especial ─────────────
create table if not exists control_fichas (
  producto_id uuid primary key references productos on delete cascade,
  empresa_id uuid not null references empresas on delete cascade,
  principio_activo text check (principio_activo is null or length(principio_activo) between 2 and 160),
  concentracion text check (concentracion is null or length(concentracion) between 1 and 80),
  forma_farmaceutica text check (forma_farmaceutica is null or length(forma_farmaceutica) between 2 and 80),
  cum text check (cum is null or cum ~ '^[0-9]{1,12}(-[0-9]{1,4})?$'),
  categoria text check (categoria is null or length(categoria) between 2 and 120),
  usuario_id uuid,
  actualizado timestamptz not null default now()
);
create index if not exists control_fichas_empresa on control_fichas (empresa_id);

-- ───────────── Configuración del informe mensual por droguería ─────────────
create table if not exists control_config (
  empresa_id uuid primary key references empresas on delete cascade,
  departamento text check (departamento is null or length(departamento) between 3 and 60),
  fondo text check (fondo is null or length(fondo) between 3 and 160),
  canal text check (canal is null or canal in ('correo', 'plataforma', 'presencial', 'otro')),
  destino text check (destino is null or length(destino) between 3 and 200),
  responsable text check (responsable is null or length(responsable) between 3 and 120),
  responsable_registro text check (responsable_registro is null or length(responsable_registro) between 2 and 40),
  plantilla jsonb check (plantilla is null or (jsonb_typeof(plantilla) = 'array' and jsonb_array_length(plantilla) between 1 and 40)),
  usuario_id uuid,
  actualizado timestamptz not null default now()
);

-- ───────────── Informes presentados (inmutable) ─────────────
create table if not exists control_informes (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  sede_id uuid references sedes on delete cascade,          -- null = toda la droguería
  periodo date not null check (extract(day from periodo) = 1), -- primer día del mes informado
  presentado date not null,
  canal text not null check (canal in ('correo', 'plataforma', 'presencial', 'otro')),
  radicado text check (radicado is null or length(radicado) between 1 and 80),
  observacion text check (observacion is null or length(observacion) <= 500),
  totales jsonb not null check (jsonb_typeof(totales) = 'object'),  -- lo que se presentó (productos, entradas, salidas…)
  reemplaza bigint references control_informes,
  usuario_id uuid not null,
  creado timestamptz not null default now()
);
create index if not exists control_informes_periodo on control_informes (empresa_id, periodo desc);

drop trigger if exists control_informes_inmutables on control_informes;
create trigger control_informes_inmutables before update or delete on control_informes for each row execute function no_modificar();

-- ───────────── Seguridad por fila: solo la gerencia de la droguería ─────────────
alter table control_fichas enable row level security;
alter table control_config enable row level security;
alter table control_informes enable row level security;
drop policy if exists gerencia_lee on control_fichas;
create policy gerencia_lee on control_fichas for select to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin'])));
drop policy if exists gerencia_lee on control_config;
create policy gerencia_lee on control_config for select to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin'])));
drop policy if exists gerencia_lee on control_informes;
create policy gerencia_lee on control_informes for select to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin'])));
revoke all on control_fichas, control_config, control_informes from anon, authenticated;
grant select on control_fichas, control_config, control_informes to authenticated;

-- ───────────── Funciones (únicas vías de escritura) ─────────────
create or replace function control_gerencia(p_empresa uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_empresa is null or coalesce(rol_en(p_empresa), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador manejan el control especial' using errcode = '42501';
  end if;
  if (select demo from empresas where id = p_empresa) then
    raise exception 'En la demostración esto se ve pero no se guarda' using errcode = 'P0001';
  end if;
end $$;

-- p = { principio_activo, concentracion, forma_farmaceutica, cum, categoria }
create or replace function guardar_ficha_control(p_producto uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_antes jsonb; v_cum text;
  t text := nullif(regexp_replace(trim(coalesce(p ->> 'principio_activo', '')), '\s+', ' ', 'g'), '');
  k text := nullif(regexp_replace(trim(coalesce(p ->> 'concentracion', '')), '\s+', ' ', 'g'), '');
  f text := nullif(regexp_replace(trim(coalesce(p ->> 'forma_farmaceutica', '')), '\s+', ' ', 'g'), '');
  g text := nullif(regexp_replace(trim(coalesce(p ->> 'categoria', '')), '\s+', ' ', 'g'), '');
begin
  select empresa_id into v_emp from productos where id = p_producto;
  perform control_gerencia(v_emp);
  v_cum := nullif(regexp_replace(coalesce(p ->> 'cum', ''), '[^0-9-]', '', 'g'), '');
  if v_cum is not null and v_cum !~ '^[0-9]{1,12}(-[0-9]{1,4})?$' then
    raise exception 'El CUM va como expediente-consecutivo, por ejemplo 19912345-01' using errcode = 'P0001';
  end if;
  select to_jsonb(x) - 'producto_id' - 'empresa_id' - 'usuario_id' - 'actualizado' into v_antes from control_fichas x where producto_id = p_producto;
  insert into control_fichas (producto_id, empresa_id, principio_activo, concentracion, forma_farmaceutica, cum, categoria, usuario_id, actualizado)
  values (p_producto, v_emp, t, k, f, v_cum, g, auth.uid(), now())
  on conflict (producto_id) do update set principio_activo = excluded.principio_activo, concentracion = excluded.concentracion,
    forma_farmaceutica = excluded.forma_farmaceutica, cum = excluded.cum, categoria = excluded.categoria,
    usuario_id = excluded.usuario_id, actualizado = now();
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v_emp, auth.uid(), 'ficha_control', 'productos', p_producto::text,
          jsonb_build_object('antes', v_antes, 'despues', jsonb_build_object('principio_activo', t, 'concentracion', k, 'forma_farmaceutica', f,
            'cum', v_cum, 'categoria', g)));
end $$;

-- p = { departamento, fondo, canal, destino, responsable, responsable_registro, plantilla }
create or replace function configurar_anexo13(p_empresa uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_plant jsonb := p -> 'plantilla';
begin
  perform control_gerencia(p_empresa);
  if v_plant is not null and jsonb_typeof(v_plant) = 'null' then v_plant := null; end if;
  if v_plant is not null and (jsonb_typeof(v_plant) <> 'array' or jsonb_array_length(v_plant) not between 1 and 40) then
    raise exception 'La plantilla debe tener entre 1 y 40 columnas' using errcode = 'P0001';
  end if;
  insert into control_config (empresa_id, departamento, fondo, canal, destino, responsable, responsable_registro, plantilla, usuario_id, actualizado)
  values (p_empresa, nullif(trim(p ->> 'departamento'), ''), nullif(trim(p ->> 'fondo'), ''), nullif(trim(p ->> 'canal'), ''),
          nullif(trim(p ->> 'destino'), ''), nullif(regexp_replace(trim(coalesce(p ->> 'responsable', '')), '\s+', ' ', 'g'), ''),
          nullif(upper(trim(p ->> 'responsable_registro')), ''), v_plant, auth.uid(), now())
  on conflict (empresa_id) do update set departamento = excluded.departamento, fondo = excluded.fondo, canal = excluded.canal,
    destino = excluded.destino, responsable = excluded.responsable, responsable_registro = excluded.responsable_registro,
    plantilla = excluded.plantilla, usuario_id = excluded.usuario_id, actualizado = now();
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (p_empresa, auth.uid(), 'configurar_anexo13', 'empresas', p_empresa::text, p - 'plantilla' || jsonb_build_object('plantilla_columnas', coalesce(jsonb_array_length(v_plant), 0)));
end $$;

-- p = { presentado, canal, radicado, observacion, totales }
create or replace function registrar_informe_anexo13(p_empresa uuid, p_sede uuid, p_periodo date, p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_prev bigint; v_pres date; v_canal text := nullif(trim(p ->> 'canal'), '');
begin
  perform control_gerencia(p_empresa);
  if p_sede is not null and not exists (select 1 from sedes where id = p_sede and empresa_id = p_empresa) then
    raise exception 'La sede no es de esta droguería' using errcode = '42501';
  end if;
  if p_periodo is null or extract(day from p_periodo) <> 1 then raise exception 'El periodo es un mes (primer día del mes)' using errcode = 'P0001'; end if;
  if p_periodo >= date_trunc('month', (now() at time zone 'America/Bogota')::date)::date then
    raise exception 'Solo se presenta un mes que ya terminó' using errcode = 'P0001';
  end if;
  begin v_pres := (p ->> 'presentado')::date; exception when others then v_pres := null; end;
  if v_pres is null then raise exception 'Escribe la fecha en que lo presentaste' using errcode = 'P0001'; end if;
  if v_pres < p_periodo or v_pres > (now() at time zone 'America/Bogota')::date then
    raise exception 'La fecha de presentación debe estar entre el mes informado y hoy' using errcode = 'P0001';
  end if;
  if v_canal is null or v_canal not in ('correo', 'plataforma', 'presencial', 'otro') then raise exception 'Elige cómo lo enviaste' using errcode = 'P0001'; end if;
  if jsonb_typeof(p -> 'totales') is distinct from 'object' then raise exception 'Faltan los totales del informe' using errcode = 'P0001'; end if;
  select id into v_prev from control_informes where empresa_id = p_empresa and sede_id is not distinct from p_sede and periodo = p_periodo
    order by id desc limit 1;
  insert into control_informes (empresa_id, sede_id, periodo, presentado, canal, radicado, observacion, totales, reemplaza, usuario_id)
  values (p_empresa, p_sede, p_periodo, v_pres, v_canal, nullif(trim(p ->> 'radicado'), ''), nullif(trim(p ->> 'observacion'), ''),
          p -> 'totales', v_prev, auth.uid())
  returning id into v_id;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (p_empresa, auth.uid(), 'informe_anexo13', 'control_informes', v_id::text,
          jsonb_build_object('periodo', p_periodo, 'sede', p_sede, 'presentado', v_pres, 'canal', v_canal, 'reemplaza', v_prev));
  return v_id;
end $$;

revoke execute on function control_gerencia(uuid), guardar_ficha_control(uuid, jsonb), configurar_anexo13(uuid, jsonb),
  registrar_informe_anexo13(uuid, uuid, date, jsonb) from public;
grant execute on function guardar_ficha_control(uuid, jsonb), configurar_anexo13(uuid, jsonb),
  registrar_informe_anexo13(uuid, uuid, date, jsonb) to authenticated;
-- Solo la droguería de DEMOSTRACIÓN: ficha de su medicamento de control especial y configuración del informe, para que
-- la demo muestre el Anexo 13 completo (CUM de muestra en ceros). No toca ninguna droguería real.
insert into control_fichas (producto_id, empresa_id, principio_activo, concentracion, forma_farmaceutica, cum, categoria)
select p.id, p.empresa_id, 'Acetaminofén + codeína', '325 mg + 30 mg', 'Tableta', '00000000-01', 'Medicamento de control especial de uso humano'
from productos p join empresas e on e.id = p.empresa_id
where e.demo and p.control_especial and p.nombre ilike 'Winadeine f tabletas 325mg/30mg%' on conflict do nothing;
insert into control_config (empresa_id, departamento, fondo, canal, responsable)
select id, 'Tolima', 'Fondo Rotatorio de Estupefacientes del Tolima', 'correo', 'Regente de la demostración' from empresas where demo on conflict do nothing;
insert into regenta_migraciones (nombre) values ('048_anexo13.sql') on conflict do nothing;
commit;
