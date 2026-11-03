-- Regenta · ingresos y operación (revisión por tipo de usuario, puntos medios).

-- 1) Pago manual registrado en la consola (transferencia, efectivo, consignación): cuenta igual que un pago de pasarela.
alter table pagos_suscripcion drop constraint pagos_suscripcion_proveedor_check;
alter table pagos_suscripcion add constraint pagos_suscripcion_proveedor_check check (proveedor in ('wompi', 'stripe', 'qr', 'manual'));

-- 2) Bajar de plan al terminar el periodo ya pagado (no al instante): se guarda el plan siguiente y la tarea lo aplica.
alter table empresas add column if not exists plan_siguiente text check (plan_siguiente in ('esencial', 'pro'));

-- 3) Documentos electrónicos por encima del cupo del plan (términos, punto 2): un cargo por empresa y mes.
create table if not exists cargos_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  mes date not null,                        -- primer día del mes cobrado
  documentos int not null check (documentos >= 0),
  cupo int not null check (cupo >= 0),
  extra int not null check (extra > 0),
  valor_unidad numeric(12,2) not null check (valor_unidad >= 0),
  monto numeric(14,2) not null check (monto >= 0),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'pagado', 'condonado')),
  referencia text,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  unique (empresa_id, mes)
);
alter table cargos_documentos enable row level security;
create policy gerencia_lee on cargos_documentos for select to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin'])));
grant select on cargos_documentos to authenticated;

-- 4) Proveedores de la droguería (antes, texto libre al recibir).
create table if not exists proveedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  nombre text not null check (length(trim(nombre)) between 2 and 160),
  nit text check (nit is null or nit ~ '^[0-9]{5,12}$'),
  telefono text check (telefono is null or length(telefono) <= 30),
  email text check (email is null or length(email) <= 160),
  activo boolean not null default true,
  creado timestamptz not null default now()
);
create unique index if not exists proveedores_nombre on proveedores (empresa_id, lower(trim(nombre)));
alter table proveedores enable row level security;
create policy miembros_leen on proveedores for select to authenticated using (empresa_id in (select mis_empresas()));
create policy inventario_crea on proveedores for insert to authenticated with check (empresa_id in (select mis_empresas(array['dueno', 'admin', 'bodeguero'])));
create policy inventario_edita on proveedores for update to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin', 'bodeguero'])))
  with check (empresa_id in (select mis_empresas(array['dueno', 'admin', 'bodeguero'])));
grant select, insert, update on proveedores to authenticated;
