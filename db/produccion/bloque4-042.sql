-- Regenta: migración 042 (auditoría del 09/11/2026: seguridad, caja, compras, reportes y DIAN). Una sola transacción. Repetible.
begin;
-- 042 · Auditoría completa (09/11/2026). Repetible: se puede pegar más de una vez en el editor SQL.

-- ── Seguridad ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Cerrar sesión la invalida de verdad (antes solo se borraba la cookie y una copia seguía sirviendo hasta 12 h).
create table if not exists sesiones_cerradas (jti text primary key check (length(jti) <= 64), vence timestamptz not null);
alter table sesiones_cerradas enable row level security; -- sin políticas: solo el servidor la usa
revoke all on sesiones_cerradas from public, anon, authenticated;

-- Doble clic / reintento de red en operaciones con dinero (recibos, abonos, devoluciones, movimientos de caja): la
-- misma clave devuelve el mismo resultado sin registrar otra vez.
create table if not exists operaciones_idem (
  empresa_id uuid not null references empresas on delete cascade,
  clave text not null check (length(clave) between 8 and 64),
  resultado jsonb not null,
  creado timestamptz not null default now(),
  primary key (empresa_id, clave)
);
alter table operaciones_idem enable row level security;
drop policy if exists miembros_usan on operaciones_idem;
create policy miembros_usan on operaciones_idem for all to authenticated
  using (empresa_id in (select mis_empresas())) with check (empresa_id in (select mis_empresas()));
revoke all on operaciones_idem from public, anon;
grant select, insert on operaciones_idem to authenticated;

-- Verificación en dos pasos de la consola (TOTP). El secreto va cifrado por el servidor.
alter table cuentas add column if not exists totp_secreto text check (totp_secreto is null or length(totp_secreto) <= 200);
alter table cuentas add column if not exists totp_pendiente text check (totp_pendiente is null or length(totp_pendiente) <= 200);
alter table cuentas add column if not exists totp_ultimo bigint;

-- Cada arqueo de caja y cada kárdex leían la tabla completa de ventas de todas las droguerías.
create index if not exists ventas_caja_creado on ventas (caja_id, creado);
create index if not exists venta_lineas_producto on venta_lineas (producto_id);

-- La bodega recibe mercancía sin ver costos: el archivo de la factura (con precios) solo lo leen el dueño y el administrador.
drop policy if exists inventario_lee on compra_archivos;
create policy inventario_lee on compra_archivos for select to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin'])));

-- ── Caja ──────────────────────────────────────────────────────────────────────────────────────────────────────
-- Venta hecha sin internet: al sincronizarse queda con la hora real en que se vendió (día, turno y arqueo correctos),
-- no con la de la sincronización. El servidor fija regenta.venta_creado en la transacción de esa venta (solo ahí) y la
-- venta y sus movimientos nacen con esa hora: las ventas y el kárdex no se modifican después (son inmutables).
-- Hasta 72 horas atrás; un reloj desfasado (futuro o más viejo) se ignora y queda la hora de hoy.
drop function if exists fechar_venta_sin_conexion(uuid, timestamptz);
create or replace function fecha_venta_sin_conexion() returns trigger language plpgsql security definer set search_path = public as $$
declare v text := nullif(current_setting('regenta.venta_creado', true), ''); t timestamptz;
begin
  if v is null then return new; end if;
  if tg_table_name = 'movimientos' then
    if to_jsonb(new) ->> 'tipo' <> 'venta' then return new; end if;   -- ventas no tiene «tipo»: se lee sin nombrar el campo
  end if;
  begin t := v::timestamptz; exception when others then return new; end;
  if t > now() or t < now() - interval '72 hours' then return new; end if;
  new.creado := t;
  if tg_table_name = 'ventas' then
    insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
    values (new.empresa_id, auth.uid(), 'venta_sin_conexion', 'ventas', new.id::text, jsonb_build_object('vendida', t, 'registrada', now(), 'total', new.total));
  end if;
  return new;
