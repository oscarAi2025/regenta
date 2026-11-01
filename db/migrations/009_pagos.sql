-- Regenta · cobro con QR en la caja y pagos en línea de las suscripciones (Wompi en Colombia, Stripe para tarjetas internacionales).

-- Medio de pago «QR» (QR de Bancolombia, de Bre-B o de otro banco que la droguería tenga en el mostrador).
alter table pagos drop constraint pagos_medio_check;
alter table pagos add constraint pagos_medio_check check (medio in ('efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'bre_b', 'qr'));
alter table abonos drop constraint abonos_medio_check;
alter table abonos add constraint abonos_medio_check check (medio in ('efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'bre_b', 'qr'));

-- Pagos de planes desde la web. Solo los toca el servidor (sin políticas: ningún usuario de la app los lee).
create table pagos_suscripcion (
  id uuid primary key default gen_random_uuid(),
  referencia text not null unique,
  plan text not null check (plan in ('esencial', 'pro')),
  periodo text not null check (periodo in ('mes', 'anio')),
  monto integer not null check (monto > 0),            -- pesos colombianos, sin centavos
  moneda text not null default 'COP',
  proveedor text not null check (proveedor in ('wompi', 'stripe')),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado', 'anulado', 'error')),
  nombre text not null, empresa text not null, nit text, email text not null, telefono text not null,
  transaccion text,          -- id de la transacción (Wompi) o de la sesión/suscripción (Stripe)
  metodo text,               -- CARD, PSE, NEQUI, BANCOLOMBIA_QR…
  detalle jsonb,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);
create index pagos_suscripcion_estado on pagos_suscripcion (estado, creado desc);
alter table pagos_suscripcion enable row level security;
