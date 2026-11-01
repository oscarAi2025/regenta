-- 015 · Pago con el QR (llave Bre-B) de la cuenta empresarial Bancolombia, sin pasarela: el cliente paga desde su app y
-- el pago se confirma a mano en la consola al verlo en la cuenta.
alter table pagos_suscripcion drop constraint if exists pagos_suscripcion_proveedor_check;
alter table pagos_suscripcion add constraint pagos_suscripcion_proveedor_check check (proveedor in ('wompi', 'stripe', 'qr'));
alter table pagos_suscripcion add column if not exists confirmado_por uuid; -- superadministrador que vio el dinero en la cuenta
