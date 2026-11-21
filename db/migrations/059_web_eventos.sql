-- 059 · Embudo de la web pública (21/11/2026). Hasta hoy solo se medía lo que pasa dentro de la demo: no se sabía cuántos
-- llegan a la portada ni cuántos tocan «Probar», «Contratar» o WhatsApp. Una fila por paso, sin datos personales:
-- un identificador aleatorio del navegador (no la IP), la página, el botón, el origen (utm, buscador o sitio) y el tipo de
-- dispositivo. Lo escribe y lo lee solo el servidor (como demo_visitas). Se conserva 12 meses.
create table if not exists web_eventos (
  id bigint generated always as identity primary key,
  creado timestamptz not null default now(),
  visitante text check (visitante ~ '^[a-z0-9]{8,32}$'),
  tipo text not null check (tipo in ('vista', 'demo', 'contratar', 'whatsapp', 'formulario')),
  ruta text check (char_length(ruta) <= 160),
  detalle text check (char_length(detalle) <= 120),
  origen text check (char_length(origen) <= 60),
  dispositivo text check (char_length(dispositivo) <= 20)
);
create index if not exists web_eventos_creado on web_eventos (creado desc);
create index if not exists web_eventos_tipo on web_eventos (tipo, creado desc);

alter table web_eventos enable row level security;
revoke all on web_eventos from anon, authenticated;

create or replace function purgar_web_eventos() returns integer
language sql security definer set search_path = public as $$
  with b as (delete from web_eventos where creado < now() - interval '12 months' returning 1) select count(*)::int from b;
$$;
revoke all on function purgar_web_eventos() from public, anon, authenticated;
