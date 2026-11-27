-- Reserva para el beneficiario: al avisarle por teléfono tiene 7 días hábiles para retirar.
-- Si retira: la reserva pasa a Despacho (traslado ya recibido, pendiente de registrar en SIVET) y se despacha con su DUI.
-- Si no retira: queda "No retiró" y administración la pasa a Despacho para otro paciente.
-- JPII reserva en la Bodega Central; las regionales en su bodega "Reservas de solicitudes".
-- Llaman: en JPII los responsables de Seguimiento telefónico; en las regionales los dependientes de la sede.

-- 1. Bodegas de reservas en las regionales ----------------------------------------------------------
insert into bodegas (codigo, nombre, sede_id, tipo)
select x.codigo, 'Reservas de solicitudes ' || s.nombre, s.id, 'reservas'
  from (values ('SM-RES', 2), ('SA-RES', 3), ('CH-RES', 4)) x(codigo, sede)
  join sedes s on s.id = x.sede
on conflict (codigo) do nothing;

-- 2. Feriados y días hábiles ---------------------------------------------------------------------------
create table if not exists feriados (
  fecha  date primary key,
  nombre text not null
);
alter table feriados enable row level security;
drop policy if exists leer_todos on feriados;
drop policy if exists admin_inserta on feriados;
drop policy if exists admin_borra on feriados;
create policy leer_todos on feriados for select to authenticated using (true);
create policy admin_inserta on feriados for insert to authenticated with check ((select es_admin()));
create policy admin_borra on feriados for delete to authenticated using ((select es_admin()));
insert into feriados (fecha, nombre) values
  ('2026-12-25', 'Navidad'),
  ('2027-01-01', 'Año Nuevo'),
  ('2027-03-25', 'Jueves Santo'), ('2027-03-26', 'Viernes Santo'),
  ('2027-05-01', 'Día del Trabajo'), ('2027-05-10', 'Día de la Madre'),
  ('2027-06-17', 'Día del Padre'), ('2027-08-06', 'Fiestas agostinas'),
  ('2027-09-15', 'Independencia'), ('2027-11-02', 'Día de los Difuntos'),
  ('2027-12-25', 'Navidad')
on conflict do nothing;

create or replace function es_dia_habil(d date) returns boolean
language sql stable set search_path = public as $$
  select extract(isodow from d) < 6 and not exists (select 1 from feriados f where f.fecha = d)
$$;

create or replace function sumar_dias_habiles(p_desde date, p_dias int) returns date
language plpgsql stable set search_path = public as $$
declare d date := p_desde; n int := 0;
begin
  while n < p_dias loop
    d := d + 1;
    if es_dia_habil(d) then n := n + 1; end if;
  end loop;
  return d;
end $$;

-- días hábiles que quedan desde hoy hasta la fecha límite (incluida); negativo si ya pasó
create or replace function dias_habiles_restantes(p_limite date) returns int
language sql stable set search_path = public as $$
  select case when p_limite >= hoy
    then (select count(*)::int from generate_series(hoy + 1, p_limite, interval '1 day') g where es_dia_habil(g::date))
    else -(select count(*)::int from generate_series(p_limite + 1, hoy, interval '1 day') g where es_dia_habil(g::date)) end
  from (select (now() at time zone 'America/El_Salvador')::date as hoy) x
$$;

-- 3. Columnas y estados nuevos -------------------------------------------------------------------------
alter table solicitudes
  add column if not exists bodega_reserva_id smallint references bodegas(id),
  add column if not exists avisado_at timestamptz,
  add column if not exists retiro_limite date,
  add column if not exists traslado_id bigint references traslados(id);

