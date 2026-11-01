-- 014 · Correcciones del QA funcional.
-- Recibir: un lote existente no cambia de fecha de vencimiento ni de costo; no se recibe mercancía vencida.
create or replace function registrar_entrada(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := (p ->> 'empresa_id')::uuid;
  v_sede uuid := (p ->> 'sede_id')::uuid;
  v_tipo text := p ->> 'tipo';
  v_rol text := rol_en(v_emp);
  ln jsonb; v_lote uuid; v_unid integer; v_ref uuid := gen_random_uuid(); v_n integer := 0;
  v_gerencia boolean := v_rol in ('dueno', 'admin');
begin
  if v_rol is null or v_rol not in ('dueno', 'admin', 'bodeguero') then
    raise exception 'No tienes permiso para mover inventario' using errcode = '42501';
  end if;
  -- Idempotencia: la misma entrada enviada dos veces (corte de red, doble clic) se registra una sola vez.
  if (p ->> 'idem_key') is not null then
    perform pg_advisory_xact_lock(hashtext(v_emp::text || ':' || (p ->> 'idem_key')));
    if exists (select 1 from entradas_idem where empresa_id = v_emp and idem_key = p ->> 'idem_key') then
      return (select resultado || jsonb_build_object('repetida', true) from entradas_idem where empresa_id = v_emp and idem_key = p ->> 'idem_key');
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext(x)) from (select distinct e ->> 'producto_id' x from jsonb_array_elements(p -> 'lineas') e order by 1) s;
  if v_tipo not in ('inicial', 'compra', 'ajuste') then raise exception 'Tipo de entrada no válido' using errcode = 'P0001'; end if;
  if v_tipo = 'ajuste' and coalesce(trim(p ->> 'motivo'), '') = '' then
    raise exception 'Todo ajuste de inventario necesita un motivo' using errcode = 'P0001';
  end if;
  if not exists (select 1 from sedes where id = v_sede and empresa_id = v_emp) then raise exception 'Sede no válida' using errcode = 'P0001'; end if;
  for ln in select * from jsonb_array_elements(p -> 'lineas') loop
    if not exists (select 1 from productos where id = (ln ->> 'producto_id')::uuid and empresa_id = v_emp) then
      raise exception 'Producto no válido' using errcode = 'P0001';
    end if;
    v_unid := (ln ->> 'unidades')::integer;
    if v_unid is null or v_unid = 0 or (v_tipo <> 'ajuste' and v_unid < 0) then raise exception 'Cantidad no válida' using errcode = 'P0001'; end if;
    insert into lotes (empresa_id, sede_id, producto_id, lote, vence)
    values (v_emp, v_sede, (ln ->> 'producto_id')::uuid, upper(trim(ln ->> 'lote')), (ln ->> 'vence')::date)
    on conflict (sede_id, producto_id, lote) do update set vence = coalesce(lotes.vence, excluded.vence)
    returning id into v_lote;
    -- Un lote tiene UNA fecha de vencimiento: si llega el mismo lote con otra fecha es un error de digitación (o
    -- mercancía distinta), nunca se cambia la fecha de lo que ya está en la estantería.
    if (ln ->> 'vence') is not null and (select vence from lotes where id = v_lote) <> (ln ->> 'vence')::date then
      raise exception 'El lote % ya existe con vencimiento %: revisa la fecha o usa otro código de lote', upper(trim(ln ->> 'lote')),
        to_char((select vence from lotes where id = v_lote), 'DD/MM/YYYY') using errcode = 'P0001';
    end if;
    if v_tipo <> 'ajuste' and (ln ->> 'vence') is not null and (ln ->> 'vence')::date < current_date then
      raise exception 'El lote % ya está vencido: no se puede recibir para la venta', upper(trim(ln ->> 'lote')) using errcode = 'P0001';
    end if;
    if (ln ->> 'costo_unidad') is not null and v_gerencia then  -- el costo solo lo registra la gerencia
      insert into lote_costos (lote_id, empresa_id, costo_unidad) values (v_lote, v_emp, (ln ->> 'costo_unidad')::numeric)
      on conflict (lote_id) do nothing; -- el costo del lote es el de su primera entrada
    end if;
    if v_unid < 0 then
      if (select unidades from v_stock_lotes where lote_id = v_lote) + v_unid < 0 then
        raise exception 'El ajuste dejaría el lote % en negativo', ln ->> 'lote' using errcode = 'P0001';
      end if;
    end if;
    insert into movimientos (empresa_id, sede_id, producto_id, lote_id, cantidad, tipo, ref_id, motivo, usuario_id)
    values (v_emp, v_sede, (ln ->> 'producto_id')::uuid, v_lote, v_unid, v_tipo, v_ref, p ->> 'motivo', auth.uid());
    v_n := v_n + 1;
  end loop;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v_emp, auth.uid(), 'entrada_' || v_tipo, 'movimientos', v_ref::text, jsonb_build_object('lineas', v_n, 'motivo', p ->> 'motivo'));
  if (p ->> 'idem_key') is not null then
    insert into entradas_idem (empresa_id, idem_key, resultado) values (v_emp, p ->> 'idem_key', jsonb_build_object('ref', v_ref, 'lineas', v_n));
  end if;
  return jsonb_build_object('ref', v_ref, 'lineas', v_n);
end $$;
