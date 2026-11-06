-- Regenta · compras, proveedores y cuentas por pagar.
-- Reglas:
--   · Una compra es un documento: proveedor, factura, fecha, condición (contado o crédito), líneas con costo SIN IVA, IVA,
--     descuento y bonificadas, totales calculados por la base de datos y el total que dice el papel (para cuadrar).
--   · Toda entrada al inventario sigue pasando por registrar_entrada (tipo 'compra', con ref_id = id de la compra).
--   · El costo del lote es SIEMPRE sin IVA: base de la línea (con descuento) ÷ unidades que entran (pagadas + bonificadas).
--     Si el lote ya tenía costo y existencias, queda el promedio ponderado.
--   · La bodega registra la recepción sin costos (estado «por_costear», no ve dinero); el dueño o el administrador completa
--     los costos y en ese momento nace la cuenta por pagar.
--   · Compras, líneas, pagos y devoluciones no se borran: se anulan con motivo (y quedan en la auditoría).
--   · Saldo de una compra = total − pagos vigentes aplicados − notas crédito del proveedor registradas.

-- ───────────────────────── Proveedores: datos para pagar ─────────────────────────
alter table proveedores add column if not exists dv text check (dv is null or dv ~ '^[0-9]$');
alter table proveedores add column if not exists direccion text check (direccion is null or length(direccion) <= 160);
alter table proveedores add column if not exists ciudad text check (ciudad is null or length(ciudad) <= 80);
alter table proveedores add column if not exists plazo_dias integer check (plazo_dias is null or plazo_dias between 0 and 365);
alter table proveedores add column if not exists responsable_iva boolean not null default true;
alter table proveedores add column if not exists obligado_facturar boolean not null default true;
alter table proveedores add column if not exists contacto text check (contacto is null or length(contacto) <= 120);

-- ───────────────────────── Costos heredados ─────────────────────────
-- Los costos que había antes de esta migración no dicen si llevan IVA: quedan marcados para que la ganancia los distinga.
alter table lote_costos add column if not exists heredado boolean not null default false;
alter table lote_costos add column if not exists actualizado timestamptz;
update lote_costos set heredado = true;
comment on column lote_costos.heredado is 'Costo anterior a la migración 031: no se sabe si incluye IVA. Los costos de compras (031 en adelante) son sin IVA.';

create index if not exists movimientos_ref on movimientos (ref_id);

-- ───────────────────────── Compras ─────────────────────────
create table if not exists compras (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  sede_id uuid not null references sedes,
  numero integer not null check (numero > 0),                 -- consecutivo interno por droguería
  proveedor_id uuid not null references proveedores,
  numero_factura text not null check (length(numero_factura) between 1 and 40),
  fecha_factura date not null,
  condicion text not null default 'contado' check (condicion in ('contado', 'credito')),
  vence_pago date not null,
  subtotal numeric(14, 2) not null default 0 check (subtotal >= 0),   -- antes de descuento e IVA
  descuento numeric(14, 2) not null default 0 check (descuento >= 0),
  iva numeric(14, 2) not null default 0 check (iva >= 0),
  total numeric(14, 2) not null default 0 check (total >= 0),
  total_papel numeric(14, 2) check (total_papel is null or total_papel >= 0),   -- lo que dice la factura del proveedor
  diferencia numeric(14, 2),                                           -- total_papel − total
  cufe_proveedor text check (cufe_proveedor is null or length(cufe_proveedor) <= 120),
  observaciones text check (observaciones is null or length(observaciones) <= 300),
  estado text not null check (estado in ('por_costear', 'registrada', 'anulada')),
  motivo_anulacion text check (motivo_anulacion is null or length(motivo_anulacion) between 4 and 300),
  anulada timestamptz,
  anula_usuario uuid,
  costeada timestamptz,
  costea_usuario uuid,
  idem_key text check (idem_key is null or length(idem_key) <= 80),
  usuario_id uuid not null,
  creado timestamptz not null default now(),
  unique (empresa_id, numero),
  unique (empresa_id, idem_key),
  check (vence_pago >= fecha_factura),
  check ((estado = 'anulada') = (motivo_anulacion is not null)),
  check (subtotal - descuento + iva = total)
);
create unique index if not exists compras_factura_unica on compras (empresa_id, proveedor_id, upper(numero_factura)) where estado <> 'anulada';
create index if not exists compras_empresa on compras (empresa_id, creado desc);
create index if not exists compras_proveedor on compras (proveedor_id, vence_pago);

create table if not exists compra_lineas (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  compra_id uuid not null references compras on delete restrict,
  producto_id uuid not null references productos,
  lote_id uuid not null references lotes,
  unidades integer not null check (unidades >= 0),            -- pagadas, en unidades base
  bonificadas integer not null default 0 check (bonificadas >= 0),
  costo numeric(14, 2) check (costo is null or costo >= 0),     -- como se digitó (sin IVA), por caja o por unidad
  costo_por text check (costo_por in ('caja', 'unidad')),
  costo_unidad_sin_iva numeric(18, 6) check (costo_unidad_sin_iva is null or costo_unidad_sin_iva >= 0),  -- por unidad pagada
  descuento_pct numeric(5, 2) not null default 0 check (descuento_pct >= 0 and descuento_pct < 100),
  iva_pct numeric(5, 2) check (iva_pct is null or iva_pct in (0, 5, 19)),
  bruto numeric(14, 2),                                          -- antes del descuento
  base numeric(14, 2),                                           -- con descuento, sin IVA
  iva numeric(14, 2),
  total numeric(14, 2),
  costo_lote numeric(18, 6),                                     -- base ÷ (pagadas + bonificadas): lo que cuesta cada unidad que entra
  costo_lote_antes numeric(14, 4),                               -- costo del lote antes de esta compra (para anular)
  costo_lote_despues numeric(14, 4),
  precio_anterior numeric(14, 2),                                -- precio de venta por caja (con IVA) al registrar
  precio_venta_nuevo numeric(14, 2) check (precio_venta_nuevo is null or (precio_venta_nuevo > 0 and precio_venta_nuevo = trunc(precio_venta_nuevo))),
  precio_unidad_nuevo numeric(14, 2) check (precio_unidad_nuevo is null or (precio_unidad_nuevo > 0 and precio_unidad_nuevo = trunc(precio_unidad_nuevo))),
  check (unidades + bonificadas > 0),
  check ((costo is null) = (costo_unidad_sin_iva is null) and (costo is null) = (base is null))
);
create index if not exists compra_lineas_compra on compra_lineas (compra_id);
create index if not exists compra_lineas_lote on compra_lineas (lote_id);

-- ───────────────────────── Pagos a proveedores ─────────────────────────
create table if not exists pagos_proveedor (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  proveedor_id uuid not null references proveedores,
  medio text not null check (medio in ('efectivo', 'transferencia', 'consignacion', 'cheque', 'nequi', 'daviplata', 'bre_b', 'tarjeta')),
  valor numeric(14, 2) not null check (valor > 0),
  referencia text check (referencia is null or length(referencia) <= 60),
  caja_id uuid references cajas,
  turno_id uuid references turnos,
  movimiento_caja_id bigint references movimientos_caja,
  anulado boolean not null default false,
  motivo text check (motivo is null or length(motivo) between 4 and 300),
  anulado_en timestamptz,
  anula_usuario uuid,
  idem_key text check (idem_key is null or length(idem_key) <= 80),
  usuario_id uuid not null,
  creado timestamptz not null default now(),
  unique (empresa_id, idem_key),
  check (anulado = (motivo is not null)),
  check ((caja_id is null) = (turno_id is null))
);
create index if not exists pagos_proveedor_prov on pagos_proveedor (proveedor_id, creado desc);
create index if not exists pagos_proveedor_empresa on pagos_proveedor (empresa_id, creado desc);

create table if not exists pago_aplicaciones (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  pago_id uuid not null references pagos_proveedor on delete restrict deferrable initially deferred,
  compra_id uuid not null references compras on delete restrict,
  valor numeric(14, 2) not null check (valor > 0)
);
create index if not exists pago_aplicaciones_compra on pago_aplicaciones (compra_id);
create index if not exists pago_aplicaciones_pago on pago_aplicaciones (pago_id);

