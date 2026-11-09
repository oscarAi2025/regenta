-- 042 · Auditoría completa (09/11/2026). Repetible: se puede pegar más de una vez en el editor SQL.

-- ── Seguridad ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Cerrar sesión la invalida de verdad (antes solo se borraba la cookie y una copia seguía sirviendo hasta 12 h).
create table if not exists sesiones_cerradas (jti text primary key check (length(jti) <= 64), vence timestamptz not null);
alter table sesiones_cerradas enable row level security; -- sin políticas: solo el servidor la usa
revoke all on sesiones_cerradas from public, anon, authenticated;

-- Doble clic / reintento de red en operaciones con dinero (recibos, abonos, devoluciones, movimientos de caja): la
-- misma clave devuelve el mismo resultado sin registrar otra vez.
create table if not exists operaciones_idem (
  empresa_id uuid not null references empresas on delete cascade,
  clave text not null check (length(clave) between 8 and 64),
  resultado jsonb not null,
  creado timestamptz not null default now(),
  primary key (empresa_id, clave)
);
alter table operaciones_idem enable row level security;
drop policy if exists miembros_usan on operaciones_idem;
create policy miembros_usan on operaciones_idem for all to authenticated
  using (empresa_id in (select mis_empresas())) with check (empresa_id in (select mis_empresas()));
revoke all on operaciones_idem from public, anon;
grant select, insert on operaciones_idem to authenticated;

-- Verificación en dos pasos de la consola (TOTP). El secreto va cifrado por el servidor.
alter table cuentas add column if not exists totp_secreto text check (totp_secreto is null or length(totp_secreto) <= 200);
alter table cuentas add column if not exists totp_pendiente text check (totp_pendiente is null or length(totp_pendiente) <= 200);
alter table cuentas add column if not exists totp_ultimo bigint;

-- Cada arqueo de caja y cada kárdex leían la tabla completa de ventas de todas las droguerías.
create index if not exists ventas_caja_creado on ventas (caja_id, creado);
create index if not exists venta_lineas_producto on venta_lineas (producto_id);

-- La bodega recibe mercancía sin ver costos: el archivo de la factura (con precios) solo lo leen el dueño y el administrador.
drop policy if exists inventario_lee on compra_archivos;
create policy inventario_lee on compra_archivos for select to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin'])));
