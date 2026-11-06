-- Regenta: migración 030a (correcciones del Bloque 1). Una sola transacción.
begin;
-- Regenta · correcciones del Bloque 1 tras la revisión independiente (06/11/2026).
--   1. Conteo físico: una venta hecha mientras el conteo está abierto ya no se «devuelve» al inventario al cerrar.
--      Cada línea guarda las existencias del momento en que se contó; al cerrar se ajusta solo esa diferencia.
--   2. Un conteo grande (más de 2.000 lotes con diferencia) se puede cerrar, y un conteo abierto se puede anular.
--   3. Un conteo que se está cerrando no recibe líneas nuevas (bloqueo compartido al contar).
--   4. La consola vuelve a poder eliminar una droguería de prueba con ajustes y conteos.
--   5. Planilla de temperatura: «hoy» con la fecha de Bogotá (el informe muestra cuándo se hizo cada registro).
--   6. Kardex: filtra por la empresa del producto (usa el índice propio, no el de todas las droguerías).
--   7. Una baja «Vencido» solo para lotes vencidos.

-- ───────────── 1 · Existencias al contar ─────────────
alter table conteo_lineas add column if not exists sistema_al_contar integer;
comment on column conteo_lineas.sistema_al_contar is 'Existencias del lote en el momento del último conteo de la línea';
comment on column conteo_lineas.sistema is 'Existencias de referencia de la diferencia: las del momento del conteo (o las del cierre si la línea no se contó)';

-- ───────────── 2 · Conteo anulado ─────────────
alter table conteos drop constraint if exists conteos_estado_check;
alter table conteos add constraint conteos_estado_check check (estado in ('abierto', 'cerrado', 'anulado'));
alter table conteos add column if not exists motivo_anulacion text check (motivo_anulacion is null or length(motivo_anulacion) <= 300);

-- Los conteos cerrados o anulados no se modifican; ninguno se borra (salvo al eliminar una droguería de prueba).
create or replace function conteo_proteger() returns trigger language plpgsql as $$
begin
  if current_user not in ('authenticated', 'anon') and current_setting('regenta.eliminar_empresa', true) = old.empresa_id::text then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then raise exception 'Los conteos no se borran' using errcode = 'P0001'; end if;
  if old.estado <> 'abierto' then raise exception 'Un conteo cerrado no se modifica' using errcode = 'P0001'; end if;
  if (to_jsonb(new) - array['estado', 'cerrado', 'cierra_usuario', 'ajuste_id', 'resumen', 'sin_contar_en_cero', 'observaciones', 'motivo_anulacion'])
     <> (to_jsonb(old) - array['estado', 'cerrado', 'cierra_usuario', 'ajuste_id', 'resumen', 'sin_contar_en_cero', 'observaciones', 'motivo_anulacion']) then
    raise exception 'Los datos del conteo no se cambian' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function conteo_linea_proteger() returns trigger language plpgsql as $$
declare v_estado text;
begin
  if tg_op = 'DELETE' then
    if current_user not in ('authenticated', 'anon') and current_setting('regenta.eliminar_empresa', true) = old.empresa_id::text then return old; end if;
    raise exception 'Las líneas de un conteo no se borran' using errcode = 'P0001';
  end if;
  select estado into v_estado from conteos where id = new.conteo_id;
  if v_estado is distinct from 'abierto' then raise exception 'Un conteo cerrado no se modifica' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' and (new.conteo_id, new.producto_id, new.lote_id, new.empresa_id) is distinct from (old.conteo_id, old.producto_id, old.lote_id, old.empresa_id) then
    raise exception 'Los datos del conteo no se cambian' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- aplicar_ajuste con tope configurable: la pantalla de ajustes sigue limitada a 2.000 lotes; el cierre de un conteo no.