update solicitud_tipos set estados = (
  select jsonb_agg(e order by o) from (
    select case when e->>'k' = 'avisado' then jsonb_build_object('k', 'avisado', 't', 'Llamado: esperando retiro') else e end as e, o * 10 as o
      from jsonb_array_elements(estados) with ordinality as x(e, o)
    union all select '{"k":"en_despacho","t":"En Despacho: entregar con su DUI"}'::jsonb,
           (select o * 10 + 1 from jsonb_array_elements(estados) with ordinality as x(e, o) where e->>'k' = 'avisado')
    union all select '{"k":"retiro_vencido","t":"No retiró: pasar a Despacho"}'::jsonb,
           (select o * 10 + 2 from jsonb_array_elements(estados) with ordinality as x(e, o) where e->>'k' = 'avisado')
    union all select '{"k":"no_retirado","t":"No retiró (liberado a Despacho)","final":true}'::jsonb, 9999
  ) y)
 where clave in ('medicamento', 'insumo') and not estados @> '[{"k":"en_despacho"}]';

-- 4. Quién da seguimiento: JPII → responsables de Seguimiento; regionales → dependientes de la sede --------
create or replace function puede_dar_seguimiento(p_tipo text, p_sede smallint) returns boolean
language sql stable security definer set search_path = public as $$
  select es_admin()
      or es_responsable(p_tipo, 'DSIN')
      or (p_sede = 1 and es_responsable(p_tipo, 'SEGUIMIENTO'))
      or (p_sede <> 1 and p_tipo in ('medicamento', 'insumo') and app_rol() = 'dependiente' and app_sede() = p_sede)
$$;

create or replace function puede_ver_solicitud(p_tipo text, p_creado_por text, p_sede smallint) returns boolean
language sql stable security definer set search_path = public as $$
  select puede_ver_solicitud(p_tipo, p_creado_por) or puede_dar_seguimiento(p_tipo, p_sede)
$$;

-- a quién avisar de la llegada / del retiro según la sede
create or replace function seguimiento_de(p_tipo text, p_sede smallint) returns text[]
language sql stable security definer set search_path = public as $$
  select case when p_sede = 1 then responsables_de(p_tipo, 'SEGUIMIENTO')
         else array(select email from perfiles where activo and rol = 'dependiente' and sede_id = p_sede) end
$$;

-- 5. Vistas (se recrean: columnas nuevas) -----------------------------------------------------------------
drop view if exists v_solicitud_eventos;
drop view if exists v_solicitudes;
create view v_solicitudes as
select s.*, t.nombre as tipo_nombre, t.icono, t.lista_espera, t.dias_validar,
       estado_txt(s.tipo, s.estado) as estado_texto, estado_final(s.tipo, s.estado) as es_final,
       b.nombre as beneficiario, b.telefono, b.telefono2, b.sector, b.departamento,
       se.nombre as sede, producto_solicitado(s) as solicita,
       p.codigo as producto_codigo, p.tipo::text as producto_tipo,
       (current_date - (s.creado_at at time zone 'America/El_Salvador')::date) as dias,
       (current_date - (s.estado_at at time zone 'America/El_Salvador')::date) as dias_estado,
       case when t.lista_espera and not estado_final(s.tipo, s.estado) then
         (select count(*) from solicitudes x where x.tipo = s.tipo and x.sede_id = s.sede_id and x.cerrada_at is null
             and (x.prioridad = 'urgente' and s.prioridad = 'normal' or x.prioridad = s.prioridad and x.creado_at <= s.creado_at)) end as posicion,
       nombre_usuario(s.asignado_a) as asignado_nombre,
       br.nombre as bodega_reserva, br.tipo::text as bodega_reserva_tipo,
       case when s.estado = 'avisado' and s.retiro_limite is not null then dias_habiles_restantes(s.retiro_limite) end as dias_retiro,
       tr.numero as traslado_numero
  from solicitudes s
  join solicitud_tipos t on t.clave = s.tipo
  join beneficiarios b on b.dui = s.dui
  join sedes se on se.id = s.sede_id
  left join productos p on p.id = s.producto_id
  left join bodegas br on br.id = s.bodega_reserva_id
  left join traslados tr on tr.id = s.traslado_id
 where puede_ver_solicitud(s.tipo, s.creado_por, s.sede_id);
