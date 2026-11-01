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
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviando', 'aceptado', 'rechazado')),
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

  -- Reintento de una venta ya registrada (la caja volvió a enviarla): se devuelve la misma.
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