drop function if exists aplicar_ajuste(uuid, text, text, uuid, jsonb, text);
create or replace function aplicar_ajuste(p_emp uuid, p_motivo text, p_detalle text, p_conteo uuid, p_lineas jsonb, p_idem text, p_max integer default 2000)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  x jsonb; l lotes; v_unid integer; v_sede uuid; v_para_entrada jsonb := '[]'; r jsonb; v_id uuid; v_num integer; v_antes jsonb;
  v_texto text := motivo_ajuste_texto(p_motivo) || coalesce(': ' || nullif(trim(p_detalle), ''), '');
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Agrega al menos un producto con su lote y cantidad' using errcode = 'P0001';
  end if;
  if p_max is not null and jsonb_array_length(p_lineas) > p_max then
    raise exception 'Máximo % lotes por ajuste', replace(to_char(p_max, 'FM9,999,999'), ',', '.') using errcode = 'P0001';
  end if;
  for x in select * from jsonb_array_elements(p_lineas) loop
    select * into l from lotes where id = (x ->> 'lote_id')::uuid and empresa_id = p_emp;
    if not found then raise exception 'Lote no válido' using errcode = 'P0001'; end if;
    v_unid := (x ->> 'unidades')::integer;
    if v_unid is null or v_unid = 0 then raise exception 'La cantidad del lote % no puede ser cero', l.lote using errcode = 'P0001'; end if;
    if p_motivo <> 'conteo' and v_unid > 0 then
      raise exception 'Una baja resta unidades: para sumar usa el motivo «Diferencia de conteo»' using errcode = 'P0001';
    end if;
    if p_motivo = 'vencido' and l.vence >= v_hoy then
      raise exception 'El lote % todavía no está vencido (vence el %): elige otro motivo', l.lote, to_char(l.vence, 'DD/MM/YYYY') using errcode = 'P0001';
    end if;
    if v_sede is null then v_sede := l.sede_id;
    elsif v_sede <> l.sede_id then raise exception 'Todos los lotes de un ajuste deben ser de la misma sede' using errcode = 'P0001';
    end if;
    v_para_entrada := v_para_entrada || jsonb_build_object('producto_id', l.producto_id, 'lote', l.lote, 'unidades', v_unid);
  end loop;

  perform pg_advisory_xact_lock(hashtext(y)) from (select distinct e ->> 'producto_id' y from jsonb_array_elements(v_para_entrada) e order by 1) s;
  select coalesce(jsonb_object_agg(s.lote_id::text, s.unidades), '{}') into v_antes from v_stock_lotes s
    where s.lote_id in (select (e ->> 'lote_id')::uuid from jsonb_array_elements(p_lineas) e);

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
revoke execute on function aplicar_ajuste(uuid, text, text, uuid, jsonb, text, integer) from public;
revoke execute on function aplicar_ajuste(uuid, text, text, uuid, jsonb, text, integer) from authenticated, anon;

