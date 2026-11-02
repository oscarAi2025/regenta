-- Regenta · la venta es inmutable salvo dos cambios: anularla (cerrada → anulada) o sumar lo devuelto en una
-- devolución parcial (devuelto crece, sin pasar del total, y nada más cambia). La migración 020 olvidó este candado.
create or replace function venta_solo_anular() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Las ventas no se borran' using errcode = 'P0001'; end if;
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
