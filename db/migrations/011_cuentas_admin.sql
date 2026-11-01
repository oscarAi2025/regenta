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
