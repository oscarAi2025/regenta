-- 016 · Permisos exactos también en Supabase.
-- Supabase concede por defecto TODO a anon y authenticated sobre cada tabla, secuencia y función nueva del esquema
-- public (para su API de datos). Regenta no usa esa API: la app se conecta por el servidor y cambia de rol ella misma.
-- Aquí se deja el mismo estado que en local: anon sin acceso a nada y authenticated solo con lo que las migraciones
-- conceden a propósito. La seguridad por fila (RLS) sigue igual; esto es una segunda barrera.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- Lo que crea el dueño a partir de ahora tampoco se concede solo.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- Funciones de Regenta que no deben ejecutarse fuera de la app (en Supabase las tenía anon).
revoke execute on function rol_en(uuid), registrar_venta(jsonb), registrar_entrada(jsonb), anular_venta(uuid, text),
  registrar_abono(uuid, text, numeric, text), anular_abono(bigint, text), alertas_empresa(uuid, integer), patron_semanal(uuid),
  prediccion_productos(uuid, integer, integer), riesgo_vencimiento(uuid) from public;

-- Permisos de authenticated (los mismos que dejan las migraciones 001–015 en una base limpia).
grant select on abonos, alertas_invima, auditoria, cajas, documentos_dian, empresas, lote_costos, lotes, movimientos, pagos,
  productos_maestro, resoluciones_dian, sedes, v_cartera, v_stock_lotes, v_stock_vigente, venta_lineas, ventas to authenticated;
grant select, insert on alertas_revision to authenticated;
grant select, insert, update on clientes, productos to authenticated;
grant select, insert, update, delete on miembros to authenticated;
grant update (nombre_comercial, direccion, ciudad, telefono, email) on empresas to authenticated;
grant usage on sequence alertas_revision_id_seq to authenticated;
grant execute on function alertas_empresa(uuid, integer), anular_abono(bigint, text), anular_venta(uuid, text), patron_semanal(uuid),
  prediccion_productos(uuid, integer, integer), registrar_abono(uuid, text, numeric, text), registrar_entrada(jsonb),
  registrar_venta(jsonb), riesgo_vencimiento(uuid), rol_en(uuid) to authenticated;

-- La tabla de control de migraciones tampoco se expone.
alter table if exists regenta_migraciones enable row level security;
