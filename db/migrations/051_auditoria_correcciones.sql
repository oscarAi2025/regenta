-- Correcciones de la auditoría integral (17/11/2026). Cada una tiene su prueba en tests/auditoria-db.test.mjs.
--
-- AUD-01 · Factura electrónica a consumidor final. La caja ofrece «Consumidor final» (CC 222222222222, sin correo: la DIAN
-- no se la envía a nadie y el proveedor la acepta), pero registrar_venta exigía correo a TODA factura y el cobro fallaba con
-- «necesita el correo del cliente». Se exceptúa solo el documento 222222222222; a cualquier otro cliente se le sigue
-- exigiendo un correo válido. Se corrige solo esa condición sobre la versión vigente (como la 036), sin copiar la función.
do $$
declare d text;
  viejo text := 'and email ~ ''^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'') then';
  nuevo text := 'and (numero_doc = ''222222222222'' or email ~ ''^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'')) then';
begin
  select pg_get_functiondef('registrar_venta(jsonb)'::regprocedure) into d;
  if position(nuevo in d) > 0 then raise notice 'registrar_venta ya acepta consumidor final';
  elsif position(viejo in d) > 0 then execute replace(d, viejo, nuevo);
  else raise exception 'registrar_venta no trae la comprobación del correo esperada: revisar AUD-01 a mano';
  end if;
end $$;
