-- 054 · Contingencia del tiquete POS (Res. DIAN 165/2023 art. 37, hoy art. 1.5.1.5.7.1 Res. 227/2025; auditoría P1-2).
-- Ante un inconveniente (sin internet, proveedor tecnológico o DIAN caídos) el documento equivalente se expide igual, con su
-- número de la resolución, se transmite dentro de las 48 horas siguientes y se conservan los soportes del inconveniente.
--
-- 1. Números reservados por caja: con internet, cada caja aparta unos números de su resolución POS. Sin internet, el tiquete
--    sale impreso con su número definitivo (no un «comprobante provisional» sin número) y al volver la conexión la venta se
--    registra con ese mismo número. Un número reservado no usado queda libre para esa caja; no se reutiliza en otra.
-- 2. Bitácora de inconvenientes (soportes): inicio, fin, causa y ventas expedidas en contingencia.

create table if not exists contingencia_numeros (
  empresa_id uuid not null references empresas(id),
  caja_id uuid not null references cajas(id),
  resolucion_id uuid not null references resoluciones_dian(id),
  prefijo text not null,
  numero bigint not null,
  venta_id uuid references ventas(id),
  creado timestamptz not null default now(),
  usado timestamptz,
  primary key (empresa_id, prefijo, numero)
);
create index if not exists contingencia_libres on contingencia_numeros (caja_id) where usado is null;
alter table contingencia_numeros enable row level security;
drop policy if exists contingencia_lectura on contingencia_numeros;
create policy contingencia_lectura on contingencia_numeros for select to authenticated using (empresa_id in (select mis_empresas()));
grant select on contingencia_numeros to authenticated;

create table if not exists incidencias_dian (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  caja_id uuid references cajas(id),
  causa text not null check (causa in ('sin_internet', 'proveedor', 'dian')),
  inicio timestamptz not null,
  fin timestamptz,
  detalle text check (detalle is null or length(detalle) <= 500),
  ventas int not null default 0,
  creado timestamptz not null default now(),
  check (fin is null or fin >= inicio)
);
create index if not exists incidencias_empresa on incidencias_dian (empresa_id, inicio desc);
create unique index if not exists incidencias_abierta on incidencias_dian (empresa_id, causa) where fin is null and caja_id is null;
alter table incidencias_dian enable row level security;
drop policy if exists incidencias_lectura on incidencias_dian;
create policy incidencias_lectura on incidencias_dian for select to authenticated using (empresa_id in (select mis_empresas()));
grant select on incidencias_dian to authenticated;


-- Aparta números de la resolución POS activa para una caja hasta tener `p_minimo` libres (máximo 50). Devuelve los libres.
create or replace function reservar_contingencia(p_caja uuid, p_minimo int default 20) returns table (prefijo text, numero bigint)
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_res resoluciones_dian; v_libres int; v_n int;
begin
  select empresa_id into v_emp from cajas where id = p_caja and activa;
  if v_emp is null then raise exception 'Caja no válida' using errcode = 'P0001'; end if;
  if coalesce(rol_en(v_emp), '') not in ('dueno', 'admin', 'cajero') then raise exception 'No tienes permiso para vender en esta empresa' using errcode = '42501'; end if;
  select * into v_res from resoluciones_dian where empresa_id = v_emp and tipo = 'pos' and activa for update;
  if not found or (v_res.pruebas and not (select demo from empresas where id = v_emp))
     or (v_res.vigente_hasta is not null and v_res.vigente_hasta < current_date) then
    return; -- sin POS en producción no hay nada que reservar (la caja cae al comprobante provisional)
  end if;
  -- Los números de una resolución anterior que quedaron sin usar ya no sirven.
  delete from contingencia_numeros c where c.caja_id = p_caja and c.usado is null and c.resolucion_id <> v_res.id;
  select count(*) into v_libres from contingencia_numeros c where c.caja_id = p_caja and c.usado is null;
  v_n := least(greatest(least(p_minimo, 50) - v_libres, 0), v_res.hasta - v_res.actual);
  if v_n > 0 then
    insert into contingencia_numeros (empresa_id, caja_id, resolucion_id, prefijo, numero)
    select v_emp, p_caja, v_res.id, v_res.prefijo, v_res.actual + g from generate_series(1, v_n) g;
    update resoluciones_dian set actual = actual + v_n where id = v_res.id;
  end if;
  return query select c.prefijo, c.numero from contingencia_numeros c where c.caja_id = p_caja and c.usado is null order by c.numero;
