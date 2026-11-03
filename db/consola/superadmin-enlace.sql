-- Enlace de un solo uso (1 hora) para que el superadministrador cree su contraseña de la consola. Se pega en el editor SQL
-- de Supabase y se abre el enlace que devuelve. Crea la cuenta y el permiso si no existen. Cambia el correo si es otro.
with t as (select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') tok),
c as (insert into cuentas (email, nombre) values ('gerencia@farmagenericoscolombia.com', 'Oscar Domínguez')
      on conflict ((lower(email))) do update set activa = true returning id),
s as (insert into superadmins (user_id, nombre) select id, 'Oscar Domínguez' from c on conflict (user_id) do nothing),
u as (update invitaciones set usada = now() where cuenta_id = (select id from c) and usada is null),
i as (insert into invitaciones (token_hash, cuenta_id, expira) select encode(sha256(convert_to(tok, 'UTF8')), 'hex'), (select id from c), now() + interval '1 hour' from t)
select 'https://regenta.pro/admin/activar?t=' || tok as enlace from t;
