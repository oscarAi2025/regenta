-- Regenta · clientes con cuenta (fiado controlado) y cartera por cliente.
--  · Cada cliente puede tener cupo de crédito (null = sin cupo: la cajera no le fía), plazo por defecto, bloqueo y notas.
--    Solo el dueño o el administrador cambian esos datos (función auditada; la cajera no escribe esas columnas).
--  · La droguería puede bloquear el fiado a quien tenga una factura con más de N días de mora (dias_mora_bloqueo).
--  · La venta a crédito sigue exigiendo factura electrónica y cliente (restricción credito_completo). La cajera fía si el
--    cliente tiene cupo, no está bloqueado, no pasa el límite de mora y saldo + venta ≤ cupo. El dueño o el administrador
--    pueden pasarse con un motivo obligatorio que queda en la auditoría. Sin cupo asignado, la gerencia sigue fiando como
--    hasta hoy (sin motivo), salvo bloqueo o mora.
--  · Recibos de caja (RC, consecutivo por droguería): un pago del cliente se reparte entre sus facturas, la que vence
--    primero primero; nunca más que lo que debe. Inmutables: solo se anulan (con motivo), y anular restituye los saldos.
--  · Abonos con caja y turno: la cajera recibe abonos con su turno abierto y el efectivo entra al turno de SU caja (con
--    varias cajas activas, antes no entraba a ninguno). Los abonos antiguos sin caja ni turno siguen la regla anterior.

-- ───────────────────────── Datos de crédito ─────────────────────────
alter table clientes add column if not exists cupo_credito numeric(14, 2) check (cupo_credito is null or (cupo_credito >= 0 and cupo_credito = trunc(cupo_credito)));
alter table clientes add column if not exists plazo_dias_defecto integer check (plazo_dias_defecto between 1 and 180);
alter table clientes add column if not exists credito_bloqueado boolean not null default false;
alter table clientes add column if not exists notas text check (length(notas) <= 500);
alter table empresas add column if not exists dias_mora_bloqueo integer check (dias_mora_bloqueo between 0 and 365);

-- Quien vende crea y corrige clientes, pero las columnas de crédito solo cambian por configurar_credito_cliente().
revoke insert, update on clientes from authenticated;
grant insert (empresa_id, tipo_doc, numero_doc, dv, nombre, email, telefono, autoriza_datos) on clientes to authenticated;
grant update (tipo_doc, numero_doc, dv, nombre, email, telefono, autoriza_datos) on clientes to authenticated;