end $$;
revoke all on function reservar_contingencia(uuid, int) from public;
grant execute on function reservar_contingencia(uuid, int) to authenticated;

-- registrar_venta: con `numero_contingencia`, la venta usa ese número reservado de su caja (el que ya salió impreso) en vez
-- de tomar el siguiente. Se patcha solo el bloque de numeración sobre la versión vigente (como la 036 y la 051).
do $$
declare d text;
  -- El bloque se busca con espacios y saltos de línea flexibles: una función pegada desde el SQL Editor de Supabase guarda
  -- saltos de línea \r\n y el texto exacto no coincide.
  patron text := 'v_num := v_res\.actual \+ 1;\s*if v_num > v_res\.hasta then raise exception [^;]*;\s*end if;\s*update resoluciones_dian set actual = v_num where id = v_res\.id;';
  nuevo text := '  if (p ->> ''numero_contingencia'') is not null then
    -- Tiquete POS expedido en contingencia (054): su número ya está impreso; tiene que ser uno reservado y libre de esta caja.
    if v_tipo <> ''pos'' then raise exception ''Solo el tiquete POS se expide en contingencia'' using errcode = ''P0001''; end if;
    v_num := (p ->> ''numero_contingencia'')::bigint;
    update contingencia_numeros set usado = now()   -- la venta se liga al insertarse (trigger ventas_contingencia)
      where empresa_id = v_emp and caja_id = v_caja and prefijo = v_res.prefijo and numero = v_num and usado is null and resolucion_id = v_res.id;
    if not found then raise exception ''El número de contingencia % no está reservado para esta caja o ya se usó'', v_res.prefijo || v_num using errcode = ''P0001''; end if;
  else
  v_num := v_res.actual + 1;
  if v_num > v_res.hasta then raise exception ''Se agotó la numeración autorizada (%-%)'', v_res.prefijo, v_res.hasta using errcode = ''P0001''; end if;
  update resoluciones_dian set actual = v_num where id = v_res.id;
  end if;';
begin
  select pg_get_functiondef('registrar_venta(jsonb)'::regprocedure) into d;
  if position('numero_contingencia' in d) > 0 then raise notice 'registrar_venta ya admite contingencia';
  elsif d ~ patron then execute regexp_replace(d, patron, ltrim(nuevo));
  else raise exception 'registrar_venta no trae el bloque de numeración esperado: revisar la 054 a mano';
  end if;
end $$;

-- Al insertar la venta, el número de contingencia queda ligado a ella (así se sabe qué ventas salieron en contingencia).
create or replace function contingencia_ligar() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update contingencia_numeros set venta_id = new.id
    where empresa_id = new.empresa_id and prefijo = new.prefijo and numero = new.numero and caja_id = new.caja_id and usado is not null and venta_id is null;
  return null;
end $$;
drop trigger if exists ventas_contingencia on ventas;
create trigger ventas_contingencia after insert on ventas for each row when (new.tipo_doc = 'pos') execute function contingencia_ligar();

-- Bitácora: una venta hecha sin internet abre (o alarga) la incidencia «sin_internet» de su caja.
create or replace function registrar_incidencia_sin_internet(p_empresa uuid, p_caja uuid, p_cuando timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if coalesce(rol_en(p_empresa), '') not in ('dueno', 'admin', 'cajero') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  select id into v_id from incidencias_dian where empresa_id = p_empresa and caja_id is not distinct from p_caja and causa = 'sin_internet'
    and p_cuando between inicio - interval '30 minutes' and coalesce(fin, inicio) + interval '30 minutes' order by inicio desc limit 1 for update;
  if v_id is null then
    insert into incidencias_dian (empresa_id, caja_id, causa, inicio, fin, detalle, ventas)
    values (p_empresa, p_caja, 'sin_internet', p_cuando, p_cuando, 'Sin conexión a internet en la droguería: ventas expedidas en la caja y registradas al volver la conexión', 1);
  else
    update incidencias_dian set inicio = least(inicio, p_cuando), fin = greatest(fin, p_cuando), ventas = ventas + 1 where id = v_id;
  end if;
end $$;
revoke all on function registrar_incidencia_sin_internet(uuid, uuid, timestamptz) from public;
grant execute on function registrar_incidencia_sin_internet(uuid, uuid, timestamptz) to authenticated;
