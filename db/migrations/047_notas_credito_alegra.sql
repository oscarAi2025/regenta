-- 047 · Notas crédito de Alegra en el historial (11/11/2026). Repetible.
-- Las 33 notas crédito de Alegra no se habían traído: las facturas anuladas con nota crédito contaban como vendidas
-- (p. ej. las cinco de la estafa Alkosto, $257,9 millones). Las anulaciones completas ponen la factura en «anulada»; las
-- devoluciones parciales quedan en «devuelto» (se resta de lo vendido) y cada nota se guarda en «notas».
alter table ventas_externas add column if not exists devuelto numeric(14,2) not null default 0;
alter table ventas_externas add column if not exists notas jsonb not null default '[]';
alter table ventas_externas drop constraint if exists ventas_externas_devuelto_check;
alter table ventas_externas add constraint ventas_externas_devuelto_check check (devuelto >= 0 and devuelto <= total + 1);
alter table ventas_externas drop constraint if exists ventas_externas_notas_check;
alter table ventas_externas add constraint ventas_externas_notas_check check (jsonb_typeof(notas) = 'array');
