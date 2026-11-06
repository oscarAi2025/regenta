-- Regenta · integración del Bloque 3 (resultados y gastos 034, DIAN complementaria 035, precios y lotes 036). 06/11/2026.
--   1. eliminar_empresa_prueba (consola) parte EXACTAMENTE de la versión de 033a y además:
--      · borra los documentos DIAN y las devoluciones de venta ANTES que venta_lineas: devolucion_lineas.venta_linea_id es
--        RESTRICT, así que la versión de 033a fallaba con cualquier droguería de prueba que hubiera hecho una devolución
--        (lo encontró el frente 3-C);
--      · 034: gastos antes de movimientos_caja y turnos (gastos.movimiento_caja_id y turno_id no son cascada);
--      · 035: documento_lineas y soporte_compras (caen con documentos_dian, pero se borran explícitos y antes que las
--        compras, porque soporte_compras.compra_id y documentos_dian.compra_id no son cascada);
--      · 036: cambio_precio_lineas, cambios_precio y producto_codigos, explícitos y antes que los productos.
--   2. La droguería de demostración, si ya existe (producción), recibe las numeraciones de PRUEBA de los documentos nuevos
--      (soporte, nota de ajuste y nota débito) para que la demo muestre el documento soporte en simulado. No toca ninguna
--      otra droguería ni cambia numeraciones existentes; si la migración se repite no vuelve a insertar.

-- ───────────── 1 · Eliminar una droguería de prueba (desde 033a) ─────────────
create or replace function eliminar_empresa_prueba(p_empresa uuid) returns int
language plpgsql set search_path = public as $$
declare e record; usuarios uuid[]; n int;
begin
  select * into e from empresas where id = p_empresa for update;
  if not found then raise exception 'Cliente no encontrado' using errcode = 'P0001'; end if;
  if e.demo then raise exception 'La demostración no se elimina' using errcode = 'P0001'; end if;
  if e.estado <> 'suspendida' then raise exception 'Primero suspende la droguería; luego podrás eliminarla' using errcode = 'P0001'; end if;
  if exists (select 1 from resoluciones_dian where empresa_id = p_empresa and not pruebas) then
    raise exception 'Esta droguería facturó con numeración DIAN en producción: sus documentos se conservan por ley. Solo se puede suspender' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct user_id), '{}') into usuarios from miembros where empresa_id = p_empresa;
  perform set_config('regenta.eliminar_empresa', p_empresa::text, true);

  -- Hijos primero (algunas llaves son RESTRICT), luego la empresa (el resto cae en cascada).
  -- 035 · Líneas y compras de los documentos complementarios, antes que sus documentos.
  delete from soporte_compras where empresa_id = p_empresa;
  delete from documento_lineas where empresa_id = p_empresa;
  -- Documentos DIAN (apuntan a ventas, devoluciones y compras) y devoluciones de venta (apuntan a venta_lineas): antes
  -- que venta_lineas. 036a: en 033a iban después y fallaba con cualquier devolución.
  delete from documentos_dian where empresa_id = p_empresa;
  delete from devolucion_lineas where empresa_id = p_empresa;
  delete from devoluciones where empresa_id = p_empresa;
  delete from venta_formulas where empresa_id = p_empresa;
  delete from venta_lineas where empresa_id = p_empresa;
  delete from pagos where empresa_id = p_empresa;
  delete from abonos where empresa_id = p_empresa;
  delete from recibos_caja where empresa_id = p_empresa;              -- 033: después de abonos (abonos.recibo_id)
  -- 032 · Mostrador: antes de ventas, productos, clientes, cajas y sedes.
  delete from pedido_lineas where empresa_id = p_empresa;
  delete from pedidos_mostrador where empresa_id = p_empresa;
  -- 031 · Compras: antes de movimientos_caja y turnos (pagos desde la caja), lotes y proveedores.
  delete from devolucion_proveedor_lineas where empresa_id = p_empresa;
  delete from devoluciones_proveedor where empresa_id = p_empresa;
  delete from pago_aplicaciones where empresa_id = p_empresa;
  delete from pagos_proveedor where empresa_id = p_empresa;
  delete from compra_lineas where empresa_id = p_empresa;
  delete from compras where empresa_id = p_empresa;
  delete from proveedores where empresa_id = p_empresa;
  -- 034 · Gastos: antes de movimientos_caja y turnos (gasto en efectivo desde la caja).
  delete from gastos where empresa_id = p_empresa;
  delete from movimientos_caja where empresa_id = p_empresa;
  delete from ventas where empresa_id = p_empresa;
  delete from turnos where empresa_id = p_empresa;
  -- Conteos y ajustes se apuntan entre sí: primero se suelta el enlace.
  update conteos set ajuste_id = null where empresa_id = p_empresa and ajuste_id is not null;
  delete from conteo_lineas where empresa_id = p_empresa;
  delete from ajuste_lineas where empresa_id = p_empresa;
  delete from ajustes where empresa_id = p_empresa;
  delete from conteos where empresa_id = p_empresa;
  delete from temperatura_registros where empresa_id = p_empresa;
  -- 036 · Cambios de precio y códigos alternos: antes que los productos (caen en cascada con la empresa).
  delete from cambio_precio_lineas where empresa_id = p_empresa;
  delete from cambios_precio where empresa_id = p_empresa;
  delete from producto_codigos where empresa_id = p_empresa;
  delete from movimientos where empresa_id = p_empresa;
  delete from alertas_revision where empresa_id = p_empresa;
  delete from auditoria where empresa_id = p_empresa;
  delete from lote_costos where empresa_id = p_empresa;
  delete from lotes where empresa_id = p_empresa;
  delete from empresas where id = p_empresa;

  delete from cuentas c where c.id = any (usuarios)
    and not exists (select 1 from miembros m where m.user_id = c.id)
    and not exists (select 1 from superadmins s where s.user_id = c.id);
  get diagnostics n = row_count;

  perform set_config('regenta.eliminar_empresa', '', true);
  return n;
end $$;
revoke execute on function eliminar_empresa_prueba(uuid) from public;
revoke execute on function eliminar_empresa_prueba(uuid) from authenticated, anon;

-- ───────────── 2 · Demo: numeraciones de prueba de los documentos complementarios ─────────────
insert into resoluciones_dian (empresa_id, tipo, prefijo, desde, hasta, actual, vigente_hasta, pruebas)
select e.id, x.tipo, x.prefijo, 1, 1000000, 0, date '2027-12-31', true
from empresas e
cross join (values ('soporte', 'DSSE'), ('ajuste_soporte', 'NASE'), ('nota_debito', 'NDSE')) as x (tipo, prefijo)
where e.demo
  and not exists (select 1 from resoluciones_dian r where r.empresa_id = e.id and r.tipo = x.tipo and r.activa);
