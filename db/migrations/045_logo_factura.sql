-- 045 · Logo de la droguería para la factura en tamaño carta (10/11/2026). Repetible.
-- Se guarda como imagen PNG, JPEG o WebP en base64 (la pantalla la reduce antes de subirla; máx. ~300 KB). No se admite
-- SVG: puede llevar código.
alter table empresas add column if not exists logo text;
alter table empresas drop constraint if exists empresas_logo_check;
alter table empresas add constraint empresas_logo_check check (logo is null or (logo ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' and length(logo) <= 400000));
