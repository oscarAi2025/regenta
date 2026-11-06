-- Regenta · DIAN complementaria (Bloque 3-B). 06/11/2026.
--   1. Tipos nuevos de numeración y de documento: documento soporte (compras a proveedores no obligados a facturar), su
--      nota de ajuste (anula o corrige) y la nota débito de una factura (mayor valor).
--   2. documentos_dian guarda el XML que devuelve el proveedor tecnológico (o el XML de prueba del modo simulado) y la URL
--      del PDF, en todos los tipos; y para los tipos nuevos: compra, proveedor, documento de origen, motivo, periodo y totales.
--   3. Líneas propias de los documentos que no salen de una venta (documento_lineas) y las compras que soporta cada
--      documento soporte (soporte_compras). Una compra está en un solo documento soporte vigente: lo garantiza un índice
--      único; la nota de ajuste de anulación la libera.
--   4. Funciones de la gerencia (dueño o administrador): generar_soporte, ajustar_soporte, nota_debito. Numeración con
--      bloqueo de fila, idempotencia por idem_key, auditoría y nada se borra.
-- Las tablas nuevas cuelgan de documentos_dian en cascada: eliminar_empresa_prueba (033a) ya borra documentos_dian antes de
-- compras y proveedores, así que no hace falta redefinirla.

-- ───────────── 1 · Tipos ─────────────
alter table resoluciones_dian drop constraint if exists resoluciones_dian_tipo_check;
alter table resoluciones_dian add constraint resoluciones_dian_tipo_check
  check (tipo in ('pos', 'factura', 'nota_credito', 'contingencia', 'soporte', 'ajuste_soporte', 'nota_debito'));
alter table documentos_dian drop constraint if exists documentos_dian_tipo_check;
alter table documentos_dian add constraint documentos_dian_tipo_check
  check (tipo in ('pos', 'factura', 'nota_credito', 'soporte', 'ajuste_soporte', 'nota_debito'));

-- ───────────── 2 · Columnas nuevas de documentos_dian ─────────────
alter table documentos_dian add column if not exists compra_id uuid references compras;            -- soporte por operación
alter table documentos_dian add column if not exists proveedor_id uuid references proveedores;      -- soporte y su nota de ajuste
-- En cascada solo para eliminar_empresa_prueba (los documentos nunca se borran de otra forma).
alter table documentos_dian add column if not exists origen_id uuid references documentos_dian on delete cascade;  -- ajuste → soporte · nota débito → factura
alter table documentos_dian add column if not exists concepto text check (concepto is null or concepto in ('anulacion', 'correccion', 'mayor_valor'));
alter table documentos_dian add column if not exists motivo text check (motivo is null or length(motivo) between 4 and 300);
alter table documentos_dian add column if not exists periodo_desde date;
alter table documentos_dian add column if not exists periodo_hasta date;
alter table documentos_dian add column if not exists base numeric(14, 2);
alter table documentos_dian add column if not exists iva numeric(14, 2);
alter table documentos_dian add column if not exists total numeric(14, 2);
alter table documentos_dian add column if not exists xml text;          -- el XML que devolvió el proveedor (o el de prueba, marcado)
alter table documentos_dian add column if not exists pdf_url text;      -- representación gráfica del proveedor, si la entrega
alter table documentos_dian add column if not exists idem_key text check (idem_key is null or length(idem_key) <= 80);
alter table documentos_dian add column if not exists usuario_id uuid;
alter table documentos_dian drop constraint if exists documentos_dian_tipo_datos;
alter table documentos_dian add constraint documentos_dian_tipo_datos check (case tipo
  when 'soporte' then venta_id is null and proveedor_id is not null and total is not null and origen_id is null
  when 'ajuste_soporte' then venta_id is null and proveedor_id is not null and origen_id is not null and total is not null and concepto in ('anulacion', 'correccion') and motivo is not null
  when 'nota_debito' then venta_id is null and origen_id is not null and total is not null and concepto = 'mayor_valor' and motivo is not null
  else true end);