-- ───────────── 3 · Contar con el conteo bloqueado en modo compartido ─────────────
create or replace function contar_conteo(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  k conteos; v_lote lotes; v_modo text := coalesce(p ->> 'modo', 'sumar'); v_cant integer; v_nuevo boolean := false;
  v_codigo text; v_vence date; ln conteo_lineas; v_sis integer;
begin
  -- «for share» choca con el «for update» del cierre: si el conteo se está cerrando, se espera y luego se ve cerrado.
  select * into k from conteos where id = (p ->> 'conteo_id')::uuid for share;
  if not found or coalesce(rol_en(k.empresa_id), '') not in ('dueno', 'admin', 'bodeguero') then
    raise exception 'No puedes contar en este conteo' using errcode = '42501';
  end if;
  if k.estado <> 'abierto' then raise exception 'Este conteo ya está %: no se modifica', k.estado using errcode = 'P0001'; end if;
  if v_modo not in ('sumar', 'fijar') then raise exception 'Operación no válida' using errcode = 'P0001'; end if;
  v_cant := (p ->> 'cantidad')::integer;
  if v_cant is null or v_cant < 0 or v_cant > 1000000 or (v_modo = 'sumar' and v_cant = 0) then
    raise exception 'Cantidad no válida' using errcode = 'P0001';
  end if;
  if (p ->> 'lote_id') is not null then
    select * into v_lote from lotes where id = (p ->> 'lote_id')::uuid and empresa_id = k.empresa_id and sede_id = k.sede_id;
    if not found then raise exception 'Ese lote no es de esta sede' using errcode = 'P0001'; end if;
  else
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
  -- Existencias de este momento (con el producto bloqueado, igual que una venta): la diferencia se mide contra ellas.
  perform pg_advisory_xact_lock(hashtext(v_lote.producto_id::text));
  v_sis := coalesce((select unidades from v_stock_lotes where lote_id = v_lote.id), 0);
  insert into conteo_lineas (empresa_id, conteo_id, producto_id, lote_id, contado, nuevo, usuario_id, actualizado, sistema_al_contar)
  values (k.empresa_id, k.id, v_lote.producto_id, v_lote.id, v_cant, true, auth.uid(), now(), v_sis)
  on conflict (conteo_id, lote_id) do update
    set contado = case when v_modo = 'sumar' then coalesce(conteo_lineas.contado, 0) + v_cant else v_cant end,
        usuario_id = auth.uid(), actualizado = now(), sistema_al_contar = v_sis
  returning * into ln;
  return jsonb_build_object('linea_id', ln.id, 'lote_id', ln.lote_id, 'producto_id', ln.producto_id, 'lote', v_lote.lote,
    'vence', v_lote.vence::text, 'contado', ln.contado, 'nuevo', ln.nuevo, 'lote_creado', v_nuevo, 'sistema', v_sis);
end $$;

-- Cierra el conteo. La diferencia de cada lote contado se mide contra las existencias del momento en que se contó, así
-- lo vendido después (mientras el conteo seguía abierto) no se devuelve al inventario. Los lotes sin contar no se tocan,
-- salvo que se indique que no estaban (p_sin_contar_en_cero): entonces quedan en cero.
create or replace function cerrar_conteo(p_conteo uuid, p_sin_contar_en_cero boolean default false, p_observaciones text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k conteos; v_lineas jsonb; v_aj jsonb; v_res jsonb;
begin
  select * into k from conteos where id = p_conteo for update;
  if not found or coalesce(rol_en(k.empresa_id), '') not in ('dueno', 'admin', 'bodeguero') then
    raise exception 'No puedes cerrar este conteo' using errcode = '42501';
  end if;
  if k.estado <> 'abierto' then raise exception 'El conteo ya está %', k.estado using errcode = 'P0001'; end if;
  if not exists (select 1 from conteo_lineas where conteo_id = k.id and contado is not null) and not coalesce(p_sin_contar_en_cero, false) then
    raise exception 'Todavía no has contado ningún lote' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext(y)) from (select distinct producto_id::text y from conteo_lineas where conteo_id = k.id order by 1) s;
  -- Referencia de cada línea: lo que había al contarla; si no se contó (o es de antes de esta corrección), lo de ahora.
  update conteo_lineas cl set sistema = coalesce(case when cl.contado is not null then cl.sistema_al_contar end,
                                                 (select s.unidades from v_stock_lotes s where s.lote_id = cl.lote_id), 0)
  where cl.conteo_id = k.id;
  if coalesce(p_sin_contar_en_cero, false) then
    update conteo_lineas set contado = 0, actualizado = now(), usuario_id = auth.uid() where conteo_id = k.id and contado is null;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('lote_id', lote_id, 'unidades', contado - sistema) order by id), '[]') into v_lineas
  from conteo_lineas where conteo_id = k.id and contado is not null and contado <> sistema;
  if jsonb_array_length(v_lineas) > 0 then
    v_aj := aplicar_ajuste(k.empresa_id, 'conteo', 'conteo físico N.º ' || k.numero, k.id, v_lineas, null, null);
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

