-- Regenta: migraciones. Pegar en Supabase → SQL Editor → Run. Se puede correr una sola vez.
begin;
create table regenta_migraciones (nombre text primary key, aplicada timestamptz not null default now());
revoke all on regenta_migraciones from public;

-- 001_base.sql
-- Regenta · esquema base (compatible con Supabase: usa auth.uid() y los roles anon/authenticated).
-- Reglas de diseño:
--   1. Toda fila de negocio lleva empresa_id y la seguridad por fila (RLS) solo deja ver la empresa del usuario.
--   2. El stock no se guarda: se calcula sumando movimientos por lote (cantidades en unidades base).
--   3. Ventas, movimientos y documentos DIAN no se editan ni se borran: se anulan o se corrigen con nota crédito.
--   4. Las ventas solo entran por registrar_venta(): precios, lotes (vencimiento más próximo primero) y numeración
--      los decide la base de datos, nunca el navegador.
--   5. El costo vive aparte (lote_costos) y solo lo ven el dueño y el administrador.

create extension if not exists pgcrypto;

-- ───────────────────────── Empresas, sedes, cajas, usuarios ─────────────────────────
create table empresas (
  id uuid primary key default gen_random_uuid(),
  nit text not null unique,
  dv text,
  razon_social text not null,
  nombre_comercial text,
  plan text not null default 'drogueria' check (plan in ('drogueria', 'drogueria_plus', 'distribuidor')),
  estado text not null default 'activa' check (estado in ('activa', 'suspendida')),
  responsable_iva boolean not null default false,
  ciudad text,
  direccion text,
  telefono text,
  email text,
  creado timestamptz not null default now()
);

create table sedes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  nombre text not null,
  direccion text,
  ciudad text,
  creado timestamptz not null default now()
);

create table cajas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  sede_id uuid not null references sedes on delete cascade,
  nombre text not null,
  activa boolean not null default true
);

create table miembros (
  empresa_id uuid not null references empresas on delete cascade,
  user_id uuid not null,
  nombre text not null,
  rol text not null check (rol in ('dueno', 'admin', 'cajero', 'bodeguero', 'vendedor')),
  activo boolean not null default true,
  creado timestamptz not null default now(),
  primary key (empresa_id, user_id)
);
create index on miembros (user_id);

-- Equipo de Farmagenéricos con acceso a la consola Regenta (se usa desde el servidor con conexión privilegiada).
create table superadmins (user_id uuid primary key, nombre text not null);

-- Rol del usuario actual en una empresa (null si no es miembro activo). Security definer para que las políticas
-- puedan consultarlo sin recursión sobre miembros.
create function rol_en(e uuid) returns text
language sql stable security definer set search_path = public as $$
  select m.rol from miembros m where m.empresa_id = e and m.user_id = auth.uid() and m.activo
$$;

-- ───────────────────────── Catálogo ─────────────────────────
-- Catálogo común de Regenta (precargado por Farmagenéricos). Sin proveedores ni costos.
create table productos_maestro (
  id uuid primary key default gen_random_uuid(),
  ref text unique,                 -- referencia de origen (código FG del catálogo de Farmagenéricos)
  nombre text not null,
  laboratorio text,
  ean text,
  iva numeric(5, 2) not null default 0,
  categoria text,
  busqueda tsvector generated always as (to_tsvector('spanish', coalesce(nombre, '') || ' ' || coalesce(laboratorio, ''))) stored
);
create index on productos_maestro using gin (busqueda);
create index on productos_maestro (ean);

-- El producto tal como lo vende cada empresa. Precios CON IVA (así se exhiben en la droguería).
create table productos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  maestro_id uuid references productos_maestro,
  nombre text not null,
  laboratorio text,
  ean text,
  iva numeric(5, 2) not null default 0 check (iva in (0, 5, 19)),
  categoria text,
  unidades_por_caja integer not null default 1 check (unidades_por_caja >= 1),
  precio_caja numeric(14, 2) not null check (precio_caja >= 0),
  precio_unidad numeric(14, 2) check (precio_unidad >= 0),     -- null = no se vende fraccionado
  stock_minimo integer not null default 0,
  activo boolean not null default true,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  busqueda tsvector generated always as (to_tsvector('spanish', coalesce(nombre, '') || ' ' || coalesce(laboratorio, ''))) stored
);
create index on productos (empresa_id);
create index on productos using gin (busqueda);
create index on productos (empresa_id, ean);
create unique index productos_empresa_maestro on productos (empresa_id, maestro_id) where maestro_id is not null;

-- ───────────────────────── Inventario por lote ─────────────────────────
create table lotes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  sede_id uuid not null references sedes on delete cascade,
  producto_id uuid not null references productos on delete cascade,
  lote text not null,
  vence date,
  creado timestamptz not null default now(),
  unique (sede_id, producto_id, lote)
);
create index on lotes (empresa_id, producto_id);

-- Costo unitario (por unidad base) de cada lote: solo dueño y administrador.
create table lote_costos (
  lote_id uuid primary key references lotes on delete cascade,
  empresa_id uuid not null references empresas on delete cascade,
  costo_unidad numeric(14, 4) not null check (costo_unidad >= 0)
);

-- Cada entrada (+) y salida (−) en unidades base. Fuente única del stock.
create table movimientos (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  sede_id uuid not null references sedes,
  producto_id uuid not null references productos,
  lote_id uuid not null references lotes,
  cantidad integer not null check (cantidad <> 0),
  tipo text not null check (tipo in ('inicial', 'compra', 'venta', 'ajuste', 'devolucion', 'anulacion')),
  ref_id uuid,
  motivo text,
  usuario_id uuid,
  creado timestamptz not null default now()
);
create index on movimientos (lote_id);
create index on movimientos (empresa_id, producto_id);

-- Stock por lote (respeta la RLS de quien consulta).
create view v_stock_lotes with (security_invoker = true) as
  select l.id as lote_id, l.empresa_id, l.sede_id, l.producto_id, l.lote, l.vence,
         coalesce(sum(m.cantidad), 0)::integer as unidades
  from lotes l left join movimientos m on m.lote_id = l.id
  group by l.id;

-- ───────────────────────── Clientes ─────────────────────────
create table clientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  tipo_doc text not null default 'CC' check (tipo_doc in ('CC', 'NIT', 'CE', 'PP', 'TI', 'PEP')),
  numero_doc text not null,
  dv text,
  nombre text not null,
  email text,
  telefono text,
  autoriza_datos boolean not null default false,
  creado timestamptz not null default now(),
  unique (empresa_id, tipo_doc, numero_doc)
);

-- ───────────────────────── DIAN: resoluciones ─────────────────────────
create table resoluciones_dian (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  tipo text not null check (tipo in ('pos', 'factura', 'nota_credito', 'contingencia')),
  numero_resolucion text,
  prefijo text not null default '',
  desde bigint not null,
  hasta bigint not null,
  actual bigint not null,             -- último número usado (desde − 1 al crearla)
  vigente_desde date,
  vigente_hasta date,
  activa boolean not null default true,
  pruebas boolean not null default true,  -- numeración de habilitación (pruebas DIAN)
  check (desde <= hasta and actual >= desde - 1 and actual <= hasta)
);
create unique index resolucion_activa on resoluciones_dian (empresa_id, tipo) where activa;

-- ───────────────────────── Ventas ─────────────────────────
create table ventas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  sede_id uuid not null references sedes,
  caja_id uuid not null references cajas,
  cliente_id uuid references clientes,
  usuario_id uuid not null,
  idem_key text not null,             -- clave de idempotencia: la caja reintenta sin duplicar (venta sin conexión)
  tipo_doc text not null check (tipo_doc in ('pos', 'factura')),
  prefijo text not null,
  numero bigint not null,
  base numeric(14, 2) not null,
  iva numeric(14, 2) not null,
  total numeric(14, 2) not null,
  recibido numeric(14, 2) not null,
  cambio numeric(14, 2) not null,
  estado text not null default 'cerrada' check (estado in ('cerrada', 'anulada')),
  creado timestamptz not null default now(),
  unique (empresa_id, idem_key),
  unique (empresa_id, tipo_doc, prefijo, numero)
);
create index on ventas (empresa_id, creado desc);

