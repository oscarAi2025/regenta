-- Regenta · seguridad por fila más rápida, con las mismas reglas.
-- Las políticas de lectura llamaban a rol_en(empresa_id) en CADA fila (lotes, movimientos, productos, ventas…): con
-- miles de movimientos, cada consulta de inventario evaluaba miles de veces la membresía del usuario. Ahora las
-- empresas del usuario se calculan UNA vez por consulta (mis_empresas) y cada fila solo se compara contra esa lista.
-- Mismo resultado: miembro activo de una empresa activa; las de gerencia, además, rol dueño o administrador.

create or replace function mis_empresas(p_roles text[] default null) returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.empresa_id from miembros m join empresas x on x.id = m.empresa_id
  where m.user_id = auth.uid() and m.activo and x.estado = 'activa' and (p_roles is null or m.rol = any (p_roles))
$$;
revoke execute on function mis_empresas(text[]) from public;
grant execute on function mis_empresas(text[]) to authenticated;

do $$
declare r record; n int := 0;
begin
  for r in select tablename, policyname, qual from pg_policies where schemaname = 'public' and cmd = 'SELECT' loop
    if r.qual = '(rol_en(empresa_id) IS NOT NULL)' then
      execute format('alter policy %I on public.%I using (empresa_id in (select mis_empresas()))', r.policyname, r.tablename); n := n + 1;
    elsif r.qual = '(rol_en(id) IS NOT NULL)' then
      execute format('alter policy %I on public.%I using (id in (select mis_empresas()))', r.policyname, r.tablename); n := n + 1;
    elsif r.qual = '(rol_en(empresa_id) = ANY (ARRAY[''dueno''::text, ''admin''::text]))' then
      execute format('alter policy %I on public.%I using (empresa_id in (select mis_empresas(array[''dueno'', ''admin''])))', r.policyname, r.tablename); n := n + 1;
    end if;
  end loop;
  raise notice 'políticas aceleradas: %', n;
  if exists (select 1 from pg_policies where schemaname = 'public' and cmd = 'SELECT' and qual like '%rol_en(%') then
    raise notice 'quedan políticas con rol_en: %', (select string_agg(tablename || '.' || policyname || ' ' || qual, ' | ') from pg_policies where schemaname = 'public' and cmd = 'SELECT' and qual like '%rol_en(%');
  end if;
end $$;