-- ───────────────────────── Devoluciones al proveedor ─────────────────────────
create table if not exists devoluciones_proveedor (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  sede_id uuid not null references sedes,
  numero integer not null check (numero > 0),
  compra_id uuid not null references compras on delete restrict,
  proveedor_id uuid not null references proveedores,
  motivo text not null check (length(motivo) between 4 and 200),
  valor numeric(14, 2) not null check (valor >= 0),                 -- con IVA: lo que debe acreditar el proveedor
  estado text not null default 'pendiente_nc' check (estado in ('pendiente_nc', 'aplicada')),
  nc_proveedor text check (nc_proveedor is null or length(nc_proveedor) between 1 and 40),
  valor_nc numeric(14, 2) check (valor_nc is null or valor_nc > 0),
  aplicada timestamptz,
  aplica_usuario uuid,
  idem_key text check (idem_key is null or length(idem_key) <= 80),
  usuario_id uuid not null,
  creado timestamptz not null default now(),
  unique (empresa_id, numero),
  unique (empresa_id, idem_key),
  check ((estado = 'aplicada') = (nc_proveedor is not null and valor_nc is not null))
);
create index if not exists devoluciones_proveedor_compra on devoluciones_proveedor (compra_id);

create table if not exists devolucion_proveedor_lineas (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  devolucion_id uuid not null references devoluciones_proveedor on delete restrict deferrable initially deferred,
  compra_id uuid not null references compras on delete restrict,
  compra_linea_id bigint not null references compra_lineas on delete restrict,
  producto_id uuid not null references productos,
  lote_id uuid not null references lotes,
  unidades integer not null check (unidades > 0),
  valor numeric(14, 2) not null check (valor >= 0)
);
create index if not exists devolucion_proveedor_lineas_dev on devolucion_proveedor_lineas (devolucion_id);
create index if not exists devolucion_proveedor_lineas_linea on devolucion_proveedor_lineas (compra_linea_id);

-- ───────────────────────── Inmutabilidad ─────────────────────────
-- Una compra solo cambia al completar sus costos (por_costear → registrada) o al anularse; nada se borra.
create or replace function compra_proteger() returns trigger language plpgsql as $$
declare v_costos text[] := array['estado', 'subtotal', 'descuento', 'iva', 'total', 'total_papel', 'diferencia', 'condicion', 'vence_pago', 'costeada', 'costea_usuario'];
        v_anular text[] := array['estado', 'motivo_anulacion', 'anulada', 'anula_usuario'];
begin
  if tg_op = 'DELETE' and current_user not in ('authenticated', 'anon') and current_setting('regenta.eliminar_empresa', true) = old.empresa_id::text then return old; end if;  -- eliminar_empresa_prueba
  if tg_op = 'DELETE' then raise exception 'Las compras no se borran: se anulan' using errcode = 'P0001'; end if;
  if old.estado = 'anulada' then raise exception 'Una compra anulada no se modifica' using errcode = 'P0001'; end if;
  if old.estado = 'por_costear' and new.estado = 'registrada' and (to_jsonb(new) - v_costos) = (to_jsonb(old) - v_costos) then return new; end if;
  if new.estado = 'anulada' and (to_jsonb(new) - v_anular) = (to_jsonb(old) - v_anular) then return new; end if;
  raise exception 'Los datos de una compra no se cambian' using errcode = 'P0001';
end $$;
drop trigger if exists compras_proteger on compras;
create trigger compras_proteger before update or delete on compras for each row execute function compra_proteger();

-- Las líneas solo reciben sus costos mientras la compra está por costear.
create or replace function compra_linea_proteger() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_user not in ('authenticated', 'anon') and current_setting('regenta.eliminar_empresa', true) = old.empresa_id::text then return old; end if;  -- eliminar_empresa_prueba
  if tg_op = 'DELETE' then raise exception 'Las líneas de una compra no se borran' using errcode = 'P0001'; end if;
  if (select estado from compras where id = old.compra_id) <> 'por_costear'
     or (new.compra_id, new.producto_id, new.lote_id, new.unidades, new.bonificadas, new.empresa_id)
        is distinct from (old.compra_id, old.producto_id, old.lote_id, old.unidades, old.bonificadas, old.empresa_id) then
    raise exception 'Las líneas de una compra no se cambian' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists compra_lineas_proteger on compra_lineas;
create trigger compra_lineas_proteger before update or delete on compra_lineas for each row execute function compra_linea_proteger();

create or replace function pago_proveedor_proteger() returns trigger language plpgsql as $$
declare v text[] := array['anulado', 'motivo', 'anulado_en', 'anula_usuario'];
begin
  if tg_op = 'DELETE' and current_user not in ('authenticated', 'anon') and current_setting('regenta.eliminar_empresa', true) = old.empresa_id::text then return old; end if;  -- eliminar_empresa_prueba
  if tg_op = 'DELETE' then raise exception 'Los pagos no se borran: se anulan' using errcode = 'P0001'; end if;
  if old.anulado or not new.anulado or (to_jsonb(new) - v) <> (to_jsonb(old) - v) then
    raise exception 'Un pago solo puede anularse' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists pagos_proveedor_proteger on pagos_proveedor;
create trigger pagos_proveedor_proteger before update or delete on pagos_proveedor for each row execute function pago_proveedor_proteger();

create or replace function devolucion_proveedor_proteger() returns trigger language plpgsql as $$
declare v text[] := array['estado', 'nc_proveedor', 'valor_nc', 'aplicada', 'aplica_usuario'];
begin
  if tg_op = 'DELETE' and current_user not in ('authenticated', 'anon') and current_setting('regenta.eliminar_empresa', true) = old.empresa_id::text then return old; end if;  -- eliminar_empresa_prueba
  if tg_op = 'DELETE' then raise exception 'Las devoluciones no se borran' using errcode = 'P0001'; end if;
  if old.estado <> 'pendiente_nc' or new.estado <> 'aplicada' or (to_jsonb(new) - v) <> (to_jsonb(old) - v) then
    raise exception 'Una devolución solo cambia al registrar la nota crédito del proveedor' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists devoluciones_proveedor_proteger on devoluciones_proveedor;
create trigger devoluciones_proveedor_proteger before update or delete on devoluciones_proveedor for each row execute function devolucion_proveedor_proteger();
drop trigger if exists pago_aplicaciones_inmutables on pago_aplicaciones;
create trigger pago_aplicaciones_inmutables before update or delete on pago_aplicaciones for each row execute function no_modificar();
drop trigger if exists devolucion_proveedor_lineas_inmutables on devolucion_proveedor_lineas;
create trigger devolucion_proveedor_lineas_inmutables before update or delete on devolucion_proveedor_lineas for each row execute function no_modificar();

-- ───────────────────────── Saldos ─────────────────────────
-- Cuentas por pagar: compras registradas con lo pagado, las notas crédito, el saldo y los días (negativo = vencida).
-- Security invoker: solo la gerencia ve compras (RLS), así que la bodega y la cajera no ven nada aquí.
create or replace view v_cuentas_por_pagar with (security_invoker = true) as
  select c.id compra_id, c.empresa_id, c.numero, c.proveedor_id, p.nombre proveedor, p.nit, p.dv, c.numero_factura, c.fecha_factura, c.vence_pago,
         c.condicion, c.total, coalesce(pa.pagado, 0)::numeric(14, 2) pagado, coalesce(nc.notas, 0)::numeric(14, 2) notas_credito,
         (c.total - coalesce(pa.pagado, 0) - coalesce(nc.notas, 0))::numeric(14, 2) saldo,
         (c.vence_pago - current_date) dias, greatest(0, current_date - c.vence_pago) dias_vencida,
         sum(c.total - coalesce(pa.pagado, 0) - coalesce(nc.notas, 0)) over (partition by c.proveedor_id)::numeric(14, 2) saldo_proveedor
  from compras c
  join proveedores p on p.id = c.proveedor_id
  left join (select a.compra_id, sum(a.valor) pagado from pago_aplicaciones a join pagos_proveedor g on g.id = a.pago_id where not g.anulado group by a.compra_id) pa on pa.compra_id = c.id
  left join (select d.compra_id, sum(d.valor_nc) notas from devoluciones_proveedor d where d.estado = 'aplicada' group by d.compra_id) nc on nc.compra_id = c.id
  where c.estado = 'registrada';

