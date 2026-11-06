-- Regenta: migración 038 (conteo a ciegas y rangos de temperatura fijos en la demo). Una sola transacción.
begin;

-- ═════════════ 038_conteo_ciego.sql ═════════════
-- 038 · Conteo a ciegas y rangos de temperatura fijos en la demo compartida
--  1. Conteo a ciegas: en la pantalla de contar no aparece cuánto dice el sistema (se cuenta lo que hay, sin dejarse
--     llevar por la cifra). Mientras está abierto, solo el dueño y el administrador ven las diferencias (en el informe);
--     al cerrar, el resultado es igual al de un conteo normal. iniciar_conteo parte de 028_conteos.sql (única versión).
--  2. La demo pública es compartida: los rangos de temperatura no se cambian en ella (si un visitante los cambiaba,
--     cambiaban para todos). configurar_rango_temperatura parte de 029_temperatura.sql (única versión).

alter table conteos add column if not exists a_ciegas boolean not null default false;

create or replace function iniciar_conteo(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := (p ->> 'empresa_id')::uuid; v_sede uuid := (p ->> 'sede_id')::uuid;
  v_alcance text := coalesce(nullif(p ->> 'alcance', ''), 'todo'); v_filtro text := nullif(trim(coalesce(p ->> 'filtro', '')), '');
  v_id uuid; v_num integer; v_n integer; v_ciegas boolean := coalesce((p ->> 'a_ciegas')::boolean, false);
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
  insert into conteos (empresa_id, sede_id, numero, alcance, filtro, observaciones, usuario_id, a_ciegas)
  values (v_emp, v_sede, v_num, v_alcance, v_filtro, nullif(trim(coalesce(p ->> 'observaciones', '')), ''), auth.uid(), v_ciegas) returning id into v_id;
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
  values (v_emp, auth.uid(), 'iniciar_conteo', 'conteos', v_id::text, jsonb_build_object('numero', v_num, 'alcance', v_alcance, 'filtro', v_filtro, 'lotes', v_n, 'a_ciegas', v_ciegas));
  return jsonb_build_object('id', v_id, 'numero', v_num, 'lotes', v_n, 'a_ciegas', v_ciegas);
end $$;

create or replace function configurar_rango_temperatura(p_empresa uuid, p_area text, p_tmin numeric, p_tmax numeric, p_hmin numeric, p_hmax numeric) returns void
language plpgsql security definer set search_path = public as $$
declare antes record;
begin
  if coalesce(rol_en(p_empresa), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador cambian los rangos' using errcode = '42501';
  end if;
  -- La demo es compartida: si un visitante cambia el rango, cambia para todos. En la demo quedan fijos.
  if exists (select 1 from empresas where id = p_empresa and demo) then
    raise exception 'En la demo los rangos quedan fijos para que todos los visitantes vean lo mismo. En tu droguería los ajustas aquí mismo.' using errcode = 'P0001';
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

insert into regenta_migraciones (nombre) values ('038_conteo_ciego.sql');
commit;
