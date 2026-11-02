-- Regenta · emisor MATIAS (casa de software): cada droguería es un cliente de la cuenta principal de MATIAS y se
-- emite en su nombre con ?client_uuid=. Null = la propia empresa de la cuenta.
alter table empresas add column if not exists matias_cliente text;
