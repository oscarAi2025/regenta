-- Regenta: migraciones 031, 032, 033 y 033a (Bloque 2: compras, mostrador, cuentas de clientes e integración). Una sola transacción.
begin;

-- ═════════════ 031_compras.sql ═════════════
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
-- Las filas que ya existen nacen marcadas (la columna se crea con valor true, sin un update que reescriba datos y sin
-- volver a marcar nada si la migración se repite); las que se creen después llevan false.
alter table lote_costos add column if not exists heredado boolean not null default true;
alter table lote_costos alter column heredado set default false;
alter table lote_costos add column if not exists actualizado timestamptz;
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


-- ═════════════ 032_mostrador.sql ═════════════
-- Regenta · mostrador ágil: ventas en espera, domicilios y cotizaciones (pedidos del mostrador).
--  · Un pedido es un borrador de venta guardado en el servidor: «espera» (cliente que fue por algo y vuelve; otra caja
--    puede cobrarla), «domicilio» (sale con el domiciliario y se cobra al volver) y «cotización» (con validez, se
--    imprime o se manda por WhatsApp y se convierte en venta).
--  · Nada reserva existencias: el stock solo se mueve cuando la venta se registra con registrar_venta.
--  · Se cobra SIEMPRE al precio vigente (lo fija registrar_venta). precio_mostrado guarda el precio que se le dijo al
--    cliente, solo para avisar «antes X, ahora Y».
--  · cobrar_pedido(pedido, venta) se llama en la MISMA transacción que registrar_venta (que no se modifica): marca el
--    pedido cobrado y lo enlaza a su venta, con bloqueo de fila (dos cajas no lo cobran dos veces).
--  · Las tablas solo se leen (RLS por empresa); se escriben únicamente por las funciones de abajo.

create table if not exists pedidos_mostrador (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  sede_id uuid not null references sedes,
  tipo text not null check (tipo in ('espera', 'domicilio', 'cotizacion')),
  estado text not null default 'abierto' check (estado in ('abierto', 'en_camino', 'cobrado', 'cancelado', 'vencido')),
  numero integer not null check (numero > 0),          -- consecutivo por empresa y tipo
  cliente_id uuid references clientes,
  contacto text check (contacto is null or length(contacto) between 1 and 80),
  telefono text check (telefono is null or telefono ~ '^[0-9 +()-]{7,20}$'),
  direccion text check (direccion is null or length(direccion) between 3 and 200),
  nota text check (nota is null or length(nota) <= 300),
  vence date,                                           -- validez de la cotización
  descuento_pct numeric(5, 2) not null default 0 check (descuento_pct >= 0 and descuento_pct < 100),  -- descuento general
  motivo text check (motivo is null or length(motivo) between 3 and 200),  -- motivo de la cancelación
  venta_id uuid unique references ventas,
  creado_por uuid not null,
  caja_id uuid references cajas,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  unique (empresa_id, tipo, numero),
  check ((estado = 'cobrado') = (venta_id is not null)),
  check (estado <> 'en_camino' or tipo = 'domicilio'),
  check (estado <> 'vencido' or tipo = 'cotizacion'),
  check (tipo <> 'cotizacion' or vence is not null),
  check (estado <> 'cancelado' or motivo is not null)
);
create index if not exists pedidos_mostrador_lista on pedidos_mostrador (empresa_id, tipo, estado, creado desc);

create table if not exists pedido_lineas (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  pedido_id uuid not null references pedidos_mostrador on delete cascade,
  producto_id uuid not null references productos,
  presentacion text not null check (presentacion in ('caja', 'unidad')),
  cantidad integer not null check (cantidad between 1 and 10000),
  descuento_pct numeric(5, 2) not null default 0 check (descuento_pct >= 0 and descuento_pct < 100),
  precio_mostrado numeric(14, 2) not null check (precio_mostrado >= 0)   -- precio de la presentación al armar el pedido
);
create index if not exists pedido_lineas_pedido on pedido_lineas (pedido_id);
create index if not exists pedido_lineas_producto on pedido_lineas (empresa_id, producto_id);