-- Recepciones para la bodega: la compra sin dinero (ni totales ni costos). Corre como el dueño de la tabla y filtra por las
-- empresas donde el usuario es dueño, administrador o bodega.
create or replace view v_recepciones as
  select c.id, c.empresa_id, c.sede_id, c.numero, c.proveedor_id, p.nombre proveedor, p.nit proveedor_nit, c.numero_factura, c.fecha_factura, c.estado,
         c.motivo_anulacion, c.usuario_id, c.creado,
         (select count(*) from compra_lineas l where l.compra_id = c.id)::int lineas,
         (select coalesce(sum(l.unidades + l.bonificadas), 0) from compra_lineas l where l.compra_id = c.id)::int unidades
  from compras c join proveedores p on p.id = c.proveedor_id
  where c.empresa_id in (select mis_empresas(array['dueno', 'admin', 'bodeguero']));

create or replace view v_recepcion_lineas as
  select l.id, l.empresa_id, l.compra_id, l.producto_id, l.lote_id, l.unidades, l.bonificadas
  from compra_lineas l
  where l.empresa_id in (select mis_empresas(array['dueno', 'admin', 'bodeguero']));

-- Saldo de una compra (uso interno, dentro de las funciones que ya bloquearon la compra).
create or replace function saldo_compra(p_compra uuid) returns numeric language sql stable set search_path = public as $$
  select c.total
    - coalesce((select sum(a.valor) from pago_aplicaciones a join pagos_proveedor g on g.id = a.pago_id where a.compra_id = c.id and not g.anulado), 0)
    - coalesce((select sum(d.valor_nc) from devoluciones_proveedor d where d.compra_id = c.id and d.estado = 'aplicada'), 0)
  from compras c where c.id = p_compra
$$;

-- ───────────────────────── Entrada de inventario con referencia ─────────────────────────
-- Igual que en la 014, más un ref_id opcional: solo se acepta el id de una compra de la misma empresa que aún no tenga
-- movimientos (la compra se crea en la misma transacción, justo antes). Sin ref_id funciona como siempre (ajustes, carga
-- inicial, importación).
create or replace function registrar_entrada(p jsonb) returns jsonb
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
  if (p ->> 'ref_id') is not null then
    v_ref := (p ->> 'ref_id')::uuid;
    if not exists (select 1 from compras where id = v_ref and empresa_id = v_emp) or exists (select 1 from movimientos where ref_id = v_ref) then
      raise exception 'Referencia de la entrada no válida' using errcode = 'P0001';
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
    on conflict (sede_id, producto_id, lote) do update set vence = coalesce(lotes.vence, excluded.vence)
    returning id into v_lote;
    -- Un lote tiene UNA fecha de vencimiento: si llega el mismo lote con otra fecha es un error de digitación (o
    -- mercancía distinta), nunca se cambia la fecha de lo que ya está en la estantería.
    if (ln ->> 'vence') is not null and (select vence from lotes where id = v_lote) <> (ln ->> 'vence')::date then
      raise exception 'El lote % ya existe con vencimiento %: revisa la fecha o usa otro código de lote', upper(trim(ln ->> 'lote')),
        to_char((select vence from lotes where id = v_lote), 'DD/MM/YYYY') using errcode = 'P0001';
    end if;
    if v_tipo <> 'ajuste' and (ln ->> 'vence') is not null and (ln ->> 'vence')::date < current_date then
      raise exception 'El lote % ya está vencido: no se puede recibir para la venta', upper(trim(ln ->> 'lote')) using errcode = 'P0001';
    end if;
    if (ln ->> 'costo_unidad') is not null and v_gerencia then  -- el costo solo lo registra la gerencia
      insert into lote_costos (lote_id, empresa_id, costo_unidad, actualizado) values (v_lote, v_emp, (ln ->> 'costo_unidad')::numeric, now())
      on conflict (lote_id) do nothing; -- por esta vía el costo del lote es el de su primera entrada (las compras promedian)
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

-- ───────────────────────── Cálculo de una línea ─────────────────────────
-- Costo digitado sin IVA (por caja o por unidad), unidades pagadas, descuento e IVA → bruto, base, IVA y total al centavo.
-- Una sola división para que el redondeo sea el exacto (igual que en la pantalla).
create or replace function compra_calcular_linea(p_costo numeric, p_factor integer, p_unidades integer, p_desc numeric, p_iva numeric,
  out bruto numeric, out base numeric, out iva numeric, out total numeric)
language sql immutable as $$
  select round(p_costo * p_unidades / p_factor, 2),
         round(p_costo * p_unidades * (100 - p_desc) / (p_factor * 100), 2),
         round(round(p_costo * p_unidades * (100 - p_desc) / (p_factor * 100), 2) * p_iva / 100, 2),
         round(p_costo * p_unidades * (100 - p_desc) / (p_factor * 100), 2) + round(round(p_costo * p_unidades * (100 - p_desc) / (p_factor * 100), 2) * p_iva / 100, 2)
$$;

-- Valida y calcula el costeo de una línea. x = { costo, costo_por, descuento_pct?, iva_pct? }. Uso interno.
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
  return jsonb_build_object('costo', v_costo, 'costo_por', v_por, 'costo_unidad', round(v_costo / v_factor, 6), 'descuento_pct', v_desc, 'iva_pct', v_iva,
    'bruto', r.bruto, 'base', r.base, 'iva', r.iva, 'total', r.total);
end $$;

-- Pone el costo de un lote con lo que entra de una compra: si el lote tenía costo y existencias antes, promedio ponderado.
-- p_antes = existencias del lote justo antes de estas unidades. Devuelve { antes, despues }. Uso interno.
create or replace function compra_costo_lote(p_emp uuid, p_lote uuid, p_antes integer, p_base numeric, p_entran integer) returns jsonb
language plpgsql set search_path = public as $$
declare lc lote_costos; v_nuevo numeric; v_unit numeric := p_base / p_entran;
begin
  select * into lc from lote_costos where lote_id = p_lote for update;
  if found and p_antes > 0 then
    v_nuevo := round((lc.costo_unidad * p_antes + p_base) / (p_antes + p_entran), 4);
    update lote_costos set costo_unidad = v_nuevo, actualizado = now() where lote_id = p_lote;  -- heredado se conserva: el promedio arrastra ese costo
  elsif found then
    v_nuevo := round(v_unit, 4);
    update lote_costos set costo_unidad = v_nuevo, heredado = false, actualizado = now() where lote_id = p_lote;
  else
    v_nuevo := round(v_unit, 4);
    insert into lote_costos (lote_id, empresa_id, costo_unidad, heredado, actualizado) values (p_lote, p_emp, v_nuevo, false, now());
  end if;
  return jsonb_build_object('antes', lc.costo_unidad, 'despues', v_nuevo);
end $$;

-- Cambia el precio de venta si la compra lo trae (el trigger de productos lo audita). Uso interno.
create or replace function compra_precio(p_prod productos, x jsonb) returns void language plpgsql set search_path = public as $$
declare v_caja numeric := nullif(x ->> 'precio_venta_nuevo', '')::numeric; v_und numeric := nullif(x ->> 'precio_unidad_nuevo', '')::numeric;
begin
  if v_caja is null and v_und is null then return; end if;
  if (v_caja is not null and (v_caja <= 0 or v_caja <> trunc(v_caja) or v_caja > 100000000)) or (v_und is not null and (v_und <= 0 or v_und <> trunc(v_und) or v_und > 100000000)) then
    raise exception 'El precio de venta de % va en pesos, sin centavos', p_prod.nombre using errcode = 'P0001';
  end if;
  if v_und is not null and (p_prod.unidades_por_caja = 1 or p_prod.precio_unidad is null) then
    raise exception '% no se vende por unidad: pon solo el precio de la caja', p_prod.nombre using errcode = 'P0001';
  end if;
  if coalesce(v_und, p_prod.precio_unidad, 0) > coalesce(v_caja, p_prod.precio_caja) then
    raise exception 'El precio por unidad de % no puede ser mayor que el de la caja', p_prod.nombre using errcode = 'P0001';
  end if;
  update productos set precio_caja = coalesce(v_caja, precio_caja), precio_unidad = coalesce(v_und, precio_unidad) where id = p_prod.id;
