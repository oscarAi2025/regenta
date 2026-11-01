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
