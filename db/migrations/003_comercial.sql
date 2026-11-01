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
