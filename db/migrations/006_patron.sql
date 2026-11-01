-- Regenta · patrón semanal de ventas de la droguería: qué días vende más o menos que su promedio (últimas 8 semanas).
create function patron_semanal(p_empresa uuid)
returns table (dia integer, nombre text, ventas_promedio numeric, frente_al_promedio integer)
language sql stable security invoker set search_path = public as $$
  with d as (
    select g::date fecha, extract(isodow from g)::int dia from generate_series(current_date - 56, current_date - 1, '1 day') g
  ), v as (
    select (creado at time zone 'America/Bogota')::date fecha, sum(total) total from ventas
    where empresa_id = p_empresa and estado = 'cerrada' and creado >= now() - interval '57 days' group by 1
  ), x as (
    select d.dia, avg(coalesce(v.total, 0)) prom from d left join v on v.fecha = d.fecha group by d.dia
  )
  select x.dia, (array['lunes','martes','miércoles','jueves','viernes','sábado','domingo'])[x.dia], round(x.prom),
         case when avg(x.prom) over () > 0 then round(100 * (x.prom / avg(x.prom) over () - 1))::int end
  from x order by x.dia
$$;
grant execute on function patron_semanal(uuid) to authenticated;
