-- Pegar en Supabase → SQL Editor → Run. Una sola transacción.
-- Antes, para ver a quién afecta (opcional):
--   select d.prefijo || d.numero doc, d.estado, d.ultimo_error from documentos_dian d where d.ultimo_error like 'Sin respuesta tras 48 horas%';
begin;
update documentos_dian d set estado = 'pendiente', proximo_intento = now(), actualizado = now(),
  ultimo_error = 'Vuelto a la cola (migración 052): estaba marcado «rechazado» solo por llevar 48 h sin respuesta. ' || coalesce(d.ultimo_error, '')
where d.estado = 'rechazado' and d.ultimo_error like 'Sin respuesta tras 48 horas%';
insert into regenta_migraciones (nombre) values ('052_dian_sin_respuesta.sql') on conflict do nothing;
commit;