create table venta_lineas (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  venta_id uuid not null references ventas on delete restrict deferrable initially deferred,
  producto_id uuid not null references productos,
  lote_id uuid not null references lotes,
  descripcion text not null,
  presentacion text not null check (presentacion in ('caja', 'unidad')),
  cantidad numeric(14, 3) not null check (cantidad > 0),   -- en la presentación vendida
  unidades integer not null check (unidades > 0),         -- en unidades base, para el inventario
  precio numeric(14, 2) not null,                          -- precio unitario de la presentación, con IVA
  iva_pct numeric(5, 2) not null,
  base numeric(14, 2) not null,
  iva numeric(14, 2) not null,
  total numeric(14, 2) not null
);
create index on venta_lineas (venta_id);

create table pagos (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  venta_id uuid not null references ventas on delete restrict deferrable initially deferred,
  medio text not null check (medio in ('efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'bre_b')),
  valor numeric(14, 2) not null check (valor > 0),
  referencia text
);
create index on pagos (venta_id);

-- ───────────────────────── DIAN: documentos y cola ─────────────────────────
create table documentos_dian (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  venta_id uuid references ventas on delete restrict,
  tipo text not null check (tipo in ('pos', 'factura', 'nota_credito')),
  prefijo text not null,
  numero bigint not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviando', 'aceptado', 'rechazado', 'anulado')),
  cufe text,
  qr text,
  intentos integer not null default 0,
  proximo_intento timestamptz not null default now(),
  ultimo_error text,
  respuesta jsonb,
  xml_path text,
  pdf_path text,
  simulado boolean not null default false,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  unique (empresa_id, tipo, prefijo, numero)
);
create index documentos_cola on documentos_dian (proximo_intento) where estado in ('pendiente', 'rechazado');

-- ───────────────────────── Auditoría ─────────────────────────
create table auditoria (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  usuario_id uuid,
  accion text not null,
  entidad text not null,
  entidad_id text,
  datos jsonb,
  creado timestamptz not null default now()
);
create index on auditoria (empresa_id, creado desc);

-- ───────────────────────── Inmutabilidad ─────────────────────────
create function no_modificar() returns trigger language plpgsql as $$
begin
  raise exception 'Los registros de % no se modifican ni se borran', tg_table_name using errcode = 'P0001';
end $$;
create trigger movimientos_inmutables before update or delete on movimientos for each row execute function no_modificar();
create trigger lineas_inmutables before update or delete on venta_lineas for each row execute function no_modificar();
create trigger pagos_inmutables before update or delete on pagos for each row execute function no_modificar();
create trigger auditoria_inmutable before update or delete on auditoria for each row execute function no_modificar();

-- Una venta solo puede pasar de «cerrada» a «anulada»; nada más cambia.
create function venta_solo_anular() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Las ventas no se borran' using errcode = 'P0001'; end if;
  if (to_jsonb(new) - 'estado') <> (to_jsonb(old) - 'estado') or not (old.estado = 'cerrada' and new.estado = 'anulada') then
    raise exception 'Una venta solo puede anularse' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger ventas_inmutables before update or delete on ventas for each row execute function venta_solo_anular();

-- Precio cambiado = auditoría.
create function auditar_producto() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.precio_caja is distinct from old.precio_caja or new.precio_unidad is distinct from old.precio_unidad then
    insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
    values (new.empresa_id, auth.uid(), 'cambio_precio', 'productos', new.id::text,
            jsonb_build_object('antes', jsonb_build_object('caja', old.precio_caja, 'unidad', old.precio_unidad),
                               'despues', jsonb_build_object('caja', new.precio_caja, 'unidad', new.precio_unidad)));
  end if;
  new.actualizado := now();
  return new;
end $$;
create trigger productos_auditoria before update on productos for each row execute function auditar_producto();

-- ───────────────────────── Registrar una venta ─────────────────────────
-- p = { empresa_id, sede_id, caja_id, idem_key, tipo_doc: 'pos'|'factura', cliente_id?,
--       lineas: [{ producto_id, presentacion: 'caja'|'unidad', cantidad }],
--       pagos:  [{ medio, valor, referencia? }] }
create function registrar_venta(p jsonb) returns jsonb
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
begin
  v_rol := rol_en(v_emp);
  if v_rol is null or v_rol not in ('dueno', 'admin', 'cajero') then
    raise exception 'No tienes permiso para vender en esta empresa' using errcode = '42501';
  end if;
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
  if (p ->> 'cliente_id') is not null and not exists (select 1 from clientes where id = (p ->> 'cliente_id')::uuid and empresa_id = v_emp) then
    raise exception 'Cliente no válido' using errcode = 'P0001';
  end if;
  if jsonb_array_length(coalesce(p -> 'lineas', '[]')) = 0 then raise exception 'La venta no tiene productos' using errcode = 'P0001'; end if;

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
    for r in
      select s.lote_id, s.unidades from v_stock_lotes s
      where s.producto_id = v_prod.id and s.sede_id = v_sede and s.unidades > 0 and (s.vence is null or s.vence >= current_date)
      order by s.vence nulls last, s.lote_id
    loop
      exit when v_falta = 0;
      v_toma := least(v_falta, r.unidades);
      v_parte := v_toma::numeric / v_unid;
      l_total := round(v_precio * v_cant * v_parte, 2);
      l_base := round(l_total / (1 + v_prod.iva / 100), 2);
      l_iva := l_total - l_base;
      insert into venta_lineas (empresa_id, venta_id, producto_id, lote_id, descripcion, presentacion, cantidad, unidades,
                                precio, iva_pct, base, iva, total)
      values (v_emp, v_venta, v_prod.id, r.lote_id, v_prod.nombre, v_pres, round(v_cant * v_parte, 3), v_toma,
              v_precio, v_prod.iva, l_base, l_iva, l_total);
      insert into movimientos (empresa_id, sede_id, producto_id, lote_id, cantidad, tipo, ref_id, usuario_id)
      values (v_emp, v_sede, v_prod.id, r.lote_id, -v_toma, 'venta', v_venta, v_user);
      v_base := v_base + l_base; v_iva := v_iva + l_iva; v_total := v_total + l_total;
      v_falta := v_falta - v_toma;
    end loop;
    if v_falta > 0 then
      if exists (select 1 from v_stock_lotes s where s.producto_id = v_prod.id and s.sede_id = v_sede and s.unidades > 0 and s.vence < current_date) then
        raise exception 'No hay existencias vigentes suficientes de % (faltan % unidades; lo demás está vencido y no se puede vender)', v_prod.nombre, v_falta using errcode = 'P0001';
      end if;
      raise exception 'No hay existencias suficientes de % (faltan % unidades)', v_prod.nombre, v_falta using errcode = 'P0001';
    end if;
  end loop;

  for pg in select * from jsonb_array_elements(coalesce(p -> 'pagos', '[]')) loop
    if (pg ->> 'valor')::numeric > 0 then
      insert into pagos (empresa_id, venta_id, medio, valor, referencia)
      values (v_emp, v_venta, pg ->> 'medio', (pg ->> 'valor')::numeric, pg ->> 'referencia');
      v_recibido := v_recibido + (pg ->> 'valor')::numeric;
      if pg ->> 'medio' = 'efectivo' then v_efectivo := v_efectivo + (pg ->> 'valor')::numeric; end if;
    end if;
  end loop;
  if v_recibido < v_total then
    raise exception 'El pago (%) no cubre el total (%)', v_recibido, v_total using errcode = 'P0001';
  end if;
  v_cambio := v_recibido - v_total;
  if v_cambio > v_efectivo then
    raise exception 'Solo se da cambio sobre el efectivo recibido' using errcode = 'P0001';
  end if;

  insert into ventas (id, empresa_id, sede_id, caja_id, cliente_id, usuario_id, idem_key, tipo_doc, prefijo, numero,
                      base, iva, total, recibido, cambio)
  values (v_venta, v_emp, v_sede, v_caja, (p ->> 'cliente_id')::uuid, v_user, p ->> 'idem_key', v_tipo, v_res.prefijo, v_num,
          v_base, v_iva, v_total, v_recibido, v_cambio);

  insert into documentos_dian (empresa_id, venta_id, tipo, prefijo, numero)
  values (v_emp, v_venta, v_tipo, v_res.prefijo, v_num) returning id into v_doc;

  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v_emp, v_user, 'venta', 'ventas', v_venta::text, jsonb_build_object('total', v_total, 'numero', v_res.prefijo || v_num));

  return jsonb_build_object('venta_id', v_venta, 'documento_id', v_doc, 'prefijo', v_res.prefijo, 'numero', v_num,
                            'base', v_base, 'iva', v_iva, 'total', v_total, 'cambio', v_cambio, 'repetida', false);
end $$;

insert into regenta_migraciones (nombre) values ('001_base.sql');

-- 002_seguridad.sql
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

insert into regenta_migraciones (nombre) values ('002_seguridad.sql');

-- 003_comercial.sql
-- Regenta · solicitudes de demo desde la página comercial (las escribe el servidor; nadie las lee desde el navegador).
create table solicitudes_demo (
  id bigint generated always as identity primary key,
  nombre text not null,
  drogueria text not null,
  ciudad text,
  telefono text not null,
  email text,
  cajas text,
  mensaje text,
  origen text,
  creado timestamptz not null default now()
);
alter table solicitudes_demo enable row level security;
revoke all on solicitudes_demo from anon, authenticated;

insert into regenta_migraciones (nombre) values ('003_comercial.sql');

-- 004_prediccion.sql
-- Regenta · predicción con los datos de la propia droguería.
-- Todo se calcula con los movimientos reales (ventas menos anulaciones). Las funciones son security invoker:
-- la seguridad por fila decide qué ve cada usuario (los costos solo los ve dueño/administrador).

-- Ritmo de venta por producto: unidades/día de los últimos 56 días, con más peso a los últimos 14
-- (60 % los 14 días recientes, 40 % los 42 anteriores) para que reaccione a cambios sin saltar por un día raro.
create function prediccion_productos(p_empresa uuid, p_dias_reposicion integer default 3, p_dias_cobertura integer default 15)
returns table (
  producto_id uuid, nombre text, laboratorio text, unidades_por_caja integer, stock_minimo integer,
  existencias integer, venta_dia numeric, dias_cobertura numeric, tendencia numeric,
  sugerido_unidades integer, sugerido_cajas integer, ultima_venta date
)
language sql stable security invoker set search_path = public as $$
  with ventas as (
    select m.producto_id,
           -sum(m.cantidad) filter (where m.creado >= now() - interval '14 days') u14,
           -sum(m.cantidad) filter (where m.creado < now() - interval '14 days') u42,
           max(m.creado) filter (where m.tipo = 'venta') ultima
    from movimientos m
    where m.empresa_id = p_empresa and m.tipo in ('venta', 'anulacion') and m.creado >= now() - interval '56 days'
    group by m.producto_id
  ), stock as (
    select s.producto_id, sum(s.unidades) filter (where s.vence is null or s.vence >= current_date)::integer unidades
    from v_stock_lotes s where s.empresa_id = p_empresa group by s.producto_id
  ), base as (
    select p.id, p.nombre, p.laboratorio, p.unidades_por_caja, p.stock_minimo,
           coalesce(st.unidades, 0) existencias,
           round(0.6 * coalesce(v.u14, 0) / 14.0 + 0.4 * coalesce(v.u42, 0) / 42.0, 3) venta_dia,
           case when coalesce(v.u42, 0) > 0 then round((coalesce(v.u14, 0) / 14.0) / (v.u42 / 42.0), 2) end tendencia,
           (v.ultima at time zone 'America/Bogota')::date ultima
    from productos p
    left join ventas v on v.producto_id = p.id
    left join stock st on st.producto_id = p.id
    where p.empresa_id = p_empresa and p.activo
  )
  select b.id, b.nombre, b.laboratorio, b.unidades_por_caja, b.stock_minimo, b.existencias, b.venta_dia,
         case when b.venta_dia > 0 then round(b.existencias / b.venta_dia, 1) end,
         b.tendencia,
         -- lo necesario para cubrir reposición + cobertura, sin bajar del mínimo (en cajas), redondeado a cajas completas
         n.unidades, ceil(n.unidades::numeric / b.unidades_por_caja)::integer, b.ultima
  from base b
  cross join lateral (select greatest(0, ceil(greatest(b.venta_dia * (p_dias_reposicion + p_dias_cobertura), b.stock_minimo * b.unidades_por_caja) - b.existencias))::integer unidades) n
$$;

-- Riesgo de vencimiento por lote: con el ritmo de venta actual y vendiendo primero lo que vence antes (FEFO),
-- cuántas unidades de cada lote NO alcanzarán a venderse antes de su fecha. Valor a costo solo si el usuario lo puede ver.
create function riesgo_vencimiento(p_empresa uuid)
returns table (
  lote_id uuid, producto_id uuid, nombre text, laboratorio text, unidades_por_caja integer, lote text, vence date,
  dias integer, unidades integer, venta_dia numeric, unidades_en_riesgo integer, costo_unidad numeric, valor_en_riesgo numeric
)
language sql stable security invoker set search_path = public as $$
  with ritmo as (select producto_id, venta_dia from prediccion_productos(p_empresa)),
  lotes as (
    select s.lote_id, s.producto_id, s.lote, s.vence, s.unidades,
           coalesce(sum(s.unidades) over (partition by s.producto_id order by s.vence, s.lote_id rows between unbounded preceding and 1 preceding), 0) antes
    from v_stock_lotes s
    where s.empresa_id = p_empresa and s.unidades > 0 and s.vence is not null and s.vence >= current_date
  )
  select l.lote_id, l.producto_id, p.nombre, p.laboratorio, p.unidades_por_caja, l.lote, l.vence, (l.vence - current_date)::integer,
         l.unidades, r.venta_dia, x.riesgo, lc.costo_unidad, x.riesgo * lc.costo_unidad
  from lotes l
  join productos p on p.id = l.producto_id
  join ritmo r on r.producto_id = l.producto_id
  left join lote_costos lc on lc.lote_id = l.lote_id
  cross join lateral (select (l.unidades - least(l.unidades, greatest(0, floor(r.venta_dia * (l.vence - current_date) - l.antes))))::integer riesgo) x
  where x.riesgo > 0 and l.vence <= current_date + 180
$$;

grant execute on function prediccion_productos(uuid, integer, integer) to authenticated;
grant execute on function riesgo_vencimiento(uuid) to authenticated;

insert into regenta_migraciones (nombre) values ('004_prediccion.sql');

-- 005_invima.sql
-- Regenta · alertas sanitarias del INVIMA cruzadas con el inventario de cada droguería.
-- Las alertas son públicas y comunes a todas las empresas (las carga el servidor desde invima.gov.co).
-- El cruce se hace por tres caminos, de más a menos seguro:
--   lote     → tienes en existencias un lote que la alerta nombra (y el producto coincide por registro o por nombre)
--   registro → el registro sanitario de tu producto es el de la alerta
--   nombre   → tu producto contiene las palabras clave del producto alertado: hay que revisarlo

alter table productos add column registro_sanitario text;
alter table productos_maestro add column registro_sanitario text;

create table alertas_invima (
  id bigint generated always as identity primary key,
  numero text not null unique,                 -- 329-2026
  tipo text not null check (tipo in ('alerta', 'informe')),
  titulo text not null,
  motivo text,                                 -- «Producto fraudulento», «Producto defectuoso»…
  fecha date not null,
  url text not null,
  pdf text,
  direccion text not null default 'medicamentos',
  registros text[] not null default '{}',      -- normalizados: INVIMA 2020M-003171-R4
  lotes text[] not null default '{}',          -- en mayúsculas
  palabras text[] not null default '{}',       -- palabras clave del producto, en minúsculas y sin tildes
  resumen text,
  recomendacion text,
  creado timestamptz not null default now()
);
create index on alertas_invima (fecha desc);
alter table alertas_invima enable row level security;
create policy alertas_lectura on alertas_invima for select to authenticated using (true);
grant select on alertas_invima to authenticated;

-- Lo que hizo la droguería con cada alerta (evidencia para la visita de la secretaría de salud).
create table alertas_revision (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  alerta_id bigint not null references alertas_invima on delete cascade,
  producto_id uuid references productos,
  resultado text not null check (resultado in ('no_aplica', 'sin_lote', 'separado')),
  nota text,
  usuario_id uuid not null default auth.uid(),
  creado timestamptz not null default now()
);
create index on alertas_revision (empresa_id, alerta_id);
alter table alertas_revision enable row level security;
create policy revision_ver on alertas_revision for select to authenticated using (rol_en(empresa_id) is not null);
create policy revision_crear on alertas_revision for insert to authenticated
  with check (rol_en(empresa_id) in ('dueno', 'admin', 'bodeguero') and usuario_id = auth.uid());
grant select, insert on alertas_revision to authenticated;
grant usage on sequence alertas_revision_id_seq to authenticated;
create trigger alertas_revision_inmutable before update or delete on alertas_revision for each row execute function no_modificar();

create function sin_tildes(t text) returns text language sql immutable as $$
  select translate(lower(t), 'áéíóúüñ', 'aeiouun')
$$;
create function norm_registro(t text) returns text language sql immutable as $$
  select upper(regexp_replace(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g'), '^\s+|\s+$', '', 'g'))
$$;

-- Cruce de alertas con los productos de la empresa (seguridad por fila: solo ve su empresa).
create function alertas_empresa(p_empresa uuid, p_dias integer default 365)
returns table (
  alerta_id bigint, numero text, tipo text, titulo text, motivo text, fecha date, url text, pdf text, recomendacion text,
  producto_id uuid, producto text, nivel text, lote text, unidades integer, revisada text, revisada_el timestamptz
)
language sql stable security invoker set search_path = public as $$
  with a as (select * from alertas_invima where fecha >= current_date - p_dias),
  cand as (
    select a.id, p.id producto_id, p.nombre,
           (norm_registro(p.registro_sanitario) = any (a.registros)) por_registro,
           (cardinality(a.palabras) > 0 and (select bool_and(sin_tildes(p.nombre) like '%' || w || '%') from unnest(a.palabras) w)) por_nombre
    from a join productos p on p.empresa_id = p_empresa and p.activo
  ), m as (
    select c.id, c.producto_id, c.nombre, c.por_registro,
           (select s.lote from v_stock_lotes s join alertas_invima x on x.id = c.id
             where s.producto_id = c.producto_id and s.unidades > 0 and upper(s.lote) = any (x.lotes) limit 1) lote_hit
    from cand c where c.por_registro or c.por_nombre
  )
  select a.id, a.numero, a.tipo, a.titulo, a.motivo, a.fecha, a.url, a.pdf, a.recomendacion,
         m.producto_id, m.nombre,
         case when m.lote_hit is not null then 'lote' when m.por_registro then 'registro' when m.producto_id is not null then 'nombre' end,
         m.lote_hit,
         case when m.lote_hit is not null then (select sum(s.unidades)::integer from v_stock_lotes s where s.producto_id = m.producto_id and upper(s.lote) = m.lote_hit) end,
         r.resultado, r.creado
  from a
  left join m on m.id = a.id
  left join lateral (select resultado, creado from alertas_revision r where r.empresa_id = p_empresa and r.alerta_id = a.id
                     and (r.producto_id is not distinct from m.producto_id) order by r.creado desc limit 1) r on true
$$;
grant execute on function alertas_empresa(uuid, integer) to authenticated;

insert into regenta_migraciones (nombre) values ('005_invima.sql');

-- 006_patron.sql
-- Regenta · patrón semanal de ventas de la droguería: qué días vende más o menos que su promedio (últimas 8 semanas).
create function patron_semanal(p_empresa uuid)
returns table (dia integer, nombre text, ventas_promedio numeric, frente_al_promedio integer)
language sql stable security invoker set search_path = public as $$
  with d as (
    select g::date fecha, extract(isodow from g)::int dia from generate_series(current_date - 56, current_date - 1, '1 day') g
  ), v as (
    select (creado at time zone 'America/Bogota')::date fecha, sum(total) total from ventas
    where empresa_id = p_empresa and estado = 'cerrada' and creado >= now() - interval '57 days' group by 1
  ), x as (
    select d.dia, avg(coalesce(v.total, 0)) prom from d left join v on v.fecha = d.fecha group by d.dia
  )
  select x.dia, (array['lunes','martes','miércoles','jueves','viernes','sábado','domingo'])[x.dia], round(x.prom),
         case when avg(x.prom) over () > 0 then round(100 * (x.prom / avg(x.prom) over () - 1))::int end
  from x order by x.dia
$$;
grant execute on function patron_semanal(uuid) to authenticated;

insert into regenta_migraciones (nombre) values ('006_patron.sql');

-- 007_correcciones.sql
-- Regenta · correcciones de la revisión de código del 1/11/2026.

-- «Hoy» es el día de Bogotá, no el del servidor (Supabase corre en UTC: de 7 p. m. a medianoche ya sería mañana).
do $$ begin execute format('alter database %I set timezone = %L', current_database(), 'America/Bogota'); end $$;
set timezone = 'America/Bogota';

-- Índices para las consultas por producto y por venta.
create index if not exists lotes_producto on lotes (producto_id, sede_id);
create index if not exists documentos_venta on documentos_dian (venta_id);

-- Existencias que se pueden vender (sin lotes vencidos): una sola definición para todas las pantallas.
create view v_stock_vigente with (security_invoker = true) as
  select * from v_stock_lotes where vence is null or vence >= current_date;
grant select on v_stock_vigente to authenticated;

-- Idempotencia de entradas de inventario (la usa registrar_entrada).
create table entradas_idem (
  empresa_id uuid not null references empresas on delete cascade,
  idem_key text not null,
  resultado jsonb not null,
  creado timestamptz not null default now(),
  primary key (empresa_id, idem_key)
);
alter table entradas_idem enable row level security;

-- Precios en pesos enteros: la caja cobra en pesos y los medios electrónicos no admiten centavos.
alter table productos add constraint precio_caja_entero check (precio_caja = trunc(precio_caja));
alter table productos add constraint precio_unidad_entero check (precio_unidad is null or precio_unidad = trunc(precio_unidad));

-- Registro sanitario normalizado igual que en las alertas («2020m-3171-r4» → «INVIMA 2020M-3171-R4»).
create or replace function norm_registro(t text) returns text language sql immutable as $$
  select case when m is null then nullif(upper(trim(coalesce(t, ''))), '')
              else 'INVIMA ' || m[1] || 'M-' || m[2] || coalesce('-R' || m[3], '') end
  from (select regexp_match(upper(coalesce(t, '')), '(?:INVIMA\s*)?(\d{4})\s*M\s*-\s*(\d{3,8})(?:\s*-\s*R\s*(\d+))?') m) x
$$;
create function normalizar_registro_producto() returns trigger language plpgsql as $$
begin new.registro_sanitario := norm_registro(new.registro_sanitario); return new; end $$;
create trigger productos_registro before insert or update of registro_sanitario on productos for each row execute function normalizar_registro_producto();

-- Una revisión de alerta solo puede citar productos de la misma empresa.
drop policy revision_crear on alertas_revision;
create policy revision_crear on alertas_revision for insert to authenticated
  with check (rol_en(empresa_id) in ('dueno', 'admin', 'bodeguero') and usuario_id = auth.uid()
              and (producto_id is null or exists (select 1 from productos p where p.id = producto_id and p.empresa_id = alertas_revision.empresa_id)));

-- Alertas del INVIMA ya vistas que no son de medicamentos (para no volver a descargarlas).
create table invima_descartadas (numero text primary key, creado timestamptz not null default now());

-- Empresas de demostración: cualquiera puede entrar, nadie puede romperlas (ni sus usuarios ni sus datos de empresa).
alter table empresas add column demo boolean not null default false;
create function proteger_demo() returns trigger language plpgsql as $$
declare e uuid := coalesce(old.empresa_id, new.empresa_id);
begin
  if current_user = 'authenticated' and exists (select 1 from empresas where id = e and demo) then
    raise exception 'En la demostración no se pueden cambiar los usuarios' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger miembros_demo before insert or update or delete on miembros for each row execute function proteger_demo();
create function proteger_empresa_demo() returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' and old.demo then raise exception 'En la demostración no se pueden cambiar los datos de la empresa' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger empresas_demo before update on empresas for each row execute function proteger_empresa_demo();

-- Ritmo de venta sin las ventas anuladas (antes la anulación restaba en la fecha en que se anulaba).
create or replace function prediccion_productos(p_empresa uuid, p_dias_reposicion integer default 3, p_dias_cobertura integer default 15)
returns table (
  producto_id uuid, nombre text, laboratorio text, unidades_por_caja integer, stock_minimo integer,
  existencias integer, venta_dia numeric, dias_cobertura numeric, tendencia numeric,
  sugerido_unidades integer, sugerido_cajas integer, ultima_venta date
)
language sql stable security invoker set search_path = public as $$
  with vend as (
    select m.producto_id,
           -sum(m.cantidad) filter (where m.creado >= now() - interval '14 days') u14,
           -sum(m.cantidad) filter (where m.creado < now() - interval '14 days') u42,
           max(m.creado) ultima
    from movimientos m join ventas v on v.id = m.ref_id and v.estado = 'cerrada'
    where m.empresa_id = p_empresa and m.tipo = 'venta' and m.creado >= now() - interval '56 days'
    group by m.producto_id
  ), stock as (
    select s.producto_id, sum(s.unidades)::integer unidades from v_stock_vigente s where s.empresa_id = p_empresa group by s.producto_id
  ), base as (
    select p.id, p.nombre, p.laboratorio, p.unidades_por_caja, p.stock_minimo,
           coalesce(st.unidades, 0) existencias,
           round(0.6 * coalesce(v.u14, 0) / 14.0 + 0.4 * coalesce(v.u42, 0) / 42.0, 3) venta_dia,
           case when coalesce(v.u42, 0) > 0 then round((coalesce(v.u14, 0) / 14.0) / (v.u42 / 42.0), 2) end tendencia,
           (v.ultima at time zone 'America/Bogota')::date ultima
    from productos p
    left join vend v on v.producto_id = p.id
    left join stock st on st.producto_id = p.id
    where p.empresa_id = p_empresa and p.activo
  )
  select b.id, b.nombre, b.laboratorio, b.unidades_por_caja, b.stock_minimo, b.existencias, b.venta_dia,
         case when b.venta_dia > 0 then round(b.existencias / b.venta_dia, 1) end,
         b.tendencia, n.unidades, ceil(n.unidades::numeric / b.unidades_por_caja)::integer, b.ultima
  from base b
  cross join lateral (select greatest(0, ceil(greatest(b.venta_dia * (p_dias_reposicion + p_dias_cobertura), b.stock_minimo * b.unidades_por_caja) - b.existencias))::integer unidades) n
$$;

insert into regenta_migraciones (nombre) values ('007_correcciones.sql');

-- 008_credito.sql
-- Regenta · venta a crédito, cartera y abonos (facturación para distribuidoras y droguerías que fían a clientes con NIT).

alter table ventas add column condicion text not null default 'contado' check (condicion in ('contado', 'credito'));
alter table ventas add column plazo_dias integer check (plazo_dias between 1 and 180);
alter table ventas add column vence_pago date;
alter table ventas add constraint credito_completo check (condicion = 'contado' or (plazo_dias is not null and vence_pago is not null and cliente_id is not null and tipo_doc = 'factura'));

-- Abonos a facturas a crédito. Inmutables: un abono mal registrado se anula con otro registro (anulado = true), nunca se borra.
create table abonos (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  venta_id uuid not null references ventas on delete restrict,
  medio text not null check (medio in ('efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'bre_b')),
  valor numeric(14, 2) not null check (valor > 0 and valor = trunc(valor)),
  referencia text check (length(referencia) <= 60),
  usuario_id uuid not null,
  creado timestamptz not null default now()
);
create index abonos_venta on abonos (venta_id);
create index ventas_credito on ventas (empresa_id, vence_pago) where condicion = 'credito';
alter table abonos enable row level security;
create policy gerencia_lee on abonos for select to authenticated using (rol_en(empresa_id) in ('dueno', 'admin'));
grant select on abonos to authenticated;

-- Cartera: facturas a crédito vigentes con lo abonado, el saldo y los días de mora. Solo la ve la gerencia (RLS de abonos y
-- filtro por rol: el cajero vende, no cobra cartera).
create view v_cartera with (security_invoker = true) as
  select v.id venta_id, v.empresa_id, v.prefijo, v.numero, v.creado, v.vence_pago, v.plazo_dias, v.total,
         c.id cliente_id, c.nombre cliente, c.tipo_doc, c.numero_doc, c.dv, c.telefono, c.email,
         coalesce(a.abonado, 0) abonado, v.total - coalesce(a.abonado, 0) saldo,
         greatest(0, current_date - v.vence_pago) dias_mora
  from ventas v
  join clientes c on c.id = v.cliente_id
  left join (select venta_id, sum(valor) abonado from abonos group by venta_id) a on a.venta_id = v.id
  where v.condicion = 'credito' and v.estado = 'cerrada' and rol_en(v.empresa_id) in ('dueno', 'admin');
grant select on v_cartera to authenticated;

-- Registrar un abono: nunca más que el saldo; candado por venta para que dos abonos simultáneos no lo superen.
create function registrar_abono(p_venta uuid, p_medio text, p_valor numeric, p_referencia text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v ventas; v_abonado numeric; v_saldo numeric;
begin
  select * into v from ventas where id = p_venta for update;
  if not found or coalesce(rol_en(v.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador registran abonos' using errcode = '42501';
  end if;
  if v.condicion <> 'credito' then raise exception 'Esta venta no es a crédito' using errcode = 'P0001'; end if;
  if v.estado <> 'cerrada' then raise exception 'La venta está anulada' using errcode = 'P0001'; end if;
  if p_valor is null or p_valor <= 0 or p_valor <> trunc(p_valor) then raise exception 'El abono debe ser un valor en pesos mayor que cero' using errcode = 'P0001'; end if;
  select coalesce(sum(valor), 0) into v_abonado from abonos where venta_id = p_venta;
  v_saldo := v.total - v_abonado;
  if p_valor > v_saldo then raise exception 'El abono (%) supera el saldo de la factura (%)', p_valor, v_saldo using errcode = 'P0001'; end if;
  insert into abonos (empresa_id, venta_id, medio, valor, referencia, usuario_id)
  values (v.empresa_id, p_venta, p_medio, p_valor, nullif(trim(coalesce(p_referencia, '')), ''), auth.uid());
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v.empresa_id, auth.uid(), 'abono', 'ventas', p_venta::text, jsonb_build_object('valor', p_valor, 'medio', p_medio));
  return jsonb_build_object('abonado', v_abonado + p_valor, 'saldo', v_saldo - p_valor);
end $$;
revoke execute on function registrar_abono(uuid, text, numeric, text) from public;
grant execute on function registrar_abono(uuid, text, numeric, text) to authenticated;

-- Venta: acepta condición 'credito' (con plazo, factura y cliente; sin pago en caja).
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
begin
  v_rol := rol_en(v_emp);
  if v_rol is null or v_rol not in ('dueno', 'admin', 'cajero') then
    raise exception 'No tienes permiso para vender en esta empresa' using errcode = '42501';
  end if;
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
  if (p ->> 'cliente_id') is not null and not exists (select 1 from clientes where id = (p ->> 'cliente_id')::uuid and empresa_id = v_emp) then
    raise exception 'Cliente no válido' using errcode = 'P0001';
  end if;
  if coalesce(p ->> 'condicion', 'contado') not in ('contado', 'credito') then raise exception 'Condición de pago no válida' using errcode = 'P0001'; end if;
  if v_credito then
    -- A crédito solo vende quien responde por la cartera, con factura electrónica a un cliente identificado.
    if v_rol not in ('dueno', 'admin') then raise exception 'Solo el dueño o el administrador pueden vender a crédito' using errcode = '42501'; end if;
    if v_tipo <> 'factura' then raise exception 'La venta a crédito se hace con factura electrónica' using errcode = 'P0001'; end if;
    v_plazo := (p ->> 'plazo_dias')::integer;
    if v_plazo is null or v_plazo < 1 or v_plazo > 180 then raise exception 'El plazo de pago debe estar entre 1 y 180 días' using errcode = 'P0001'; end if;
    if jsonb_array_length(coalesce(p -> 'pagos', '[]')) > 0 then raise exception 'La venta a crédito no lleva pago en caja: registra los abonos en Cartera' using errcode = 'P0001'; end if;
  end if;
  if jsonb_array_length(coalesce(p -> 'lineas', '[]')) = 0 then raise exception 'La venta no tiene productos' using errcode = 'P0001'; end if;

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
    for r in
      select s.lote_id, s.unidades from v_stock_lotes s
      where s.producto_id = v_prod.id and s.sede_id = v_sede and s.unidades > 0 and (s.vence is null or s.vence >= current_date)
      order by s.vence nulls last, s.lote_id
    loop
      exit when v_falta = 0;
      v_toma := least(v_falta, r.unidades);
      v_parte := v_toma::numeric / v_unid;
      l_total := round(v_precio * v_cant * v_parte, 2);
      l_base := round(l_total / (1 + v_prod.iva / 100), 2);
      l_iva := l_total - l_base;
      insert into venta_lineas (empresa_id, venta_id, producto_id, lote_id, descripcion, presentacion, cantidad, unidades,
                                precio, iva_pct, base, iva, total)
      values (v_emp, v_venta, v_prod.id, r.lote_id, v_prod.nombre, v_pres, round(v_cant * v_parte, 3), v_toma,
              v_precio, v_prod.iva, l_base, l_iva, l_total);
      insert into movimientos (empresa_id, sede_id, producto_id, lote_id, cantidad, tipo, ref_id, usuario_id)
      values (v_emp, v_sede, v_prod.id, r.lote_id, -v_toma, 'venta', v_venta, v_user);
      v_base := v_base + l_base; v_iva := v_iva + l_iva; v_total := v_total + l_total;
      v_falta := v_falta - v_toma;
    end loop;
    if v_falta > 0 then
      if exists (select 1 from v_stock_lotes s where s.producto_id = v_prod.id and s.sede_id = v_sede and s.unidades > 0 and s.vence < current_date) then
        raise exception 'No hay existencias vigentes suficientes de % (faltan % unidades; lo demás está vencido y no se puede vender)', v_prod.nombre, v_falta using errcode = 'P0001';
      end if;
      raise exception 'No hay existencias suficientes de % (faltan % unidades)', v_prod.nombre, v_falta using errcode = 'P0001';
    end if;
  end loop;

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
  v_cambio := v_recibido - v_total;
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

  return jsonb_build_object('venta_id', v_venta, 'documento_id', v_doc, 'prefijo', v_res.prefijo, 'numero', v_num,
                            'base', v_base, 'iva', v_iva, 'total', v_total, 'cambio', v_cambio, 'repetida', false,
                            'credito', v_credito, 'vence_pago', case when v_credito then current_date + v_plazo end);
end $$;

-- Anular: no se anula una venta a crédito que ya tiene abonos.
create or replace function anular_venta(p_venta uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v ventas; ln venta_lineas; d documentos_dian; v_res resoluciones_dian;
begin
  select * into v from ventas where id = p_venta for update;
  if not found or coalesce(rol_en(v.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador pueden anular ventas' using errcode = '42501';
  end if;
  if v.estado <> 'cerrada' then raise exception 'La venta ya está anulada' using errcode = 'P0001'; end if;
  if exists (select 1 from abonos where venta_id = p_venta) then
    raise exception 'Esta venta a crédito ya tiene abonos: devuelve primero lo abonado y anula los abonos en Cartera' using errcode = 'P0001';
  end if;
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

insert into regenta_migraciones (nombre) values ('008_credito.sql');

-- 009_pagos.sql
-- Regenta · cobro con QR en la caja y pagos en línea de las suscripciones (Wompi en Colombia, Stripe para tarjetas internacionales).

-- Medio de pago «QR» (QR de Bancolombia, de Bre-B o de otro banco que la droguería tenga en el mostrador).
alter table pagos drop constraint pagos_medio_check;
alter table pagos add constraint pagos_medio_check check (medio in ('efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'bre_b', 'qr'));
alter table abonos drop constraint abonos_medio_check;
alter table abonos add constraint abonos_medio_check check (medio in ('efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'bre_b', 'qr'));

-- Pagos de planes desde la web. Solo los toca el servidor (sin políticas: ningún usuario de la app los lee).
create table pagos_suscripcion (
  id uuid primary key default gen_random_uuid(),
  referencia text not null unique,
  plan text not null check (plan in ('esencial', 'pro')),
  periodo text not null check (periodo in ('mes', 'anio')),
  monto integer not null check (monto > 0),            -- pesos colombianos, sin centavos
  moneda text not null default 'COP',
  proveedor text not null check (proveedor in ('wompi', 'stripe')),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado', 'anulado', 'error')),
  nombre text not null, empresa text not null, nit text, email text not null, telefono text not null,
  transaccion text,          -- id de la transacción (Wompi) o de la sesión/suscripción (Stripe)
  metodo text,               -- CARD, PSE, NEQUI, BANCOLOMBIA_QR…
  detalle jsonb,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index pagos_suscripcion_estado on pagos_suscripcion (estado, creado desc);
alter table pagos_suscripcion enable row level security;

insert into regenta_migraciones (nombre) values ('009_pagos.sql');

-- 010_auditoria.sql
-- Regenta · correcciones de la auditoría del 1/11/2026 (tarde).

-- Las funciones de predicción y alertas son rápidas sin JIT; con él, Postgres gastaba más de 1 s compilando cada consulta.
alter function alertas_empresa(uuid, integer) set jit = off;
alter function prediccion_productos(uuid, integer, integer) set jit = off;
alter function riesgo_vencimiento(uuid) set jit = off;
alter function patron_semanal(uuid) set jit = off;

-- Lotes separados por una alerta del INVIMA: ya no se venden ni cuentan como existencias vendibles.
alter table lotes add column bloqueado boolean not null default false;
alter table lotes add column bloqueo_motivo text;
create or replace view v_stock_lotes with (security_invoker = true) as
  select l.id as lote_id, l.empresa_id, l.sede_id, l.producto_id, l.lote, l.vence,
         coalesce(sum(m.cantidad), 0)::integer as unidades, l.bloqueado
  from lotes l left join movimientos m on m.lote_id = l.id
  group by l.id;
create or replace view v_stock_vigente with (security_invoker = true) as
  select * from v_stock_lotes where (vence is null or vence >= current_date) and not bloqueado;

-- «Separé el producto» en una alerta bloquea los lotes de ese producto que nombra la alerta (o todos, si la alerta no
-- trae lotes). Quien separa es bodega o gerencia; el bloqueo lo aplica la base de datos.
create function bloquear_por_alerta() returns trigger language plpgsql security definer set search_path = public as $$
declare a alertas_invima;
begin
  if new.resultado <> 'separado' or new.producto_id is null then return new; end if;
  select * into a from alertas_invima where id = new.alerta_id;
  update lotes set bloqueado = true, bloqueo_motivo = 'Alerta INVIMA ' || a.numero
  where producto_id = new.producto_id and empresa_id = new.empresa_id
    and (cardinality(a.lotes) = 0 or upper(lote) = any(a.lotes));
  return new;
end $$;
create trigger alertas_revision_bloquea after insert on alertas_revision for each row execute function bloquear_por_alerta();

-- Abonos: un abono mal registrado se anula (queda la constancia), nunca se borra.
alter table abonos add column anulado boolean not null default false;
alter table abonos add column anulado_motivo text;
create or replace view v_cartera with (security_invoker = true) as
  select v.id venta_id, v.empresa_id, v.prefijo, v.numero, v.creado, v.vence_pago, v.plazo_dias, v.total,
         c.id cliente_id, c.nombre cliente, c.tipo_doc, c.numero_doc, c.dv, c.telefono, c.email,
         coalesce(a.abonado, 0) abonado, v.total - coalesce(a.abonado, 0) saldo,
         greatest(0, current_date - v.vence_pago) dias_mora
  from ventas v
  join clientes c on c.id = v.cliente_id
  left join (select venta_id, sum(valor) abonado from abonos where not anulado group by venta_id) a on a.venta_id = v.id
  where v.condicion = 'credito' and v.estado = 'cerrada' and rol_en(v.empresa_id) in ('dueno', 'admin');

create function anular_abono(p_abono bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare a abonos;
begin
  select * into a from abonos where id = p_abono for update;
  if not found or coalesce(rol_en(a.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador anulan abonos' using errcode = '42501';
  end if;
  if a.anulado then raise exception 'Ese abono ya está anulado' using errcode = 'P0001'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indica el motivo' using errcode = 'P0001'; end if;
  update abonos set anulado = true, anulado_motivo = p_motivo where id = p_abono;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (a.empresa_id, auth.uid(), 'anular_abono', 'ventas', a.venta_id::text, jsonb_build_object('abono', p_abono, 'valor', a.valor, 'motivo', p_motivo));
end $$;
revoke execute on function anular_abono(bigint, text) from public;
grant execute on function anular_abono(bigint, text) to authenticated;

-- Alertas descartadas: solo el servidor (si la base expone una API de datos, nadie más puede escribirlas).
alter table invima_descartadas enable row level security;
revoke all on invima_descartadas from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on invima_descartadas from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on invima_descartadas from authenticated'; end if;
end $$;

-- Venta: el último lote recibe el resto del total (sin centavos sueltos), no vende lotes separados y la venta a crédito
-- guarda cambio 0.
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
begin
  v_rol := rol_en(v_emp);
  if v_rol is null or v_rol not in ('dueno', 'admin', 'cajero') then
    raise exception 'No tienes permiso para vender en esta empresa' using errcode = '42501';
  end if;
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
  if (p ->> 'cliente_id') is not null and not exists (select 1 from clientes where id = (p ->> 'cliente_id')::uuid and empresa_id = v_emp) then
    raise exception 'Cliente no válido' using errcode = 'P0001';
  end if;
  if coalesce(p ->> 'condicion', 'contado') not in ('contado', 'credito') then raise exception 'Condición de pago no válida' using errcode = 'P0001'; end if;
  if v_credito then
    -- A crédito solo vende quien responde por la cartera, con factura electrónica a un cliente identificado.
    if v_rol not in ('dueno', 'admin') then raise exception 'Solo el dueño o el administrador pueden vender a crédito' using errcode = '42501'; end if;
    if v_tipo <> 'factura' then raise exception 'La venta a crédito se hace con factura electrónica' using errcode = 'P0001'; end if;
    v_plazo := (p ->> 'plazo_dias')::integer;
    if v_plazo is null or v_plazo < 1 or v_plazo > 180 then raise exception 'El plazo de pago debe estar entre 1 y 180 días' using errcode = 'P0001'; end if;
    if jsonb_array_length(coalesce(p -> 'pagos', '[]')) > 0 then raise exception 'La venta a crédito no lleva pago en caja: registra los abonos en Cartera' using errcode = 'P0001'; end if;
  end if;
  if jsonb_array_length(coalesce(p -> 'lineas', '[]')) = 0 then raise exception 'La venta no tiene productos' using errcode = 'P0001'; end if;

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
    v_linea := round(v_precio * v_cant, 2); v_asignado := 0;
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
      l_base := round(l_total / (1 + v_prod.iva / 100), 2);
      l_iva := l_total - l_base;
      insert into venta_lineas (empresa_id, venta_id, producto_id, lote_id, descripcion, presentacion, cantidad, unidades,
                                precio, iva_pct, base, iva, total)
      values (v_emp, v_venta, v_prod.id, r.lote_id, v_prod.nombre, v_pres, round(v_cant * v_parte, 3), v_toma,
              v_precio, v_prod.iva, l_base, l_iva, l_total);
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

  return jsonb_build_object('venta_id', v_venta, 'documento_id', v_doc, 'prefijo', v_res.prefijo, 'numero', v_num,
                            'base', v_base, 'iva', v_iva, 'total', v_total, 'cambio', v_cambio, 'repetida', false,
                            'credito', v_credito, 'vence_pago', case when v_credito then current_date + v_plazo end);
end $$;

-- Abono: solo cuentan los abonos vigentes.
create or replace function registrar_abono(p_venta uuid, p_medio text, p_valor numeric, p_referencia text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v ventas; v_abonado numeric; v_saldo numeric;
begin
  select * into v from ventas where id = p_venta for update;
  if not found or coalesce(rol_en(v.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador registran abonos' using errcode = '42501';
  end if;
  if v.condicion <> 'credito' then raise exception 'Esta venta no es a crédito' using errcode = 'P0001'; end if;
  if v.estado <> 'cerrada' then raise exception 'La venta está anulada' using errcode = 'P0001'; end if;
  if p_valor is null or p_valor <= 0 or p_valor <> trunc(p_valor) then raise exception 'El abono debe ser un valor en pesos mayor que cero' using errcode = 'P0001'; end if;
  select coalesce(sum(valor), 0) into v_abonado from abonos where venta_id = p_venta and not anulado;
  v_saldo := v.total - v_abonado;
  if p_valor > v_saldo then raise exception 'El abono (%) supera el saldo de la factura (%)', p_valor, v_saldo using errcode = 'P0001'; end if;
  insert into abonos (empresa_id, venta_id, medio, valor, referencia, usuario_id)
  values (v.empresa_id, p_venta, p_medio, p_valor, nullif(trim(coalesce(p_referencia, '')), ''), auth.uid());
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v.empresa_id, auth.uid(), 'abono', 'ventas', p_venta::text, jsonb_build_object('valor', p_valor, 'medio', p_medio));
  return jsonb_build_object('abonado', v_abonado + p_valor, 'saldo', v_saldo - p_valor);
end $$;

-- Anular venta: bloqueada solo por abonos vigentes.
create or replace function anular_venta(p_venta uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v ventas; ln venta_lineas; d documentos_dian; v_res resoluciones_dian;
begin
  select * into v from ventas where id = p_venta for update;
  if not found or coalesce(rol_en(v.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador pueden anular ventas' using errcode = '42501';
  end if;
  if v.estado <> 'cerrada' then raise exception 'La venta ya está anulada' using errcode = 'P0001'; end if;
  if exists (select 1 from abonos where venta_id = p_venta and not anulado) then
    raise exception 'Esta venta a crédito tiene abonos vigentes: devuelve lo abonado y anula esos abonos en el detalle de la venta' using errcode = 'P0001';
  end if;
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

insert into regenta_migraciones (nombre) values ('010_auditoria.sql');

-- 011_cuentas_admin.sql
-- Regenta · cuentas con contraseña (clientes y equipo) y consola de superadministración.

-- Cuentas de acceso. El id es el mismo user_id que usan miembros y auth.uid(). Solo las toca el servidor.
create table cuentas (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  nombre text not null,
  clave_hash text,                       -- scrypt (sal:hash en hex); null hasta que activa la invitación
  activa boolean not null default true,
  creado timestamptz not null default now(),
  ultimo_ingreso timestamptz
);
create unique index cuentas_email on cuentas (lower(email));
alter table cuentas enable row level security;

-- Invitaciones de un solo uso para poner la contraseña (se guarda el hash del token, nunca el token).
create table invitaciones (
  token_hash text primary key,
  cuenta_id uuid not null references cuentas on delete cascade,
  expira timestamptz not null,
  usada timestamptz,
  creado timestamptz not null default now()
);
alter table invitaciones enable row level security;

-- Planes iguales a los que se venden en la web.
alter table empresas drop constraint empresas_plan_check;
update empresas set plan = case plan when 'drogueria' then 'esencial' when 'drogueria_plus' then 'pro' else 'cadena' end;
alter table empresas alter column plan set default 'esencial';
alter table empresas add constraint empresas_plan_check check (plan in ('esencial', 'pro', 'cadena', 'socio'));
alter table empresas add column nota_admin text;

-- Seguimiento comercial desde la consola.
alter table solicitudes_demo add column estado text not null default 'nueva' check (estado in ('nueva', 'contactada', 'cliente', 'descartada'));
alter table solicitudes_demo add column nota text;
alter table pagos_suscripcion add column empresa_id uuid references empresas on delete set null;
alter table pagos_suscripcion add column atendido boolean not null default false;

-- Bitácora de la consola (todo lo que hace el superadministrador, incluso entrar como un cliente).
create table admin_eventos (
  id bigint generated always as identity primary key,
  cuenta_id uuid not null,
  accion text not null,
  empresa_id uuid references empresas on delete set null,
  datos jsonb,
  creado timestamptz not null default now()
);
create index admin_eventos_creado on admin_eventos (creado desc);
alter table admin_eventos enable row level security;

revoke all on cuentas, invitaciones, admin_eventos, superadmins from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on cuentas, invitaciones, admin_eventos, superadmins from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on cuentas, invitaciones, admin_eventos, superadmins from authenticated'; end if;
end $$;

insert into regenta_migraciones (nombre) values ('011_cuentas_admin.sql');

-- 012_correos.sql
-- Regenta · correos: cola de envío (transaccionales y embudo de venta), bajas y recordatorios de renovación.

create table correos (
  id bigint generated always as identity primary key,
  clave text not null unique,              -- idempotencia: el mismo correo nunca se encola dos veces
  para text not null,
  plantilla text not null,
  tipo text not null check (tipo in ('transaccional', 'comercial')),
  datos jsonb not null default '{}',
  programado timestamptz not null default now(),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviando', 'enviado', 'error', 'cancelado', 'simulado')),
  intentos integer not null default 0,
  proveedor_id text,
  error text,
  empresa_id uuid references empresas on delete set null,
  enviado timestamptz,
  creado timestamptz not null default now()
);
create index correos_cola on correos (estado, programado);
create index correos_para on correos (lower(para));
alter table correos enable row level security;

-- Bajas de correos comerciales (los transaccionales siempre se envían: son parte del servicio contratado).
create table correos_bajas (
  email text primary key,                  -- en minúsculas
  motivo text,
  creado timestamptz not null default now()
);
alter table correos_bajas enable row level security;

-- Consentimiento para correos comerciales en la solicitud de demo (Ley 1581 de 2012).
alter table solicitudes_demo add column acepta_correos boolean not null default false;

-- Vencimiento del periodo pagado (para recordar la renovación de pagos con Wompi, que no se cobran solos).
alter table pagos_suscripcion add column vence date;

revoke all on correos, correos_bajas from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on correos, correos_bajas from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on correos, correos_bajas from authenticated'; end if;
end $$;

insert into regenta_migraciones (nombre) values ('012_correos.sql');

-- 013_seguridad.sql
-- 013 · Correcciones de la auditoría de seguridad de la consola y el acceso.

-- Una empresa suspendida deja de existir para sus usuarios también en la base (no solo al entrar).
create or replace function rol_en(e uuid) returns text
language sql stable security definer set search_path = public as $$
  select m.rol from miembros m join empresas x on x.id = m.empresa_id
  where m.empresa_id = e and m.user_id = auth.uid() and m.activo and x.estado = 'activa'
$$;

-- Versión de sesión: al restablecer la contraseña o desactivar la cuenta se incrementa y las sesiones abiertas mueren.
alter table cuentas add column if not exists version_sesion int not null default 0;

-- Intentos fallidos de acceso (límite compartido entre instancias del servidor).
create table if not exists intentos_acceso (clave text not null, creado timestamptz not null default now());
create index if not exists intentos_acceso_clave on intentos_acceso (clave, creado);
alter table intentos_acceso enable row level security;

-- Una transacción de Wompi solo puede pagar una orden.
create unique index if not exists pagos_wompi_transaccion on pagos_suscripcion (transaccion) where proveedor = 'wompi' and transaccion is not null;

-- Prueba de la autorización de correos comerciales (Ley 1581, art. 9 y 17.b): texto aceptado, fecha e IP.
alter table solicitudes_demo add column if not exists consentimiento jsonb;

revoke all on intentos_acceso from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on intentos_acceso from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on intentos_acceso from authenticated'; end if;
end $$;

-- Zona horaria de Bogotá en la base (el pooler de Supabase no deja fijarla al conectar): «hoy» es el día de Colombia.
do $$ begin execute format('alter database %I set timezone to %L', current_database(), 'America/Bogota'); end $$;

insert into regenta_migraciones (nombre) values ('013_seguridad.sql');

-- 014_qa.sql
-- 014 · Correcciones del QA funcional.
-- Recibir: un lote existente no cambia de fecha de vencimiento ni de costo; no se recibe mercancía vencida.
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
      insert into lote_costos (lote_id, empresa_id, costo_unidad) values (v_lote, v_emp, (ln ->> 'costo_unidad')::numeric)
      on conflict (lote_id) do nothing; -- el costo del lote es el de su primera entrada
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

insert into regenta_migraciones (nombre) values ('014_qa.sql');

-- 015_pago_qr.sql
-- 015 · Pago con el QR (llave Bre-B) de la cuenta empresarial Bancolombia, sin pasarela: el cliente paga desde su app y
-- el pago se confirma a mano en la consola al verlo en la cuenta.
alter table pagos_suscripcion drop constraint if exists pagos_suscripcion_proveedor_check;
alter table pagos_suscripcion add constraint pagos_suscripcion_proveedor_check check (proveedor in ('wompi', 'stripe', 'qr'));
alter table pagos_suscripcion add column if not exists confirmado_por uuid; -- superadministrador que vio el dinero en la cuenta

insert into regenta_migraciones (nombre) values ('015_pago_qr.sql');

-- 016_permisos_supabase.sql
-- 016 · Permisos exactos también en Supabase.
-- Supabase concede por defecto TODO a anon y authenticated sobre cada tabla, secuencia y función nueva del esquema
-- public (para su API de datos). Regenta no usa esa API: la app se conecta por el servidor y cambia de rol ella misma.
-- Aquí se deja el mismo estado que en local: anon sin acceso a nada y authenticated solo con lo que las migraciones
-- conceden a propósito. La seguridad por fila (RLS) sigue igual; esto es una segunda barrera.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- Lo que crea el dueño a partir de ahora tampoco se concede solo.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- Funciones de Regenta que no deben ejecutarse fuera de la app (en Supabase las tenía anon).
revoke execute on function rol_en(uuid), registrar_venta(jsonb), registrar_entrada(jsonb), anular_venta(uuid, text),
  registrar_abono(uuid, text, numeric, text), anular_abono(bigint, text), alertas_empresa(uuid, integer), patron_semanal(uuid),
  prediccion_productos(uuid, integer, integer), riesgo_vencimiento(uuid) from public;

-- Permisos de authenticated (los mismos que dejan las migraciones 001–015 en una base limpia).
grant select on abonos, alertas_invima, auditoria, cajas, documentos_dian, empresas, lote_costos, lotes, movimientos, pagos,
  productos_maestro, resoluciones_dian, sedes, v_cartera, v_stock_lotes, v_stock_vigente, venta_lineas, ventas to authenticated;
grant select, insert on alertas_revision to authenticated;
grant select, insert, update on clientes, productos to authenticated;
grant select, insert, update, delete on miembros to authenticated;
grant update (nombre_comercial, direccion, ciudad, telefono, email) on empresas to authenticated;
grant usage on sequence alertas_revision_id_seq to authenticated;
grant execute on function alertas_empresa(uuid, integer), anular_abono(bigint, text), anular_venta(uuid, text), patron_semanal(uuid),
  prediccion_productos(uuid, integer, integer), registrar_abono(uuid, text, numeric, text), registrar_entrada(jsonb),
  registrar_venta(jsonb), riesgo_vencimiento(uuid), rol_en(uuid) to authenticated;

-- La tabla de control de migraciones tampoco se expone.
alter table if exists regenta_migraciones enable row level security;

insert into regenta_migraciones (nombre) values ('016_permisos_supabase.sql');
commit;
