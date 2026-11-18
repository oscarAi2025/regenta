-- 053 · Tope del tiquete POS (art. 616-1 par. 2 ET; Decreto 442/2023, art. 1.6.1.4.26 DUR 1625/2016): el documento
-- equivalente POS solo procede si la venta NO supera 5 UVT sin impuestos; por encima, factura electrónica de venta
-- (con el cliente, o a consumidor final 222222222222). Auditoría P1-1.
-- UVT 2026 = $52.374 (Res. DIAN 000238 de 2025) ⇒ tope 2026 = $261.870. Cada año se agrega la fila del año nuevo.
create table if not exists uvt (anio int primary key, valor numeric not null check (valor > 0), fuente text not null);
insert into uvt (anio, valor, fuente) values (2026, 52374, 'Res. DIAN 000238 de 2025') on conflict (anio) do nothing;
alter table uvt enable row level security;
drop policy if exists uvt_lectura on uvt;
create policy uvt_lectura on uvt for select to authenticated using (true);
grant select on uvt to authenticated;

-- 5 UVT del año de la fecha (hora de Colombia); si aún no está cargado el año, el del último año conocido.
create or replace function tope_pos(p_fecha timestamptz default now()) returns numeric language sql stable as $$
  select 5 * valor from uvt where anio <= extract(year from p_fecha at time zone 'America/Bogota')::int order by anio desc limit 1
$$;
grant execute on function tope_pos(timestamptz) to authenticated;

do $$
declare d text;
  ancla text := '  -- Cupo, bloqueo y mora del cliente, con el total ya calculado.';
  nuevo text := '  -- Tope del tiquete POS: 5 UVT sin impuestos (art. 616-1 par. 2 ET). Por encima, factura electrónica (053).
  if v_tipo = ''pos'' and v_base > coalesce(tope_pos(), v_base) then
    raise exception ''Esta venta supera 5 UVT (% sin IVA): por norma va con factura electrónica. Elige «Factura electrónica» (sirve «Consumidor final»)'', ''$'' || replace(to_char(tope_pos(), ''FM999G999G999''), '','', ''.'') using errcode = ''P0001'';
  end if;

';
begin
  select pg_get_functiondef('registrar_venta(jsonb)'::regprocedure) into d;
  if position('art. 616-1 par. 2 ET' in d) > 0 then raise notice 'registrar_venta ya aplica el tope POS';
  elsif position(ancla in d) > 0 then execute replace(d, ancla, nuevo || ancla);
  else raise exception 'registrar_venta no trae el punto esperado para el tope POS: revisar la 053 a mano';
  end if;
end $$;
