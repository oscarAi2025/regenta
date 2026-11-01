-- Regenta · seguridad por fila (RLS) y permisos.
-- authenticated = usuario con sesión. Todo se filtra por la empresa de la que es miembro activo (rol_en).
-- Las escrituras sensibles (ventas, movimientos, documentos) NO tienen permiso directo: solo entran por funciones
-- security definer que validan el rol. El proceso de la cola DIAN usa la conexión del servidor (sin RLS).

alter table empresas enable row level security;
alter table sedes enable row level security;
alter table cajas enable row level security;
alter table miembros enable row level security;
alter table superadmins enable row level security;
alter table productos_maestro enable row level security;
alter table productos enable row level security;
alter table lotes enable row level security;
alter table lote_costos enable row level security;
alter table movimientos enable row level security;
alter table clientes enable row level security;
alter table resoluciones_dian enable row level security;
alter table ventas enable row level security;
alter table venta_lineas enable row level security;
alter table pagos enable row level security;
alter table documentos_dian enable row level security;
alter table auditoria enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon;

-- Lectura para cualquier miembro activo de la empresa.
create policy miembro_lee on empresas for select to authenticated using (rol_en(id) is not null);
create policy miembro_lee on sedes for select to authenticated using (rol_en(empresa_id) is not null);
create policy miembro_lee on cajas for select to authenticated using (rol_en(empresa_id) is not null);
create policy miembro_lee on miembros for select to authenticated using (rol_en(empresa_id) is not null);
create policy miembro_lee on productos for select to authenticated using (rol_en(empresa_id) is not null);
create policy miembro_lee on lotes for select to authenticated using (rol_en(empresa_id) is not null);
create policy miembro_lee on movimientos for select to authenticated using (rol_en(empresa_id) is not null);
create policy miembro_lee on clientes for select to authenticated using (rol_en(empresa_id) is not null);
create policy miembro_lee on resoluciones_dian for select to authenticated using (rol_en(empresa_id) is not null);
create policy miembro_lee on ventas for select to authenticated using (rol_en(empresa_id) is not null);
create policy miembro_lee on venta_lineas for select to authenticated using (rol_en(empresa_id) is not null);
create policy miembro_lee on pagos for select to authenticated using (rol_en(empresa_id) is not null);
create policy miembro_lee on documentos_dian for select to authenticated using (rol_en(empresa_id) is not null);
create policy catalogo_comun on productos_maestro for select to authenticated using (true);

-- Solo dueño y administrador.
create policy gerencia_lee on lote_costos for select to authenticated using (rol_en(empresa_id) in ('dueno', 'admin'));
create policy gerencia_lee on auditoria for select to authenticated using (rol_en(empresa_id) in ('dueno', 'admin'));
create policy gerencia_escribe on productos for insert to authenticated with check (rol_en(empresa_id) in ('dueno', 'admin'));
create policy gerencia_actualiza on productos for update to authenticated
  using (rol_en(empresa_id) in ('dueno', 'admin')) with check (rol_en(empresa_id) in ('dueno', 'admin'));
create policy gerencia_actualiza on empresas for update to authenticated
  using (rol_en(id) = 'dueno') with check (rol_en(id) = 'dueno');
create policy dueno_gestiona on miembros for all to authenticated
  using (rol_en(empresa_id) = 'dueno') with check (rol_en(empresa_id) = 'dueno');

-- Clientes: los crean quienes venden.
create policy venta_crea_cliente on clientes for insert to authenticated
  with check (rol_en(empresa_id) in ('dueno', 'admin', 'cajero', 'vendedor'));
create policy venta_actualiza_cliente on clientes for update to authenticated
  using (rol_en(empresa_id) in ('dueno', 'admin', 'cajero', 'vendedor'))
  with check (rol_en(empresa_id) in ('dueno', 'admin', 'cajero', 'vendedor'));

grant select on empresas, sedes, cajas, miembros, productos_maestro, productos, lotes, lote_costos, movimientos, clientes,
  resoluciones_dian, ventas, venta_lineas, pagos, documentos_dian, auditoria, v_stock_lotes to authenticated;
grant insert, update on productos, clientes, miembros to authenticated;
-- El dueño solo puede cambiar sus datos de contacto: nunca plan, estado ni NIT.
grant update (nombre_comercial, direccion, ciudad, telefono, email) on empresas to authenticated;
grant delete on miembros to authenticated;