create unique index if not exists documentos_idem on documentos_dian (empresa_id, idem_key) where idem_key is not null;
create index if not exists documentos_origen on documentos_dian (origen_id) where origen_id is not null;
create index if not exists documentos_compra on documentos_dian (compra_id) where compra_id is not null;

-- Envío real de documento soporte, nota de ajuste y nota débito: apagado hasta que la consola lo active para la droguería
-- (los tipos de MATIAS deben validarse en el sandbox antes). Sin activar, la cola los rechaza con un mensaje claro.
alter table empresas add column if not exists dian_complementario boolean not null default false;

-- ───────────── 3 · Líneas y compras de los documentos nuevos ─────────────
create table if not exists documento_lineas (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  documento_id uuid not null references documentos_dian on delete cascade,
  descripcion text not null check (length(descripcion) between 1 and 300),
  codigo text check (codigo is null or length(codigo) <= 60),
  cantidad numeric(14, 3) not null check (cantidad > 0),
  precio numeric(14, 2) not null check (precio >= 0),          -- unitario sin IVA (informativo: la base manda)
  iva_pct numeric(5, 2) not null check (iva_pct in (0, 5, 19)),
  base numeric(14, 2) not null check (base >= 0),
  iva numeric(14, 2) not null check (iva >= 0),
  total numeric(14, 2) not null,
  check (total = base + iva)
);
create index if not exists documento_lineas_doc on documento_lineas (documento_id);

create table if not exists soporte_compras (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  documento_id uuid not null references documentos_dian on delete cascade,
  compra_id uuid not null references compras,
  liberada timestamptz,                                         -- la anuló una nota de ajuste: la compra puede volver a soportarse
  liberada_por uuid references documentos_dian on delete cascade,
  check ((liberada is null) = (liberada_por is null))
);
create unique index if not exists soporte_compra_vigente on soporte_compras (compra_id) where liberada is null;
create index if not exists soporte_compras_doc on soporte_compras (documento_id);

-- Inmutables: las líneas nunca cambian; una compra soportada solo se libera una vez. Excepción: eliminar_empresa_prueba
-- (solo el servidor, nunca un usuario de la app, y solo la empresa que se está eliminando).
create or replace function dian_hijos_proteger() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_user not in ('authenticated', 'anon') and current_setting('regenta.eliminar_empresa', true) = old.empresa_id::text then return old; end if;
  if tg_table_name = 'soporte_compras' and tg_op = 'UPDATE' then
    if to_jsonb(old) ->> 'liberada' is null and to_jsonb(new) ->> 'liberada' is not null
       and (to_jsonb(new) - 'liberada' - 'liberada_por') = (to_jsonb(old) - 'liberada' - 'liberada_por') then return new; end if;
  end if;
  raise exception 'Los registros de % no se modifican ni se borran', tg_table_name using errcode = 'P0001';
end $$;
drop trigger if exists documento_lineas_inmutables on documento_lineas;
create trigger documento_lineas_inmutables before update or delete on documento_lineas for each row execute function dian_hijos_proteger();
drop trigger if exists soporte_compras_proteger on soporte_compras;
create trigger soporte_compras_proteger before update or delete on soporte_compras for each row execute function dian_hijos_proteger();