-- ───────────────────────── Recibos de caja ─────────────────────────
create table if not exists recibos_caja (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references empresas on delete cascade,
  numero integer not null check (numero > 0),
  cliente_id uuid not null references clientes on delete restrict,
  medio text not null check (medio in ('efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'bre_b', 'qr')),
  valor numeric(14, 2) not null check (valor > 0 and valor = trunc(valor)),
  referencia text check (length(referencia) <= 60),
  caja_id uuid references cajas,
  turno_id uuid references turnos,
  usuario_id uuid not null,
  saldo_anterior numeric(14, 2) not null,
  aplicado jsonb not null default '[]',           -- [{venta_id, factura, vence, valor, saldo}] cómo se repartió el pago
  anulado boolean not null default false,
  motivo text check (motivo is null or length(trim(motivo)) between 4 and 200),
  anulado_por uuid,
  anulado_en timestamptz,
  creado timestamptz not null default now(),
  unique (empresa_id, numero),
  check (anulado = (motivo is not null))
);
create index if not exists recibos_caja_cliente on recibos_caja (cliente_id, creado desc);
create index if not exists recibos_caja_turno on recibos_caja (turno_id) where turno_id is not null;

-- Un recibo solo cambia para anularse (con motivo, quién y cuándo); nada más, y nunca se borra.
create or replace function recibo_solo_anular() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Los recibos de caja no se borran: se anulan' using errcode = 'P0001'; end if;
  if (to_jsonb(new) - 'anulado' - 'motivo' - 'anulado_por' - 'anulado_en') <> (to_jsonb(old) - 'anulado' - 'motivo' - 'anulado_por' - 'anulado_en')
     or old.anulado or not new.anulado then
    raise exception 'Un recibo de caja solo puede anularse' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists recibos_caja_inmutables on recibos_caja;
create trigger recibos_caja_inmutables before update or delete on recibos_caja for each row execute function recibo_solo_anular();

alter table abonos add column if not exists caja_id uuid references cajas;
alter table abonos add column if not exists turno_id uuid references turnos;
alter table abonos add column if not exists recibo_id bigint references recibos_caja;
create index if not exists abonos_turno on abonos (turno_id) where turno_id is not null;
create index if not exists abonos_recibo on abonos (recibo_id) where recibo_id is not null;
create index if not exists ventas_cliente_credito on ventas (cliente_id, vence_pago) where condicion = 'credito';

alter table recibos_caja enable row level security;
drop policy if exists caja_lee on recibos_caja;
create policy caja_lee on recibos_caja for select to authenticated using (empresa_id in (select mis_empresas(array['dueno', 'admin', 'cajero'])));
revoke all on recibos_caja from anon, authenticated;
grant select on recibos_caja to authenticated;

-- Cartera: el saldo descuenta lo devuelto que bajó el saldo (a_saldo); lo que se reembolsó al cliente porque ya había
-- pagado no deja la factura en negativo. Mismas columnas.
create or replace view v_cartera with (security_invoker = true) as
  select v.id venta_id, v.empresa_id, v.prefijo, v.numero, v.creado, v.vence_pago, v.plazo_dias, v.total,
         c.id cliente_id, c.nombre cliente, c.tipo_doc, c.numero_doc, c.dv, c.telefono, c.email,
         coalesce(a.abonado, 0) abonado, v.total - coalesce(d.a_saldo, 0) - coalesce(a.abonado, 0) saldo,
         greatest(0, current_date - v.vence_pago) dias_mora, v.devuelto
  from ventas v
  join clientes c on c.id = v.cliente_id
  left join (select venta_id, sum(valor) abonado from abonos where not anulado group by venta_id) a on a.venta_id = v.id
  left join (select venta_id, sum(a_saldo) a_saldo from devoluciones group by venta_id) d on d.venta_id = v.id
  where v.condicion = 'credito' and v.estado = 'cerrada' and v.empresa_id in (select mis_empresas(array['dueno', 'admin']));

-- ───────────────────────── Funciones auxiliares (internas) ─────────────────────────
-- Pesos colombianos para los mensajes: $150.000
create or replace function pesos_texto(n numeric) returns text language sql immutable as $$
  select '$' || replace(to_char(round(coalesce(n, 0)), 'FM999,999,999,990'), ',', '.')
$$;

-- Saldo de una factura a crédito: total − lo devuelto que bajó el saldo − abonos vigentes.
create or replace function saldo_factura(p_venta uuid) returns numeric language sql stable security definer set search_path = public as $$
  select v.total - coalesce((select sum(d.a_saldo) from devoluciones d where d.venta_id = v.id), 0)
         - coalesce((select sum(a.valor) from abonos a where a.venta_id = v.id and not a.anulado), 0)
  from ventas v where v.id = p_venta
$$;

-- Estado de crédito de un cliente frente a una venta de p_valor. p_gerencia: quien pregunta es dueño o administrador.
--   puede_fiar       se le puede fiar sin autorización
--   requiere_motivo  no se puede, pero la gerencia puede autorizarlo con un motivo
--   motivo           por qué no (en español); aviso: nota para la gerencia cuando fía sin cupo asignado
create or replace function credito_cliente(p_cliente uuid, p_valor numeric, p_gerencia boolean) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cl clientes; v_lim integer; v_saldo numeric; v_mora integer; v_n integer; v_motivo text; v_disp numeric;
  v_puede boolean; v_valor numeric := greatest(coalesce(p_valor, 0), 0); v_excede_mora boolean;
begin
  select * into cl from clientes where id = p_cliente;
  if not found then return null; end if;
  select dias_mora_bloqueo into v_lim from empresas where id = cl.empresa_id;
  select coalesce(sum(s), 0), coalesce(max(m), 0), count(*) into v_saldo, v_mora, v_n from (
    select saldo_factura(v.id) s, greatest(0, current_date - v.vence_pago) m
    from ventas v where v.cliente_id = cl.id and v.empresa_id = cl.empresa_id and v.condicion = 'credito' and v.estado = 'cerrada') x
  where s > 0;
  v_disp := case when cl.cupo_credito is null then null else greatest(0, cl.cupo_credito - v_saldo) end;
  v_excede_mora := v_lim is not null and v_mora > v_lim;
  if cl.credito_bloqueado then
    v_motivo := 'El crédito de este cliente está bloqueado';
  elsif v_excede_mora then
    v_motivo := format('Mora de %s días: pasa el límite de %s días de la droguería', v_mora, v_lim);
  elsif cl.cupo_credito is null then
    v_motivo := 'Sin cupo de crédito asignado';
  elsif v_valor > 0 and v_saldo + v_valor > cl.cupo_credito then
    v_motivo := format('La venta (%s) supera el cupo disponible (%s de %s)', pesos_texto(v_valor), pesos_texto(v_disp), pesos_texto(cl.cupo_credito));
  elsif v_valor = 0 and v_disp <= 0 then
    v_motivo := format('Cupo agotado: debe %s de un cupo de %s', pesos_texto(v_saldo), pesos_texto(cl.cupo_credito));
  end if;
  -- Sin cupo asignado (y sin bloqueo ni mora), la gerencia fía como hasta hoy, bajo su criterio.
  v_puede := v_motivo is null or (p_gerencia and cl.cupo_credito is null and not cl.credito_bloqueado and not v_excede_mora);
  return jsonb_build_object(
    'puede_fiar', v_puede, 'requiere_motivo', not v_puede and p_gerencia, 'motivo', case when v_puede then null else v_motivo end,
    'aviso', case when v_puede and v_motivo is not null then 'Sin cupo asignado: el crédito queda a criterio de la gerencia' end,
    'cupo', cl.cupo_credito, 'cupo_disponible', v_disp, 'saldo', v_saldo, 'facturas', v_n, 'dias_mora', v_mora,
    'limite_mora', v_lim, 'bloqueado', cl.credito_bloqueado, 'plazo_dias', cl.plazo_dias_defecto);
end $$;

-- Caja y turno abierto donde entra un pago: la caja debe ser de la droguería y estar activa.
create or replace function caja_y_turno(p_emp uuid, p_caja uuid, out caja_id uuid, out turno_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_caja is null then return; end if;
  select c.id into caja_id from cajas c where c.id = p_caja and c.empresa_id = p_emp and c.activa;
  if caja_id is null then raise exception 'Caja no válida' using errcode = 'P0001'; end if;
  select t.id into turno_id from turnos t where t.caja_id = p_caja and t.estado = 'abierto';
end $$;

-- ───────────────────────── Funciones públicas ─────────────────────────
-- Estado de crédito para la caja y la ficha: quien vende (dueño, administrador, cajera) de esa droguería.
create or replace function estado_credito(p_cliente uuid, p_valor numeric default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid; v_rol text;
begin
  select empresa_id into v_emp from clientes where id = p_cliente;
  v_rol := case when v_emp is not null then rol_en(v_emp) end;
  if coalesce(v_rol, '') not in ('dueno', 'admin', 'cajero') then raise exception 'No tienes permiso para ver el crédito de este cliente' using errcode = '42501'; end if;
  return credito_cliente(p_cliente, p_valor, v_rol in ('dueno', 'admin'));
end $$;

-- Datos de crédito del cliente: solo dueño o administrador; cada cambio queda en la auditoría con el antes y el después.
create or replace function configurar_credito_cliente(p_cliente uuid, p_cupo numeric, p_plazo integer, p_bloqueado boolean, p_notas text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cl clientes; v_notas text := nullif(trim(coalesce(p_notas, '')), '');
begin
  select * into cl from clientes where id = p_cliente for update;
  if not found or coalesce(rol_en(cl.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador cambian el crédito de un cliente' using errcode = '42501';
  end if;
  if p_cupo is not null and (p_cupo < 0 or p_cupo <> trunc(p_cupo) or p_cupo > 10000000000) then raise exception 'El cupo va en pesos, sin centavos' using errcode = 'P0001'; end if;
  if p_plazo is not null and (p_plazo < 1 or p_plazo > 180) then raise exception 'El plazo debe estar entre 1 y 180 días' using errcode = 'P0001'; end if;
  if length(v_notas) > 500 then raise exception 'Las notas van hasta 500 caracteres' using errcode = 'P0001'; end if;
  update clientes set cupo_credito = p_cupo, plazo_dias_defecto = p_plazo, credito_bloqueado = coalesce(p_bloqueado, false), notas = v_notas where id = p_cliente;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (cl.empresa_id, auth.uid(), 'credito_cliente', 'clientes', p_cliente::text, jsonb_build_object(
    'antes', jsonb_build_object('cupo', cl.cupo_credito, 'plazo', cl.plazo_dias_defecto, 'bloqueado', cl.credito_bloqueado, 'notas', cl.notas),
    'despues', jsonb_build_object('cupo', p_cupo, 'plazo', p_plazo, 'bloqueado', coalesce(p_bloqueado, false), 'notas', v_notas)));
  return credito_cliente(p_cliente, 0, true);
end $$;

-- Bloquear el fiado por mora (null = no bloquea). Dueño o administrador; en la demostración no se cambia.
create or replace function configurar_mora(p_empresa uuid, p_dias integer) returns void
language plpgsql security definer set search_path = public as $$
declare v_antes integer;
begin
  if coalesce(rol_en(p_empresa), '') not in ('dueno', 'admin') then raise exception 'Solo el dueño o el administrador cambian esta opción' using errcode = '42501'; end if;
  if (select demo from empresas where id = p_empresa) then raise exception 'En la droguería de demostración esta opción no se cambia' using errcode = 'P0001'; end if;
  if p_dias is not null and (p_dias < 0 or p_dias > 365) then raise exception 'Los días de mora van de 0 a 365' using errcode = 'P0001'; end if;
  select dias_mora_bloqueo into v_antes from empresas where id = p_empresa;
  update empresas set dias_mora_bloqueo = p_dias where id = p_empresa;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (p_empresa, auth.uid(), 'mora_bloqueo', 'empresas', p_empresa::text, jsonb_build_object('antes', v_antes, 'despues', p_dias));
end $$;

-- Clientes con saldo pendiente (para recibir un pago en la caja): quien vende de esa droguería.
create or replace function deudores(p_empresa uuid, p_q text default '') returns table (cliente_id uuid, nombre text, documento text, telefono text, saldo numeric, facturas integer, dias_mora integer)
language plpgsql stable security definer set search_path = public as $$
declare v_q text := lower(trim(coalesce(p_q, '')));
begin
  if coalesce(rol_en(p_empresa), '') not in ('dueno', 'admin', 'cajero') then raise exception 'No tienes permiso para ver la cartera' using errcode = '42501'; end if;
  return query
    select cl.id, cl.nombre, cl.tipo_doc || ' ' || cl.numero_doc || coalesce('-' || cl.dv, ''), cl.telefono,
           sum(x.s), count(*)::int, max(x.m)::int
    from clientes cl
    join lateral (select saldo_factura(v.id) s, greatest(0, current_date - v.vence_pago) m from ventas v
                  where v.cliente_id = cl.id and v.empresa_id = p_empresa and v.condicion = 'credito' and v.estado = 'cerrada') x on x.s > 0
    where cl.empresa_id = p_empresa
      and (v_q = '' or cl.numero_doc like replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%'
           or lower(cl.nombre) like '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%')
    group by cl.id order by max(x.m) desc, cl.nombre limit 8;
end $$;

-- Recibo de caja: el pago del cliente se reparte entre sus facturas a crédito, primero la que vence antes (y la más
-- antigua). No se acepta más de lo que debe. La cajera solo recibe con su turno abierto; el efectivo entra a ese turno.
create or replace function registrar_recibo(p_cliente uuid, p_medio text, p_valor numeric, p_referencia text default null, p_caja uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cl clientes; v_rol text; v_caja uuid; v_turno uuid; f record; v_saldo_total numeric := 0; v_resta numeric; v_toma numeric;
  v_aplicado jsonb := '[]'; v_num integer; v_id bigint; x jsonb; v_ref text := nullif(trim(coalesce(p_referencia, '')), '');
begin
  select * into cl from clientes where id = p_cliente;
  v_rol := case when found then rol_en(cl.empresa_id) end;
  if coalesce(v_rol, '') not in ('dueno', 'admin', 'cajero') then raise exception 'No tienes permiso para recibir pagos en esta droguería' using errcode = '42501'; end if;
  if (select estado from empresas where id = cl.empresa_id) <> 'activa' then raise exception 'La suscripción de esta empresa está suspendida' using errcode = 'P0001'; end if;
  if p_medio is null or p_medio not in ('efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'bre_b', 'qr') then raise exception 'Medio de pago no válido' using errcode = 'P0001'; end if;
  if p_valor is null or p_valor <= 0 or p_valor <> trunc(p_valor) then raise exception 'El pago debe ser un valor en pesos mayor que cero' using errcode = 'P0001'; end if;
  if length(v_ref) > 60 then raise exception 'La referencia va hasta 60 caracteres' using errcode = 'P0001'; end if;
  select c.caja_id, c.turno_id into v_caja, v_turno from caja_y_turno(cl.empresa_id, p_caja) c;
  if v_rol = 'cajero' and v_turno is null then
    raise exception 'Abre el turno de tu caja para recibir abonos (Caja → Turno); si no, lo registra el dueño o el administrador' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('credito:' || cl.id::text));
  v_resta := p_valor;
  for f in
    select v.id, v.prefijo || v.numero factura, v.vence_pago, saldo_factura(v.id) saldo
    from ventas v where v.cliente_id = cl.id and v.empresa_id = cl.empresa_id and v.condicion = 'credito' and v.estado = 'cerrada'
    order by v.vence_pago, v.creado, v.numero for update of v
  loop
    continue when f.saldo <= 0;
    v_saldo_total := v_saldo_total + f.saldo;
    if v_resta > 0 then
      v_toma := least(v_resta, f.saldo);
      v_aplicado := v_aplicado || jsonb_build_object('venta_id', f.id, 'factura', f.factura, 'vence', f.vence_pago, 'valor', v_toma, 'saldo', f.saldo - v_toma);
      v_resta := v_resta - v_toma;
    end if;
  end loop;
  if v_saldo_total = 0 then raise exception 'Este cliente no tiene saldo pendiente' using errcode = 'P0001'; end if;
  if v_resta > 0 then
    raise exception 'El pago (%) supera lo que debe el cliente (%): recibe como máximo el saldo', pesos_texto(p_valor), pesos_texto(v_saldo_total) using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('recibo:' || cl.empresa_id::text));
  select coalesce(max(numero), 0) + 1 into v_num from recibos_caja where empresa_id = cl.empresa_id;
  insert into recibos_caja (empresa_id, numero, cliente_id, medio, valor, referencia, caja_id, turno_id, usuario_id, saldo_anterior, aplicado)
  values (cl.empresa_id, v_num, cl.id, p_medio, p_valor, v_ref, v_caja, v_turno, auth.uid(), v_saldo_total, v_aplicado) returning id into v_id;
  for x in select * from jsonb_array_elements(v_aplicado) loop
    insert into abonos (empresa_id, venta_id, medio, valor, referencia, usuario_id, caja_id, turno_id, recibo_id)
    values (cl.empresa_id, (x ->> 'venta_id')::uuid, p_medio, (x ->> 'valor')::numeric, left('RC-' || v_num || coalesce(' · ' || v_ref, ''), 60), auth.uid(), v_caja, v_turno, v_id);
  end loop;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (cl.empresa_id, auth.uid(), 'recibo_caja', 'clientes', cl.id::text,
          jsonb_build_object('recibo', v_id, 'numero', 'RC-' || v_num, 'valor', p_valor, 'medio', p_medio, 'facturas', jsonb_array_length(v_aplicado)));
  return jsonb_build_object('id', v_id, 'numero', v_num, 'valor', p_valor, 'medio', p_medio, 'aplicado', v_aplicado,
                            'saldo_anterior', v_saldo_total, 'saldo', v_saldo_total - p_valor, 'turno_id', v_turno);
end $$;

-- Anular un recibo de caja: sus abonos quedan anulados (los saldos vuelven) y, si el efectivo ya se había cerrado en un
-- turno anterior, la devolución sale del turno abierto de esa caja (si no, el cierre actual mostraría un sobrante).
create or replace function anular_recibo(p_recibo bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r recibos_caja; v_turno turnos; v_motivo text := trim(coalesce(p_motivo, ''));
begin
  select * into r from recibos_caja where id = p_recibo for update;
  if not found or coalesce(rol_en(r.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador anulan recibos de caja' using errcode = '42501';
  end if;
  if r.anulado then raise exception 'Ese recibo ya está anulado' using errcode = 'P0001'; end if;
  if length(v_motivo) < 4 then raise exception 'Escribe el motivo de la anulación' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('credito:' || r.cliente_id::text));
  update abonos set anulado = true, anulado_motivo = left('Recibo RC-' || r.numero || ' anulado: ' || v_motivo, 200) where recibo_id = r.id and not anulado;
  update recibos_caja set anulado = true, motivo = left(v_motivo, 200), anulado_por = auth.uid(), anulado_en = now() where id = r.id;
  if r.medio = 'efectivo' and r.turno_id is not null and exists (select 1 from turnos where id = r.turno_id and estado = 'cerrado') then
    select * into v_turno from turnos where caja_id = r.caja_id and estado = 'abierto';
    if found then
      insert into movimientos_caja (empresa_id, turno_id, tipo, valor, concepto, usuario_id)
      values (r.empresa_id, v_turno.id, 'egreso', r.valor, left('Devolución por anulación del recibo RC-' || r.numero, 120), auth.uid());
    end if;
  end if;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (r.empresa_id, auth.uid(), 'anular_recibo', 'clientes', r.cliente_id::text, jsonb_build_object('recibo', r.id, 'numero', 'RC-' || r.numero, 'valor', r.valor, 'motivo', v_motivo));
  return credito_cliente(r.cliente_id, 0, true);
end $$;

-- Un abono que es parte de un recibo de caja no se anula suelto: se anula el recibo completo.
create or replace function anular_abono(p_abono bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare a abonos;
begin
  select * into a from abonos where id = p_abono for update;
  if not found or coalesce(rol_en(a.empresa_id), '') not in ('dueno', 'admin') then
    raise exception 'Solo el dueño o el administrador anulan abonos' using errcode = '42501';
  end if;
  if a.anulado then raise exception 'Ese abono ya está anulado' using errcode = 'P0001'; end if;
  if a.recibo_id is not null then
    raise exception 'Este abono es parte del recibo de caja RC-%: anula el recibo completo desde la ficha del cliente', (select numero from recibos_caja where id = a.recibo_id) using errcode = 'P0001';
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indica el motivo' using errcode = 'P0001'; end if;
  update abonos set anulado = true, anulado_motivo = p_motivo where id = p_abono;
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (a.empresa_id, auth.uid(), 'anular_abono', 'ventas', a.venta_id::text, jsonb_build_object('abono', p_abono, 'valor', a.valor, 'motivo', p_motivo));
end $$;

-- Abono a una factura: dueño o administrador (como antes) y también la cajera con su turno abierto. Con caja (p_caja), el
-- abono queda en esa caja y en su turno abierto: el efectivo cuenta en ese turno y en ningún otro.
drop function if exists registrar_abono(uuid, text, numeric, text);
create or replace function registrar_abono(p_venta uuid, p_medio text, p_valor numeric, p_referencia text default null, p_caja uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v ventas; v_rol text; v_cli uuid; v_emp uuid; v_abonado numeric; v_saldo numeric; v_caja uuid; v_turno uuid;
begin
  select cliente_id, empresa_id into v_cli, v_emp from ventas where id = p_venta;
  v_rol := case when v_emp is not null then rol_en(v_emp) end;
  if coalesce(v_rol, '') not in ('dueno', 'admin', 'cajero') then
    raise exception 'Solo el dueño o el administrador registran abonos' using errcode = '42501';
  end if;
  select c.caja_id, c.turno_id into v_caja, v_turno from caja_y_turno(v_emp, p_caja) c;
  if v_rol = 'cajero' and v_turno is null then
    raise exception 'Abre el turno de tu caja para recibir abonos (Caja → Turno); si no, lo registra el dueño o el administrador' using errcode = 'P0001';
  end if;
  if v_cli is not null then perform pg_advisory_xact_lock(hashtext('credito:' || v_cli::text)); end if;
  select * into v from ventas where id = p_venta for update;
  if v.condicion <> 'credito' then raise exception 'Esta venta no es a crédito' using errcode = 'P0001'; end if;
  if v.estado <> 'cerrada' then raise exception 'La venta está anulada' using errcode = 'P0001'; end if;
  if p_medio is null or p_medio not in ('efectivo', 'transferencia', 'nequi', 'daviplata', 'tarjeta', 'bre_b', 'qr') then raise exception 'Medio de pago no válido' using errcode = 'P0001'; end if;
  if p_valor is null or p_valor <= 0 or p_valor <> trunc(p_valor) then raise exception 'El abono debe ser un valor en pesos mayor que cero' using errcode = 'P0001'; end if;
  select coalesce(sum(valor), 0) into v_abonado from abonos where venta_id = p_venta and not anulado;
  v_saldo := saldo_factura(p_venta);
  if p_valor > v_saldo then raise exception 'El abono (%) supera el saldo de la factura (%)', p_valor, v_saldo using errcode = 'P0001'; end if;
  insert into abonos (empresa_id, venta_id, medio, valor, referencia, usuario_id, caja_id, turno_id)
  values (v.empresa_id, p_venta, p_medio, p_valor, nullif(trim(coalesce(p_referencia, '')), ''), auth.uid(), v_caja, v_turno);
  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v.empresa_id, auth.uid(), 'abono', 'ventas', p_venta::text, jsonb_build_object('valor', p_valor, 'medio', p_medio, 'caja', v_caja, 'turno', v_turno));
  return jsonb_build_object('abonado', v_abonado + p_valor, 'saldo', v_saldo - p_valor);
end $$;

-- ───────────────────────── Venta (desde 022): cupo, bloqueo y mora del cliente ─────────────────────────
-- Igual que la versión de 022 (descuentos de 019, cajas, IVA, habilitación DIAN, lotes FEFO sin vencidos ni separados);
-- cambia solo la regla de crédito. La fórmula médica (030) sigue aparte, en la misma transacción.
create or replace function registrar_venta(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid := (p ->> 'empresa_id')::uuid;
  v_sede uuid := (p ->> 'sede_id')::uuid;
  v_caja uuid := (p ->> 'caja_id')::uuid;
  v_tipo text := coalesce(p ->> 'tipo_doc', 'pos');
  v_user uuid := auth.uid();
  v_rol text;
  v_venta uuid;
  v_existente ventas;
  v_res resoluciones_dian;
  v_num bigint;
  ln jsonb; pg jsonb;
  v_prod productos;
  v_pres text; v_cant numeric; v_unid integer; v_precio numeric;
  v_falta integer; v_toma integer; v_parte numeric;
  r record;
  v_base numeric := 0; v_iva numeric := 0; v_total numeric := 0;
  l_total numeric; l_base numeric; l_iva numeric;
  v_recibido numeric := 0; v_efectivo numeric := 0; v_cambio numeric;
  v_doc uuid;
  v_credito boolean := coalesce(p ->> 'condicion', 'contado') = 'credito';
  v_plazo integer;
  v_linea numeric; v_asignado numeric;
  v_bruto numeric; v_desc_linea numeric; v_desc_asig numeric; l_desc numeric; v_dpct numeric; v_dgen numeric; v_dmax numeric;
  v_cant_asig numeric; l_cant numeric; v_ivapct numeric; v_resp_iva boolean; v_demo boolean;
  v_cli clientes; v_cred jsonb; v_motivo_cred text; v_autoriza boolean := false;
begin
  v_rol := rol_en(v_emp);
  if v_rol is null or v_rol not in ('dueno', 'admin', 'cajero') then
    raise exception 'No tienes permiso para vender en esta empresa' using errcode = '42501';
  end if;
  select responsable_iva, demo into v_resp_iva, v_demo from empresas where id = v_emp;
  if (select estado from empresas where id = v_emp) <> 'activa' then
    raise exception 'La suscripción de esta empresa está suspendida' using errcode = 'P0001';
  end if;
  if not exists (select 1 from cajas where id = v_caja and empresa_id = v_emp and sede_id = v_sede and activa) then
    raise exception 'Caja no válida' using errcode = 'P0001';
  end if;
  if v_tipo not in ('pos', 'factura') then raise exception 'Tipo de documento no válido' using errcode = 'P0001'; end if;
  if v_tipo = 'factura' and (p ->> 'cliente_id') is null then
    raise exception 'La factura electrónica necesita los datos del cliente' using errcode = 'P0001';
  end if;
  -- La factura electrónica se entrega por correo al adquirente: sin un correo válido la DIAN/MATIAS la rechaza.
  if v_tipo = 'factura' and not exists (select 1 from clientes where id = (p ->> 'cliente_id')::uuid and empresa_id = v_emp
      and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'La factura electrónica necesita el correo del cliente: edítalo en sus datos' using errcode = 'P0001';
  end if;
  if (p ->> 'cliente_id') is not null and not exists (select 1 from clientes where id = (p ->> 'cliente_id')::uuid and empresa_id = v_emp) then
    raise exception 'Cliente no válido' using errcode = 'P0001';
  end if;
  if coalesce(p ->> 'condicion', 'contado') not in ('contado', 'credito') then raise exception 'Condición de pago no válida' using errcode = 'P0001'; end if;
  if v_credito then
    -- A crédito, con factura electrónica a un cliente identificado. La cajera fía dentro del cupo del cliente; el dueño o el
    -- administrador pueden pasarse con un motivo que queda en la auditoría (se comprueba con el total, tras las líneas).
    -- El candado por cliente evita que dos cajas fíen a la vez sobre el mismo cupo.
    if v_tipo <> 'factura' then raise exception 'La venta a crédito se hace con factura electrónica' using errcode = 'P0001'; end if;
    select * into v_cli from clientes where id = (p ->> 'cliente_id')::uuid and empresa_id = v_emp;
    perform pg_advisory_xact_lock(hashtext('credito:' || v_cli.id::text));
    v_plazo := coalesce((p ->> 'plazo_dias')::integer, v_cli.plazo_dias_defecto);
    if v_plazo is null or v_plazo < 1 or v_plazo > 180 then raise exception 'El plazo de pago debe estar entre 1 y 180 días' using errcode = 'P0001'; end if;
    if jsonb_array_length(coalesce(p -> 'pagos', '[]')) > 0 then raise exception 'La venta a crédito no lleva pago en caja: registra los abonos en Cartera' using errcode = 'P0001'; end if;
  end if;
  if jsonb_array_length(coalesce(p -> 'lineas', '[]')) = 0 then raise exception 'La venta no tiene productos' using errcode = 'P0001'; end if;
  -- Descuentos: por línea (descuento_pct de cada línea) y general sobre toda la venta (p.descuento_pct). La cajera tiene un
  -- tope (empresas.descuento_max_cajero); el dueño y el administrador no.
  v_dgen := coalesce((p ->> 'descuento_pct')::numeric, 0);
  if v_dgen < 0 or v_dgen >= 100 then raise exception 'El descuento general debe estar entre 0 y 99 %%' using errcode = 'P0001'; end if;
  select descuento_max_cajero into v_dmax from empresas where id = v_emp;

  -- Reintento de una venta ya registrada (la caja volvió a enviarla): se devuelve la misma. El candado sobre la clave
  -- evita que dos envíos simultáneos de la misma venta choquen.
  perform pg_advisory_xact_lock(hashtext(v_emp::text || ':' || (p ->> 'idem_key')));
  select * into v_existente from ventas where empresa_id = v_emp and idem_key = p ->> 'idem_key';
  if found then
    return jsonb_build_object('venta_id', v_existente.id, 'prefijo', v_existente.prefijo, 'numero', v_existente.numero,
                              'total', v_existente.total, 'cambio', v_existente.cambio, 'repetida', true);
  end if;

  -- Numeración de la resolución activa (bloqueo de fila: dos cajas no pueden tomar el mismo número).
  select * into v_res from resoluciones_dian where empresa_id = v_emp and tipo = v_tipo and activa for update;
  if not found then raise exception 'No hay resolución de numeración activa para %', v_tipo using errcode = 'P0001'; end if;
  -- Antes de la habilitación ante la DIAN no se vende de verdad (el documento no tendría validez fiscal). La demo sí.
  if v_res.pruebas and not v_demo then
    raise exception 'Tu droguería aún no está habilitada ante la DIAN: ya puedes cargar productos, inventario y usuarios; la caja vende en cuanto quede cargada tu resolución' using errcode = 'P0001';
  end if;
  if v_res.vigente_hasta is not null and v_res.vigente_hasta < current_date then
    raise exception 'La resolución de numeración venció el %', v_res.vigente_hasta using errcode = 'P0001';
  end if;
  v_num := v_res.actual + 1;
  if v_num > v_res.hasta then raise exception 'Se agotó la numeración autorizada (%-%)', v_res.prefijo, v_res.hasta using errcode = 'P0001'; end if;
  update resoluciones_dian set actual = v_num where id = v_res.id;

  -- Candados por producto en orden fijo (evita bloqueos mutuos con otra venta o un ajuste).
  perform pg_advisory_xact_lock(hashtext(x)) from (select distinct e ->> 'producto_id' x from jsonb_array_elements(p -> 'lineas') e order by 1) s;

  -- La venta se inserta al final, ya con sus totales: las líneas y pagos la referencian con FK diferida.
  v_venta := gen_random_uuid();

  for ln in select * from jsonb_array_elements(p -> 'lineas') loop
    select * into v_prod from productos where id = (ln ->> 'producto_id')::uuid and empresa_id = v_emp and activo;
    if not found then raise exception 'Producto no válido' using errcode = 'P0001'; end if;
    v_pres := coalesce(ln ->> 'presentacion', 'caja');
    v_cant := (ln ->> 'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 or v_cant <> trunc(v_cant) then raise exception 'Cantidad no válida en %', v_prod.nombre using errcode = 'P0001'; end if;
    if v_pres = 'caja' then
      v_unid := v_cant * v_prod.unidades_por_caja; v_precio := v_prod.precio_caja;
    elsif v_pres = 'unidad' then
      if v_prod.precio_unidad is null then raise exception '% no se vende por unidad', v_prod.nombre using errcode = 'P0001'; end if;
      v_unid := v_cant; v_precio := v_prod.precio_unidad;
    else raise exception 'Presentación no válida' using errcode = 'P0001';
    end if;

    -- Lotes con existencias de esta sede, el que vence antes primero (FEFO). Una línea puede repartirse en varios lotes.
    -- Nunca se vende un lote vencido. Bloqueo por producto: dos cajas no pueden descontar el mismo lote a la vez.
    perform pg_advisory_xact_lock(hashtext(v_prod.id::text));
    v_falta := v_unid;
    -- El total de la línea se calcula una vez; el último lote recibe el resto (sin centavos sueltos al repartir).
    v_dpct := coalesce((ln ->> 'descuento_pct')::numeric, 0);
    if v_dpct < 0 or v_dpct >= 100 then raise exception 'Descuento no válido en %', v_prod.nombre using errcode = 'P0001'; end if;
    v_dpct := 100 - (100 - v_dpct) * (100 - v_dgen) / 100;  -- descuento efectivo de la línea (el general se suma encima)
    if v_rol = 'cajero' and v_dpct > v_dmax + 0.001 then
      raise exception 'El descuento de % (% %%) supera el máximo permitido a la cajera (% %%)', v_prod.nombre, round(v_dpct, 2), v_dmax using errcode = '42501';
    end if;
    v_bruto := round(v_precio * v_cant, 2);
    v_linea := case when v_dpct > 0 then round(v_bruto * (100 - v_dpct) / 100, 0) else v_bruto end; v_asignado := 0;  -- con descuento, en pesos enteros
    v_desc_linea := v_bruto - v_linea; v_desc_asig := 0; v_cant_asig := 0;
    -- Quien no es responsable de IVA no lo discrimina: la línea va sin IVA aunque el producto lo tenga.
    v_ivapct := case when v_resp_iva then v_prod.iva else 0 end;
    for r in
      select s.lote_id, s.unidades from v_stock_lotes s
      where s.producto_id = v_prod.id and s.sede_id = v_sede and s.unidades > 0 and (s.vence is null or s.vence >= current_date) and not s.bloqueado
      order by s.vence nulls last, s.lote_id
    loop
      exit when v_falta = 0;
      v_toma := least(v_falta, r.unidades);
      v_parte := v_toma::numeric / v_unid;
      l_total := case when v_toma = v_falta then v_linea - v_asignado else round(v_linea * v_parte, 2) end;
      v_asignado := v_asignado + l_total;
      l_desc := case when v_toma = v_falta then v_desc_linea - v_desc_asig else round(v_desc_linea * v_parte, 2) end;
      v_desc_asig := v_desc_asig + l_desc;
      l_cant := case when v_toma = v_falta then v_cant - v_cant_asig else round(v_cant * v_parte, 3) end; -- sin 0,999 al repartir
      v_cant_asig := v_cant_asig + l_cant;
      l_base := round(l_total / (1 + v_ivapct / 100), 2);
      l_iva := l_total - l_base;
      insert into venta_lineas (empresa_id, venta_id, producto_id, lote_id, descripcion, presentacion, cantidad, unidades,
                                precio, iva_pct, base, iva, total, descuento, descuento_pct)
      values (v_emp, v_venta, v_prod.id, r.lote_id, v_prod.nombre, v_pres, l_cant, v_toma,
              v_precio, v_ivapct, l_base, l_iva, l_total, l_desc, round(v_dpct, 2));
      insert into movimientos (empresa_id, sede_id, producto_id, lote_id, cantidad, tipo, ref_id, usuario_id)
      values (v_emp, v_sede, v_prod.id, r.lote_id, -v_toma, 'venta', v_venta, v_user);
      v_base := v_base + l_base; v_iva := v_iva + l_iva; v_total := v_total + l_total;
      v_falta := v_falta - v_toma;
    end loop;
    if v_falta > 0 then
      if exists (select 1 from v_stock_lotes s where s.producto_id = v_prod.id and s.sede_id = v_sede and s.unidades > 0 and s.bloqueado) then
        raise exception 'No hay existencias vendibles suficientes de % (faltan % unidades; hay lotes separados por una alerta del INVIMA)', v_prod.nombre, v_falta using errcode = 'P0001';
      end if;
      if exists (select 1 from v_stock_lotes s where s.producto_id = v_prod.id and s.sede_id = v_sede and s.unidades > 0 and s.vence < current_date) then
        raise exception 'No hay existencias vigentes suficientes de % (faltan % unidades; lo demás está vencido y no se puede vender)', v_prod.nombre, v_falta using errcode = 'P0001';
      end if;
      raise exception 'No hay existencias suficientes de % (faltan % unidades)', v_prod.nombre, v_falta using errcode = 'P0001';
    end if;
  end loop;

  -- Cupo, bloqueo y mora del cliente, con el total ya calculado.
  if v_credito then
    v_cred := credito_cliente(v_cli.id, v_total, v_rol in ('dueno', 'admin'));
    if not (v_cred ->> 'puede_fiar')::boolean then
      if v_rol not in ('dueno', 'admin') then
        raise exception '%: solo el dueño o el administrador pueden autorizar esta venta a crédito', v_cred ->> 'motivo' using errcode = 'P0001';
      end if;
      v_motivo_cred := left(trim(coalesce(p ->> 'motivo_credito', '')), 200);
      if length(v_motivo_cred) < 4 then
        raise exception '%. Para fiar de todas formas, escribe el motivo de la autorización (queda en la auditoría)', v_cred ->> 'motivo' using errcode = 'P0001';
      end if;
      v_autoriza := true;
    end if;
  end if;

  for pg in select * from jsonb_array_elements(coalesce(p -> 'pagos', '[]')) loop
    if (pg ->> 'valor')::numeric > 0 then
      insert into pagos (empresa_id, venta_id, medio, valor, referencia)
      values (v_emp, v_venta, pg ->> 'medio', (pg ->> 'valor')::numeric, pg ->> 'referencia');
      v_recibido := v_recibido + (pg ->> 'valor')::numeric;
      if pg ->> 'medio' = 'efectivo' then v_efectivo := v_efectivo + (pg ->> 'valor')::numeric; end if;
    end if;
  end loop;
  if not v_credito and v_recibido < v_total then
    raise exception 'El pago (%) no cubre el total (%)', v_recibido, v_total using errcode = 'P0001';
  end if;
  v_cambio := greatest(0, v_recibido - v_total);
  if v_cambio > v_efectivo then
    raise exception 'Solo se da cambio sobre el efectivo recibido' using errcode = 'P0001';
  end if;

  insert into ventas (id, empresa_id, sede_id, caja_id, cliente_id, usuario_id, idem_key, tipo_doc, prefijo, numero,
                      base, iva, total, recibido, cambio, condicion, plazo_dias, vence_pago)
  values (v_venta, v_emp, v_sede, v_caja, (p ->> 'cliente_id')::uuid, v_user, p ->> 'idem_key', v_tipo, v_res.prefijo, v_num,
          v_base, v_iva, v_total, v_recibido, v_cambio, case when v_credito then 'credito' else 'contado' end, v_plazo,
          case when v_credito then current_date + v_plazo end);

  insert into documentos_dian (empresa_id, venta_id, tipo, prefijo, numero)
  values (v_emp, v_venta, v_tipo, v_res.prefijo, v_num) returning id into v_doc;

  insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
  values (v_emp, v_user, 'venta', 'ventas', v_venta::text, jsonb_build_object('total', v_total, 'numero', v_res.prefijo || v_num, 'credito', v_credito));
  if v_autoriza then
    insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos)
    values (v_emp, v_user, 'credito_autorizado', 'ventas', v_venta::text, jsonb_build_object('motivo', v_motivo_cred, 'razon', v_cred ->> 'motivo',
            'total', v_total, 'cupo', v_cred -> 'cupo', 'saldo', v_cred -> 'saldo', 'dias_mora', v_cred -> 'dias_mora', 'cliente', v_cli.id, 'numero', v_res.prefijo || v_num));
  end if;

  return jsonb_build_object('venta_id', v_venta, 'documento_id', v_doc, 'prefijo', v_res.prefijo, 'numero', v_num,
                            'base', v_base, 'iva', v_iva, 'total', v_total, 'cambio', v_cambio, 'repetida', false,
                            'credito', v_credito, 'autorizado', v_autoriza, 'vence_pago', case when v_credito then current_date + v_plazo end);
end $$;


-- ───────────────────────── Turno (desde 020): abonos por turno ─────────────────────────
create or replace function resumen_turno(p_turno uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t turnos; v_hasta timestamptz; r jsonb; v_cajas int;
  v_ventas numeric; v_n int; v_anuladas int; v_iva numeric; v_credito numeric; v_efectivo numeric; v_abonos numeric;
  v_ingresos numeric; v_egresos numeric; v_medios jsonb; v_dev numeric; v_dev_ef numeric; v_n_dev int;
  v_abonos_medios jsonb; v_n_recibos int;
begin
  select * into t from turnos where id = p_turno;
  if not found or rol_en(t.empresa_id) is null then raise exception 'Turno no encontrado' using errcode = 'P0002'; end if;
  v_hasta := coalesce(t.cerrado, now());
  select coalesce(sum(total) filter (where estado = 'cerrada'), 0), count(*) filter (where estado = 'cerrada'), count(*) filter (where estado = 'anulada'),
         coalesce(sum(iva) filter (where estado = 'cerrada'), 0), coalesce(sum(total) filter (where estado = 'cerrada' and condicion = 'credito'), 0)
    into v_ventas, v_n, v_anuladas, v_iva, v_credito
    from ventas where caja_id = t.caja_id and creado >= t.abierto and creado < v_hasta;
  select coalesce(jsonb_object_agg(medio, valor), '{}'::jsonb) into v_medios from (
    select p.medio, sum(p.valor) - case when p.medio = 'efectivo' then coalesce((select sum(v2.cambio) from ventas v2 where v2.caja_id = t.caja_id
             and v2.estado = 'cerrada' and v2.creado >= t.abierto and v2.creado < v_hasta), 0) else 0 end as valor
    from pagos p join ventas v on v.id = p.venta_id
    where v.caja_id = t.caja_id and v.estado = 'cerrada' and v.creado >= t.abierto and v.creado < v_hasta group by p.medio) x;
  v_efectivo := coalesce((v_medios ->> 'efectivo')::numeric, 0);
  select count(*) into v_cajas from cajas where empresa_id = t.empresa_id and activa;
  -- Abonos en efectivo: los registrados en este turno (turno_id) y, de los antiguos sin caja ni turno, la regla anterior
  -- (solo si la droguería tiene una sola caja activa). Son conjuntos separados: ningún abono cuenta dos veces.
  select coalesce(sum(valor), 0) into v_abonos from abonos
   where medio = 'efectivo' and not anulado
     and (turno_id = t.id
          or (turno_id is null and caja_id is null and empresa_id = t.empresa_id and creado >= t.abierto and creado < v_hasta and v_cajas = 1));
  select coalesce(jsonb_object_agg(medio, valor), '{}'::jsonb) into v_abonos_medios from (
    select medio, sum(valor) valor from abonos where turno_id = t.id and not anulado and medio <> 'efectivo' group by medio) x;
  select count(*) into v_n_recibos from recibos_caja where turno_id = t.id and not anulado;
  select coalesce(sum(valor) filter (where tipo = 'ingreso'), 0), coalesce(sum(valor) filter (where tipo = 'egreso'), 0)
    into v_ingresos, v_egresos from movimientos_caja where turno_id = t.id;
  select coalesce(sum(total), 0), coalesce(sum(reembolso) filter (where medio = 'efectivo'), 0), count(*)
    into v_dev, v_dev_ef, v_n_dev from devoluciones where caja_id = t.caja_id and creado >= t.abierto and creado < v_hasta;
  r := jsonb_build_object('ventas', v_ventas, 'n_ventas', v_n, 'anuladas', v_anuladas, 'iva', v_iva, 'credito', v_credito, 'medios', v_medios,
    'efectivo_ventas', v_efectivo, 'abonos_efectivo', v_abonos, 'abonos_medios', v_abonos_medios, 'n_recibos', v_n_recibos, 'ingresos', v_ingresos, 'egresos', v_egresos, 'base', t.base,
    'devoluciones', v_dev, 'n_devoluciones', v_n_dev, 'devoluciones_efectivo', v_dev_ef, 'ventas_netas', v_ventas - v_dev,
    'efectivo_esperado', t.base + v_efectivo + v_abonos + v_ingresos - v_egresos - v_dev_ef);
  return r;
end $$;


-- ───────────────────────── Permisos ─────────────────────────
-- Internas: solo las usan las funciones de arriba (corren como dueño de las tablas).
revoke execute on function pesos_texto(numeric), saldo_factura(uuid), credito_cliente(uuid, numeric, boolean), caja_y_turno(uuid, uuid),
  recibo_solo_anular() from public, anon, authenticated;
revoke execute on function estado_credito(uuid, numeric), configurar_credito_cliente(uuid, numeric, integer, boolean, text), configurar_mora(uuid, integer),
  deudores(uuid, text), registrar_recibo(uuid, text, numeric, text, uuid), anular_recibo(bigint, text), anular_abono(bigint, text),
  registrar_abono(uuid, text, numeric, text, uuid), registrar_venta(jsonb), resumen_turno(uuid) from public, anon;
grant execute on function estado_credito(uuid, numeric), configurar_credito_cliente(uuid, numeric, integer, boolean, text), configurar_mora(uuid, integer),
  deudores(uuid, text), registrar_recibo(uuid, text, numeric, text, uuid), anular_recibo(bigint, text), anular_abono(bigint, text),
  registrar_abono(uuid, text, numeric, text, uuid), registrar_venta(jsonb), resumen_turno(uuid) to authenticated;