-- Anula un conteo abierto sin tocar el inventario (dueño o administrador). Libera la sede para empezar otro.
create or replace function anular_conteo(p_conteo uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k conteos; v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  select * into k from conteos where id = p_conteo for update;
  if not found or coalesce(rol_en(k.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador anulan un conteo' using errcode = '42501';
  end if;
  if k.estado <> 'abierto' then raise exception 'Solo se anula un conteo abierto' using errcode = 'P0001'; end if;
  if length(coalesce(v_motivo, '')) < 4 then raise exception 'Escribe el motivo de la anulación' using errcode = 'P0001'; end if;
  if length(v_motivo) > 300 then raise exception 'El motivo es demasiado largo (máximo 300 caracteres)' using errcode = 'P0001'; end if;
  update conteos set estado = 'anulado', cerrado = now(), cierra_usuario = auth.uid(), motivo_anulacion = v_motivo where id = k.id;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (k.empresa_id, auth.uid(), 'anular_conteo', 'conteos', k.id::text, jsonb_build_object('numero', k.numero, 'motivo', v_motivo));
  return jsonb_build_object('id', k.id, 'numero', k.numero, 'estado', 'anulado');
end $$;
revoke execute on function anular_conteo(uuid, text) from public;
grant execute on function anular_conteo(uuid, text) to authenticated;

-- ───────────── 4 · Eliminar una droguería de prueba (con ajustes, conteos, temperatura y fórmulas) ─────────────
create or replace function eliminar_empresa_prueba(p_empresa uuid) returns int
language plpgsql set search_path = public as $$
declare e record; usuarios uuid[]; n int;
begin
  select * into e from empresas where id = p_empresa for update;
  if not found then raise exception 'Cliente no encontrado' using errcode = 'P0001'; end if;
  if e.demo then raise exception 'La demostración no se elimina' using errcode = 'P0001'; end if;
  if e.estado <> 'suspendida' then raise exception 'Primero suspende la droguería; luego podrás eliminarla' using errcode = 'P0001'; end if;
  if exists (select 1 from resoluciones_dian where empresa_id = p_empresa and not pruebas) then
    raise exception 'Esta droguería facturó con numeración DIAN en producción: sus documentos se conservan por ley. Solo se puede suspender' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct user_id), '{}') into usuarios from miembros where empresa_id = p_empresa;
  perform set_config('regenta.eliminar_empresa', p_empresa::text, true);

  -- Hijos primero (algunas llaves son RESTRICT), luego la empresa (el resto cae en cascada).
  delete from venta_formulas where empresa_id = p_empresa;
  delete from venta_lineas where empresa_id = p_empresa;
  delete from pagos where empresa_id = p_empresa;
  delete from abonos where empresa_id = p_empresa;
  delete from documentos_dian where empresa_id = p_empresa;
  delete from devolucion_lineas where empresa_id = p_empresa;
  delete from devoluciones where empresa_id = p_empresa;
  delete from movimientos_caja where empresa_id = p_empresa;
  delete from ventas where empresa_id = p_empresa;
  delete from turnos where empresa_id = p_empresa;
  -- Conteos y ajustes se apuntan entre sí: primero se suelta el enlace.
  update conteos set ajuste_id = null where empresa_id = p_empresa and ajuste_id is not null;
  delete from conteo_lineas where empresa_id = p_empresa;
  delete from ajuste_lineas where empresa_id = p_empresa;
  delete from ajustes where empresa_id = p_empresa;
  delete from conteos where empresa_id = p_empresa;
  delete from temperatura_registros where empresa_id = p_empresa;
  delete from movimientos where empresa_id = p_empresa;
  delete from alertas_revision where empresa_id = p_empresa;
  delete from auditoria where empresa_id = p_empresa;
  delete from lote_costos where empresa_id = p_empresa;
  delete from lotes where empresa_id = p_empresa;
  delete from empresas where id = p_empresa;

  delete from cuentas c where c.id = any (usuarios)
    and not exists (select 1 from miembros m where m.user_id = c.id)
    and not exists (select 1 from superadmins s where s.user_id = c.id);
  get diagnostics n = row_count;

  perform set_config('regenta.eliminar_empresa', '', true);
  return n;
end $$;
revoke execute on function eliminar_empresa_prueba(uuid) from public;
revoke execute on function eliminar_empresa_prueba(uuid) from authenticated, anon;

-- ───────────── 5 · Planilla de temperatura ─────────────
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
  v_hoy date := (now() at time zone 'America/Bogota')::date;
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
  if v_fecha is null or v_fecha > v_hoy then raise exception 'La fecha no puede ser futura' using errcode = 'P0001'; end if;
  if v_anula is null and v_fecha < v_hoy - 7 then
    raise exception 'Solo se registran jornadas de los últimos 7 días' using errcode = 'P0001';
  end if;
  if v_temp is null or v_temp < -30 or v_temp > 60 then raise exception 'Revisa la temperatura: debe estar entre -30 y 60 °C' using errcode = 'P0001'; end if;
  if v_hum is not null and (v_hum < 0 or v_hum > 100) then raise exception 'La humedad relativa va de 0 a 100 %%' using errcode = 'P0001'; end if;
  if v_area = 'general' and v_hum is null then raise exception 'Escribe la humedad relativa' using errcode = 'P0001'; end if;
  if length(coalesce(v_obs, '')) > 500 or length(coalesce(v_accion, '')) > 500 then raise exception 'El texto es demasiado largo (máximo 500 caracteres)' using errcode = 'P0001'; end if;

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

-- ───────────── 6 · Kardex por la empresa del producto ─────────────
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
    where m.empresa_id = (select pr.empresa_id from productos pr where pr.id = p_producto)
      and m.producto_id = p_producto and (p_lote is null or m.lote_id = p_lote)
  ) k
  where (p_desde is null or (k.creado at time zone 'America/Bogota')::date >= p_desde)
    and (p_hasta is null or (k.creado at time zone 'America/Bogota')::date <= p_hasta)
  order by k.creado, k.id
$$;

insert into regenta_migraciones (nombre) values ('030a_correcciones_bloque1.sql');
commit;
