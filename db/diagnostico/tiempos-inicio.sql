-- Diagnóstico de velocidad del Inicio (solo lectura: no cambia nada). Pegar en Supabase → SQL Editor → Run.
-- Mide cuánto tarda cada consulta del Inicio con los datos reales de la droguería con más movimientos.
create temp table if not exists _tiempos (consulta text, ms numeric, filas int);
truncate _tiempos;
do $$
declare e uuid; t0 timestamptz; n int;
begin
  select x.id into e from empresas x where not x.demo
    order by (select count(*) from movimientos m where m.empresa_id = x.id) desc limit 1;

  t0 := clock_timestamp(); select count(*) into n from prediccion_productos(e);
  insert into _tiempos values ('pedido sugerido (prediccion_productos)', round(extract(epoch from clock_timestamp() - t0) * 1000), n);

  t0 := clock_timestamp(); select count(*) into n from riesgo_vencimiento(e);
  insert into _tiempos values ('riesgo de vencimiento', round(extract(epoch from clock_timestamp() - t0) * 1000), n);

  t0 := clock_timestamp(); select count(*) into n from alertas_empresa(e);
  insert into _tiempos values ('alertas INVIMA (alertas_empresa)', round(extract(epoch from clock_timestamp() - t0) * 1000), n);

  t0 := clock_timestamp(); select count(*) into n from patron_semanal(e);
  insert into _tiempos values ('patrón semanal', round(extract(epoch from clock_timestamp() - t0) * 1000), n);

  t0 := clock_timestamp();
  perform (select count(distinct producto_id) from v_stock_lotes where empresa_id = e and unidades > 0 and vence between current_date and current_date + 30),
          (select count(*) from v_stock_lotes where empresa_id = e and unidades > 0 and vence < current_date);
  insert into _tiempos values ('vencimientos (v_stock_lotes)', round(extract(epoch from clock_timestamp() - t0) * 1000), null);

  t0 := clock_timestamp();
  perform (select count(*) from productos p where empresa_id = e and activo and coalesce((select sum(unidades) from v_stock_vigente where producto_id = p.id), 0) <= 0),
          (select count(*) from productos p where empresa_id = e and activo and stock_minimo > 0
             and coalesce((select sum(unidades) from v_stock_vigente where producto_id = p.id), 0) between 1 and p.stock_minimo * p.unidades_por_caja);
  insert into _tiempos values ('agotados y bajos (v_stock_vigente)', round(extract(epoch from clock_timestamp() - t0) * 1000), null);

  t0 := clock_timestamp();
  perform count(*) from ventas v where v.empresa_id = e and v.origen is null and v.estado = 'cerrada' and (v.creado at time zone 'America/Bogota')::date >= current_date - 6;
  insert into _tiempos values ('ventas de la semana', round(extract(epoch from clock_timestamp() - t0) * 1000), null);

  insert into _tiempos values ('— productos activos', null, (select count(*) from productos where empresa_id = e and activo)),
                              ('— lotes', null, (select count(*) from lotes where empresa_id = e)),
                              ('— movimientos', null, (select count(*) from movimientos where empresa_id = e));
end $$;
select * from _tiempos order by ms desc nulls last;
