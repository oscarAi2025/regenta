-- Regenta: migración 041 (factura del proveedor repetida aunque el número venga con guion o espacios). Una sola transacción.
begin;
-- 041 · Factura del proveedor repetida aunque el número venga escrito distinto (09/11/2026)
-- La misma factura puede llegar como «FVZ7037» (XML), «FVZ-7037» (leída de una foto) o «FVZ 7037» (escrita a mano).
-- El índice compras_factura_unica compara el número tal cual; este control compara solo letras y cifras para no
-- registrar dos veces la misma compra (y duplicar el inventario). Mismo código de error y mensaje que registrar_compra.
create or replace function compras_factura_repetida() returns trigger language plpgsql security definer set search_path = public as $$
declare v compras;
begin
  if new.estado = 'anulada' then return new; end if;
  select * into v from compras c
   where c.empresa_id = new.empresa_id and c.proveedor_id = new.proveedor_id and c.id <> new.id and c.estado <> 'anulada'
     and regexp_replace(upper(c.numero_factura), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(new.numero_factura), '[^A-Z0-9]', '', 'g')
   limit 1;
  if found then
    raise exception 'La factura % ya está registrada como % (compra N.º %)', new.numero_factura, v.numero_factura, v.numero using errcode = '23505';
  end if;
  return new;
end $$;
revoke execute on function compras_factura_repetida() from public, anon, authenticated;
drop trigger if exists compras_factura_repetida on compras;
create trigger compras_factura_repetida before insert or update of numero_factura, proveedor_id on compras
  for each row execute function compras_factura_repetida();
insert into regenta_migraciones (nombre) values ('041_factura_repetida.sql') on conflict do nothing;
commit;