-- ───────────── 4 · Numeración (uso interno) ─────────────
-- Toma el siguiente número de la numeración activa de un tipo, con las mismas reglas de la venta: sin numeración no hay
-- documento; con numeración de pruebas solo la demo emite (simulado); vencida o agotada, no.
create or replace function dian_siguiente_numero(p_emp uuid, p_tipo text, p_nombre text) returns resoluciones_dian
language plpgsql set search_path = public as $$
declare v_res resoluciones_dian; v_demo boolean;
begin
  select demo into v_demo from empresas where id = p_emp;
  select * into v_res from resoluciones_dian where empresa_id = p_emp and tipo = p_tipo and activa for update;
  if not found then
    raise exception 'Tu droguería aún no tiene numeración de %: pídela a soporte de Regenta (se carga con la resolución que autoriza la DIAN)', p_nombre using errcode = 'P0001';
  end if;
  if v_res.pruebas and not coalesce(v_demo, false) then
    raise exception 'La numeración de % de tu droguería es de pruebas: podrás generarlo cuando quede cargada la resolución autorizada por la DIAN', p_nombre using errcode = 'P0001';
  end if;
  if v_res.vigente_hasta is not null and v_res.vigente_hasta < current_date then
    raise exception 'La resolución de numeración de % venció el %', p_nombre, to_char(v_res.vigente_hasta, 'DD/MM/YYYY') using errcode = 'P0001';
  end if;
  if v_res.actual + 1 > v_res.hasta then
    raise exception 'Se agotó la numeración autorizada de % (%-%)', p_nombre, v_res.prefijo, v_res.hasta using errcode = 'P0001';
  end if;
  update resoluciones_dian set actual = actual + 1 where id = v_res.id returning * into v_res;
  return v_res;
end $$;

-- ¿El documento salió con numeración de pruebas? (para que la nota herede el modo del original)
create or replace function dian_doc_pruebas(p_doc documentos_dian) returns boolean language sql stable set search_path = public as $$
  select coalesce((select r.pruebas from resoluciones_dian r where r.empresa_id = p_doc.empresa_id and r.tipo = p_doc.tipo and r.prefijo = p_doc.prefijo
    and p_doc.numero between r.desde and r.hasta order by r.activa desc limit 1), true)
$$;

-- ───────────── 5 · Documento soporte ─────────────
-- p = { empresa_id, compras: [uuid], semanal?: boolean, idem_key? }
-- Por operación: una sola compra. Semanal: varias compras del mismo proveedor dentro de una semana (lunes a domingo).
-- Solo compras registradas (con costos) de proveedores no obligados a facturar, y nunca una compra que ya está en un
-- documento soporte vigente.
create or replace function generar_soporte(p jsonb) returns jsonb
language plpgsql security definer set search_path = public set jit = off as $$
declare
  v_emp uuid := (p ->> 'empresa_id')::uuid;
  v_semanal boolean := coalesce((p ->> 'semanal')::boolean, false);
  v_ids uuid[]; v_n int; v_ya documentos_dian; v_prov proveedores; v_res resoluciones_dian; r record;
  v_doc uuid := gen_random_uuid(); v_desde date; v_hasta date; v_base numeric; v_iva numeric; v_total numeric;