end $$;
revoke execute on function fecha_venta_sin_conexion() from public, anon, authenticated;
drop trigger if exists ventas_fecha_sin_conexion on ventas;
create trigger ventas_fecha_sin_conexion before insert on ventas for each row execute function fecha_venta_sin_conexion();
drop trigger if exists movimientos_fecha_sin_conexion on movimientos;
create trigger movimientos_fecha_sin_conexion before insert on movimientos for each row execute function fecha_venta_sin_conexion();

-- Anular un abono suelto en efectivo cuyo turno ya cerró: la plata sale de la caja del turno abierto (igual que al
-- anular un recibo), así el arqueo de hoy cuadra.
create or replace function anular_abono(p_abono bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare a abonos; v_turno turnos;
begin
  select * into a from abonos where id = p_abono for update;
  if not found or coalesce(rol_en(a.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador anulan abonos' using errcode = '42501';
  end if;
  if a.anulado then raise exception 'Ese abono ya está anulado' using errcode = 'P0001'; end if;
  if a.recibo_id is not null then
    raise exception 'Este abono es parte del recibo de caja RC-%: anula el recibo completo desde la ficha del cliente', (select numero from recibos_caja where id = a.recibo_id) using errcode = 'P0001';
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indica el motivo' using errcode = 'P0001'; end if;
  update abonos set anulado = true, anulado_motivo = p_motivo where id = p_abono;
  if a.medio = 'efectivo' and a.turno_id is not null and exists (select 1 from turnos where id = a.turno_id and estado = 'cerrado') then
    select * into v_turno from turnos where caja_id = a.caja_id and estado = 'abierto';
    if found then
      insert into movimientos_caja (empresa_id, turno_id, tipo, valor, concepto, usuario_id)
      values (a.empresa_id, v_turno.id, 'egreso', a.valor, left('Devolución por anulación de un abono', 120), auth.uid());
    end if;
  end if;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (a.empresa_id, auth.uid(), 'anular_abono', 'ventas', a.venta_id::text, jsonb_build_object('abono', p_abono, 'valor', a.valor, 'motivo', p_motivo));
end $$;
revoke execute on function anular_abono(bigint, text) from public, anon;
grant execute on function anular_abono(bigint, text) to authenticated;

-- Mensajes con montos en formato colombiano ($27.300, no 27300.00). La función de formato ya existe (pesos_texto).

-- ── Compras ───────────────────────────────────────────────────────────────────────────────────────────────────
-- La misma factura no entra dos veces aunque se registre con otro proveedor: el CUFE es único por droguería.
create or replace function compras_factura_repetida() returns trigger language plpgsql security definer set search_path = public as $$
declare v compras;
begin
  if new.estado = 'anulada' then return new; end if;
  select * into v from compras c
   where c.empresa_id = new.empresa_id and c.proveedor_id = new.proveedor_id and c.id <> new.id and c.estado <> 'anulada'
     and regexp_replace(upper(c.numero_factura), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(new.numero_factura), '[^A-Z0-9]', '', 'g')
   limit 1;
  if found then
    raise exception 'La factura % ya está registrada como % (compra N.º %)', new.numero_factura, v.numero_factura, v.numero using errcode = '23505';
  end if;
  if new.cufe_proveedor is not null then
    select * into v from compras c
     where c.empresa_id = new.empresa_id and c.id <> new.id and c.estado <> 'anulada' and lower(c.cufe_proveedor) = lower(new.cufe_proveedor)
     limit 1;
    if found then
      raise exception 'Esta factura (mismo CUFE) ya está registrada como % de % (compra N.º %)', v.numero_factura, (select nombre from proveedores where id = v.proveedor_id), v.numero using errcode = '23505';
    end if;
  end if;
  return new;
end $$;
revoke execute on function compras_factura_repetida() from public, anon, authenticated;
drop trigger if exists compras_factura_repetida on compras;
create trigger compras_factura_repetida before insert or update of numero_factura, proveedor_id, cufe_proveedor on compras
  for each row execute function compras_factura_repetida();
create index if not exists compras_cufe on compras (empresa_id, lower(cufe_proveedor)) where cufe_proveedor is not null;

-- Dos proveedores con el mismo NIT en la misma droguería partían en dos sus facturas y su saldo. Los que ya existan
-- repetidos se dejan como están (se unen a mano); los nuevos no se dejan crear.
create or replace function proveedores_nit_unico() returns trigger language plpgsql security definer set search_path = public as $$
declare v proveedores;
begin
  if new.nit is null then return new; end if;
  select * into v from proveedores p where p.empresa_id = new.empresa_id and p.nit = new.nit and p.id <> new.id limit 1;
  if found then raise exception 'Ya tienes el proveedor % con el NIT %', v.nombre, new.nit using errcode = '23505'; end if;
  return new;
end $$;
revoke execute on function proveedores_nit_unico() from public, anon, authenticated;
drop trigger if exists proveedores_nit_unico on proveedores;
create trigger proveedores_nit_unico before insert or update of nit on proveedores for each row execute function proveedores_nit_unico();

-- Último costo de un producto: una línea solo bonificada (costo 0) no lo deja en $0.
create or replace function ultimo_costo(p_producto uuid, out costo numeric, out heredado boolean, out origen text) returns record
language plpgsql stable set search_path = public as $$
begin
  select cl.costo_lote, false, 'compra' into costo, heredado, origen
  from compra_lineas cl join compras c on c.id = cl.compra_id
  where cl.producto_id = p_producto and c.estado = 'registrada' and cl.costo_lote is not null and cl.unidades > 0
  order by coalesce(c.costeada, c.creado) desc, cl.id desc limit 1;
  if found then return; end if;
  select lc.costo_unidad, lc.heredado, 'lote' into costo, heredado, origen
  from lote_costos lc join lotes l on l.id = lc.lote_id
  where l.producto_id = p_producto and lc.costo_unidad > 0
  order by coalesce(lc.actualizado, l.creado) desc, l.creado desc limit 1;
end $$;

-- Flete, domicilio, seguro… de la factura del proveedor: no son mercancía, pero se le deben. Van en la compra (total,
-- IVA descontable y cuenta por pagar). Solo el dueño o el administrador, una vez por compra registrada.
alter table compras add column if not exists cargos numeric(14, 2) not null default 0 check (cargos >= 0);
alter table compras add column if not exists cargos_iva numeric(14, 2) not null default 0 check (cargos_iva >= 0);
alter table compras add column if not exists cargos_detalle jsonb;
create or replace function compra_proteger() returns trigger language plpgsql as $$
declare v_costos text[] := array['estado', 'subtotal', 'descuento', 'iva', 'total', 'total_papel', 'diferencia', 'condicion', 'vence_pago', 'costeada', 'costea_usuario'];
        v_anular text[] := array['estado', 'motivo_anulacion', 'anulada', 'anula_usuario'];
        v_cargos text[] := array['cargos', 'cargos_iva', 'cargos_detalle', 'subtotal', 'iva', 'total', 'total_papel'];
begin
  if tg_op = 'DELETE' and current_user not in ('authenticated', 'anon') and current_setting('regenta.eliminar_empresa', true) = old.empresa_id::text then return old; end if;  -- eliminar_empresa_prueba
  if tg_op = 'DELETE' then raise exception 'Las compras no se borran: se anulan' using errcode = 'P0001'; end if;
  if old.estado = 'anulada' then raise exception 'Una compra anulada no se modifica' using errcode = 'P0001'; end if;
  if old.estado = 'por_costear' and new.estado = 'registrada' and (to_jsonb(new) - v_costos) = (to_jsonb(old) - v_costos) then return new; end if;
  if new.estado = 'anulada' and (to_jsonb(new) - v_anular) = (to_jsonb(old) - v_anular) then return new; end if;
  if current_setting('regenta.cargos_compra', true) = old.id::text and (to_jsonb(new) - v_cargos) = (to_jsonb(old) - v_cargos) then return new; end if;
  raise exception 'Los datos de una compra no se cambian' using errcode = 'P0001';
end $$;

-- p = [{ descripcion, base, iva }]
create or replace function agregar_cargos_compra(p_compra uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c compras; x jsonb; v_base numeric := 0; v_iva numeric := 0; v_det jsonb := '[]'::jsonb;
begin
  select * into c from compras where id = p_compra for update;
  if not found or coalesce(rol_en(c.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador registran los cargos de una compra' using errcode = '42501';
  end if;
  if c.estado <> 'registrada' then raise exception 'Los cargos se agregan a una compra registrada (con costos)' using errcode = 'P0001'; end if;
  if c.cargos > 0 then raise exception 'Esta compra ya tiene sus cargos' using errcode = 'P0001'; end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) = 0 or jsonb_array_length(p) > 10 then raise exception 'Cargos no válidos' using errcode = 'P0001'; end if;
  for x in select * from jsonb_array_elements(p) loop
    if coalesce((x ->> 'base')::numeric, -1) <= 0 or coalesce((x ->> 'iva')::numeric, -1) < 0 or (x ->> 'base')::numeric > 1000000000 or (x ->> 'iva')::numeric > (x ->> 'base')::numeric then
      raise exception 'Revisa el valor del cargo %', coalesce(x ->> 'descripcion', '') using errcode = 'P0001';
    end if;
    v_base := v_base + round((x ->> 'base')::numeric, 2); v_iva := v_iva + round((x ->> 'iva')::numeric, 2);
    v_det := v_det || jsonb_build_object('descripcion', left(coalesce(x ->> 'descripcion', 'Cargo'), 120), 'base', round((x ->> 'base')::numeric, 2), 'iva', round((x ->> 'iva')::numeric, 2));
  end loop;
  -- No responsable de IVA: el IVA del flete es más costo (no descontable).
  if not coalesce((select e.responsable_iva from empresas e where e.id = c.empresa_id), true) then v_base := v_base + v_iva; v_iva := 0; end if;
  perform set_config('regenta.cargos_compra', c.id::text, true);
  update compras set cargos = v_base, cargos_iva = v_iva, cargos_detalle = v_det, subtotal = subtotal + v_base, iva = iva + v_iva,
                     total = total + v_base + v_iva, total_papel = case when total_papel is null then null else total_papel + v_base + v_iva end
   where id = c.id;
  perform set_config('regenta.cargos_compra', '', true);
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (c.empresa_id, auth.uid(), 'cargos_compra', 'compras', c.id::text, jsonb_build_object('numero', c.numero, 'cargos', v_det));
  return jsonb_build_object('cargos', v_base, 'iva', v_iva, 'total', c.total + v_base + v_iva);
end $$;
revoke execute on function agregar_cargos_compra(uuid, jsonb) from public, anon;
grant execute on function agregar_cargos_compra(uuid, jsonb) to authenticated;

-- Anular una compra devuelve también el precio de venta por caja que esa compra cambió (si nadie lo volvió a cambiar).
create or replace function compras_anulada_precio() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.estado <> 'anulada' and new.estado = 'anulada' then
    update productos p set precio_caja = l.precio_anterior
      from compra_lineas l
     where l.compra_id = new.id and p.id = l.producto_id and l.precio_venta_nuevo is not null and l.precio_anterior is not null
       and p.precio_caja = l.precio_venta_nuevo;
  end if;
  return new;
end $$;
revoke execute on function compras_anulada_precio() from public, anon, authenticated;
drop trigger if exists compras_anulada_precio on compras;
create trigger compras_anulada_precio after update of estado on compras for each row execute function compras_anulada_precio();

-- ── DIAN ──────────────────────────────────────────────────────────────────────────────────────────────────────
-- Res. DIAN 165/2023, arts. 42 y 43: la DIAN solo autoriza la numeración de la factura, el POS y el documento soporte.
-- Las notas (crédito, débito, de ajuste) llevan consecutivo propio, sin número de resolución (arts. 22 y 36).
alter table resoluciones_dian drop constraint if exists produccion_completa;
alter table resoluciones_dian add constraint produccion_completa
  check (pruebas or length(prefijo) <= 4 and (numero_resolucion is not null or tipo not in ('pos', 'factura', 'soporte'))) not valid;

-- ── IVA del no responsable ───────────────────────────────────────────────────────────────────────────────────
-- Quien no es responsable de IVA no lo descuenta (E.T. art. 488; DIAN, oficio 15660 de 2026): el IVA que paga en la
-- compra es más costo. La línea queda con su costo con IVA y tarifa 0: el lote cuesta lo que se pagó (la utilidad no
-- sale inflada) y el auxiliar no muestra un «IVA descontable» que no existe. Mismo total de la factura.
create or replace function compra_costeo(x jsonb, p_prod productos, p_unidades integer) returns jsonb
language plpgsql stable set search_path = public as $$
declare v_costo numeric := (x ->> 'costo')::numeric; v_por text := coalesce(x ->> 'costo_por', 'unidad');
  v_desc numeric := coalesce((x ->> 'descuento_pct')::numeric, 0); v_iva numeric := coalesce((x ->> 'iva_pct')::numeric, p_prod.iva);
  v_factor integer; r record;
begin
  if v_costo is null or v_costo < 0 or v_costo > 100000000 or v_costo <> round(v_costo, 2) then
    raise exception 'Revisa el costo de % (sin IVA, hasta dos decimales)', p_prod.nombre using errcode = 'P0001';
  end if;
  if v_por not in ('caja', 'unidad') then raise exception 'Indica si el costo de % es por caja o por unidad', p_prod.nombre using errcode = 'P0001'; end if;
  if v_desc < 0 or v_desc >= 100 or v_desc <> round(v_desc, 2) then raise exception 'El descuento de % debe estar entre 0 y 99,99 %%', p_prod.nombre using errcode = 'P0001'; end if;
  if v_iva not in (0, 5, 19) then raise exception 'El IVA de % debe ser 0, 5 o 19 %%', p_prod.nombre using errcode = 'P0001'; end if;
  v_factor := case when v_por = 'caja' then p_prod.unidades_por_caja else 1 end;
  select * into r from compra_calcular_linea(v_costo, v_factor, p_unidades, v_desc, v_iva);
  -- Mismos totales de la factura (al centavo); solo cambia qué es base y qué es IVA.
  if v_iva > 0 and not coalesce((select e.responsable_iva from empresas e where e.id = p_prod.empresa_id), true) then
    return jsonb_build_object('costo', round(v_costo * (1 + v_iva / 100), 2), 'costo_por', v_por, 'costo_unidad', round(v_costo * (1 + v_iva / 100) / v_factor, 6),
      'descuento_pct', v_desc, 'iva_pct', 0, 'bruto', r.bruto + r.iva + (r.bruto - r.base) * v_iva / 100, 'base', r.total, 'iva', 0, 'total', r.total);
  end if;
  return jsonb_build_object('costo', v_costo, 'costo_por', v_por, 'costo_unidad', round(v_costo / v_factor, 6), 'descuento_pct', v_desc, 'iva_pct', v_iva,
    'bruto', r.bruto, 'base', r.base, 'iva', r.iva, 'total', r.total);
end $$;

-- Nota débito de un no responsable de IVA: sin IVA (igual que sus ventas). La pantalla ya no ofrece la tarifa.
create or replace function documento_lineas_sin_iva() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.iva_pct > 0 and exists (select 1 from documentos_dian d join empresas e on e.id = d.empresa_id
                                 where d.id = new.documento_id and d.tipo = 'nota_debito' and not e.responsable_iva) then
    raise exception 'Tu droguería no es responsable de IVA: la nota débito va sin IVA' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function documento_lineas_sin_iva() from public, anon, authenticated;
drop trigger if exists documento_lineas_sin_iva on documento_lineas;
create trigger documento_lineas_sin_iva before insert on documento_lineas for each row execute function documento_lineas_sin_iva();
commit;
