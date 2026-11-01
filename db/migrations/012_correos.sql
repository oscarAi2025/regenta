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