begin
  if coalesce(rol_en(v_emp), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador generan documentos soporte' using errcode = '42501';
  end if;
  if (p ->> 'idem_key') is not null then
    perform pg_advisory_xact_lock(hashtext('dian-doc:' || v_emp::text || ':' || (p ->> 'idem_key')));
    select * into v_ya from documentos_dian where empresa_id = v_emp and idem_key = p ->> 'idem_key';
    if found then return jsonb_build_object('id', v_ya.id, 'numero', v_ya.prefijo || v_ya.numero, 'repetido', true); end if;
  end if;
  if jsonb_typeof(p -> 'compras') is distinct from 'array' then raise exception 'Elige la compra' using errcode = 'P0001'; end if;
  select array_agg(distinct e::uuid order by e::uuid) into v_ids from jsonb_array_elements_text(p -> 'compras') e;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then raise exception 'Elige la compra' using errcode = 'P0001'; end if;
  if v_n > 200 then raise exception 'Un documento soporte admite máximo 200 compras' using errcode = 'P0001'; end if;
  if not v_semanal and v_n > 1 then
    raise exception 'El documento soporte por operación es de una sola compra: para varias compras de la semana usa el semanal' using errcode = 'P0001';
  end if;
  if (select count(*) from compras where id = any (v_ids) and empresa_id = v_emp) <> v_n then
    raise exception 'Alguna de las compras no es de tu droguería' using errcode = 'P0001';
  end if;
  if (select count(distinct proveedor_id) from compras where id = any (v_ids)) > 1 then
    raise exception 'Un documento soporte es de un solo proveedor: elige compras del mismo proveedor' using errcode = 'P0001';
  end if;
  select pr.* into v_prov from proveedores pr where pr.id = (select proveedor_id from compras where id = v_ids[1]);
  if v_prov.obligado_facturar then
    raise exception '% está obligado a facturar: su factura electrónica es el soporte de la compra y no se genera documento soporte', v_prov.nombre using errcode = 'P0001';
  end if;
  if v_prov.nit is null then
    raise exception 'Falta el NIT o la cédula de % (el documento soporte lo exige): complétalo en la ficha del proveedor', v_prov.nombre using errcode = 'P0001';
  end if;
  -- Un proveedor a la vez: dos pestañas no pueden meter la misma compra en dos documentos.
  perform pg_advisory_xact_lock(hashtext('soporte-prov:' || v_prov.id::text));
  perform 1 from compras where id = any (v_ids) order by id for update;
  for r in select numero, estado from compras where id = any (v_ids) and estado <> 'registrada' order by numero limit 1 loop
    raise exception 'La compra N.º % %', r.numero, case when r.estado = 'anulada' then 'está anulada' else 'aún no tiene costos: complétalos primero' end using errcode = 'P0001';
  end loop;
  for r in select c.numero, d.prefijo || d.numero doc from soporte_compras s join compras c on c.id = s.compra_id join documentos_dian d on d.id = s.documento_id
           where s.compra_id = any (v_ids) and s.liberada is null order by c.numero limit 1 loop
    raise exception 'La compra N.º % ya está en el documento soporte %: una compra no se incluye dos veces', r.numero, r.doc using errcode = 'P0001';
  end loop;
  select min(fecha_factura), max(fecha_factura) into v_desde, v_hasta from compras where id = any (v_ids);
  if v_semanal then
    if date_trunc('week', v_desde::timestamp) <> date_trunc('week', v_hasta::timestamp) then
      raise exception 'El documento soporte semanal agrupa compras de una misma semana (de lunes a domingo)' using errcode = 'P0001';
    end if;
    v_desde := date_trunc('week', v_desde::timestamp)::date; v_hasta := v_desde + 6;
  end if;
  select coalesce(sum(l.base), 0), coalesce(sum(l.iva), 0), coalesce(sum(l.total), 0) into v_base, v_iva, v_total from compra_lineas l where l.compra_id = any (v_ids);
  if v_total <= 0 then raise exception 'Esta compra no tiene valor: no hay nada que soportar' using errcode = 'P0001'; end if;

  v_res := dian_siguiente_numero(v_emp, 'soporte', 'documento soporte');
  insert into documentos_dian (id, empresa_id, tipo, prefijo, numero, compra_id, proveedor_id, periodo_desde, periodo_hasta, base, iva, total, idem_key, usuario_id)
  values (v_doc, v_emp, 'soporte', v_res.prefijo, v_res.actual, case when not v_semanal then v_ids[1] end, v_prov.id, v_desde, v_hasta,
          v_base, v_iva, v_total, p ->> 'idem_key', auth.uid());
  insert into documento_lineas (empresa_id, documento_id, descripcion, codigo, cantidad, precio, iva_pct, base, iva, total)
  select v_emp, v_doc, left(pr.nombre || ' · lote ' || lo.lote || case when v_semanal then ' · compra N.º ' || c.numero else '' end, 300),
         left(coalesce(pr.ean, left(pr.id::text, 8)), 60), l.unidades + l.bonificadas, round(l.base / (l.unidades + l.bonificadas), 2), l.iva_pct, l.base, l.iva, l.total
  from compra_lineas l join compras c on c.id = l.compra_id join productos pr on pr.id = l.producto_id join lotes lo on lo.id = l.lote_id
  where l.compra_id = any (v_ids) order by c.numero, l.id;
  insert into soporte_compras (empresa_id, documento_id, compra_id) select v_emp, v_doc, x from unnest(v_ids) x;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v_emp, auth.uid(), 'documento_soporte', 'documentos_dian', v_doc::text, jsonb_build_object('numero', v_res.prefijo || v_res.actual, 'proveedor', v_prov.nombre,
    'semanal', v_semanal, 'compras', (select jsonb_agg(numero order by numero) from compras where id = any (v_ids)), 'total', v_total));
  return jsonb_build_object('id', v_doc, 'numero', v_res.prefijo || v_res.actual, 'total', v_total, 'repetido', false);