-- ───────────────────────── Entradas de inventario ─────────────────────────
-- Compra, carga inicial o ajuste. p = { empresa_id, sede_id, tipo: 'inicial'|'compra'|'ajuste', motivo?,
--   lineas: [{ producto_id, lote, vence?, unidades, costo_unidad? }] }  (en ajustes, unidades puede ser negativo)
create function registrar_entrada(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := (p ->> 'empresa_id')::uuid;
  v_sede uuid := (p ->> 'sede_id')::uuid;
  v_tipo text := p ->> 'tipo';
  v_rol text := rol_en(v_emp);
  ln jsonb; v_lote uuid; v_unid integer; v_ref uuid := gen_random_uuid(); v_n integer := 0;
  v_gerencia boolean := v_rol in ('dueno', 'admin');
begin
  if v_rol is null or v_rol not in ('dueno', 'admin', 'bodeguero') then
    raise exception 'No tienes permiso para mover inventario' using errcode = '42501';
  end if;
  -- Idempotencia: la misma entrada enviada dos veces (corte de red, doble clic) se registra una sola vez.
  if (p ->> 'idem_key') is not null then
    perform pg_advisory_xact_lock(hashtext(v_emp::text || ':' || (p ->> 'idem_key')));
    if exists (select 1 from entradas_idem where empresa_id = v_emp and idem_key = p ->> 'idem_key') then
      return (select resultado || jsonb_build_object('repetida', true) from entradas_idem where empresa_id = v_emp and idem_key = p ->> 'idem_key');
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext(x)) from (select distinct e ->> 'producto_id' x from jsonb_array_elements(p -> 'lineas') e order by 1) s;
  if v_tipo not in ('inicial', 'compra', 'ajuste') then raise exception 'Tipo de entrada no válido' using errcode = 'P0001'; end if;
  if v_tipo = 'ajuste' and coalesce(trim(p ->> 'motivo'), '') = '' then
    raise exception 'Todo ajuste de inventario necesita un motivo' using errcode = 'P0001';
  end if;
  if not exists (select 1 from sedes where id = v_sede and empresa_id = v_emp) then raise exception 'Sede no válida' using errcode = 'P0001'; end if;
  for ln in select * from jsonb_array_elements(p -> 'lineas') loop
    if not exists (select 1 from productos where id = (ln ->> 'producto_id')::uuid and empresa_id = v_emp) then
      raise exception 'Producto no válido' using errcode = 'P0001';
    end if;
    v_unid := (ln ->> 'unidades')::integer;
    if v_unid is null or v_unid = 0 or (v_tipo <> 'ajuste' and v_unid < 0) then raise exception 'Cantidad no válida' using errcode = 'P0001'; end if;
    insert into lotes (empresa_id, sede_id, producto_id, lote, vence)
    values (v_emp, v_sede, (ln ->> 'producto_id')::uuid, upper(trim(ln ->> 'lote')), (ln ->> 'vence')::date)
    on conflict (sede_id, producto_id, lote) do update set vence = coalesce(excluded.vence, lotes.vence)
    returning id into v_lote;
    if (ln ->> 'costo_unidad') is not null and v_gerencia then  -- el costo solo lo registra la gerencia
      insert into lote_costos (lote_id, empresa_id, costo_unidad) values (v_lote, v_emp, (ln ->> 'costo_unidad')::numeric)
      on conflict (lote_id) do update set costo_unidad = excluded.costo_unidad;
    end if;
    if v_unid < 0 then
      if (select unidades from v_stock_lotes where lote_id = v_lote) + v_unid < 0 then
        raise exception 'El ajuste dejaría el lote % en negativo', ln ->> 'lote' using errcode = 'P0001';
      end if;
    end if;
    insert into movimientos (empresa_id, sede_id, producto_id, lote_id, cantidad, tipo, ref_id, motivo, usuario_id)
    values (v_emp, v_sede, (ln ->> 'producto_id')::uuid, v_lote, v_unid, v_tipo, v_ref, p ->> 'motivo', auth.uid());
    v_n := v_n + 1;
  end loop;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v_emp, auth.uid(), 'entrada_' || v_tipo, 'movimientos', v_ref::text, jsonb_build_object('lineas', v_n, 'motivo', p ->> 'motivo'));
  if (p ->> 'idem_key') is not null then
    insert into entradas_idem (empresa_id, idem_key, resultado) values (v_emp, p ->> 'idem_key', jsonb_build_object('ref', v_ref, 'lineas', v_n));
  end if;
  return jsonb_build_object('ref', v_ref, 'lineas', v_n);
end $$;

-- Anular una venta: devuelve las unidades a sus lotes y corrige ante la DIAN: si el documento aún no salió, no se envía;
-- si ya fue aceptado, se genera la nota crédito (con la numeración de su resolución) para que la cola la emita.
create function anular_venta(p_venta uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v ventas; ln venta_lineas; d documentos_dian; v_res resoluciones_dian;
begin
  select * into v from ventas where id = p_venta for update;
  if not found or coalesce(rol_en(v.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador pueden anular ventas' using errcode = '42501';
  end if;
  if v.estado <> 'cerrada' then raise exception 'La venta ya está anulada' using errcode = 'P0001'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indica el motivo de la anulación' using errcode = 'P0001'; end if;
  update ventas set estado = 'anulada' where id = p_venta;
  select * into d from documentos_dian where venta_id = p_venta and tipo <> 'nota_credito' for update;
  if found and d.estado in ('pendiente', 'rechazado') then
    update documentos_dian set estado = 'anulado', ultimo_error = 'Venta anulada antes de emitirse', actualizado = now() where id = d.id;
  elsif found and d.estado in ('aceptado', 'enviando') then
    select * into v_res from resoluciones_dian where empresa_id = v.empresa_id and tipo = 'nota_credito' and activa for update;
    if not found then raise exception 'Para anular un documento ya emitido necesitas una numeración de notas crédito activa' using errcode = 'P0001'; end if;
    if v_res.actual + 1 > v_res.hasta then raise exception 'Se agotó la numeración de notas crédito' using errcode = 'P0001'; end if;
    update resoluciones_dian set actual = actual + 1 where id = v_res.id;
    insert into documentos_dian (empresa_id, venta_id, tipo, prefijo, numero) values (v.empresa_id, p_venta, 'nota_credito', v_res.prefijo, v_res.actual + 1);
  end if;
  for ln in select * from venta_lineas where venta_id = p_venta loop
    insert into movimientos (empresa_id, sede_id, producto_id, lote_id, cantidad, tipo, ref_id, motivo, usuario_id)
    values (v.empresa_id, v.sede_id, ln.producto_id, ln.lote_id, ln.unidades, 'anulacion', p_venta, p_motivo, auth.uid());
  end loop;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v.empresa_id, auth.uid(), 'anular_venta', 'ventas', p_venta::text, jsonb_build_object('motivo', p_motivo, 'total', v.total));
end $$;

grant execute on function rol_en(uuid), registrar_venta(jsonb), registrar_entrada(jsonb), anular_venta(uuid, text) to authenticated;
