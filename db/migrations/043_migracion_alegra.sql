-- 043 · Migración desde Alegra (09/11/2026). Repetible.
-- Una droguería que llega de Alegra trae su historial de ventas (solo consulta), sus clientes con dirección y la
-- cartera abierta. Las facturas abiertas entran como ventas a crédito «de Alegra» para cobrarlas con recibos de caja;
-- no tienen caja ni turno, no mueven existencias, no generan documentos DIAN y no se anulan ni devuelven aquí.

alter table clientes add column if not exists direccion text, add column if not exists ciudad text;
alter table clientes drop constraint if exists clientes_direccion_check, drop constraint if exists clientes_ciudad_check;
alter table clientes add constraint clientes_direccion_check check (direccion is null or length(direccion) <= 160),
  add constraint clientes_ciudad_check check (ciudad is null or length(ciudad) <= 80);

alter table ventas add column if not exists origen text, add column if not exists externo_id text;
alter table ventas drop constraint if exists ventas_origen_check, drop constraint if exists ventas_caja_o_externa;
alter table ventas add constraint ventas_origen_check check (origen is null or (origen = 'alegra' and externo_id is not null)),
  add constraint ventas_caja_o_externa check (caja_id is not null or origen is not null);
alter table ventas alter column caja_id drop not null;
alter table ventas drop constraint if exists credito_completo;
alter table ventas add constraint credito_completo check (condicion = 'contado' or plazo_dias is not null and vence_pago is not null
  and cliente_id is not null and (tipo_doc = 'factura' or origen is not null));
create unique index if not exists ventas_externas_unicas on ventas (empresa_id, origen, externo_id) where origen is not null;

-- Una venta de Alegra es de solo lectura (sus abonos sí se registran: van en otra tabla).
create or replace function venta_solo_anular() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if current_user not in ('authenticated', 'anon') and current_setting('regenta.eliminar_empresa', true) = old.empresa_id::text then return old; end if;
    raise exception 'Las ventas no se borran' using errcode = 'P0001';
  end if;
  if old.origen is not null then
    raise exception 'Esta factura viene de Alegra: se anula o se devuelve en Alegra' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - 'estado' - 'devuelto') <> (to_jsonb(old) - 'estado' - 'devuelto') then
    raise exception 'Una venta solo puede anularse o recibir devoluciones' using errcode = 'P0001';
  end if;
  if new.estado is distinct from old.estado then
    if not (old.estado = 'cerrada' and new.estado = 'anulada') or new.devuelto <> old.devuelto then
      raise exception 'Una venta solo puede anularse' using errcode = 'P0001';
    end if;
  elsif new.devuelto <> old.devuelto then
    if old.estado <> 'cerrada' or new.devuelto < old.devuelto or new.devuelto > new.total then
      raise exception 'Lo devuelto no puede bajar ni pasar del total de la venta' using errcode = 'P0001';
    end if;
  else
    raise exception 'Una venta solo puede anularse' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Historial de ventas del sistema anterior: cabecera y líneas tal como estaban (consulta, informes por cliente y producto).
create table if not exists ventas_externas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas on delete cascade,
  origen text not null check (origen = 'alegra'),
  externo_id text not null check (length(externo_id) <= 40),
  documento text not null check (documento in ('factura', 'pos')),
  prefijo text check (length(prefijo) <= 10),
  numero bigint,
  fecha date not null,
  vence date,
  cliente_id uuid references clientes on delete set null,
  cliente_nombre text check (length(cliente_nombre) <= 200),
  cliente_doc text check (length(cliente_doc) <= 30),
  subtotal numeric(14,2) not null default 0,
  descuento numeric(14,2) not null default 0,
  iva numeric(14,2) not null default 0,
  total numeric(14,2) not null,
  pagado numeric(14,2) not null default 0,
  saldo numeric(14,2) not null default 0,
  estado text not null check (estado in ('pagada', 'por_cobrar', 'anulada', 'borrador')),
  estado_dian text check (length(estado_dian) <= 60),
  cufe text check (length(cufe) <= 200),
  forma_pago text check (length(forma_pago) <= 60),
  lineas jsonb not null default '[]' check (jsonb_typeof(lineas) = 'array'),
  creado timestamptz not null default now(),
  unique (empresa_id, origen, externo_id)
);
create index if not exists ventas_externas_fecha on ventas_externas (empresa_id, fecha desc);
create index if not exists ventas_externas_cliente on ventas_externas (cliente_id) where cliente_id is not null;
alter table ventas_externas enable row level security;
drop policy if exists gerencia_lee on ventas_externas;
drop policy if exists miembro_lee on ventas_externas;
create policy miembro_lee on ventas_externas for select to authenticated using (empresa_id in (select mis_empresas()));
revoke insert, update, delete on ventas_externas from anon, authenticated;
grant select on ventas_externas to authenticated;

-- El producto recuerda su id en el sistema anterior: repetir la migración no lo duplica y el historial lo encuentra.
alter table productos add column if not exists externo_id text;
alter table productos drop constraint if exists productos_externo_id_check;
alter table productos add constraint productos_externo_id_check check (externo_id is null or length(externo_id) <= 60);
create unique index if not exists productos_externo on productos (empresa_id, externo_id) where externo_id is not null;