grant select on v_solicitudes to authenticated;

create view v_solicitud_eventos as
select e.* from solicitud_eventos e join solicitudes s on s.id = e.solicitud_id
 where puede_ver_solicitud(s.tipo, s.creado_por, s.sede_id);
grant select on v_solicitud_eventos to authenticated;

-- 6. Llegada: guarda la bodega de reserva y avisa a quien llama en esa sede -----------------------------
create or replace function solicitudes_llegada_producto() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sede smallint; v_n int; v_ids bigint[]; r record; v_para text[] := '{}';
begin
  if new.tipo not in ('entrada', 'traslado_recepcion') or new.cantidad <= 0 then return new; end if;
  select sede_id into v_sede from bodegas where id = new.bodega_id and tipo in ('despacho_medicamentos', 'almacen_insumos', 'central', 'reservas');
  if v_sede is null then return new; end if;
  with x as (
    update solicitudes set estado = 'lista', estado_at = now(), producto_disponible_at = now(), bodega_reserva_id = new.bodega_id,
           proximo_contacto = coalesce(proximo_contacto, current_date)
     where producto_id = new.producto_id and sede_id = v_sede and cerrada_at is null
       and estado in ('aprobada', 'en_gestion', 'sin_disponibilidad')
     returning id, estado, creado_por, tipo)
  select count(*), array_agg(id) into v_n, v_ids from x;
  if v_n = 0 then return new; end if;
  insert into solicitud_eventos (solicitud_id, por, por_nombre, tipo, estado_anterior, estado_nuevo, nota)
  select i, app_email(), 'SIGAM', 'llegada', null, 'lista',
         'Llegó ' || (select nombre_comercial from productos where id = new.producto_id) || ' a ' || (select nombre from bodegas where id = new.bodega_id) ||
         ' (' || case when new.tipo = 'entrada' then 'factura' else 'traslado recibido' end || ')'
    from unnest(v_ids) i;
  for r in select distinct s.tipo from solicitudes s where s.id = any(v_ids) loop
    v_para := v_para || seguimiento_de(r.tipo, v_sede);
  end loop;
  v_para := v_para || array(select distinct s.creado_por from solicitudes s where s.id = any(v_ids));
  perform encolar_correo_solicitud(v_ids[1], v_para,
    'Llegó producto: ' || v_n || ' persona(s) pendiente(s) de entrega',
    'Llegó <b>' || (select nombre_comercial from productos where id = new.producto_id) || '</b> a ' || (select nombre from bodegas where id = new.bodega_id) ||
    '. Hay <b>' || v_n || '</b> persona(s) pendiente(s) de entrega; ya aparecen en Seguimiento telefónico para llamarles. ' ||
    'Desde la llamada tienen 7 días hábiles para retirar. Abajo, la primera de la lista.');
  return new;
end $$;

