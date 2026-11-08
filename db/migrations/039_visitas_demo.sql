-- 039 · Quién entra a la demo, desde dónde y qué hace (consola, 08/11/2026)
--  · demo_visitas: una fila por entrada a la droguería de demostración. Ubicación APROXIMADA (ciudad, departamento y país
--    que da el proveedor de hosting a partir de la IP), dispositivo y navegador, de dónde vino (utm, anuncio, buscador o
--    sitio) y con qué rol entró. La IP no se guarda: solo un resumen irreversible para saber si es la misma persona.
--  · demo_eventos: lo que hace dentro (pantallas, ventas, preguntas a la IA, ofertas vistas, clics a Contratar/WhatsApp).
--  · Las escribe y lee solo el servidor (como solicitudes_demo). Se conservan 12 meses (purgar_visitas_demo).
create table if not exists demo_visitas (
  id uuid primary key default gen_random_uuid(),
  creada timestamptz not null default now(),
  ultima timestamptz not null default now(),
  rol text,
  ciudad text, region text, pais text,
  dispositivo text, navegador text, sistema text,
  origen text, campana text, landing text, referente text,
  visitante text,
  solicitud_id bigint references solicitudes_demo (id) on delete set null
);
create index if not exists demo_visitas_creada on demo_visitas (creada desc);
create index if not exists demo_visitas_visitante on demo_visitas (visitante);

create table if not exists demo_eventos (
  id bigint generated always as identity primary key,
  visita_id uuid not null references demo_visitas (id) on delete cascade,
  creado timestamptz not null default now(),
  tipo text not null check (tipo in ('pagina', 'venta', 'ia', 'oferta', 'contratar', 'whatsapp', 'datos')),
  detalle text check (char_length(detalle) <= 240)
);
create index if not exists demo_eventos_visita on demo_eventos (visita_id, creado);

alter table demo_visitas enable row level security;
alter table demo_eventos enable row level security;
revoke all on demo_visitas, demo_eventos from anon, authenticated;

create or replace function purgar_visitas_demo() returns integer
language sql security definer set search_path = public as $$
  with b as (delete from demo_visitas where creada < now() - interval '12 months' returning 1) select count(*)::int from b;
$$;
revoke all on function purgar_visitas_demo() from public, anon, authenticated;