-- ───────────── Guardar (crear o reemplazar) un pedido ─────────────
-- p = {id?, empresa_id, sede_id, caja_id?, tipo, cliente_id?, contacto?, telefono?, direccion?, nota?, vence?, descuento_pct?,
--      lineas: [{producto_id, presentacion, cantidad, descuento_pct?}]}
create or replace function guardar_pedido(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := (p ->> 'empresa_id')::uuid;
  v_sede uuid := (p ->> 'sede_id')::uuid;
  v_caja uuid := nullif(p ->> 'caja_id', '')::uuid;
  v_tipo text := p ->> 'tipo';
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_cli uuid := nullif(p ->> 'cliente_id', '')::uuid;
  v_contacto text := nullif(regexp_replace(trim(coalesce(p ->> 'contacto', '')), '\s+', ' ', 'g'), '');
  v_tel text := nullif(trim(coalesce(p ->> 'telefono', '')), '');
  v_dir text := nullif(regexp_replace(trim(coalesce(p ->> 'direccion', '')), '\s+', ' ', 'g'), '');
  v_nota text := nullif(trim(coalesce(p ->> 'nota', '')), '');
  v_vence date;
  v_dgen numeric := coalesce((p ->> 'descuento_pct')::numeric, 0);
  v_rol text; v_dmax numeric; v_ped pedidos_mostrador; v_num integer;
  ln jsonb; v_prod productos; v_pres text; v_cant numeric; v_dpct numeric; v_precio numeric; n integer := 0;
begin
  v_rol := rol_en(v_emp);
  if coalesce(v_rol, '') not in ('dueno', 'admin', 'cajero', 'vendedor') then
    raise exception 'No tienes permiso para armar pedidos en esta empresa' using errcode = '42501';
  end if;
  if (select estado from empresas where id = v_emp) <> 'activa' then
    raise exception 'La suscripción de esta empresa está suspendida' using errcode = 'P0001';
  end if;
  if not exists (select 1 from sedes where id = v_sede and empresa_id = v_emp) then raise exception 'Sede no válida' using errcode = 'P0001'; end if;
  if v_caja is not null and not exists (select 1 from cajas where id = v_caja and empresa_id = v_emp) then raise exception 'Caja no válida' using errcode = 'P0001'; end if;
  if v_cli is not null and not exists (select 1 from clientes where id = v_cli and empresa_id = v_emp) then raise exception 'Cliente no válido' using errcode = 'P0001'; end if;
  if v_tipo is null or v_tipo not in ('espera', 'domicilio', 'cotizacion') then raise exception 'Tipo de pedido no válido' using errcode = 'P0001'; end if;
  if jsonb_array_length(coalesce(p -> 'lineas', '[]')) = 0 then raise exception 'El pedido no tiene productos' using errcode = 'P0001'; end if;
  if jsonb_array_length(p -> 'lineas') > 200 then raise exception 'El pedido tiene demasiados productos' using errcode = 'P0001'; end if;
  if v_dgen < 0 or v_dgen >= 100 then raise exception 'El descuento general debe estar entre 0 y 99 %%' using errcode = 'P0001'; end if;
  if v_tipo = 'domicilio' then
    if v_contacto is null then raise exception 'Escribe a nombre de quién va el domicilio' using errcode = 'P0001'; end if;
    if v_tel is null or v_tel !~ '^[0-9 +()-]{7,20}$' then raise exception 'Escribe un teléfono de contacto válido' using errcode = 'P0001'; end if;
    if v_dir is null or length(v_dir) < 3 then raise exception 'Escribe la dirección de entrega' using errcode = 'P0001'; end if;
  elsif v_tel is not null and v_tel !~ '^[0-9 +()-]{7,20}$' then raise exception 'Escribe un teléfono válido' using errcode = 'P0001';
  end if;
  if v_tipo = 'cotizacion' then
    begin v_vence := coalesce(nullif(p ->> 'vence', '')::date, current_date + 8);
    exception when others then raise exception 'La fecha de validez no es válida' using errcode = 'P0001'; end;
    if v_vence < current_date or v_vence > current_date + 90 then raise exception 'La validez de la cotización debe estar entre hoy y 90 días' using errcode = 'P0001'; end if;
  end if;
  if length(coalesce(v_contacto, '')) > 80 then raise exception 'El nombre es demasiado largo (máximo 80 caracteres)' using errcode = 'P0001'; end if;
  if length(coalesce(v_dir, '')) > 200 then raise exception 'La dirección es demasiado larga' using errcode = 'P0001'; end if;
  if length(coalesce(v_nota, '')) > 300 then raise exception 'La nota es demasiado larga (máximo 300 caracteres)' using errcode = 'P0001'; end if;
  -- El tope de descuento de la cajera vale también para el vendedor (así el pedido se puede cobrar tal cual).
  select descuento_max_cajero into v_dmax from empresas where id = v_emp;

  if v_id is not null then
    select * into v_ped from pedidos_mostrador where id = v_id and empresa_id = v_emp for update;
    if not found then raise exception 'Pedido no encontrado' using errcode = 'P0001'; end if;
    if v_ped.estado <> 'abierto' then raise exception 'Este pedido ya no se puede cambiar (está %)', replace(v_ped.estado, '_', ' ') using errcode = 'P0001'; end if;
    if v_ped.tipo <> v_tipo then raise exception 'El tipo del pedido no se cambia' using errcode = 'P0001'; end if;
    if v_tipo = 'cotizacion' and nullif(p ->> 'vence', '') is null then v_vence := greatest(v_ped.vence, current_date); end if; -- conserva su validez
    update pedidos_mostrador set cliente_id = v_cli, contacto = v_contacto, telefono = v_tel, direccion = v_dir, nota = v_nota,
      vence = v_vence, descuento_pct = v_dgen, actualizado = now()
    where id = v_id;
    delete from pedido_lineas where pedido_id = v_id;
  else
    perform pg_advisory_xact_lock(hashtext('pedido:' || v_emp::text || ':' || v_tipo));
    select coalesce(max(numero), 0) + 1 into v_num from pedidos_mostrador where empresa_id = v_emp and tipo = v_tipo;
    insert into pedidos_mostrador (empresa_id, sede_id, tipo, numero, cliente_id, contacto, telefono, direccion, nota, vence, descuento_pct, creado_por, caja_id)
    values (v_emp, v_sede, v_tipo, v_num, v_cli, v_contacto, v_tel, v_dir, v_nota, v_vence, v_dgen, auth.uid(), v_caja)
    returning * into v_ped;
    v_id := v_ped.id;
  end if;

  for ln in select * from jsonb_array_elements(p -> 'lineas') loop
    select * into v_prod from productos where id = (ln ->> 'producto_id')::uuid and empresa_id = v_emp and activo;
    if not found then raise exception 'Producto no válido' using errcode = 'P0001'; end if;
    v_pres := coalesce(ln ->> 'presentacion', 'caja');
    v_cant := (ln ->> 'cantidad')::numeric;
    if v_cant is null or v_cant < 1 or v_cant > 10000 or v_cant <> trunc(v_cant) then raise exception 'Cantidad no válida en %', v_prod.nombre using errcode = 'P0001'; end if;
    if v_pres = 'caja' then v_precio := v_prod.precio_caja;
    elsif v_pres = 'unidad' then
      if v_prod.precio_unidad is null then raise exception '% no se vende por unidad', v_prod.nombre using errcode = 'P0001'; end if;
      v_precio := v_prod.precio_unidad;
    else raise exception 'Presentación no válida' using errcode = 'P0001';
    end if;
    v_dpct := coalesce((ln ->> 'descuento_pct')::numeric, 0);
    if v_dpct < 0 or v_dpct >= 100 then raise exception 'Descuento no válido en %', v_prod.nombre using errcode = 'P0001'; end if;
    if v_rol in ('cajero', 'vendedor') and 100 - (100 - v_dpct) * (100 - v_dgen) / 100 > v_dmax + 0.001 then
      raise exception 'El descuento de % supera el máximo permitido (% %%)', v_prod.nombre, v_dmax using errcode = '42501';
    end if;
    insert into pedido_lineas (empresa_id, pedido_id, producto_id, presentacion, cantidad, descuento_pct, precio_mostrado)
    values (v_emp, v_id, v_prod.id, v_pres, v_cant::integer, v_dpct, v_precio);
    n := n + 1;
  end loop;

  return jsonb_build_object('id', v_id, 'tipo', v_ped.tipo, 'numero', v_ped.numero, 'lineas', n);
end $$;

-- ───────────── Cambiar el estado (en camino, cancelar) ─────────────
create or replace function cambiar_estado_pedido(p_pedido uuid, p_estado text, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v pedidos_mostrador; v_motivo text := nullif(regexp_replace(trim(coalesce(p_motivo, '')), '\s+', ' ', 'g'), '');
begin
  select * into v from pedidos_mostrador where id = p_pedido for update;
  if not found or coalesce(rol_en(v.empresa_id), '') not in ('dueno', 'admin', 'cajero', 'vendedor') then
    raise exception 'Pedido no encontrado' using errcode = 'P0001';
  end if;
  if p_estado = 'en_camino' then
    if v.tipo <> 'domicilio' then raise exception 'Solo un domicilio sale «en camino»' using errcode = 'P0001'; end if;
    if v.estado <> 'abierto' then raise exception 'Este domicilio no está abierto (está %)', replace(v.estado, '_', ' ') using errcode = 'P0001'; end if;
  elsif p_estado = 'abierto' then
    -- El domiciliario volvió sin entregar: el pedido se puede corregir o cancelar.
    if v.estado <> 'en_camino' then raise exception 'Solo un domicilio en camino vuelve a quedar abierto' using errcode = 'P0001'; end if;
  elsif p_estado = 'cancelado' then
    if v.estado not in ('abierto', 'en_camino', 'vencido') then raise exception 'Este pedido ya no se puede cancelar (está %)', replace(v.estado, '_', ' ') using errcode = 'P0001'; end if;
    if v_motivo is null or length(v_motivo) < 3 then raise exception 'Escribe el motivo de la cancelación' using errcode = 'P0001'; end if;
    if length(v_motivo) > 200 then raise exception 'El motivo es demasiado largo (máximo 200 caracteres)' using errcode = 'P0001'; end if;
  else
    raise exception 'Estado no válido' using errcode = 'P0001';
  end if;
  update pedidos_mostrador set estado = p_estado, motivo = case when p_estado = 'cancelado' then v_motivo else motivo end, actualizado = now()
  where id = p_pedido;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v.empresa_id, auth.uid(), 'pedido_' || p_estado, 'pedidos_mostrador', p_pedido::text,
          jsonb_build_object('tipo', v.tipo, 'numero', v.numero, 'antes', v.estado, 'motivo', case when p_estado = 'cancelado' then v_motivo end));
  return jsonb_build_object('id', p_pedido, 'estado', p_estado);
end $$;

-- ───────────── Cotizaciones vencidas ─────────────
-- Las cotizaciones abiertas cuya validez pasó quedan «vencidas» (se pueden convertir igual: se cobra al precio de hoy).
create or replace function vencer_cotizaciones(p_empresa uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if rol_en(p_empresa) is null then return 0; end if;
  update pedidos_mostrador set estado = 'vencido', actualizado = now()
  where empresa_id = p_empresa and tipo = 'cotizacion' and estado = 'abierto' and vence < current_date;
  get diagnostics n = row_count;
  return n;
end $$;

-- ───────────── Cobrar: enlaza la venta recién registrada ─────────────
-- Va en la misma transacción que registrar_venta, con la venta que esta acaba de crear. Un reintento de la misma venta
-- (misma clave de idempotencia) devuelve el mismo resultado; otra venta sobre un pedido ya cobrado falla y la
-- transacción entera se deshace (no queda una segunda venta).
create or replace function cobrar_pedido(p_pedido uuid, p_venta uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v pedidos_mostrador; ve ventas;
begin
  select * into v from pedidos_mostrador where id = p_pedido for update;
  if not found or rol_en(v.empresa_id) is null then raise exception 'Pedido no encontrado' using errcode = 'P0001'; end if;
  if coalesce(rol_en(v.empresa_id), '') not in ('dueno', 'admin', 'cajero') then
    raise exception 'Tu usuario no puede cobrar' using errcode = '42501';
  end if;
  select * into ve from ventas where id = p_venta and empresa_id = v.empresa_id;
  if not found then raise exception 'Venta no válida' using errcode = 'P0001'; end if;
  if v.estado = 'cobrado' then
    if v.venta_id = p_venta then return jsonb_build_object('id', v.id, 'estado', 'cobrado', 'repetido', true); end if;
    raise exception 'Este pedido ya se cobró en otra venta' using errcode = 'P0001';
  end if;
  if v.estado = 'cancelado' then raise exception 'Este pedido está cancelado: no se puede cobrar' using errcode = 'P0001'; end if;
  -- Solo la venta de esta misma transacción y de este mismo usuario (no se enlaza una venta vieja ni ajena).
  if ve.creado <> now() or ve.usuario_id is distinct from auth.uid() then
    raise exception 'El pedido se cobra con su propia venta' using errcode = 'P0001';
  end if;
  update pedidos_mostrador set estado = 'cobrado', venta_id = p_venta, actualizado = now() where id = p_pedido;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v.empresa_id, auth.uid(), 'pedido_cobrado', 'pedidos_mostrador', p_pedido::text,
          jsonb_build_object('tipo', v.tipo, 'numero', v.numero, 'venta', ve.prefijo || ve.numero, 'total', ve.total));
  return jsonb_build_object('id', v.id, 'estado', 'cobrado', 'repetido', false);
end $$;

-- ───────────────────────── Seguridad ─────────────────────────
alter table pedidos_mostrador enable row level security;
alter table pedido_lineas enable row level security;
create policy miembros_leen on pedidos_mostrador for select to authenticated using (empresa_id in (select mis_empresas()));
create policy miembros_leen on pedido_lineas for select to authenticated using (empresa_id in (select mis_empresas()));
revoke all on pedidos_mostrador, pedido_lineas from public, anon, authenticated;
grant select on pedidos_mostrador, pedido_lineas to authenticated;

revoke execute on function guardar_pedido(jsonb), cambiar_estado_pedido(uuid, text, text), vencer_cotizaciones(uuid), cobrar_pedido(uuid, uuid) from public, anon;
grant execute on function guardar_pedido(jsonb), cambiar_estado_pedido(uuid, text, text), vencer_cotizaciones(uuid), cobrar_pedido(uuid, uuid) to authenticated;


-- ═════════════ 033_cuentas_clientes.sql ═════════════
-- Regenta · clientes con cuenta (fiado controlado) y cartera por cliente.
--  · Cada cliente puede tener cupo de crédito (null = sin cupo: la cajera no le fía), plazo por defecto, bloqueo y notas.
--    Solo el dueño o el administrador cambian esos datos (función auditada; la cajera no escribe esas columnas).
--  · La droguería puede bloquear el fiado a quien tenga una factura con más de N días de mora (dias_mora_bloqueo).
--  · La venta a crédito sigue exigiendo factura electrónica y cliente (restricción credito_completo). La cajera fía si el
--    cliente tiene cupo, no está bloqueado, no pasa el límite de mora y saldo + venta ≤ cupo. El dueño o el administrador
--    pueden pasarse con un motivo obligatorio que queda en la auditoría. Sin cupo asignado, la gerencia sigue fiando como
--    hasta hoy (sin motivo), salvo bloqueo o mora.
--  · Recibos de caja (RC, consecutivo por droguería): un pago del cliente se reparte entre sus facturas, la que vence
--    primero primero; nunca más que lo que debe. Inmutables: solo se anulan (con motivo), y anular restituye los saldos.
--  · Abonos con caja y turno: la cajera recibe abonos con su turno abierto y el efectivo entra al turno de SU caja (con
--    varias cajas activas, antes no entraba a ninguno). Los abonos antiguos sin caja ni turno siguen la regla anterior.

-- ───────────────────────── Datos de crédito ─────────────────────────
alter table clientes add column if not exists cupo_credito numeric(14, 2) check (cupo_credito is null or (cupo_credito >= 0 and cupo_credito = trunc(cupo_credito)));
alter table clientes add column if not exists plazo_dias_defecto integer check (plazo_dias_defecto between 1 and 180);
alter table clientes add column if not exists credito_bloqueado boolean not null default false;
alter table clientes add column if not exists notas text check (length(notas) <= 500);
alter table empresas add column if not exists dias_mora_bloqueo integer check (dias_mora_bloqueo between 0 and 365);

-- Quien vende crea y corrige clientes, pero las columnas de crédito solo cambian por configurar_credito_cliente().
revoke insert, update on clientes from authenticated;
grant insert (empresa_id, tipo_doc, numero_doc, dv, nombre, email, telefono, autoriza_datos) on clientes to authenticated;
grant update (tipo_doc, numero_doc, dv, nombre, email, telefono, autoriza_datos) on clientes to authenticated;

-- ───────────────────────── Recibos de caja ─────────────────────────
create table if not exists recibos_caja (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  numero integer not null check (numero > 0),
  cliente_id uuid not null references clientes on delete restrict,
  medio text not null check (medio in ('efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'bre_b', 'qr')),
  valor numeric(14, 2) not null check (valor > 0 and valor = trunc(valor)),
  referencia text check (length(referencia) <= 60),
  caja_id uuid references cajas,
  turno_id uuid references turnos,
  usuario_id uuid not null,
  saldo_anterior numeric(14, 2) not null,
  aplicado jsonb not null default '[]',           -- [{venta_id, factura, vence, valor, saldo}] cómo se repartió el pago
  anulado boolean not null default false,
  motivo text check (motivo is null or length(trim(motivo)) between 4 and 200),
  anulado_por uuid,
  anulado_en timestamptz,
  creado timestamptz not null default now(),
  unique (empresa_id, numero),
  check (anulado = (motivo is not null))
);
create index if not exists recibos_caja_cliente on recibos_caja (cliente_id, creado desc);
create index if not exists recibos_caja_turno on recibos_caja (turno_id) where turno_id is not null;

-- Un recibo solo cambia para anularse (con motivo, quién y cuándo); nada más, y nunca se borra.
create or replace function recibo_solo_anular() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Los recibos de caja no se borran: se anulan' using errcode = 'P0001'; end if;
  if (to_jsonb(new) - 'anulado' - 'motivo' - 'anulado_por' - 'anulado_en') <> (to_jsonb(old) - 'anulado' - 'motivo' - 'anulado_por' - 'anulado_en')
     or old.anulado or not new.anulado then
    raise exception 'Un recibo de caja solo puede anularse' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists recibos_caja_inmutables on recibos_caja;
create trigger recibos_caja_inmutables before update or delete on recibos_caja for each row execute function recibo_solo_anular();

alter table abonos add column if not exists caja_id uuid references cajas;
alter table abonos add column if not exists turno_id uuid references turnos;
alter table abonos add column if not exists recibo_id bigint references recibos_caja;
create index if not exists abonos_turno on abonos (turno_id) where turno_id is not null;
create index if not exists abonos_recibo on abonos (recibo_id) where recibo_id is not null;
create index if not exists ventas_cliente_credito on ventas (cliente_id, vence_pago) where condicion = 'credito';

alter table recibos_caja enable row level security;
drop policy if exists caja_lee on recibos_caja;
create policy caja_lee on recibos_caja for select to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin', 'cajero'])));
revoke all on recibos_caja from anon, authenticated;
grant select on recibos_caja to authenticated;

-- Cartera: el saldo descuenta lo devuelto que bajó el saldo (a_saldo); lo que se reembolsó al cliente porque ya había
-- pagado no deja la factura en negativo. Mismas columnas.
create or replace view v_cartera with (security_invoker = true) as
  select v.id venta_id, v.empresa_id, v.prefijo, v.numero, v.creado, v.vence_pago, v.plazo_dias, v.total,
         c.id cliente_id, c.nombre cliente, c.tipo_doc, c.numero_doc, c.dv, c.telefono, c.email,
         coalesce(a.abonado, 0) abonado, v.total - coalesce(d.a_saldo, 0) - coalesce(a.abonado, 0) saldo,
         greatest(0, current_date - v.vence_pago) dias_mora, v.devuelto
  from ventas v
  join clientes c on c.id = v.cliente_id
  left join (select venta_id, sum(valor) abonado from abonos where not anulado group by venta_id) a on a.venta_id = v.id
  left join (select venta_id, sum(a_saldo) a_saldo from devoluciones group by venta_id) d on d.venta_id = v.id
  where v.condicion = 'credito' and v.estado = 'cerrada' and v.empresa_id in (select mis_empresas(array['dueno', 'admin']));

-- ───────────────────────── Funciones auxiliares (internas) ─────────────────────────
-- Pesos colombianos para los mensajes: $150.000
create or replace function pesos_texto(n numeric) returns text language sql immutable as $$
  select '$' || replace(to_char(round(coalesce(n, 0)), 'FM999,999,999,990'), ',', '.')
$$;

-- Saldo de una factura a crédito: total − lo devuelto que bajó el saldo − abonos vigentes.
create or replace function saldo_factura(p_venta uuid) returns numeric language sql stable security definer set search_path = public as $$
  select v.total - coalesce((select sum(d.a_saldo) from devoluciones d where d.venta_id = v.id), 0)
         - coalesce((select sum(a.valor) from abonos a where a.venta_id = v.id and not a.anulado), 0)
  from ventas v where v.id = p_venta
$$;

-- Estado de crédito de un cliente frente a una venta de p_valor. p_gerencia: quien pregunta es dueño o administrador.
--   puede_fiar       se le puede fiar sin autorización
--   requiere_motivo  no se puede, pero la gerencia puede autorizarlo con un motivo
--   motivo           por qué no (en español); aviso: nota para la gerencia cuando fía sin cupo asignado
create or replace function credito_cliente(p_cliente uuid, p_valor numeric, p_gerencia boolean) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cl clientes; v_lim integer; v_saldo numeric; v_mora integer; v_n integer; v_motivo text; v_disp numeric;
  v_puede boolean; v_valor numeric := greatest(coalesce(p_valor, 0), 0); v_excede_mora boolean;
begin
  select * into cl from clientes where id = p_cliente;
  if not found then return null; end if;
  select dias_mora_bloqueo into v_lim from empresas where id = cl.empresa_id;
  select coalesce(sum(s), 0), coalesce(max(m), 0), count(*) into v_saldo, v_mora, v_n from (
    select saldo_factura(v.id) s, greatest(0, current_date - v.vence_pago) m
    from ventas v where v.cliente_id = cl.id and v.empresa_id = cl.empresa_id and v.condicion = 'credito' and v.estado = 'cerrada') x
  where s > 0;
  v_disp := case when cl.cupo_credito is null then null else greatest(0, cl.cupo_credito - v_saldo) end;
  v_excede_mora := v_lim is not null and v_mora > v_lim;
  if cl.credito_bloqueado then
    v_motivo := 'El crédito de este cliente está bloqueado';
  elsif v_excede_mora then
    v_motivo := format('Mora de %s días: pasa el límite de %s días de la droguería', v_mora, v_lim);
  elsif cl.cupo_credito is null then
    v_motivo := 'Sin cupo de crédito asignado';
  elsif v_valor > 0 and v_saldo + v_valor > cl.cupo_credito then
    v_motivo := format('La venta (%s) supera el cupo disponible (%s de %s)', pesos_texto(v_valor), pesos_texto(v_disp), pesos_texto(cl.cupo_credito));
  elsif v_valor = 0 and v_disp <= 0 then
    v_motivo := format('Cupo agotado: debe %s de un cupo de %s', pesos_texto(v_saldo), pesos_texto(cl.cupo_credito));
  end if;
  -- Sin cupo asignado (y sin bloqueo ni mora), la gerencia fía como hasta hoy, bajo su criterio.
  v_puede := v_motivo is null or (p_gerencia and cl.cupo_credito is null and not cl.credito_bloqueado and not v_excede_mora);
  return jsonb_build_object(
    'puede_fiar', v_puede, 'requiere_motivo', not v_puede and p_gerencia, 'motivo', case when v_puede then null else v_motivo end,
    'aviso', case when v_puede and v_motivo is not null then 'Sin cupo asignado: el crédito queda a criterio de la gerencia' end,
    'cupo', cl.cupo_credito, 'cupo_disponible', v_disp, 'saldo', v_saldo, 'facturas', v_n, 'dias_mora', v_mora,
    'limite_mora', v_lim, 'bloqueado', cl.credito_bloqueado, 'plazo_dias', cl.plazo_dias_defecto);
end $$;

-- Caja y turno abierto donde entra un pago: la caja debe ser de la droguería y estar activa.
create or replace function caja_y_turno(p_emp uuid, p_caja uuid, out caja_id uuid, out turno_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_caja is null then return; end if;
  select c.id into caja_id from cajas c where c.id = p_caja and c.empresa_id = p_emp and c.activa;
  if caja_id is null then raise exception 'Caja no válida' using errcode = 'P0001'; end if;
  select t.id into turno_id from turnos t where t.caja_id = p_caja and t.estado = 'abierto';
end $$;

-- ───────────────────────── Funciones públicas ─────────────────────────
-- Estado de crédito para la caja y la ficha: quien vende (dueño, administrador, cajera) de esa droguería.
create or replace function estado_credito(p_cliente uuid, p_valor numeric default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid; v_rol text;
begin
  select empresa_id into v_emp from clientes where id = p_cliente;
  v_rol := case when v_emp is not null then rol_en(v_emp) end;
  if coalesce(v_rol, '') not in ('dueno', 'admin', 'cajero') then raise exception 'No tienes permiso para ver el crédito de este cliente' using errcode = '42501'; end if;
  return credito_cliente(p_cliente, p_valor, v_rol in ('dueno', 'admin'));
end $$;

-- Datos de crédito del cliente: solo dueño o administrador; cada cambio queda en la auditoría con el antes y el después.
create or replace function configurar_credito_cliente(p_cliente uuid, p_cupo numeric, p_plazo integer, p_bloqueado boolean, p_notas text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cl clientes; v_notas text := nullif(trim(coalesce(p_notas, '')), '');
begin
  select * into cl from clientes where id = p_cliente for update;
  if not found or coalesce(rol_en(cl.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador cambian el crédito de un cliente' using errcode = '42501';
  end if;
  if p_cupo is not null and (p_cupo < 0 or p_cupo <> trunc(p_cupo) or p_cupo > 10000000000) then raise exception 'El cupo va en pesos, sin centavos' using errcode = 'P0001'; end if;
  if p_plazo is not null and (p_plazo < 1 or p_plazo > 180) then raise exception 'El plazo debe estar entre 1 y 180 días' using errcode = 'P0001'; end if;
  if length(v_notas) > 500 then raise exception 'Las notas van hasta 500 caracteres' using errcode = 'P0001'; end if;
  update clientes set cupo_credito = p_cupo, plazo_dias_defecto = p_plazo, credito_bloqueado = coalesce(p_bloqueado, false), notas = v_notas where id = p_cliente;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (cl.empresa_id, auth.uid(), 'credito_cliente', 'clientes', p_cliente::text, jsonb_build_object(
    'antes', jsonb_build_object('cupo', cl.cupo_credito, 'plazo', cl.plazo_dias_defecto, 'bloqueado', cl.credito_bloqueado, 'notas', cl.notas),
    'despues', jsonb_build_object('cupo', p_cupo, 'plazo', p_plazo, 'bloqueado', coalesce(p_bloqueado, false), 'notas', v_notas)));
  return credito_cliente(p_cliente, 0, true);
end $$;

-- Bloquear el fiado por mora (null = no bloquea). Dueño o administrador; en la demostración no se cambia.
create or replace function configurar_mora(p_empresa uuid, p_dias integer) returns void
language plpgsql security definer set search_path = public as $$
declare v_antes integer;
begin
  if coalesce(rol_en(p_empresa), '') not in ('dueno', 'admin') then raise exception 'Solo el dueño o el administrador cambian esta opción' using errcode = '42501'; end if;
  if (select demo from empresas where id = p_empresa) then raise exception 'En la droguería de demostración esta opción no se cambia' using errcode = 'P0001'; end if;
  if p_dias is not null and (p_dias < 0 or p_dias > 365) then raise exception 'Los días de mora van de 0 a 365' using errcode = 'P0001'; end if;
  select dias_mora_bloqueo into v_antes from empresas where id = p_empresa;
  update empresas set dias_mora_bloqueo = p_dias where id = p_empresa;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (p_empresa, auth.uid(), 'mora_bloqueo', 'empresas', p_empresa::text, jsonb_build_object('antes', v_antes, 'despues', p_dias));
end $$;

-- Clientes con saldo pendiente (para recibir un pago en la caja): quien vende de esa droguería.
create or replace function deudores(p_empresa uuid, p_q text default '') returns table (cliente_id uuid, nombre text, documento text, telefono text, saldo numeric, facturas integer, dias_mora integer)
language plpgsql stable security definer set search_path = public as $$
declare v_q text := lower(trim(coalesce(p_q, '')));
begin
  if coalesce(rol_en(p_empresa), '') not in ('dueno', 'admin', 'cajero') then raise exception 'No tienes permiso para ver la cartera' using errcode = '42501'; end if;
  return query
    select cl.id, cl.nombre, cl.tipo_doc || ' ' || cl.numero_doc || coalesce('-' || cl.dv, ''), cl.telefono,
           sum(x.s), count(*)::int, max(x.m)::int
    from clientes cl
    join lateral (select saldo_factura(v.id) s, greatest(0, current_date - v.vence_pago) m from ventas v
                  where v.cliente_id = cl.id and v.empresa_id = p_empresa and v.condicion = 'credito' and v.estado = 'cerrada') x on x.s > 0
    where cl.empresa_id = p_empresa
      and (v_q = '' or cl.numero_doc like replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
           or lower(cl.nombre) like '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
    group by cl.id order by max(x.m) desc, cl.nombre limit 8;
end $$;

-- Recibo de caja: el pago del cliente se reparte entre sus facturas a crédito, primero la que vence antes (y la más
-- antigua). No se acepta más de lo que debe. La cajera solo recibe con su turno abierto; el efectivo entra a ese turno.
create or replace function registrar_recibo(p_cliente uuid, p_medio text, p_valor numeric, p_referencia text default null, p_caja uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cl clientes; v_rol text; v_caja uuid; v_turno uuid; f record; v_saldo_total numeric := 0; v_resta numeric; v_toma numeric;
  v_aplicado jsonb := '[]'; v_num integer; v_id bigint; x jsonb; v_ref text := nullif(trim(coalesce(p_referencia, '')), '');
begin
  select * into cl from clientes where id = p_cliente;
  v_rol := case when found then rol_en(cl.empresa_id) end;
  if coalesce(v_rol, '') not in ('dueno', 'admin', 'cajero') then raise exception 'No tienes permiso para recibir pagos en esta droguería' using errcode = '42501'; end if;
  if (select estado from empresas where id = cl.empresa_id) <> 'activa' then raise exception 'La suscripción de esta empresa está suspendida' using errcode = 'P0001'; end if;
  if p_medio is null or p_medio not in ('efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'bre_b', 'qr') then raise exception 'Medio de pago no válido' using errcode = 'P0001'; end if;
  if p_valor is null or p_valor <= 0 or p_valor <> trunc(p_valor) then raise exception 'El pago debe ser un valor en pesos mayor que cero' using errcode = 'P0001'; end if;
  if length(v_ref) > 60 then raise exception 'La referencia va hasta 60 caracteres' using errcode = 'P0001'; end if;
  select c.caja_id, c.turno_id into v_caja, v_turno from caja_y_turno(cl.empresa_id, p_caja) c;
  if v_rol = 'cajero' and v_turno is null then
    raise exception 'Abre el turno de tu caja para recibir abonos (Caja → Turno); si no, lo registra el dueño o el administrador' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('credito:' || cl.id::text));
  v_resta := p_valor;
  for f in
    select v.id, v.prefijo || v.numero factura, v.vence_pago, saldo_factura(v.id) saldo
    from ventas v where v.cliente_id = cl.id and v.empresa_id = cl.empresa_id and v.condicion = 'credito' and v.estado = 'cerrada'
    order by v.vence_pago, v.creado, v.numero for update of v
  loop
    continue when f.saldo <= 0;
    v_saldo_total := v_saldo_total + f.saldo;
    if v_resta > 0 then
      v_toma := least(v_resta, f.saldo);
      v_aplicado := v_aplicado || jsonb_build_object('venta_id', f.id, 'factura', f.factura, 'vence', f.vence_pago, 'valor', v_toma, 'saldo', f.saldo - v_toma);
      v_resta := v_resta - v_toma;
    end if;
  end loop;
  if v_saldo_total = 0 then raise exception 'Este cliente no tiene saldo pendiente' using errcode = 'P0001'; end if;
  if v_resta > 0 then
    raise exception 'El pago (%) supera lo que debe el cliente (%): recibe como máximo el saldo', pesos_texto(p_valor), pesos_texto(v_saldo_total) using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('recibo:' || cl.empresa_id::text));
  select coalesce(max(numero), 0) + 1 into v_num from recibos_caja where empresa_id = cl.empresa_id;
  insert into recibos_caja (empresa_id, numero, cliente_id, medio, valor, referencia, caja_id, turno_id, usuario_id, saldo_anterior, aplicado)
  values (cl.empresa_id, v_num, cl.id, p_medio, p_valor, v_ref, v_caja, v_turno, auth.uid(), v_saldo_total, v_aplicado) returning id into v_id;
  for x in select * from jsonb_array_elements(v_aplicado) loop
    insert into abonos (empresa_id, venta_id, medio, valor, referencia, usuario_id, caja_id, turno_id, recibo_id)
    values (cl.empresa_id, (x ->> 'venta_id')::uuid, p_medio, (x ->> 'valor')::numeric, left('RC-' || v_num || coalesce(' · ' || v_ref, ''), 60), auth.uid(), v_caja, v_turno, v_id);
  end loop;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (cl.empresa_id, auth.uid(), 'recibo_caja', 'clientes', cl.id::text,
          jsonb_build_object('recibo', v_id, 'numero', 'RC-' || v_num, 'valor', p_valor, 'medio', p_medio, 'facturas', jsonb_array_length(v_aplicado)));
  return jsonb_build_object('id', v_id, 'numero', v_num, 'valor', p_valor, 'medio', p_medio, 'aplicado', v_aplicado,
                            'saldo_anterior', v_saldo_total, 'saldo', v_saldo_total - p_valor, 'turno_id', v_turno);
end $$;

-- Anular un recibo de caja: sus abonos quedan anulados (los saldos vuelven) y, si el efectivo ya se había cerrado en un
-- turno anterior, la devolución sale del turno abierto de esa caja (si no, el cierre actual mostraría un sobrante).
create or replace function anular_recibo(p_recibo bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r recibos_caja; v_turno turnos; v_motivo text := trim(coalesce(p_motivo, ''));
begin
  select * into r from recibos_caja where id = p_recibo for update;
  if not found or coalesce(rol_en(r.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador anulan recibos de caja' using errcode = '42501';
  end if;
  if r.anulado then raise exception 'Ese recibo ya está anulado' using errcode = 'P0001'; end if;
  if length(v_motivo) < 4 then raise exception 'Escribe el motivo de la anulación' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('credito:' || r.cliente_id::text));
  update abonos set anulado = true, anulado_motivo = left('Recibo RC-' || r.numero || ' anulado: ' || v_motivo, 200) where recibo_id = r.id and not anulado;
  update recibos_caja set anulado = true, motivo = left(v_motivo, 200), anulado_por = auth.uid(), anulado_en = now() where id = r.id;
  if r.medio = 'efectivo' and r.turno_id is not null and exists (select 1 from turnos where id = r.turno_id and estado = 'cerrado') then
    select * into v_turno from turnos where caja_id = r.caja_id and estado = 'abierto';
    if found then
      insert into movimientos_caja (empresa_id, turno_id, tipo, valor, concepto, usuario_id)
      values (r.empresa_id, v_turno.id, 'egreso', r.valor, left('Devolución por anulación del recibo RC-' || r.numero, 120), auth.uid());
    end if;
  end if;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (r.empresa_id, auth.uid(), 'anular_recibo', 'clientes', r.cliente_id::text, jsonb_build_object('recibo', r.id, 'numero', 'RC-' || r.numero, 'valor', r.valor, 'motivo', v_motivo));
  return credito_cliente(r.cliente_id, 0, true);
end $$;

-- Un abono que es parte de un recibo de caja no se anula suelto: se anula el recibo completo.
create or replace function anular_abono(p_abono bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare a abonos;
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
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (a.empresa_id, auth.uid(), 'anular_abono', 'ventas', a.venta_id::text, jsonb_build_object('abono', p_abono, 'valor', a.valor, 'motivo', p_motivo));
end $$;

-- Abono a una factura: dueño o administrador (como antes) y también la cajera con su turno abierto. Con caja (p_caja), el
-- abono queda en esa caja y en su turno abierto: el efectivo cuenta en ese turno y en ningún otro.
drop function if exists registrar_abono(uuid, text, numeric, text);
create or replace function registrar_abono(p_venta uuid, p_medio text, p_valor numeric, p_referencia text default null, p_caja uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v ventas; v_rol text; v_cli uuid; v_emp uuid; v_abonado numeric; v_saldo numeric; v_caja uuid; v_turno uuid;
begin
  select cliente_id, empresa_id into v_cli, v_emp from ventas where id = p_venta;
  v_rol := case when v_emp is not null then rol_en(v_emp) end;
  if coalesce(v_rol, '') not in ('dueno', 'admin', 'cajero') then
    raise exception 'Solo el dueño o el administrador registran abonos' using errcode = '42501';
  end if;
  select c.caja_id, c.turno_id into v_caja, v_turno from caja_y_turno(v_emp, p_caja) c;
  if v_rol = 'cajero' and v_turno is null then
    raise exception 'Abre el turno de tu caja para recibir abonos (Caja → Turno); si no, lo registra el dueño o el administrador' using errcode = 'P0001';
  end if;
  if v_cli is not null then perform pg_advisory_xact_lock(hashtext('credito:' || v_cli::text)); end if;
  select * into v from ventas where id = p_venta for update;
  if v.condicion <> 'credito' then raise exception 'Esta venta no es a crédito' using errcode = 'P0001'; end if;
  if v.estado <> 'cerrada' then raise exception 'La venta está anulada' using errcode = 'P0001'; end if;
  if p_medio is null or p_medio not in ('efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'bre_b', 'qr') then raise exception 'Medio de pago no válido' using errcode = 'P0001'; end if;
  if p_valor is null or p_valor <= 0 or p_valor <> trunc(p_valor) then raise exception 'El abono debe ser un valor en pesos mayor que cero' using errcode = 'P0001'; end if;
  select coalesce(sum(valor), 0) into v_abonado from abonos where venta_id = p_venta and not anulado;
  v_saldo := saldo_factura(p_venta);
  if p_valor > v_saldo then raise exception 'El abono (%) supera el saldo de la factura (%)', p_valor, v_saldo using errcode = 'P0001'; end if;
  insert into abonos (empresa_id, venta_id, medio, valor, referencia, usuario_id, caja_id, turno_id)
  values (v.empresa_id, p_venta, p_medio, p_valor, nullif(trim(coalesce(p_referencia, '')), ''), auth.uid(), v_caja, v_turno);
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v.empresa_id, auth.uid(), 'abono', 'ventas', p_venta::text, jsonb_build_object('valor', p_valor, 'medio', p_medio, 'caja', v_caja, 'turno', v_turno));
  return jsonb_build_object('abonado', v_abonado + p_valor, 'saldo', v_saldo - p_valor);
end $$;

-- ───────────────────────── Venta (desde 022): cupo, bloqueo y mora del cliente ─────────────────────────
-- Igual que la versión de 022 (descuentos de 019, cajas, IVA, habilitación DIAN, lotes FEFO sin vencidos ni separados);
-- cambia solo la regla de crédito. La fórmula médica (030) sigue aparte, en la misma transacción.
create or replace function registrar_venta(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := (p ->> 'empresa_id')::uuid;
  v_sede uuid := (p ->> 'sede_id')::uuid;
  v_caja uuid := (p ->> 'caja_id')::uuid;
  v_tipo text := coalesce(p ->> 'tipo_doc', 'pos');
  v_user uuid := auth.uid();
  v_rol text;
  v_venta uuid;
  v_existente ventas;
  v_res resoluciones_dian;
  v_num bigint;
  ln jsonb; pg jsonb;
  v_prod productos;
  v_pres text; v_cant numeric; v_unid integer; v_precio numeric;
  v_falta integer; v_toma integer; v_parte numeric;
  r record;
  v_base numeric := 0; v_iva numeric := 0; v_total numeric := 0;
  l_total numeric; l_base numeric; l_iva numeric;
  v_recibido numeric := 0; v_efectivo numeric := 0; v_cambio numeric;
  v_doc uuid;
  v_credito boolean := coalesce(p ->> 'condicion', 'contado') = 'credito';
  v_plazo integer;
  v_linea numeric; v_asignado numeric;
  v_bruto numeric; v_desc_linea numeric; v_desc_asig numeric; l_desc numeric; v_dpct numeric; v_dgen numeric; v_dmax numeric;
  v_cant_asig numeric; l_cant numeric; v_ivapct numeric; v_resp_iva boolean; v_demo boolean;
  v_cli clientes; v_cred jsonb; v_motivo_cred text; v_autoriza boolean := false;
begin
  v_rol := rol_en(v_emp);
  if v_rol is null or v_rol not in ('dueno', 'admin', 'cajero') then
    raise exception 'No tienes permiso para vender en esta empresa' using errcode = '42501';
  end if;
  select responsable_iva, demo into v_resp_iva, v_demo from empresas where id = v_emp;
  if (select estado from empresas where id = v_emp) <> 'activa' then
    raise exception 'La suscripción de esta empresa está suspendida' using errcode = 'P0001';
  end if;
  if not exists (select 1 from cajas where id = v_caja and empresa_id = v_emp and sede_id = v_sede and activa) then
    raise exception 'Caja no válida' using errcode = 'P0001';
  end if;
  if v_tipo not in ('pos', 'factura') then raise exception 'Tipo de documento no válido' using errcode = 'P0001'; end if;
  if v_tipo = 'factura' and (p ->> 'cliente_id') is null then
    raise exception 'La factura electrónica necesita los datos del cliente' using errcode = 'P0001';
  end if;
  -- La factura electrónica se entrega por correo al adquirente: sin un correo válido la DIAN/MATIAS la rechaza.
  if v_tipo = 'factura' and not exists (select 1 from clientes where id = (p ->> 'cliente_id')::uuid and empresa_id = v_emp
      and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'La factura electrónica necesita el correo del cliente: edítalo en sus datos' using errcode = 'P0001';
  end if;
  if (p ->> 'cliente_id') is not null and not exists (select 1 from clientes where id = (p ->> 'cliente_id')::uuid and empresa_id = v_emp) then
    raise exception 'Cliente no válido' using errcode = 'P0001';
  end if;
  if coalesce(p ->> 'condicion', 'contado') not in ('contado', 'credito') then raise exception 'Condición de pago no válida' using errcode = 'P0001'; end if;
  if v_credito then
    -- A crédito, con factura electrónica a un cliente identificado. La cajera fía dentro del cupo del cliente; el dueño o el
    -- administrador pueden pasarse con un motivo que queda en la auditoría (se comprueba con el total, tras las líneas).
    -- El candado por cliente evita que dos cajas fíen a la vez sobre el mismo cupo.
    if v_tipo <> 'factura' then raise exception 'La venta a crédito se hace con factura electrónica' using errcode = 'P0001'; end if;
    select * into v_cli from clientes where id = (p ->> 'cliente_id')::uuid and empresa_id = v_emp;
    perform pg_advisory_xact_lock(hashtext('credito:' || v_cli.id::text));
    v_plazo := coalesce((p ->> 'plazo_dias')::integer, v_cli.plazo_dias_defecto);
    if v_plazo is null or v_plazo < 1 or v_plazo > 180 then raise exception 'El plazo de pago debe estar entre 1 y 180 días' using errcode = 'P0001'; end if;
    if jsonb_array_length(coalesce(p -> 'pagos', '[]')) > 0 then raise exception 'La venta a crédito no lleva pago en caja: registra los abonos en Cartera' using errcode = 'P0001'; end if;
  end if;
  if jsonb_array_length(coalesce(p -> 'lineas', '[]')) = 0 then raise exception 'La venta no tiene productos' using errcode = 'P0001'; end if;
  -- Descuentos: por línea (descuento_pct de cada línea) y general sobre toda la venta (p.descuento_pct). La cajera tiene un
  -- tope (empresas.descuento_max_cajero); el dueño y el administrador no.
  v_dgen := coalesce((p ->> 'descuento_pct')::numeric, 0);
  if v_dgen < 0 or v_dgen >= 100 then raise exception 'El descuento general debe estar entre 0 y 99 %%' using errcode = 'P0001'; end if;
  select descuento_max_cajero into v_dmax from empresas where id = v_emp;

  -- Reintento de una venta ya registrada (la caja volvió a enviarla): se devuelve la misma. El candado sobre la clave
  -- evita que dos envíos simultáneos de la misma venta choquen.
  perform pg_advisory_xact_lock(hashtext(v_emp::text || ':' || (p ->> 'idem_key')));
  select * into v_existente from ventas where empresa_id = v_emp and idem_key = p ->> 'idem_key';
  if found then
    return jsonb_build_object('venta_id', v_existente.id, 'prefijo', v_existente.prefijo, 'numero', v_existente.numero,
                              'total', v_existente.total, 'cambio', v_existente.cambio, 'repetida', true);
  end if;

  -- Numeración de la resolución activa (bloqueo de fila: dos cajas no pueden tomar el mismo número).
  select * into v_res from resoluciones_dian where empresa_id = v_emp and tipo = v_tipo and activa for update;
  if not found then raise exception 'No hay resolución de numeración activa para %', v_tipo using errcode = 'P0001'; end if;
  -- Antes de la habilitación ante la DIAN no se vende de verdad (el documento no tendría validez fiscal). La demo sí.
  if v_res.pruebas and not v_demo then
    raise exception 'Tu droguería aún no está habilitada ante la DIAN: ya puedes cargar productos, inventario y usuarios; la caja vende en cuanto quede cargada tu resolución' using errcode = 'P0001';
  end if;
  if v_res.vigente_hasta is not null and v_res.vigente_hasta < current_date then
    raise exception 'La resolución de numeración venció el %', v_res.vigente_hasta using errcode = 'P0001';
  end if;
  v_num := v_res.actual + 1;
  if v_num > v_res.hasta then raise exception 'Se agotó la numeración autorizada (%-%)', v_res.prefijo, v_res.hasta using errcode = 'P0001'; end if;
  update resoluciones_dian set actual = v_num where id = v_res.id;

  -- Candados por producto en orden fijo (evita bloqueos mutuos con otra venta o un ajuste).
  perform pg_advisory_xact_lock(hashtext(x)) from (select distinct e ->> 'producto_id' x from jsonb_array_elements(p -> 'lineas') e order by 1) s;

  -- La venta se inserta al final, ya con sus totales: las líneas y pagos la referencian con FK diferida.
  v_venta := gen_random_uuid();

  for ln in select * from jsonb_array_elements(p -> 'lineas') loop
    select * into v_prod from productos where id = (ln ->> 'producto_id')::uuid and empresa_id = v_emp and activo;
    if not found then raise exception 'Producto no válido' using errcode = 'P0001'; end if;
    v_pres := coalesce(ln ->> 'presentacion', 'caja');
    v_cant := (ln ->> 'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 or v_cant <> trunc(v_cant) then raise exception 'Cantidad no válida en %', v_prod.nombre using errcode = 'P0001'; end if;
    if v_pres = 'caja' then
      v_unid := v_cant * v_prod.unidades_por_caja; v_precio := v_prod.precio_caja;
    elsif v_pres = 'unidad' then
      if v_prod.precio_unidad is null then raise exception '% no se vende por unidad', v_prod.nombre using errcode = 'P0001'; end if;
      v_unid := v_cant; v_precio := v_prod.precio_unidad;
    else raise exception 'Presentación no válida' using errcode = 'P0001';
    end if;

    -- Lotes con existencias de esta sede, el que vence antes primero (FEFO). Una línea puede repartirse en varios lotes.
    -- Nunca se vende un lote vencido. Bloqueo por producto: dos cajas no pueden descontar el mismo lote a la vez.
    perform pg_advisory_xact_lock(hashtext(v_prod.id::text));
    v_falta := v_unid;
    -- El total de la línea se calcula una vez; el último lote recibe el resto (sin centavos sueltos al repartir).
    v_dpct := coalesce((ln ->> 'descuento_pct')::numeric, 0);
    if v_dpct < 0 or v_dpct >= 100 then raise exception 'Descuento no válido en %', v_prod.nombre using errcode = 'P0001'; end if;
    v_dpct := 100 - (100 - v_dpct) * (100 - v_dgen) / 100;  -- descuento efectivo de la línea (el general se suma encima)
    if v_rol = 'cajero' and v_dpct > v_dmax + 0.001 then
      raise exception 'El descuento de % (% %%) supera el máximo permitido a la cajera (% %%)', v_prod.nombre, round(v_dpct, 2), v_dmax using errcode = '42501';
    end if;
    v_bruto := round(v_precio * v_cant, 2);
    v_linea := case when v_dpct > 0 then round(v_bruto * (100 - v_dpct) / 100, 0) else v_bruto end; v_asignado := 0;  -- con descuento, en pesos enteros
    v_desc_linea := v_bruto - v_linea; v_desc_asig := 0; v_cant_asig := 0;
    -- Quien no es responsable de IVA no lo discrimina: la línea va sin IVA aunque el producto lo tenga.
    v_ivapct := case when v_resp_iva then v_prod.iva else 0 end;
    for r in
      select s.lote_id, s.unidades from v_stock_lotes s
      where s.producto_id = v_prod.id and s.sede_id = v_sede and s.unidades > 0 and (s.vence is null or s.vence >= current_date) and not s.bloqueado
      order by s.vence nulls last, s.lote_id
    loop
      exit when v_falta = 0;
      v_toma := least(v_falta, r.unidades);
      v_parte := v_toma::numeric / v_unid;
      l_total := case when v_toma = v_falta then v_linea - v_asignado else round(v_linea * v_parte, 2) end;
      v_asignado := v_asignado + l_total;
      l_desc := case when v_toma = v_falta then v_desc_linea - v_desc_asig else round(v_desc_linea * v_parte, 2) end;
      v_desc_asig := v_desc_asig + l_desc;
      l_cant := case when v_toma = v_falta then v_cant - v_cant_asig else round(v_cant * v_parte, 3) end; -- sin 0,999 al repartir
      v_cant_asig := v_cant_asig + l_cant;
      l_base := round(l_total / (1 + v_ivapct / 100), 2);
      l_iva := l_total - l_base;
      insert into venta_lineas (empresa_id, venta_id, producto_id, lote_id, descripcion, presentacion, cantidad, unidades,
                                precio, iva_pct, base, iva, total, descuento, descuento_pct)
      values (v_emp, v_venta, v_prod.id, r.lote_id, v_prod.nombre, v_pres, l_cant, v_toma,
              v_precio, v_ivapct, l_base, l_iva, l_total, l_desc, round(v_dpct, 2));
      insert into movimientos (empresa_id, sede_id, producto_id, lote_id, cantidad, tipo, ref_id, usuario_id)
      values (v_emp, v_sede, v_prod.id, r.lote_id, -v_toma, 'venta', v_venta, v_user);
      v_base := v_base + l_base; v_iva := v_iva + l_iva; v_total := v_total + l_total;
      v_falta := v_falta - v_toma;
    end loop;
    if v_falta > 0 then
      if exists (select 1 from v_stock_lotes s where s.producto_id = v_prod.id and s.sede_id = v_sede and s.unidades > 0 and s.bloqueado) then
        raise exception 'No hay existencias vendibles suficientes de % (faltan % unidades; hay lotes separados por una alerta del INVIMA)', v_prod.nombre, v_falta using errcode = 'P0001';
      end if;
      if exists (select 1 from v_stock_lotes s where s.producto_id = v_prod.id and s.sede_id = v_sede and s.unidades > 0 and s.vence < current_date) then
        raise exception 'No hay existencias vigentes suficientes de % (faltan % unidades; lo demás está vencido y no se puede vender)', v_prod.nombre, v_falta using errcode = 'P0001';
      end if;
      raise exception 'No hay existencias suficientes de % (faltan % unidades)', v_prod.nombre, v_falta using errcode = 'P0001';
    end if;
  end loop;

  -- Cupo, bloqueo y mora del cliente, con el total ya calculado.
  if v_credito then
    v_cred := credito_cliente(v_cli.id, v_total, v_rol in ('dueno', 'admin'));
    if not (v_cred ->> 'puede_fiar')::boolean then
      if v_rol not in ('dueno', 'admin') then
        raise exception '%: solo el dueño o el administrador pueden autorizar esta venta a crédito', v_cred ->> 'motivo' using errcode = 'P0001';
      end if;
      v_motivo_cred := left(trim(coalesce(p ->> 'motivo_credito', '')), 200);
      if length(v_motivo_cred) < 4 then
        raise exception '%. Para fiar de todas formas, escribe el motivo de la autorización (queda en la auditoría)', v_cred ->> 'motivo' using errcode = 'P0001';
      end if;
      v_autoriza := true;
    end if;
  end if;

  for pg in select * from jsonb_array_elements(coalesce(p -> 'pagos', '[]')) loop
    if (pg ->> 'valor')::numeric > 0 then
      insert into pagos (empresa_id, venta_id, medio, valor, referencia)
      values (v_emp, v_venta, pg ->> 'medio', (pg ->> 'valor')::numeric, pg ->> 'referencia');
      v_recibido := v_recibido + (pg ->> 'valor')::numeric;
      if pg ->> 'medio' = 'efectivo' then v_efectivo := v_efectivo + (pg ->> 'valor')::numeric; end if;
    end if;
  end loop;
  if not v_credito and v_recibido < v_total then
    raise exception 'El pago (%) no cubre el total (%)', v_recibido, v_total using errcode = 'P0001';
  end if;
  v_cambio := greatest(0, v_recibido - v_total);
  if v_cambio > v_efectivo then
    raise exception 'Solo se da cambio sobre el efectivo recibido' using errcode = 'P0001';
  end if;

  insert into ventas (id, empresa_id, sede_id, caja_id, cliente_id, usuario_id, idem_key, tipo_doc, prefijo, numero,
                      base, iva, total, recibido, cambio, condicion, plazo_dias, vence_pago)
  values (v_venta, v_emp, v_sede, v_caja, (p ->> 'cliente_id')::uuid, v_user, p ->> 'idem_key', v_tipo, v_res.prefijo, v_num,
          v_base, v_iva, v_total, v_recibido, v_cambio, case when v_credito then 'credito' else 'contado' end, v_plazo,
          case when v_credito then current_date + v_plazo end);

  insert into documentos_dian (empresa_id, venta_id, tipo, prefijo, numero)
  values (v_emp, v_venta, v_tipo, v_res.prefijo, v_num) returning id into v_doc;

  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v_emp, v_user, 'venta', 'ventas', v_venta::text, jsonb_build_object('total', v_total, 'numero', v_res.prefijo || v_num, 'credito', v_credito));
  if v_autoriza then
    insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
    values (v_emp, v_user, 'credito_autorizado', 'ventas', v_venta::text, jsonb_build_object('motivo', v_motivo_cred, 'razon', v_cred ->> 'motivo',
            'total', v_total, 'cupo', v_cred -> 'cupo', 'saldo', v_cred -> 'saldo', 'dias_mora', v_cred -> 'dias_mora', 'cliente', v_cli.id, 'numero', v_res.prefijo || v_num));
  end if;

  return jsonb_build_object('venta_id', v_venta, 'documento_id', v_doc, 'prefijo', v_res.prefijo, 'numero', v_num,
                            'base', v_base, 'iva', v_iva, 'total', v_total, 'cambio', v_cambio, 'repetida', false,
                            'credito', v_credito, 'autorizado', v_autoriza, 'vence_pago', case when v_credito then current_date + v_plazo end);
end $$;


-- ───────────────────────── Turno (desde 020): abonos por turno ─────────────────────────
create or replace function resumen_turno(p_turno uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t turnos; v_hasta timestamptz; r jsonb; v_cajas int;
  v_ventas numeric; v_n int; v_anuladas int; v_iva numeric; v_credito numeric; v_efectivo numeric; v_abonos numeric;
  v_ingresos numeric; v_egresos numeric; v_medios jsonb; v_dev numeric; v_dev_ef numeric; v_n_dev int;
  v_abonos_medios jsonb; v_n_recibos int;
begin
  select * into t from turnos where id = p_turno;
  if not found or rol_en(t.empresa_id) is null then raise exception 'Turno no encontrado' using errcode = 'P0002'; end if;
  v_hasta := coalesce(t.cerrado, now());
  select coalesce(sum(total) filter (where estado = 'cerrada'), 0), count(*) filter (where estado = 'cerrada'), count(*) filter (where estado = 'anulada'),
         coalesce(sum(iva) filter (where estado = 'cerrada'), 0), coalesce(sum(total) filter (where estado = 'cerrada' and condicion = 'credito'), 0)
    into v_ventas, v_n, v_anuladas, v_iva, v_credito
    from ventas where caja_id = t.caja_id and creado >= t.abierto and creado < v_hasta;
  select coalesce(jsonb_object_agg(medio, valor), '{}'::jsonb) into v_medios from (
    select p.medio, sum(p.valor) - case when p.medio = 'efectivo' then coalesce((select sum(v2.cambio) from ventas v2 where v2.caja_id = t.caja_id
             and v2.estado = 'cerrada' and v2.creado >= t.abierto and v2.creado < v_hasta), 0) else 0 end as valor
    from pagos p join ventas v on v.id = p.venta_id
    where v.caja_id = t.caja_id and v.estado = 'cerrada' and v.creado >= t.abierto and v.creado < v_hasta group by p.medio) x;
  v_efectivo := coalesce((v_medios ->> 'efectivo')::numeric, 0);
  select count(*) into v_cajas from cajas where empresa_id = t.empresa_id and activa;
  -- Abonos en efectivo: los registrados en este turno (turno_id) y, de los antiguos sin caja ni turno, la regla anterior
  -- (solo si la droguería tiene una sola caja activa). Son conjuntos separados: ningún abono cuenta dos veces.
  select coalesce(sum(valor), 0) into v_abonos from abonos
   where medio = 'efectivo' and not anulado
     and (turno_id = t.id
          or (turno_id is null and caja_id is null and empresa_id = t.empresa_id and creado >= t.abierto and creado < v_hasta and v_cajas = 1));
  select coalesce(jsonb_object_agg(medio, valor), '{}'::jsonb) into v_abonos_medios from (
    select medio, sum(valor) valor from abonos where turno_id = t.id and not anulado and medio <> 'efectivo' group by medio) x;
  select count(*) into v_n_recibos from recibos_caja where turno_id = t.id and not anulado;
  select coalesce(sum(valor) filter (where tipo = 'ingreso'), 0), coalesce(sum(valor) filter (where tipo = 'egreso'), 0)
    into v_ingresos, v_egresos from movimientos_caja where turno_id = t.id;
  select coalesce(sum(total), 0), coalesce(sum(reembolso) filter (where medio = 'efectivo'), 0), count(*)
    into v_dev, v_dev_ef, v_n_dev from devoluciones where caja_id = t.caja_id and creado >= t.abierto and creado < v_hasta;
  r := jsonb_build_object('ventas', v_ventas, 'n_ventas', v_n, 'anuladas', v_anuladas, 'iva', v_iva, 'credito', v_credito, 'medios', v_medios,
    'efectivo_ventas', v_efectivo, 'abonos_efectivo', v_abonos, 'abonos_medios', v_abonos_medios, 'n_recibos', v_n_recibos, 'ingresos', v_ingresos, 'egresos', v_egresos, 'base', t.base,
    'devoluciones', v_dev, 'n_devoluciones', v_n_dev, 'devoluciones_efectivo', v_dev_ef, 'ventas_netas', v_ventas - v_dev,
    'efectivo_esperado', t.base + v_efectivo + v_abonos + v_ingresos - v_egresos - v_dev_ef);
  return r;
end $$;


-- ───────────────────────── Permisos ─────────────────────────
-- Internas: solo las usan las funciones de arriba (corren como dueño de las tablas).
revoke execute on function pesos_texto(numeric), saldo_factura(uuid), credito_cliente(uuid, numeric, boolean), caja_y_turno(uuid, uuid),
  recibo_solo_anular() from public, anon, authenticated;
revoke execute on function estado_credito(uuid, numeric), configurar_credito_cliente(uuid, numeric, integer, boolean, text), configurar_mora(uuid, integer),
  deudores(uuid, text), registrar_recibo(uuid, text, numeric, text, uuid), anular_recibo(bigint, text), anular_abono(bigint, text),
  registrar_abono(uuid, text, numeric, text, uuid), registrar_venta(jsonb), resumen_turno(uuid) from public, anon;
grant execute on function estado_credito(uuid, numeric), configurar_credito_cliente(uuid, numeric, integer, boolean, text), configurar_mora(uuid, integer),
  deudores(uuid, text), registrar_recibo(uuid, text, numeric, text, uuid), anular_recibo(bigint, text), anular_abono(bigint, text),
  registrar_abono(uuid, text, numeric, text, uuid), registrar_venta(jsonb), resumen_turno(uuid) to authenticated;


-- ═════════════ 033a_integracion_bloque2.sql ═════════════
-- Regenta · integración del Bloque 2 (compras 031, mostrador 032, cuentas de clientes 033). 06/11/2026.
--   1. eliminar_empresa_prueba (consola) parte EXACTAMENTE de la versión de 030a y además borra las tablas nuevas, hijos
--      primero: recibos de caja (tras sus abonos), pedidos del mostrador (antes de ventas, clientes, cajas y sedes) y
--      compras, pagos y devoluciones a proveedores (antes de movimientos_caja, turnos, lotes y proveedores).
--   2. Los recibos de caja no se borran nunca, salvo al eliminar una droguería de prueba (misma excepción que no_modificar:
--      solo el servidor, nunca un usuario de la app, y solo para la empresa que se está eliminando).

-- ───────────── 1 · Recibos de caja: la excepción de la consola ─────────────
create or replace function recibo_solo_anular() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if current_user not in ('authenticated', 'anon') and current_setting('regenta.eliminar_empresa', true) = old.empresa_id::text then return old; end if;
    raise exception 'Los recibos de caja no se borran: se anulan' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - 'anulado' - 'motivo' - 'anulado_por' - 'anulado_en') <> (to_jsonb(old) - 'anulado' - 'motivo' - 'anulado_por' - 'anulado_en')
     or old.anulado or not new.anulado then
    raise exception 'Un recibo de caja solo puede anularse' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ───────────── 2 · Eliminar una droguería de prueba (desde 030a) ─────────────
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
  delete from recibos_caja where empresa_id = p_empresa;              -- 033: después de abonos (abonos.recibo_id)
  delete from documentos_dian where empresa_id = p_empresa;
  delete from devolucion_lineas where empresa_id = p_empresa;
  delete from devoluciones where empresa_id = p_empresa;
  -- 032 · Mostrador: antes de ventas, productos, clientes, cajas y sedes.
  delete from pedido_lineas where empresa_id = p_empresa;
  delete from pedidos_mostrador where empresa_id = p_empresa;
  -- 031 · Compras: antes de movimientos_caja y turnos (pagos desde la caja), lotes y proveedores.
  delete from devolucion_proveedor_lineas where empresa_id = p_empresa;
  delete from devoluciones_proveedor where empresa_id = p_empresa;
  delete from pago_aplicaciones where empresa_id = p_empresa;
  delete from pagos_proveedor where empresa_id = p_empresa;
  delete from compra_lineas where empresa_id = p_empresa;
  delete from compras where empresa_id = p_empresa;
  delete from proveedores where empresa_id = p_empresa;
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


insert into regenta_migraciones (nombre) values ('031_compras.sql');
insert into regenta_migraciones (nombre) values ('032_mostrador.sql');
insert into regenta_migraciones (nombre) values ('033_cuentas_clientes.sql');
insert into regenta_migraciones (nombre) values ('033a_integracion_bloque2.sql');
commit;
