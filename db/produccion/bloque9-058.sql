-- Pegar en Supabase → SQL Editor → Run. Una sola transacción: si algo falla, no cambia nada.
-- 058: «Te falta X → pídelo a Farmagenéricos». Aditiva: una columna con valor por defecto y una tabla nueva. No toca datos.
begin;
-- 058 · «Te falta X → pídelo a Farmagenéricos» (21/11/2026). Aditiva: no cambia nada de lo existente.
-- Cada droguería puede apagar el aviso (por defecto encendido). Cada pedido que la droguería manda a Farmagenéricos desde
-- el pedido sugerido queda guardado (qué productos, cuántas cajas, quién y cuándo): sirve de constancia para la droguería y
-- para el Plan Socio. Solo lo ven y lo crean dueño, administrador y bodega, como el resto del inventario.
alter table empresas add column if not exists pedir_farmagenericos boolean not null default true;

create table if not exists pedidos_farmagenericos (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  usuario_id uuid not null,
  lineas jsonb not null check (jsonb_typeof(lineas) = 'array' and jsonb_array_length(lineas) between 1 and 300),
  productos integer not null check (productos between 1 and 300),
  cajas integer not null check (cajas between 1 and 1000000),
  creado timestamptz not null default now()
);
create index if not exists pedidos_farmagenericos_empresa on pedidos_farmagenericos (empresa_id, creado desc);

alter table pedidos_farmagenericos enable row level security;
drop policy if exists inventario_lee on pedidos_farmagenericos;
create policy inventario_lee on pedidos_farmagenericos for select to authenticated
  using (empresa_id in (select mis_empresas(array['dueno', 'admin', 'bodeguero'])));
drop policy if exists inventario_crea on pedidos_farmagenericos;
create policy inventario_crea on pedidos_farmagenericos for insert to authenticated
  with check (empresa_id in (select mis_empresas(array['dueno', 'admin', 'bodeguero'])) and usuario_id = auth.uid());
revoke all on pedidos_farmagenericos from anon, authenticated;
grant select, insert on pedidos_farmagenericos to authenticated;
grant usage on sequence pedidos_farmagenericos_id_seq to authenticated;

insert into regenta_migraciones (nombre) values ('058_pedido_farmagenericos.sql') on conflict do nothing;
commit;
