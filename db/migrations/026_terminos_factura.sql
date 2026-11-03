-- Regenta · constancia de contratación y comprobantes del servicio.
-- 1) Cada orden de pago guarda que el comprador aceptó los términos y la política de datos: cuándo, qué versión y desde
--    qué IP (prueba de la aceptación ante un reclamo o ante la SIC).
-- 2) Número de la factura electrónica que IA DEV emite por el servicio (se anota en la consola; el dueño la ve en Mi droguería).
alter table pagos_suscripcion add column if not exists acepta_terminos timestamptz;
alter table pagos_suscripcion add column if not exists version_terminos text;
alter table pagos_suscripcion add column if not exists ip text;
alter table pagos_suscripcion add column if not exists factura text check (factura is null or length(factura) <= 40);