end $$;

-- ───────────────────────── Registrar una compra ─────────────────────────
-- p = { empresa_id, sede_id, idem_key?, proveedor_id, numero_factura, fecha_factura, condicion?, vence_pago?, total_papel?,
--       cufe_proveedor?, observaciones?,
--       lineas: [{ producto_id, lote, vence?, unidades, bonificadas?,
--                  costo?, costo_por?: 'caja'|'unidad', descuento_pct?, iva_pct?, precio_venta_nuevo?, precio_unidad_nuevo? }] }
-- Gerencia con todos los costos → «registrada» (nace la cuenta por pagar). Sin costos (o la bodega) → «por_costear».
create or replace function registrar_compra(p jsonb) returns jsonb
language plpgsql security definer set search_path = public set jit = off as $$
declare
  v_emp uuid := (p ->> 'empresa_id')::uuid; v_sede uuid := (p ->> 'sede_id')::uuid; v_rol text := rol_en((p ->> 'empresa_id')::uuid);
  v_gerencia boolean; v_prov proveedores; v_fact text := upper(trim(coalesce(p ->> 'numero_factura', '')));
  v_fecha date := (p ->> 'fecha_factura')::date; v_cond text := coalesce(nullif(p ->> 'condicion', ''), 'contado'); v_vence date := (p ->> 'vence_pago')::date;
  v_papel numeric := (p ->> 'total_papel')::numeric; v_id uuid := gen_random_uuid(); v_num integer; v_ya compras;
  x jsonb; i integer; v_prod productos; v_unid integer; v_bon integer; v_con integer := 0; v_n integer; v_costea boolean; k jsonb;
  v_cost jsonb := '[]'; v_sub numeric := 0; v_des numeric := 0; v_iva numeric := 0; v_tot numeric := 0;
  v_entrada jsonb := '[]'; v_lote uuid; v_stock integer; v_despues integer; v_cl jsonb; v_estado text; v_falta text;
begin
  if coalesce(v_rol, '') not in ('dueno', 'admin', 'bodeguero') then
    raise exception 'Solo el dueño, el administrador o la bodega registran compras' using errcode = '42501';
  end if;
  v_gerencia := v_rol in ('dueno', 'admin');
  if (p ->> 'idem_key') is not null then
    perform pg_advisory_xact_lock(hashtext('compra-idem:' || v_emp::text || ':' || (p ->> 'idem_key')));
    select * into v_ya from compras where empresa_id = v_emp and idem_key = p ->> 'idem_key';
    if found then
      return jsonb_build_object('id', v_ya.id, 'numero', v_ya.numero, 'estado', v_ya.estado, 'total', v_ya.total, 'repetida', true);
    end if;
  end if;
  if not exists (select 1 from sedes where id = v_sede and empresa_id = v_emp) then raise exception 'Sede no válida' using errcode = 'P0001'; end if;
  select * into v_prov from proveedores where id = (p ->> 'proveedor_id')::uuid and empresa_id = v_emp;
  if not found then raise exception 'Elige el proveedor' using errcode = 'P0001'; end if;
  if not v_prov.activo then raise exception 'El proveedor % está inactivo', v_prov.nombre using errcode = 'P0001'; end if;
  if length(v_fact) = 0 or length(v_fact) > 40 then raise exception 'Escribe el número de la factura del proveedor' using errcode = 'P0001'; end if;
  if v_fecha is null then raise exception 'Pon la fecha de la factura' using errcode = 'P0001'; end if;
  if v_fecha > current_date then raise exception 'La fecha de la factura no puede ser futura' using errcode = 'P0001'; end if;
  if v_fecha < current_date - 730 then raise exception 'La fecha de la factura tiene más de dos años: revísala' using errcode = 'P0001'; end if;
  if v_cond not in ('contado', 'credito') then raise exception 'Condición de pago no válida' using errcode = 'P0001'; end if;
  if v_cond = 'contado' then v_vence := v_fecha;
  else
    v_vence := coalesce(v_vence, v_fecha + nullif(v_prov.plazo_dias, 0));
    if v_vence is null then raise exception 'Pon la fecha en que vence el pago' using errcode = 'P0001'; end if;
    if v_vence < v_fecha then raise exception 'El vencimiento del pago no puede ser antes de la fecha de la factura' using errcode = 'P0001'; end if;
    if v_vence > v_fecha + 365 then raise exception 'El plazo de pago no puede pasar de un año' using errcode = 'P0001'; end if;
  end if;
  if v_papel is not null and (v_papel < 0 or v_papel > 10000000000 or v_papel <> round(v_papel, 2)) then raise exception 'Revisa el total de la factura' using errcode = 'P0001'; end if;
  if jsonb_typeof(p -> 'lineas') <> 'array' or jsonb_array_length(p -> 'lineas') = 0 then raise exception 'Agrega al menos un producto' using errcode = 'P0001'; end if;
  if jsonb_array_length(p -> 'lineas') > 500 then raise exception 'Máximo 500 líneas por compra' using errcode = 'P0001'; end if;

  -- Una factura de un proveedor se registra una sola vez (candado por factura para dos envíos simultáneos).
  perform pg_advisory_xact_lock(hashtext('compra-factura:' || v_emp::text || ':' || v_prov.id::text || ':' || v_fact));
  select * into v_ya from compras where empresa_id = v_emp and proveedor_id = v_prov.id and upper(numero_factura) = v_fact and estado <> 'anulada';
  if found then
    raise exception 'La factura % de % ya está registrada (compra N.º %)', v_fact, v_prov.nombre, v_ya.numero using errcode = '23505';
  end if;

  -- ¿Se costea ya? Solo la gerencia, y con el costo de todas las líneas (o de ninguna: queda por costear).
  select count(*) filter (where nullif(e ->> 'costo', '') is not null) into v_con from jsonb_array_elements(p -> 'lineas') e;
  v_costea := v_gerencia and v_con > 0;
  if v_costea and v_con < jsonb_array_length(p -> 'lineas') then
    select (select nombre from productos where id = (e ->> 'producto_id')::uuid and empresa_id = v_emp) into v_falta
      from jsonb_array_elements(p -> 'lineas') e where nullif(e ->> 'costo', '') is null limit 1;
    raise exception 'Falta el costo de %: pon el costo de todas las líneas o de ninguna (queda por costear)', coalesce(v_falta, 'un producto') using errcode = 'P0001';
  end if;

  i := 0;
  for x in select * from jsonb_array_elements(p -> 'lineas') loop
    i := i + 1;
    select * into v_prod from productos where id = (x ->> 'producto_id')::uuid and empresa_id = v_emp;
    if not found then raise exception 'Producto no válido' using errcode = 'P0001'; end if;
    v_unid := coalesce((x ->> 'unidades')::integer, 0); v_bon := coalesce((x ->> 'bonificadas')::integer, 0);
    if v_unid < 0 or v_bon < 0 or v_unid + v_bon = 0 or v_unid + v_bon > 1000000 then
      raise exception 'Revisa la cantidad de %', v_prod.nombre using errcode = 'P0001';
    end if;
    if length(trim(coalesce(x ->> 'lote', ''))) = 0 or length(trim(x ->> 'lote')) > 40 then raise exception 'Falta el lote de %', v_prod.nombre using errcode = 'P0001'; end if;
    if v_costea then
      k := compra_costeo(x, v_prod, v_unid);
      v_sub := v_sub + (k ->> 'bruto')::numeric; v_des := v_des + (k ->> 'bruto')::numeric - (k ->> 'base')::numeric;
      v_iva := v_iva + (k ->> 'iva')::numeric; v_tot := v_tot + (k ->> 'total')::numeric;
    else k := null;
    end if;
    v_cost := v_cost || jsonb_build_array(coalesce(k, 'null'::jsonb));
    v_entrada := v_entrada || jsonb_build_object('producto_id', v_prod.id, 'lote', x ->> 'lote', 'vence', nullif(x ->> 'vence', ''), 'unidades', v_unid + v_bon);
  end loop;
  v_estado := case when v_costea then 'registrada' else 'por_costear' end;

  perform pg_advisory_xact_lock(hashtext('compra:' || v_emp::text));
  select coalesce(max(numero), 0) + 1 into v_num from compras where empresa_id = v_emp;
  insert into compras (id, empresa_id, sede_id, numero, proveedor_id, numero_factura, fecha_factura, condicion, vence_pago, subtotal, descuento, iva, total,
                       total_papel, diferencia, cufe_proveedor, observaciones, estado, costeada, costea_usuario, idem_key, usuario_id)
  values (v_id, v_emp, v_sede, v_num, v_prov.id, v_fact, v_fecha, v_cond, v_vence, v_sub, v_des, v_iva, v_tot,
          case when v_gerencia then v_papel end, case when v_costea and v_papel is not null then v_papel - v_tot end,
          nullif(trim(coalesce(p ->> 'cufe_proveedor', '')), ''), nullif(trim(coalesce(p ->> 'observaciones', '')), ''), v_estado,
          case when v_costea then now() end, case when v_costea then auth.uid() end, p ->> 'idem_key', auth.uid());

  -- Productos bloqueados en el mismo orden que la venta y la entrada; existencias de cada lote ANTES de la compra.
  perform pg_advisory_xact_lock(hashtext(y)) from (select distinct e ->> 'producto_id' y from jsonb_array_elements(v_entrada) e order by 1) s;
  perform registrar_entrada(jsonb_build_object('empresa_id', v_emp, 'sede_id', v_sede, 'tipo', 'compra', 'ref_id', v_id, 'lineas', v_entrada,
    'motivo', left('Compra N.º ' || v_num || ' · ' || v_prov.nombre || ' · factura ' || v_fact, 200)));

  i := 0;
  for x in select * from jsonb_array_elements(p -> 'lineas') loop
    i := i + 1;
    select * into v_prod from productos where id = (x ->> 'producto_id')::uuid;
    v_unid := coalesce((x ->> 'unidades')::integer, 0); v_bon := coalesce((x ->> 'bonificadas')::integer, 0);
    select id into v_lote from lotes where sede_id = v_sede and producto_id = v_prod.id and lote = upper(trim(x ->> 'lote'));
    k := v_cost -> (i - 1);
    v_cl := null;
    if jsonb_typeof(k) = 'object' then
      -- Existencias antes de ESTA línea: las de ahora menos lo que entra por esta línea y las siguientes del mismo lote.
      select s.unidades into v_stock from v_stock_lotes s where s.lote_id = v_lote;
      select coalesce(sum(coalesce((e ->> 'unidades')::integer, 0) + coalesce((e ->> 'bonificadas')::integer, 0)), 0) into v_despues
        from jsonb_array_elements(p -> 'lineas') with ordinality o(e, n)
        where o.n >= i and (e ->> 'producto_id')::uuid = v_prod.id and upper(trim(e ->> 'lote')) = upper(trim(x ->> 'lote'));
      v_cl := compra_costo_lote(v_emp, v_lote, greatest(v_stock - v_despues, 0), (k ->> 'base')::numeric, v_unid + v_bon);
      perform compra_precio(v_prod, x);
    end if;
    insert into compra_lineas (empresa_id, compra_id, producto_id, lote_id, unidades, bonificadas, costo, costo_por, costo_unidad_sin_iva, descuento_pct, iva_pct,
                               bruto, base, iva, total, costo_lote, costo_lote_antes, costo_lote_despues, precio_anterior, precio_venta_nuevo, precio_unidad_nuevo)
    values (v_emp, v_id, v_prod.id, v_lote, v_unid, v_bon, (k ->> 'costo')::numeric, k ->> 'costo_por', (k ->> 'costo_unidad')::numeric,
            coalesce((k ->> 'descuento_pct')::numeric, 0), coalesce((k ->> 'iva_pct')::numeric, v_prod.iva),
            (k ->> 'bruto')::numeric, (k ->> 'base')::numeric, (k ->> 'iva')::numeric, (k ->> 'total')::numeric,
            case when k ->> 'base' is not null then round((k ->> 'base')::numeric / (v_unid + v_bon), 6) end,
            (v_cl ->> 'antes')::numeric, (v_cl ->> 'despues')::numeric, v_prod.precio_caja,
            case when v_costea then nullif(x ->> 'precio_venta_nuevo', '')::numeric end, case when v_costea then nullif(x ->> 'precio_unidad_nuevo', '')::numeric end);
  end loop;

  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v_emp, auth.uid(), 'registrar_compra', 'compras', v_id::text, jsonb_build_object('numero', v_num, 'proveedor', v_prov.nombre, 'factura', v_fact,
    'estado', v_estado, 'total', v_tot, 'lineas', i));
  return jsonb_build_object('id', v_id, 'numero', v_num, 'estado', v_estado, 'subtotal', v_sub, 'descuento', v_des, 'iva', v_iva, 'total', v_tot,
    'diferencia', case when v_costea and v_papel is not null then v_papel - v_tot end, 'repetida', false);