end $$;

-- ───────────── 6 · Nota de ajuste del documento soporte ─────────────
-- p = { documento_id, concepto: 'anulacion' | 'correccion', motivo, descripcion?, valor? (sin IVA), iva_pct?, idem_key? }
-- Anulación: revierte lo que queda del documento y libera sus compras (pueden volver a soportarse). Corrección: baja el
-- valor (nunca por debajo de cero). Un documento rechazado no se ajusta: se corrige y se reenvía.
create or replace function ajustar_soporte(p jsonb) returns jsonb
language plpgsql security definer set search_path = public set jit = off as $$
declare
  o documentos_dian; v_ya documentos_dian; v_res resoluciones_dian; v_doc uuid := gen_random_uuid();
  v_concepto text := p ->> 'concepto'; v_motivo text := nullif(trim(coalesce(p ->> 'motivo', '')), '');
  v_desc text := nullif(trim(coalesce(p ->> 'descripcion', '')), ''); v_valor numeric := (p ->> 'valor')::numeric; v_pct numeric := coalesce((p ->> 'iva_pct')::numeric, 0);
  v_correcciones int; v_disp numeric; v_disp_tarifa numeric; v_base numeric; v_iva numeric; v_total numeric; v_anula text;
begin
  select * into o from documentos_dian where id = (p ->> 'documento_id')::uuid and tipo = 'soporte' for update;
  if not found or coalesce(rol_en(o.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador hacen notas de ajuste' using errcode = '42501';
  end if;
  if (p ->> 'idem_key') is not null then
    perform pg_advisory_xact_lock(hashtext('dian-doc:' || o.empresa_id::text || ':' || (p ->> 'idem_key')));
    select * into v_ya from documentos_dian where empresa_id = o.empresa_id and idem_key = p ->> 'idem_key';
    if found then return jsonb_build_object('id', v_ya.id, 'numero', v_ya.prefijo || v_ya.numero, 'repetido', true); end if;
  end if;
  if coalesce(v_concepto, '') not in ('anulacion', 'correccion') then raise exception 'Elige si la nota anula o corrige el documento' using errcode = 'P0001'; end if;
  if length(coalesce(v_motivo, '')) < 4 then raise exception 'Escribe el motivo de la nota de ajuste' using errcode = 'P0001'; end if;
  if length(v_motivo) > 300 then raise exception 'El motivo admite máximo 300 caracteres' using errcode = 'P0001'; end if;
  if o.estado = 'rechazado' then
    raise exception 'La DIAN rechazó el documento soporte %: corrige el dato y reenvíalo; la nota de ajuste es para documentos válidos', o.prefijo || o.numero using errcode = 'P0001';
  end if;
  select d.prefijo || d.numero into v_anula from documentos_dian d where d.origen_id = o.id and d.tipo = 'ajuste_soporte' and d.concepto = 'anulacion' limit 1;
  if v_anula is not null then raise exception 'El documento soporte % ya está anulado con la nota de ajuste %', o.prefijo || o.numero, v_anula using errcode = 'P0001'; end if;
  select count(*), o.total - coalesce(sum(total), 0) into v_correcciones, v_disp from documentos_dian where origen_id = o.id and tipo = 'ajuste_soporte';
  if v_disp <= 0 then raise exception 'El documento soporte % ya quedó en cero con sus notas de ajuste', o.prefijo || o.numero using errcode = 'P0001'; end if;
  if v_concepto = 'correccion' then
    if v_desc is null or length(v_desc) < 2 or length(v_desc) > 300 then raise exception 'Escribe qué se corrige (el concepto)' using errcode = 'P0001'; end if;
    if v_valor is null or v_valor <= 0 or v_valor <> round(v_valor, 2) or v_valor > 10000000000 then raise exception 'Escribe el valor sin IVA que se descuenta' using errcode = 'P0001'; end if;
    if v_pct not in (0, 5, 19) then raise exception 'El IVA debe ser 0, 5 o 19 %%' using errcode = 'P0001'; end if;
    v_base := v_valor; v_iva := round(v_valor * v_pct / 100, 2); v_total := v_base + v_iva;
    -- Por tarifa: no se corrige más base de la que el documento tiene con ese IVA (así la anulación del saldo cuadra).
    select coalesce(sum(b), 0) into v_disp_tarifa from (
      select l.base b from documento_lineas l where l.documento_id = o.id and l.iva_pct = v_pct
      union all select -l.base from documento_lineas l join documentos_dian a on a.id = l.documento_id where a.origen_id = o.id and a.tipo = 'ajuste_soporte' and l.iva_pct = v_pct) x;
    if v_base > v_disp_tarifa then
      raise exception 'El documento soporte tiene % de base con IVA del % %%: la corrección no puede ser mayor', to_char(v_disp_tarifa, 'FM999G999G999G990D00'), v_pct::int using errcode = 'P0001';
    end if;
    if v_total > v_disp then
      raise exception 'La corrección (%) supera lo que queda del documento soporte (%): para dejarlo en cero, anúlalo', to_char(v_total, 'FM999G999G999G990D00'),
        to_char(v_disp, 'FM999G999G999G990D00') using errcode = 'P0001';
    end if;
  end if;
  -- La nota hereda el modo del original: si el soporte está en la DIAN, la nota no puede salir en pruebas.
  v_res := dian_siguiente_numero(o.empresa_id, 'ajuste_soporte', 'notas de ajuste del documento soporte');
  if not dian_doc_pruebas(o) and v_res.pruebas then
    raise exception 'Este documento soporte ya está en la DIAN, pero la numeración de notas de ajuste sigue en pruebas: pide que carguen la de producción' using errcode = 'P0001';
  end if;
  if v_concepto = 'anulacion' then
    select sum(b), sum(i), sum(b + i) into v_base, v_iva, v_total from (
      select sum(l.base) b, sum(l.iva) i from documento_lineas l where l.documento_id = o.id
      union all select -sum(l.base), -sum(l.iva) from documento_lineas l join documentos_dian a on a.id = l.documento_id where a.origen_id = o.id and a.tipo = 'ajuste_soporte') x;
  end if;
  insert into documentos_dian (id, empresa_id, tipo, prefijo, numero, proveedor_id, origen_id, concepto, motivo, periodo_desde, periodo_hasta, base, iva, total, idem_key, usuario_id)
  values (v_doc, o.empresa_id, 'ajuste_soporte', v_res.prefijo, v_res.actual, o.proveedor_id, o.id, v_concepto, v_motivo, o.periodo_desde, o.periodo_hasta,
          v_base, v_iva, v_total, p ->> 'idem_key', auth.uid());
  if v_concepto = 'correccion' then
    insert into documento_lineas (empresa_id, documento_id, descripcion, cantidad, precio, iva_pct, base, iva, total)
    values (o.empresa_id, v_doc, left(v_desc, 300), 1, v_base, v_pct, v_base, v_iva, v_total);
  elsif v_correcciones = 0 then
    -- Anulación sin correcciones previas: las mismas líneas del documento soporte.
    insert into documento_lineas (empresa_id, documento_id, descripcion, codigo, cantidad, precio, iva_pct, base, iva, total)
    select empresa_id, v_doc, descripcion, codigo, cantidad, precio, iva_pct, base, iva, total from documento_lineas where documento_id = o.id order by id;
  else
    -- Anulación de lo que queda tras correcciones: una línea por tarifa de IVA con el saldo.
    insert into documento_lineas (empresa_id, documento_id, descripcion, cantidad, precio, iva_pct, base, iva, total)
    select o.empresa_id, v_doc, 'Anulación del saldo del documento soporte ' || o.prefijo || o.numero || ' · IVA ' || pct::int || ' %', 1, b, pct, b, i, b + i
    from (select pct, sum(b) b, sum(i) i from (
            select l.iva_pct pct, l.base b, l.iva i from documento_lineas l where l.documento_id = o.id
            union all select l.iva_pct, -l.base, -l.iva from documento_lineas l join documentos_dian a on a.id = l.documento_id where a.origen_id = o.id and a.tipo = 'ajuste_soporte') y
          group by pct) z
    where b > 0 order by pct;
    if not found then raise exception 'El documento soporte ya quedó en cero con sus notas de ajuste' using errcode = 'P0001'; end if;
  end if;
  if v_concepto = 'anulacion' then
    update soporte_compras set liberada = now(), liberada_por = v_doc where documento_id = o.id and liberada is null;
  end if;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (o.empresa_id, auth.uid(), 'nota_ajuste_soporte', 'documentos_dian', v_doc::text, jsonb_build_object('numero', v_res.prefijo || v_res.actual,
    'soporte', o.prefijo || o.numero, 'concepto', v_concepto, 'motivo', v_motivo, 'total', v_total));
  return jsonb_build_object('id', v_doc, 'numero', v_res.prefijo || v_res.actual, 'total', v_total, 'repetido', false);
end $$;

-- ───────────── 7 · Nota débito de una factura ─────────────
-- p = { documento_id (la factura electrónica), motivo, lineas: [{ descripcion, cantidad, valor (unitario sin IVA), iva_pct }], idem_key? }
-- Aumenta el valor de una factura ya emitida (intereses, fletes, un ajuste de precio). No mueve caja, cartera ni inventario.
create or replace function nota_debito(p jsonb) returns jsonb
language plpgsql security definer set search_path = public set jit = off as $$
declare
  o documentos_dian; v ventas; v_ya documentos_dian; v_res resoluciones_dian; v_doc uuid := gen_random_uuid(); x jsonb;
  v_motivo text := nullif(trim(coalesce(p ->> 'motivo', '')), ''); v_desc text; v_cant numeric; v_valor numeric; v_pct numeric;
  v_base numeric := 0; v_iva numeric := 0; b numeric; i numeric;
begin
  select * into o from documentos_dian where id = (p ->> 'documento_id')::uuid and tipo = 'factura' for update;
  if not found or coalesce(rol_en(o.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador hacen notas débito' using errcode = '42501';
  end if;
  if (p ->> 'idem_key') is not null then
    perform pg_advisory_xact_lock(hashtext('dian-doc:' || o.empresa_id::text || ':' || (p ->> 'idem_key')));
    select * into v_ya from documentos_dian where empresa_id = o.empresa_id and idem_key = p ->> 'idem_key';
    if found then return jsonb_build_object('id', v_ya.id, 'numero', v_ya.prefijo || v_ya.numero, 'repetido', true); end if;
  end if;
  select * into v from ventas where id = o.venta_id;
  if not found or v.estado = 'anulada' then raise exception 'La venta de esta factura está anulada: no admite nota débito' using errcode = 'P0001'; end if;
  if o.estado in ('rechazado', 'anulado') then
    raise exception 'La factura % no está aceptada por la DIAN: corrígela y reenvíala antes de hacer una nota débito', o.prefijo || o.numero using errcode = 'P0001';
  end if;
  if length(coalesce(v_motivo, '')) < 4 then raise exception 'Escribe el motivo de la nota débito' using errcode = 'P0001'; end if;
  if length(v_motivo) > 300 then raise exception 'El motivo admite máximo 300 caracteres' using errcode = 'P0001'; end if;
  if jsonb_typeof(p -> 'lineas') is distinct from 'array' or jsonb_array_length(p -> 'lineas') = 0 then
    raise exception 'Agrega al menos un concepto con su valor' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p -> 'lineas') > 50 then raise exception 'Una nota débito admite máximo 50 líneas' using errcode = 'P0001'; end if;
  v_res := dian_siguiente_numero(o.empresa_id, 'nota_debito', 'notas débito');
  if not dian_doc_pruebas(o) and v_res.pruebas then
    raise exception 'Esta factura ya está en la DIAN, pero la numeración de notas débito sigue en pruebas: pide que carguen la de producción' using errcode = 'P0001';
  end if;
  -- El encabezado primero (las líneas lo referencian); sus totales se completan al final con la suma exacta de las líneas.
  insert into documentos_dian (id, empresa_id, tipo, prefijo, numero, origen_id, concepto, motivo, base, iva, total, idem_key, usuario_id)
  values (v_doc, o.empresa_id, 'nota_debito', v_res.prefijo, v_res.actual, o.id, 'mayor_valor', v_motivo, 0, 0, 0, p ->> 'idem_key', auth.uid());
  for x in select * from jsonb_array_elements(p -> 'lineas') loop
    v_desc := nullif(trim(coalesce(x ->> 'descripcion', '')), '');
    v_cant := coalesce((x ->> 'cantidad')::numeric, 1); v_valor := (x ->> 'valor')::numeric; v_pct := coalesce((x ->> 'iva_pct')::numeric, 0);
    if v_desc is null or length(v_desc) < 2 or length(v_desc) > 300 then raise exception 'Escribe el concepto de cada línea' using errcode = 'P0001'; end if;
    if v_cant <= 0 or v_cant > 100000 or v_cant <> round(v_cant, 3) then raise exception 'Revisa la cantidad de «%»', v_desc using errcode = 'P0001'; end if;
    if v_valor is null or v_valor <= 0 or v_valor > 1000000000 or v_valor <> round(v_valor, 2) then raise exception 'Revisa el valor sin IVA de «%»', v_desc using errcode = 'P0001'; end if;
    if v_pct not in (0, 5, 19) then raise exception 'El IVA de «%» debe ser 0, 5 o 19 %%', v_desc using errcode = 'P0001'; end if;
    b := round(v_cant * v_valor, 2); i := round(b * v_pct / 100, 2);
    insert into documento_lineas (empresa_id, documento_id, descripcion, cantidad, precio, iva_pct, base, iva, total)
    values (o.empresa_id, v_doc, v_desc, v_cant, v_valor, v_pct, b, i, b + i);
    v_base := v_base + b; v_iva := v_iva + i;
  end loop;
  update documentos_dian set base = v_base, iva = v_iva, total = v_base + v_iva where id = v_doc;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (o.empresa_id, auth.uid(), 'nota_debito', 'documentos_dian', v_doc::text, jsonb_build_object('numero', v_res.prefijo || v_res.actual,
    'factura', o.prefijo || o.numero, 'motivo', v_motivo, 'total', v_base + v_iva));
  return jsonb_build_object('id', v_doc, 'numero', v_res.prefijo || v_res.actual, 'total', v_base + v_iva, 'repetido', false);
end $$;

-- ───────────── 8 · Seguridad ─────────────
alter table documento_lineas enable row level security;
alter table soporte_compras enable row level security;
create policy gerencia_lee on documento_lineas for select to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin'])));
create policy gerencia_lee on soporte_compras for select to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin'])));
-- Solo lectura para la app (se escriben por las funciones); nada para anon.
revoke all on documento_lineas, soporte_compras from public, anon, authenticated;
grant select on documento_lineas, soporte_compras to authenticated;

revoke execute on function dian_hijos_proteger(), dian_siguiente_numero(uuid, text, text), dian_doc_pruebas(documentos_dian) from public, anon, authenticated;
revoke execute on function generar_soporte(jsonb), ajustar_soporte(jsonb), nota_debito(jsonb) from public, anon;
grant execute on function generar_soporte(jsonb), ajustar_soporte(jsonb), nota_debito(jsonb) to authenticated;