-- 7. Llamada: al avisar empieza el plazo de 7 días hábiles ------------------------------------------------
create or replace function registrar_llamada(p_id bigint, p_resultado text, p_nota text default null, p_proximo date default null)
returns void language plpgsql security definer set search_path = public as $$
declare s solicitudes; v_estado text; v_limite date; v_hoy date := (now() at time zone 'America/El_Salvador')::date;
begin
  select * into s from solicitudes where id = p_id for update;
  perform exigir(found and (puede_gestionar_solicitud(s.tipo) or puede_dar_seguimiento(s.tipo, s.sede_id)), 'Solo quien da seguimiento puede registrar llamadas');
  perform exigir(p_resultado in ('contesto', 'no_contesto', 'numero_equivocado', 'avisado_retirar', 'ya_recibio', 'ya_no_necesita'), 'Resultado no válido');
  v_estado := case p_resultado
    when 'avisado_retirar' then 'avisado'
    when 'ya_recibio' then case when s.tipo = 'cirugia_oftalmica' then 'operado' else 'entregada' end
    when 'ya_no_necesita' then 'cancelada'
    when 'contesto' then case when s.estado = 'lista' then 'avisado'
                              when s.estado = 'registrada' and s.tipo in ('auditivo', 'lentes', 'cirugia_oftalmica') then 'contactado' else s.estado end
    else s.estado end;
  -- avisar sin que haya llegado el producto no inicia plazo
  if v_estado = 'avisado' and s.tipo in ('medicamento', 'insumo') and s.estado not in ('lista', 'avisado') then v_estado := s.estado; end if;
  if v_estado = 'avisado' and s.estado <> 'avisado' and s.tipo in ('medicamento', 'insumo') then
    v_limite := sumar_dias_habiles(v_hoy, 7);
  end if;
  update solicitudes set intentos = intentos + 1, ultimo_contacto_at = now(), ultimo_resultado = p_resultado,
         proximo_contacto = case when estado_final(s.tipo, v_estado) or v_estado = 'avisado' then null
                                 else coalesce(p_proximo, case when p_resultado = 'no_contesto' then sumar_dias_habiles(v_hoy, 1) end) end,
         estado = v_estado, estado_at = case when v_estado <> s.estado then now() else estado_at end,
         avisado_at = case when v_limite is not null then now() else avisado_at end,
         retiro_limite = coalesce(v_limite, retiro_limite),
         cerrada_at = case when estado_final(s.tipo, v_estado) then now() end
   where id = p_id;
  perform registrar_evento(p_id, 'llamada', case when v_estado <> s.estado then s.estado end, case when v_estado <> s.estado then v_estado end,
    coalesce(nullif(trim(p_nota), '') || ' · ', '') || case when v_limite is not null then 'Puede retirar hasta el ' || to_char(v_limite, 'DD/MM/YYYY') || ' (7 días hábiles)' else '' end,
    jsonb_build_object('resultado', p_resultado, 'intento', s.intentos + 1, 'proximo', p_proximo, 'retiro_limite', v_limite));
  if v_estado <> s.estado and estado_final(s.tipo, v_estado) then
    perform encolar_correo_solicitud(p_id, array[s.creado_por], 'Solicitud: ' || estado_txt(s.tipo, v_estado),
      'Según el seguimiento telefónico de ' || nombre_usuario(app_email()) || ', la solicitud quedó como <b>' || estado_txt(s.tipo, v_estado) || '</b>.' ||
      coalesce('<br>Nota: ' || nullif(trim(p_nota), ''), ''));
  end if;
end $$;