end $$;

-- ───────────────────────── Completar los costos de una compra ─────────────────────────
-- p = { total_papel?, condicion?, vence_pago?, lineas: [{ linea_id, costo, costo_por, descuento_pct?, iva_pct?, precio_venta_nuevo?, precio_unidad_nuevo? }] }
create or replace function completar_costos_compra(p_compra uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public set jit = off as $$
declare c compras; v_prov proveedores; l compra_lineas; x jsonb; k jsonb; v_prod productos; v_cl jsonb; v_stock integer; v_despues integer;
  v_sub numeric := 0; v_des numeric := 0; v_iva numeric := 0; v_tot numeric := 0; v_papel numeric := (p ->> 'total_papel')::numeric;
  v_cond text; v_vence date; v_n integer;
begin
  select * into c from compras where id = p_compra for update;
  if not found or coalesce(rol_en(c.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador completan los costos de una compra' using errcode = '42501';
  end if;
  if c.estado <> 'por_costear' then raise exception 'Esta compra ya tiene sus costos' using errcode = 'P0001'; end if;
  select * into v_prov from proveedores where id = c.proveedor_id;
  if jsonb_typeof(p -> 'lineas') <> 'array' then raise exception 'Faltan los costos' using errcode = 'P0001'; end if;
  select count(*) into v_n from compra_lineas where compra_id = c.id;
  if jsonb_array_length(p -> 'lineas') <> v_n
     or (select count(distinct (e ->> 'linea_id')) from jsonb_array_elements(p -> 'lineas') e
         where exists (select 1 from compra_lineas cl where cl.id = (e ->> 'linea_id')::bigint and cl.compra_id = c.id)) <> v_n then
    raise exception 'Pon el costo de cada línea de la compra' using errcode = 'P0001';
  end if;
  v_cond := coalesce(nullif(p ->> 'condicion', ''), c.condicion);
  if v_cond not in ('contado', 'credito') then raise exception 'Condición de pago no válida' using errcode = 'P0001'; end if;
  if v_cond = 'contado' then v_vence := c.fecha_factura;
  else
    v_vence := coalesce((p ->> 'vence_pago')::date, case when c.condicion = 'credito' then c.vence_pago end, c.fecha_factura + nullif(v_prov.plazo_dias, 0));
    if v_vence is null then raise exception 'Pon la fecha en que vence el pago' using errcode = 'P0001'; end if;
    if v_vence < c.fecha_factura or v_vence > c.fecha_factura + 365 then raise exception 'Revisa el vencimiento del pago' using errcode = 'P0001'; end if;
  end if;
  if v_papel is not null and (v_papel < 0 or v_papel > 10000000000 or v_papel <> round(v_papel, 2)) then raise exception 'Revisa el total de la factura' using errcode = 'P0001'; end if;

  perform pg_advisory_xact_lock(hashtext(y)) from (select distinct producto_id::text y from compra_lineas where compra_id = c.id order by 1) s;
  for l in select * from compra_lineas where compra_id = c.id order by id loop
    select e into x from jsonb_array_elements(p -> 'lineas') e where (e ->> 'linea_id')::bigint = l.id limit 1;
    select * into v_prod from productos where id = l.producto_id;
    k := compra_costeo(x, v_prod, l.unidades);
    v_sub := v_sub + (k ->> 'bruto')::numeric; v_des := v_des + (k ->> 'bruto')::numeric - (k ->> 'base')::numeric;
    v_iva := v_iva + (k ->> 'iva')::numeric; v_tot := v_tot + (k ->> 'total')::numeric;
    -- Las unidades ya están en el lote (pudo venderse algo): las de antes son las de ahora menos lo de esta compra aún sin costear.
    select s.unidades into v_stock from v_stock_lotes s where s.lote_id = l.lote_id;
    select coalesce(sum(cl.unidades + cl.bonificadas), 0) into v_despues from compra_lineas cl where cl.compra_id = c.id and cl.lote_id = l.lote_id and cl.id >= l.id;
    v_cl := compra_costo_lote(c.empresa_id, l.lote_id, greatest(v_stock - v_despues, 0), (k ->> 'base')::numeric, l.unidades + l.bonificadas);
    perform compra_precio(v_prod, x);
    update compra_lineas set costo = (k ->> 'costo')::numeric, costo_por = k ->> 'costo_por', costo_unidad_sin_iva = (k ->> 'costo_unidad')::numeric,
      descuento_pct = (k ->> 'descuento_pct')::numeric, iva_pct = (k ->> 'iva_pct')::numeric, bruto = (k ->> 'bruto')::numeric, base = (k ->> 'base')::numeric,
      iva = (k ->> 'iva')::numeric, total = (k ->> 'total')::numeric, costo_lote = round((k ->> 'base')::numeric / (l.unidades + l.bonificadas), 6),
      costo_lote_antes = (v_cl ->> 'antes')::numeric, costo_lote_despues = (v_cl ->> 'despues')::numeric, precio_anterior = v_prod.precio_caja,
      precio_venta_nuevo = nullif(x ->> 'precio_venta_nuevo', '')::numeric, precio_unidad_nuevo = nullif(x ->> 'precio_unidad_nuevo', '')::numeric
    where id = l.id;
  end loop;
  update compras set estado = 'registrada', subtotal = v_sub, descuento = v_des, iva = v_iva, total = v_tot, total_papel = v_papel,
    diferencia = case when v_papel is not null then v_papel - v_tot end, condicion = v_cond, vence_pago = v_vence, costeada = now(), costea_usuario = auth.uid()
  where id = c.id;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (c.empresa_id, auth.uid(), 'completar_costos_compra', 'compras', c.id::text, jsonb_build_object('numero', c.numero, 'total', v_tot));
  return jsonb_build_object('id', c.id, 'numero', c.numero, 'estado', 'registrada', 'subtotal', v_sub, 'descuento', v_des, 'iva', v_iva, 'total', v_tot,
    'diferencia', case when v_papel is not null then v_papel - v_tot end);
end $$;

-- ───────────────────────── Anular una compra ─────────────────────────
-- Solo sin pagos vigentes ni devoluciones, y si el stock de esos lotes alcanza para sacar todo lo que entró.
create or replace function anular_compra(p_compra uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public set jit = off as $$
declare c compras; r record; v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  select * into c from compras where id = p_compra for update;
  if not found or coalesce(rol_en(c.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador anulan compras' using errcode = '42501';
  end if;
  if c.estado = 'anulada' then raise exception 'La compra ya está anulada' using errcode = 'P0001'; end if;
  if length(coalesce(v_motivo, '')) < 4 then raise exception 'Escribe el motivo de la anulación' using errcode = 'P0001'; end if;
  if exists (select 1 from pago_aplicaciones a join pagos_proveedor g on g.id = a.pago_id where a.compra_id = c.id and not g.anulado) then
    raise exception 'Esta compra tiene pagos: anula primero los pagos (o registra una devolución al proveedor)' using errcode = 'P0001';
  end if;
  if exists (select 1 from devoluciones_proveedor where compra_id = c.id) then
    raise exception 'Esta compra tiene devoluciones al proveedor: ya no se puede anular' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext(y)) from (select distinct producto_id::text y from compra_lineas where compra_id = c.id order by 1) s;
  for r in select l.lote_id, l.producto_id, lo.lote, p.nombre, sum(l.unidades + l.bonificadas)::int entran,
                  coalesce((select s.unidades from v_stock_lotes s where s.lote_id = l.lote_id), 0) hay
           from compra_lineas l join lotes lo on lo.id = l.lote_id join productos p on p.id = l.producto_id
           where l.compra_id = c.id group by l.lote_id, l.producto_id, lo.lote, p.nombre loop
    if r.hay < r.entran then
      raise exception 'No se puede anular: del lote % de % entraron % und y quedan %. Registra una devolución al proveedor o un ajuste.', r.lote, r.nombre, r.entran, r.hay
        using errcode = 'P0001';
    end if;
    insert into movimientos (empresa_id, sede_id, producto_id, lote_id, cantidad, tipo, ref_id, motivo, usuario_id)
    values (c.empresa_id, c.sede_id, r.producto_id, r.lote_id, -r.entran, 'ajuste', c.id,
            left('Anulación de la compra N.º ' || c.numero || ' (factura ' || c.numero_factura || '): ' || v_motivo, 200), auth.uid());
  end loop;
  -- El costo del lote vuelve al de antes si nadie lo cambió después.
  update lote_costos lc set costo_unidad = l.costo_lote_antes, actualizado = now()
  from compra_lineas l where l.compra_id = c.id and lc.lote_id = l.lote_id and l.costo_lote_antes is not null and lc.costo_unidad = l.costo_lote_despues;
  update compras set estado = 'anulada', motivo_anulacion = v_motivo, anulada = now(), anula_usuario = auth.uid() where id = c.id;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (c.empresa_id, auth.uid(), 'anular_compra', 'compras', c.id::text, jsonb_build_object('numero', c.numero, 'factura', c.numero_factura, 'motivo', v_motivo, 'total', c.total));
  return jsonb_build_object('id', c.id, 'estado', 'anulada');
end $$;

-- ───────────────────────── Pagos a proveedores ─────────────────────────
-- p = { empresa_id, proveedor_id, medio, valor, referencia?, idem_key?, compras?: [uuid], desde_caja?: boolean, caja_id? }
-- Se aplica a las compras elegidas (en ese orden) o, si no se eligen, de la que vence primero a la última. En efectivo
-- desde la caja: exige turno abierto y sale como egreso del turno en la misma transacción.
create or replace function registrar_pago_proveedor(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := (p ->> 'empresa_id')::uuid; v_prov proveedores; v_medio text := p ->> 'medio'; v_valor numeric := (p ->> 'valor')::numeric;
  v_caja cajas; v_turno turnos; v_ya pagos_proveedor; v_id uuid := gen_random_uuid(); v_resta numeric; v_saldo numeric; v_aplica numeric;
  r record; v_apl jsonb := '[]'; v_mov bigint; v_facturas text; v_desde_caja boolean;
begin
  if coalesce(rol_en(v_emp), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador registran pagos a proveedores' using errcode = '42501';
  end if;
  if (p ->> 'idem_key') is not null then
    perform pg_advisory_xact_lock(hashtext('pago-prov:' || v_emp::text || ':' || (p ->> 'idem_key')));
    select * into v_ya from pagos_proveedor where empresa_id = v_emp and idem_key = p ->> 'idem_key';
    if found then return jsonb_build_object('id', v_ya.id, 'valor', v_ya.valor, 'repetido', true); end if;
  end if;
  select * into v_prov from proveedores where id = (p ->> 'proveedor_id')::uuid and empresa_id = v_emp;
  if not found then raise exception 'Proveedor no válido' using errcode = 'P0001'; end if;
  if coalesce(v_medio, '') not in ('efectivo', 'transferencia', 'consignacion', 'cheque', 'nequi', 'daviplata', 'bre_b', 'tarjeta') then
    raise exception 'Elige el medio de pago' using errcode = 'P0001';
  end if;
  if v_valor is null or v_valor <= 0 or v_valor > 10000000000 or v_valor <> round(v_valor, 2) then raise exception 'Escribe el valor del pago' using errcode = 'P0001'; end if;
  v_desde_caja := v_medio = 'efectivo' and coalesce((p ->> 'desde_caja')::boolean, true);
  if v_desde_caja then
    select * into v_caja from cajas where id = (p ->> 'caja_id')::uuid and empresa_id = v_emp and activa;
    if not found then raise exception 'Elige la caja de donde sale el efectivo' using errcode = 'P0001'; end if;
    select * into v_turno from turnos where caja_id = v_caja.id and estado = 'abierto' for update;
    if not found then
      raise exception 'Para pagar en efectivo desde la caja abre primero el turno de %. Si el dinero no sale de la caja, marca «No sale de la caja».', v_caja.nombre
        using errcode = 'P0001';
    end if;
    if v_valor <> trunc(v_valor) then raise exception 'El pago en efectivo desde la caja va en pesos, sin centavos' using errcode = 'P0001'; end if;
  end if;
  if (p -> 'compras') is not null and jsonb_typeof(p -> 'compras') = 'array' and jsonb_array_length(p -> 'compras') > 0 then
    if exists (select 1 from jsonb_array_elements_text(p -> 'compras') e where not exists (
        select 1 from compras c where c.id = e::uuid and c.empresa_id = v_emp and c.proveedor_id = v_prov.id and c.estado = 'registrada')) then
      raise exception 'Alguna de las facturas elegidas no es de este proveedor o no está registrada' using errcode = 'P0001';
    end if;
  end if;
  perform 1 from compras where empresa_id = v_emp and proveedor_id = v_prov.id and estado = 'registrada' order by id for update;
  v_resta := v_valor;
  for r in
    select c.id, c.numero_factura, c.numero from compras c
    left join lateral (select n from jsonb_array_elements_text(coalesce(p -> 'compras', '[]')) with ordinality o(e, n) where o.e::uuid = c.id) o on true
    where c.empresa_id = v_emp and c.proveedor_id = v_prov.id and c.estado = 'registrada'
      and (jsonb_array_length(coalesce(p -> 'compras', '[]')) = 0 or o.n is not null)
    order by o.n nulls last, c.vence_pago, c.fecha_factura, c.numero
  loop
    exit when v_resta <= 0;
    v_saldo := saldo_compra(r.id);
    continue when v_saldo <= 0;
    v_aplica := least(v_resta, v_saldo);
    insert into pago_aplicaciones (empresa_id, pago_id, compra_id, valor) values (v_emp, v_id, r.id, v_aplica);
    v_apl := v_apl || jsonb_build_object('compra_id', r.id, 'numero_factura', r.numero_factura, 'valor', v_aplica, 'saldo', v_saldo - v_aplica);
    v_facturas := coalesce(v_facturas || ', ', '') || r.numero_factura;
    v_resta := v_resta - v_aplica;
  end loop;
  if v_resta > 0 then
    raise exception 'El pago (%) supera lo que se le debe a % en %: el saldo es %', to_char(v_valor, 'FM999G999G999G990D00'), v_prov.nombre,
      case when jsonb_array_length(coalesce(p -> 'compras', '[]')) > 0 then 'las facturas elegidas' else 'todas sus facturas' end,
      to_char(v_valor - v_resta, 'FM999G999G999G990D00') using errcode = 'P0001';
  end if;
  if v_desde_caja then
    insert into movimientos_caja (empresa_id, turno_id, tipo, valor, concepto, usuario_id)
    values (v_emp, v_turno.id, 'egreso', v_valor, left('Pago a proveedor ' || v_prov.nombre || ' · factura ' || v_facturas, 120), auth.uid())
    returning id into v_mov;
  end if;
  -- El pago se inserta al final, ya con todo calculado: sus aplicaciones lo referencian con llave diferida.
  insert into pagos_proveedor (id, empresa_id, proveedor_id, medio, valor, referencia, caja_id, turno_id, movimiento_caja_id, idem_key, usuario_id)
  values (v_id, v_emp, v_prov.id, v_medio, v_valor, nullif(trim(coalesce(p ->> 'referencia', '')), ''), case when v_desde_caja then v_caja.id end,
          case when v_desde_caja then v_turno.id end, v_mov, p ->> 'idem_key', auth.uid());
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v_emp, auth.uid(), 'pago_proveedor', 'pagos_proveedor', v_id::text, jsonb_build_object('proveedor', v_prov.nombre, 'valor', v_valor, 'medio', v_medio,
    'facturas', v_facturas, 'caja', v_desde_caja));
  return jsonb_build_object('id', v_id, 'valor', v_valor, 'aplicado', v_apl, 'egreso_caja', v_mov is not null, 'repetido', false);
end $$;

-- Anular un pago (con motivo). Si salió de la caja, el efectivo vuelve como ingreso del turno abierto de esa caja.
create or replace function anular_pago_proveedor(p_pago uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g pagos_proveedor; v_turno turnos; v_motivo text := nullif(trim(coalesce(p_motivo, '')), ''); v_prov text;
begin
  select * into g from pagos_proveedor where id = p_pago for update;
  if not found or coalesce(rol_en(g.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador anulan pagos a proveedores' using errcode = '42501';
  end if;
  if g.anulado then raise exception 'El pago ya está anulado' using errcode = 'P0001'; end if;
  if length(coalesce(v_motivo, '')) < 4 then raise exception 'Escribe el motivo de la anulación' using errcode = 'P0001'; end if;
  select nombre into v_prov from proveedores where id = g.proveedor_id;
  if g.caja_id is not null then
    select * into v_turno from turnos where caja_id = g.caja_id and estado = 'abierto' for update;
    if not found then raise exception 'Este pago salió de la caja: abre el turno de esa caja para devolver el efectivo y anular el pago' using errcode = 'P0001'; end if;
    insert into movimientos_caja (empresa_id, turno_id, tipo, valor, concepto, usuario_id)
    values (g.empresa_id, v_turno.id, 'ingreso', g.valor, left('Anulación del pago a ' || v_prov, 120), auth.uid());
  end if;
  update pagos_proveedor set anulado = true, motivo = v_motivo, anulado_en = now(), anula_usuario = auth.uid() where id = g.id;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (g.empresa_id, auth.uid(), 'anular_pago_proveedor', 'pagos_proveedor', g.id::text, jsonb_build_object('proveedor', v_prov, 'valor', g.valor, 'motivo', v_motivo));
  return jsonb_build_object('id', g.id, 'anulado', true);
end $$;

-- ───────────────────────── Devoluciones al proveedor ─────────────────────────
-- p = { empresa_id, compra_id, motivo, idem_key?, lineas: [{ compra_linea_id, unidades }] }. Las unidades salen del lote ya
-- (movimiento tipo 'ajuste' con ref = la devolución). El saldo baja cuando se registra la nota crédito del proveedor.
create or replace function registrar_devolucion_proveedor(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := (p ->> 'empresa_id')::uuid; c compras; v_prov text; v_ya devoluciones_proveedor; v_id uuid := gen_random_uuid(); v_num integer;
  x jsonb; l compra_lineas; v_unid integer; v_dev integer; v_hay integer; v_valor numeric; v_total numeric := 0; v_lote text; v_nombre text;
  v_motivo text := nullif(trim(coalesce(p ->> 'motivo', '')), '');
begin
  if coalesce(rol_en(v_emp), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador registran devoluciones a proveedores' using errcode = '42501';
  end if;
  if (p ->> 'idem_key') is not null then
    perform pg_advisory_xact_lock(hashtext('dev-prov:' || v_emp::text || ':' || (p ->> 'idem_key')));
    select * into v_ya from devoluciones_proveedor where empresa_id = v_emp and idem_key = p ->> 'idem_key';
    if found then return jsonb_build_object('id', v_ya.id, 'numero', v_ya.numero, 'valor', v_ya.valor, 'repetida', true); end if;
  end if;
  select * into c from compras where id = (p ->> 'compra_id')::uuid and empresa_id = v_emp for update;
  if not found then raise exception 'Compra no válida' using errcode = 'P0001'; end if;
  if c.estado = 'anulada' then raise exception 'La compra está anulada' using errcode = 'P0001'; end if;
  if c.estado = 'por_costear' then raise exception 'Completa primero los costos de la compra' using errcode = 'P0001'; end if;
  if length(coalesce(v_motivo, '')) < 4 then raise exception 'Escribe el motivo de la devolución' using errcode = 'P0001'; end if;
  if length(v_motivo) > 200 then raise exception 'El motivo admite máximo 200 caracteres' using errcode = 'P0001'; end if;
  if jsonb_typeof(p -> 'lineas') <> 'array' or jsonb_array_length(p -> 'lineas') = 0 then raise exception 'Elige qué vas a devolver' using errcode = 'P0001'; end if;
  select nombre into v_prov from proveedores where id = c.proveedor_id;
  perform pg_advisory_xact_lock(hashtext(y)) from (select distinct producto_id::text y from compra_lineas where compra_id = c.id order by 1) s;
  perform pg_advisory_xact_lock(hashtext('dev-prov:' || v_emp::text));
  select coalesce(max(numero), 0) + 1 into v_num from devoluciones_proveedor where empresa_id = v_emp;
  for x in select * from jsonb_array_elements(p -> 'lineas') loop
    select * into l from compra_lineas where id = (x ->> 'compra_linea_id')::bigint and compra_id = c.id;
    if not found then raise exception 'Esa línea no es de esta compra' using errcode = 'P0001'; end if;
    select lo.lote, pr.nombre into v_lote, v_nombre from lotes lo join productos pr on pr.id = lo.producto_id where lo.id = l.lote_id;
    v_unid := (x ->> 'unidades')::integer;
    if v_unid is null or v_unid <= 0 then raise exception 'Revisa la cantidad a devolver de %', v_nombre using errcode = 'P0001'; end if;
    select coalesce(sum(unidades), 0) into v_dev from devolucion_proveedor_lineas where compra_linea_id = l.id;
    if v_dev + v_unid > l.unidades + l.bonificadas then
      raise exception 'De % (lote %) entraron % und en esta compra y ya se devolvieron %', v_nombre, v_lote, l.unidades + l.bonificadas, v_dev using errcode = 'P0001';
    end if;
    select coalesce(s.unidades, 0) into v_hay from v_stock_lotes s where s.lote_id = l.lote_id;
    if v_hay < v_unid then raise exception 'Del lote % de % solo quedan % und', v_lote, v_nombre, v_hay using errcode = 'P0001'; end if;
    v_valor := round(l.total * v_unid / (l.unidades + l.bonificadas), 2);
    insert into devolucion_proveedor_lineas (empresa_id, devolucion_id, compra_id, compra_linea_id, producto_id, lote_id, unidades, valor)
    values (v_emp, v_id, c.id, l.id, l.producto_id, l.lote_id, v_unid, v_valor);
    insert into movimientos (empresa_id, sede_id, producto_id, lote_id, cantidad, tipo, ref_id, motivo, usuario_id)
    values (v_emp, c.sede_id, l.producto_id, l.lote_id, -v_unid, 'ajuste', v_id,
            left('Devolución N.º ' || v_num || ' al proveedor ' || v_prov || ' (factura ' || c.numero_factura || '): ' || v_motivo, 200), auth.uid());
    v_total := v_total + v_valor;
  end loop;
  -- El encabezado va al final, ya con su valor: las líneas lo referencian con llave diferida.
  insert into devoluciones_proveedor (id, empresa_id, sede_id, numero, compra_id, proveedor_id, motivo, valor, idem_key, usuario_id)
  values (v_id, v_emp, c.sede_id, v_num, c.id, c.proveedor_id, v_motivo, v_total, p ->> 'idem_key', auth.uid());
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v_emp, auth.uid(), 'devolucion_proveedor', 'devoluciones_proveedor', v_id::text, jsonb_build_object('numero', v_num, 'compra', c.numero, 'proveedor', v_prov,
    'valor', v_total, 'motivo', v_motivo));
  return jsonb_build_object('id', v_id, 'numero', v_num, 'valor', v_total, 'repetida', false);
end $$;

-- Registrar la nota crédito del proveedor de una devolución: baja el saldo de la compra (nunca por debajo de cero).
create or replace function aplicar_nc_proveedor(p_devolucion uuid, p_nc text, p_valor numeric default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d devoluciones_proveedor; c compras; v_nc text := upper(nullif(trim(coalesce(p_nc, '')), '')); v_valor numeric; v_saldo numeric;
begin
  select * into d from devoluciones_proveedor where id = p_devolucion for update;
  if not found or coalesce(rol_en(d.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador registran notas crédito de proveedores' using errcode = '42501';
  end if;
  if d.estado <> 'pendiente_nc' then raise exception 'Esta devolución ya tiene su nota crédito' using errcode = 'P0001'; end if;
  if v_nc is null or length(v_nc) > 40 then raise exception 'Escribe el número de la nota crédito del proveedor' using errcode = 'P0001'; end if;
  v_valor := coalesce(p_valor, d.valor);
  if v_valor <= 0 or v_valor <> round(v_valor, 2) then raise exception 'Revisa el valor de la nota crédito' using errcode = 'P0001'; end if;
  select * into c from compras where id = d.compra_id for update;
  v_saldo := saldo_compra(c.id);
  if v_valor > v_saldo then
    raise exception 'La nota crédito (%) es mayor que el saldo de la factura % (%): si ya la pagaste, pide al proveedor el reembolso', to_char(v_valor, 'FM999G999G999G990D00'),
      c.numero_factura, to_char(v_saldo, 'FM999G999G999G990D00') using errcode = 'P0001';
  end if;
  update devoluciones_proveedor set estado = 'aplicada', nc_proveedor = v_nc, valor_nc = v_valor, aplicada = now(), aplica_usuario = auth.uid() where id = d.id;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (d.empresa_id, auth.uid(), 'nc_proveedor', 'devoluciones_proveedor', d.id::text, jsonb_build_object('nc', v_nc, 'valor', v_valor, 'compra', c.numero));
  return jsonb_build_object('id', d.id, 'estado', 'aplicada', 'saldo', v_saldo - v_valor);
end $$;

-- ───────────────────────── Seguridad ─────────────────────────
alter table compras enable row level security;
alter table compra_lineas enable row level security;
alter table pagos_proveedor enable row level security;
alter table pago_aplicaciones enable row level security;
alter table devoluciones_proveedor enable row level security;
alter table devolucion_proveedor_lineas enable row level security;
-- Con dinero: solo el dueño y el administrador. La bodega ve sus recepciones por v_recepciones (sin dinero).
create policy gerencia_lee on compras for select to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin'])));
create policy gerencia_lee on compra_lineas for select to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin'])));
create policy gerencia_lee on pagos_proveedor for select to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin'])));
create policy gerencia_lee on pago_aplicaciones for select to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin'])));
create policy gerencia_lee on devoluciones_proveedor for select to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin'])));
create policy gerencia_lee on devolucion_proveedor_lineas for select to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin'])));
-- Solo lectura: se escriben únicamente por las funciones de arriba.
grant select on compras, compra_lineas, pagos_proveedor, pago_aplicaciones, devoluciones_proveedor, devolucion_proveedor_lineas,
  v_cuentas_por_pagar, v_recepciones, v_recepcion_lineas to authenticated;

revoke execute on function compra_proteger(), compra_linea_proteger(), pago_proveedor_proteger(), devolucion_proveedor_proteger(), saldo_compra(uuid),
  compra_calcular_linea(numeric, integer, integer, numeric, numeric), compra_costeo(jsonb, productos, integer),
  compra_costo_lote(uuid, uuid, integer, numeric, integer), compra_precio(productos, jsonb),
  registrar_compra(jsonb), completar_costos_compra(uuid, jsonb), anular_compra(uuid, text), registrar_pago_proveedor(jsonb),
  anular_pago_proveedor(uuid, text), registrar_devolucion_proveedor(jsonb), aplicar_nc_proveedor(uuid, text, numeric) from public, anon;
grant execute on function registrar_compra(jsonb), completar_costos_compra(uuid, jsonb), anular_compra(uuid, text), registrar_pago_proveedor(jsonb),
  anular_pago_proveedor(uuid, text), registrar_devolucion_proveedor(jsonb), aplicar_nc_proveedor(uuid, text, numeric) to authenticated;
-- registrar_entrada se reemplazó: conserva sus permisos (create or replace no los cambia).