-- 8. Pasar la reserva a Despacho (retira a tiempo, o no retiró) --------------------------------------------
-- Crea un traslado ya recibido desde la bodega de reserva al Despacho (o Almacén de insumos) de la sede.
-- Queda pendiente de registrar en SIVET (Traslados → Excel para SIVET).
create or replace function pasar_reserva_a_despacho(p_ids bigint[], p_nota text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g record; x record; v_dest smallint; v_tid bigint; v_num text; r record; v_lote bigint; v_hechos text[] := '{}';
begin
  perform exigir(coalesce(array_length(p_ids, 1), 0) > 0, 'Elija al menos una solicitud');
  for x in select * from solicitudes where id = any(p_ids) for update loop
    perform exigir(x.tipo in ('medicamento', 'insumo') and x.estado in ('avisado', 'retiro_vencido'),
                   x.numero || ': solo se pasa a Despacho lo que está avisado o no retirado');
    perform exigir(es_admin() or puede_dar_seguimiento(x.tipo, x.sede_id) or app_rol() = 'dependiente' and app_sede() = x.sede_id,
                   x.numero || ': no tiene permiso en esa sede');
    perform exigir(x.producto_id is not null and coalesce(x.cantidad, 0) > 0, x.numero || ': falta el producto del catálogo o la cantidad');
  end loop;

  for g in select so.bodega_reserva_id as origen, so.sede_id, so.tipo, array_agg(so.id order by so.creado_at) as ids
             from solicitudes so join bodegas b on b.id = so.bodega_reserva_id
            where so.id = any(p_ids) and b.tipo in ('central', 'reservas')
            group by 1, 2, 3 loop
    select id into v_dest from bodegas where sede_id = g.sede_id and activa
       and tipo = case when g.tipo = 'medicamento' then 'despacho_medicamentos' else 'almacen_insumos' end::tipo_bodega limit 1;
    perform exigir(v_dest is not null, 'La sede no tiene bodega de despacho activa');
    v_num := siguiente_numero('traslado', 'T-');
    insert into traslados (numero, bodega_origen_id, bodega_destino_id, observaciones, enviado_por, estado, recibido_por, recibido_at)
    values (v_num, g.origen, v_dest,
            'Reserva de solicitudes ' || (select string_agg(numero, ', ') from solicitudes where id = any(g.ids)) || coalesce(' · ' || nullif(trim(p_nota), ''), ''),
            app_email(), 'enviado', null, null) returning id into v_tid;
    for x in select * from solicitudes where id = any(g.ids) order by creado_at loop
      for r in select * from consumir_pvps(g.origen, x.producto_id, x.cantidad, null, 'traslado_envio', 'traslado', v_tid) loop
        v_lote := lote_en_bodega(r.lote_id, v_dest);
        perform mover_lote(v_lote, r.cantidad, 'traslado_recepcion', 'traslado', v_tid);
        insert into traslado_detalle (traslado_id, producto_id, lote_origen_id, lote_destino_id, cantidad_enviada, cantidad_recibida)
        values (v_tid, x.producto_id, r.lote_id, v_lote, r.cantidad, r.cantidad);
      end loop;
    end loop;
    update traslados set estado = 'recibido', recibido_por = app_email(), recibido_at = now() where id = v_tid;
    v_hechos := v_hechos || v_num;
    update solicitudes set traslado_id = v_tid where id = any(g.ids);
  end loop;

  -- estado: a tiempo → en Despacho (se cierra al despacharle con su DUI); vencida → no retiró (cerrada)
  for x in select * from solicitudes where id = any(p_ids) loop
    update solicitudes set estado = case when x.estado = 'avisado' then 'en_despacho' else 'no_retirado' end,
           estado_at = now(), cerrada_at = case when x.estado = 'avisado' then null else now() end
     where id = x.id;
    perform registrar_evento(x.id, 'estado', x.estado, case when x.estado = 'avisado' then 'en_despacho' else 'no_retirado' end,
      case when x.traslado_id is null
           then 'Ya estaba en el Despacho' else 'Pasado a Despacho con el traslado ' || (select numero from traslados where id = x.traslado_id) || ' · registrarlo en SIVET' end
      || coalesce(' · ' || nullif(trim(p_nota), ''), ''));
  end loop;
  return jsonb_build_object('traslados', to_jsonb(v_hechos));
end $$;

-- 9. Vencimiento diario: 7 días hábiles sin retirar → avisar a administración -----------------------------
create or replace function vencer_reservas() returns int
language plpgsql security definer set search_path = public as $$
declare v_ids bigint[]; v_n int; v_hoy date := (now() at time zone 'America/El_Salvador')::date; v_html text;
begin
  with x as (
    update solicitudes set estado = 'retiro_vencido', estado_at = now()
     where estado = 'avisado' and retiro_limite < v_hoy and cerrada_at is null and tipo in ('medicamento', 'insumo')
     returning id)
  select array_agg(id), count(*) into v_ids, v_n from x;
  if coalesce(v_n, 0) = 0 then return 0; end if;
  insert into solicitud_eventos (solicitud_id, por, por_nombre, tipo, estado_anterior, estado_nuevo, nota)
  select i, 'sigam', 'SIGAM', 'estado', 'avisado', 'retiro_vencido', 'Pasaron 7 días hábiles desde la llamada sin retirar'
    from unnest(v_ids) i;
  select string_agg('<tr><td>' || s.numero || '</td><td>' || se.nombre || '</td><td>' || coalesce(p.nombre_comercial, '') ||
                    '</td><td style="text-align:right">' || coalesce(s.cantidad::text, '') || '</td><td>' || coalesce(b.nombre, '') ||
                    '</td><td>' || to_char(s.retiro_limite, 'DD/MM/YYYY') || '</td></tr>', '' order by se.nombre, p.nombre_comercial)
    into v_html
    from solicitudes s join sedes se on se.id = s.sede_id left join productos p on p.id = s.producto_id left join bodegas b on b.id = s.bodega_reserva_id
   where s.id = any(v_ids);
  perform encolar_correo_solicitud(v_ids[1], array(select email from perfiles where activo and rol = 'administrador'),
    v_n || ' reserva(s) no retirada(s): pasar a Despacho y registrar en SIVET',
    'Estas reservas cumplieron 7 días hábiles desde la llamada y el beneficiario no las retiró. ' ||
    'Páselas a Despacho en SIGAM (Solicitudes → Seguimiento telefónico → No retiró) y registre el traslado en SIVET.' ||
    '<table style="border-collapse:collapse;margin-top:10px;font-size:13px" border="1" cellpadding="4">' ||
    '<tr><th>Solicitud</th><th>Sede</th><th>Producto</th><th>Cant.</th><th>Está en</th><th>Límite</th></tr>' || v_html || '</table>');
  return v_n;
end $$;

-- 10. Insignia: lo que me toca (incluye llamadas por sede y reservas vencidas para administración) ----------
create or replace function mis_solicitudes_pendientes() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'validar', (select count(*) from solicitudes s where s.cerrada_at is null and s.estado in ('registrada', 'contactado', 'evaluado')
                   and (es_admin() and not exists (select 1 from solicitud_responsables where tipo = s.tipo and area = s.area)
                        or es_responsable(s.tipo, s.area))),
    'llamar', (select count(*) from solicitudes s where s.cerrada_at is null
                  and (s.estado = 'lista' or s.proximo_contacto <= current_date)
                  and (s.asignado_a = app_email()
                       or s.asignado_a is null and not es_admin()
                          and (s.sede_id = 1 and es_responsable(s.tipo, 'SEGUIMIENTO')
                               or s.sede_id <> 1 and s.tipo in ('medicamento', 'insumo') and app_rol() = 'dependiente' and app_sede() = s.sede_id))),
    'vencidas', (select count(*) from solicitudes s where s.estado = 'retiro_vencido'
                    and (es_admin() or puede_dar_seguimiento(s.tipo, s.sede_id))))
$$;

grant execute on function pasar_reserva_a_despacho(bigint[], text), dias_habiles_restantes(date), sumar_dias_habiles(date, int),
  es_dia_habil(date), puede_dar_seguimiento(text, smallint), puede_ver_solicitud(text, text, smallint) to authenticated;
revoke execute on function vencer_reservas() from public, anon, authenticated;

-- 11. Tarea diaria (lunes a viernes, 6:10 a. m. de El Salvador = 12:10 UTC) --------------------------------
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'sigam-vencer-reservas';
    perform cron.schedule('sigam-vencer-reservas', '10 12 * * 1-5', 'select vencer_reservas()');
  end if;
end $$;

-- 12. JPII: Wendy Hernández llama por los medicamentos -----------------------------------------------------
insert into solicitud_responsables (tipo, area, email)
select 'medicamento', 'SEGUIMIENTO', 'wendy.hernandez@inabve.gob.sv'
 where exists (select 1 from perfiles where email = 'wendy.hernandez@inabve.gob.sv')
   and not exists (select 1 from solicitud_responsables where tipo = 'medicamento' and area = 'SEGUIMIENTO' and email = 'wendy.hernandez@inabve.gob.sv');
