-- Reserva para el beneficiario: al avisarle por teléfono tiene 7 días hábiles para retirar.
-- Lo reservado espera en la bodega "Reservas de solicitudes" de cada sede (fuera de SIVET).
-- Si llega a retirar: quien llama avisa a administración; solo administración lo pasa a Despacho (traslado ya recibido)
--   y SIGAM le recuerda registrarlo en SIVET; después se despacha con su DUI y la solicitud se cierra sola.
-- Si no retira en 7 días hábiles: queda "No retiró" y administración lo pasa a Despacho para otro paciente.
-- Todo traslado de una bodega fuera de SIVET (Reservas, Central, Campo, Pequeña Cirugía) a Despacho/Almacén es solo de administración.
-- Llaman: en JPII los responsables de Seguimiento telefónico; en las regionales los dependientes de la sede.

-- 1. Bodegas de reservas en las regionales ----------------------------------------------------------
insert into bodegas (codigo, nombre, sede_id, tipo)
select x.codigo, 'Reservas de solicitudes ' || s.nombre, s.id, 'reservas'
  from (values ('JPII-RES', 1), ('SM-RES', 2), ('SA-RES', 3), ('CH-RES', 4)) x(codigo, sede)
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
    union all select '{"k":"por_pasar","t":"Llegó a retirar: por pasar a Despacho"}'::jsonb,
           (select o * 10 + 1 from jsonb_array_elements(estados) with ordinality as x(e, o) where e->>'k' = 'avisado')
    union all select '{"k":"en_despacho","t":"En Despacho: entregar con su DUI"}'::jsonb,
           (select o * 10 + 2 from jsonb_array_elements(estados) with ordinality as x(e, o) where e->>'k' = 'avisado')
    union all select '{"k":"retiro_vencido","t":"No retiró: pasar a Despacho"}'::jsonb,
           (select o * 10 + 3 from jsonb_array_elements(estados) with ordinality as x(e, o) where e->>'k' = 'avisado')
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
  select sede_id into v_sede from bodegas where id = new.bodega_id and tipo in ('despacho_medicamentos', 'almacen_insumos', 'reservas');
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

-- 8. Llegó a retirar: quien llama avisa a administración (el plazo deja de correr) -------------------------
create or replace function solicitar_pase_despacho(p_id bigint, p_nota text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s solicitudes;
begin
  select * into s from solicitudes where id = p_id for update;
  perform exigir(found and s.estado = 'avisado', 'Solo se avisa lo que está esperando retiro');
  perform exigir(puede_dar_seguimiento(s.tipo, s.sede_id), 'Solo quien da seguimiento en esa sede');
  update solicitudes set estado = 'por_pasar', estado_at = now() where id = p_id;
  perform registrar_evento(p_id, 'estado', 'avisado', 'por_pasar', coalesce(nullif(trim(p_nota), ''), 'El beneficiario llegó a retirar'));
  perform encolar_correo_solicitud(p_id, array(select email from perfiles where activo and rol = 'administrador'),
    'Llegó a retirar: pasar a Despacho · ' || (select nombre from sedes where id = s.sede_id),
    nombre_usuario(app_email()) || ' avisa que el beneficiario llegó a retirar <b>' || producto_solicitado(s) || '</b> × ' || coalesce(s.cantidad::text, '') ||
    ' en ' || (select nombre from sedes where id = s.sede_id) || '. Páselo de Reservas a Despacho en SIGAM (Seguimiento telefónico → Por pasar a Despacho) ' ||
    'y regístrelo en SIVET para que se le pueda despachar.' || coalesce('<br>Nota: ' || nullif(trim(p_nota), ''), ''));
end $$;

-- 9. Pasar de Reservas a Despacho: solo administración ------------------------------------------------------
-- Crea un traslado ya recibido desde Reservas al Despacho (o Almacén de insumos) de la sede, pendiente de registrar en SIVET.
create or replace function pasar_reserva_a_despacho(p_ids bigint[], p_nota text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g record; x record; v_dest smallint; v_tid bigint; v_num text; r record; v_lote bigint; v_hechos text[] := '{}'; v_html text := '';
begin
  perform exigir(es_admin(), 'Solo administración pasa productos a Despacho');
  perform exigir(coalesce(array_length(p_ids, 1), 0) > 0, 'Elija al menos una solicitud');
  for x in select * from solicitudes where id = any(p_ids) for update loop
    perform exigir(x.tipo in ('medicamento', 'insumo') and x.estado in ('avisado', 'por_pasar', 'retiro_vencido'),
                   x.numero || ': solo se pasa a Despacho lo que está esperando retiro, por pasar o no retirado');
    perform exigir(x.producto_id is not null and coalesce(x.cantidad, 0) > 0, x.numero || ': falta el producto del catálogo o la cantidad');
  end loop;

  for g in select so.bodega_reserva_id as origen, so.sede_id, so.tipo, array_agg(so.id order by so.creado_at) as ids
             from solicitudes so join bodegas b on b.id = so.bodega_reserva_id
            where so.id = any(p_ids) and b.tipo not in ('despacho_medicamentos', 'almacen_insumos')
            group by 1, 2, 3 loop
    select id into v_dest from bodegas where sede_id = g.sede_id and activa
       and tipo = case when g.tipo = 'medicamento' then 'despacho_medicamentos' else 'almacen_insumos' end::tipo_bodega limit 1;
    perform exigir(v_dest is not null, 'La sede no tiene bodega de despacho activa');
    v_num := siguiente_numero('traslado', 'T-');
    insert into traslados (numero, bodega_origen_id, bodega_destino_id, observaciones, enviado_por)
    values (v_num, g.origen, v_dest,
            'Reserva de solicitudes ' || (select string_agg(numero, ', ') from solicitudes where id = any(g.ids)) || coalesce(' · ' || nullif(trim(p_nota), ''), ''),
            app_email()) returning id into v_tid;
    for x in select * from solicitudes where id = any(g.ids) order by creado_at loop
      for r in select * from consumir_pvps(g.origen, x.producto_id, x.cantidad, null, 'traslado_envio', 'traslado', v_tid) loop
        v_lote := lote_en_bodega(r.lote_id, v_dest);
        perform mover_lote(v_lote, r.cantidad, 'traslado_recepcion', 'traslado', v_tid);
        insert into traslado_detalle (traslado_id, producto_id, lote_origen_id, lote_destino_id, cantidad_enviada, cantidad_recibida)
        values (v_tid, x.producto_id, r.lote_id, v_lote, r.cantidad, r.cantidad);
      end loop;
    end loop;
    update traslados set estado = 'recibido', recibido_por = app_email(), recibido_at = now() where id = v_tid;
    update solicitudes set traslado_id = v_tid where id = any(g.ids);
    v_hechos := v_hechos || v_num;
    v_html := v_html || '<tr><td>' || v_num || '</td><td>' || (select nombre from bodegas where id = g.origen) || '</td><td>' ||
              (select nombre from bodegas where id = v_dest) || '</td><td>' ||
              (select string_agg(p.nombre_comercial || ' × ' || d.cantidad_enviada, '<br>') from traslado_detalle d join productos p on p.id = d.producto_id where d.traslado_id = v_tid) ||
              '</td></tr>';
  end loop;

  for x in select * from solicitudes where id = any(p_ids) loop
    update solicitudes set estado = case when x.estado = 'retiro_vencido' then 'no_retirado' else 'en_despacho' end,
           estado_at = now(), cerrada_at = case when x.estado = 'retiro_vencido' then now() end
     where id = x.id;
    perform registrar_evento(x.id, 'estado', x.estado, case when x.estado = 'retiro_vencido' then 'no_retirado' else 'en_despacho' end,
      case when x.traslado_id is null then 'Ya estaba en el Despacho'
           else 'Pasado a Despacho con el traslado ' || (select numero from traslados where id = x.traslado_id) || ' · registrarlo en SIVET' end
      || coalesce(' · ' || nullif(trim(p_nota), ''), ''));
    if x.estado <> 'retiro_vencido' then   -- avisar a quien llama que ya puede despacharle
      perform encolar_correo_solicitud(x.id, seguimiento_de(x.tipo, x.sede_id) || x.creado_por, 'Ya está en Despacho: despachar con su DUI',
        'El producto del beneficiario ya está en el Despacho de ' || (select nombre from sedes where id = x.sede_id) || '. Despáchele con su DUI; la solicitud se cerrará sola.');
    end if;
  end loop;
  if v_html <> '' then
    perform encolar_correo_solicitud(p_ids[1], array(select email from perfiles where activo and rol = 'administrador'),
      'Registrar en SIVET: ' || array_length(v_hechos, 1) || ' traslado(s) de Reservas a Despacho',
      'Se pasaron productos de Reservas a Despacho en SIGAM. Regístrelos en SIVET y márquelos como registrados en Seguimiento telefónico → Pendiente de registrar en SIVET.' ||
      '<table style="border-collapse:collapse;margin-top:10px;font-size:13px" border="1" cellpadding="4"><tr><th>Traslado</th><th>De</th><th>A</th><th>Productos</th></tr>' ||
      v_html || '</table>');
  end if;
  return jsonb_build_object('traslados', to_jsonb(v_hechos));
end $$;

-- traslados que entraron a Despacho/Almacén desde una bodega fuera de SIVET y aún no se registran en SIVET
create or replace function traslados_pendientes_sivet() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.recibido_at), '[]') from (
    select t.id, t.numero, t.recibido_at, t.observaciones, bo.nombre as origen, bd.nombre as destino, se.nombre as sede,
           (select jsonb_agg(jsonb_build_object('codigo', p.codigo, 'producto', p.nombre_comercial, 'cantidad', d.cantidad_recibida, 'lote', l.numero_lote))
              from traslado_detalle d join productos p on p.id = d.producto_id left join lotes l on l.id = d.lote_destino_id where d.traslado_id = t.id) as lineas
      from traslados t join bodegas bo on bo.id = t.bodega_origen_id join bodegas bd on bd.id = t.bodega_destino_id join sedes se on se.id = bd.sede_id
     where es_admin() and not t.enviado_sivet and t.estado in ('recibido', 'con_diferencias', 'cerrado')
       and bo.tipo not in ('despacho_medicamentos', 'almacen_insumos') and bd.tipo in ('despacho_medicamentos', 'almacen_insumos')
       and t.sifar_id is null) x
$$;

create or replace function marcar_registrado_sivet(p_traslado bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir(es_admin(), 'Solo administración');
  update traslados set enviado_sivet = true where id = p_traslado;
end $$;

-- traslados desde fuera de SIVET hacia Despacho/Almacén: solo administración
create or replace function crear_traslado(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o bodegas; d bodegas; v_id bigint; v_num text; ln jsonb; r record; n int := 0;
begin
  select * into o from bodegas where id = (p->>'bodega_origen_id')::smallint;
  select * into d from bodegas where id = (p->>'bodega_destino_id')::smallint;
  perform exigir(o.id is not null and d.id is not null and o.id <> d.id, 'Origen y destino deben ser bodegas distintas');
  perform exigir(d.activa, 'La bodega de destino está inactiva');
  perform exigir(puede_operar_bodega(o.id) or (o.solo_admin and es_admin()), 'No tiene permiso sobre la bodega de origen');
  perform exigir(not (o.solo_admin or d.solo_admin) or es_admin(),
                 'Solo un administrador puede trasladar desde o hacia la bodega de descarte');
  perform exigir(es_admin() or d.tipo not in ('despacho_medicamentos', 'almacen_insumos') or o.tipo in ('despacho_medicamentos', 'almacen_insumos'),
                 'Solo administración traslada a Despacho de medicamentos o Almacén de insumos (debe registrarse en SIVET)');
  perform exigir(jsonb_array_length(coalesce(p->'lineas','[]')) > 0, 'El traslado no tiene productos');

  v_num := siguiente_numero('traslado', 'T-');
  insert into traslados(numero, bodega_origen_id, bodega_destino_id, observaciones, enviado_por)
  values (v_num, o.id, d.id, p->>'observaciones', app_email()) returning id into v_id;

  for ln in select * from jsonb_array_elements(p->'lineas') loop
    n := n + 1;
    perform exigir(nullif(ln->>'cantidad','')::numeric > 0, 'Línea ' || n || ': cantidad inválida');
    for r in select * from consumir_pvps(o.id, (ln->>'producto_id')::bigint, (ln->>'cantidad')::numeric,
                                         nullif(ln->>'lote_id','')::bigint, 'traslado_envio', 'traslado', v_id) loop
      insert into traslado_detalle(traslado_id, producto_id, lote_origen_id, cantidad_enviada)
      values (v_id, (ln->>'producto_id')::bigint, r.lote_id, r.cantidad);
    end loop;
  end loop;
  return jsonb_build_object('traslado_id', v_id, 'numero', v_num);
end $$;

-- 10. Vencimiento diario: 7 días hábiles sin retirar → avisar a administración -----------------------------
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
    'Páselas a Despacho en SIGAM (Seguimiento telefónico → Por pasar a Despacho) y registre el traslado en SIVET.' ||
    '<table style="border-collapse:collapse;margin-top:10px;font-size:13px" border="1" cellpadding="4">' ||
    '<tr><th>Solicitud</th><th>Sede</th><th>Producto</th><th>Cant.</th><th>Está en</th><th>Límite</th></tr>' || v_html || '</table>');
  return v_n;
end $$;

-- 11. Insignias: solicitudes por validar · seguimiento (llamadas, por pasar, por registrar en SIVET) ----------
create or replace function mis_solicitudes_pendientes() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'validar', (select count(*) from solicitudes s where s.cerrada_at is null and s.estado in ('registrada', 'contactado', 'evaluado')
                   and (es_admin() and not exists (select 1 from solicitud_responsables where tipo = s.tipo and area = s.area)
                        or es_responsable(s.tipo, s.area))),
    'llamar', (select count(*) from solicitudes s where s.cerrada_at is null
                  and (s.estado = 'lista' or s.proximo_contacto <= current_date and s.estado not in ('avisado', 'por_pasar', 'en_despacho', 'retiro_vencido'))
                  and (s.asignado_a = app_email()
                       or s.asignado_a is null and not es_admin()
                          and (s.sede_id = 1 and es_responsable(s.tipo, 'SEGUIMIENTO')
                               or s.sede_id <> 1 and s.tipo in ('medicamento', 'insumo') and app_rol() = 'dependiente' and app_sede() = s.sede_id))),
    'pasar', (select count(*) from solicitudes s where es_admin() and s.estado in ('por_pasar', 'retiro_vencido')),
    'sivet', (select jsonb_array_length(traslados_pendientes_sivet())))
$$;

grant execute on function pasar_reserva_a_despacho(bigint[], text), solicitar_pase_despacho(bigint, text),
  traslados_pendientes_sivet(), marcar_registrado_sivet(bigint), dias_habiles_restantes(date), sumar_dias_habiles(date, int),
  es_dia_habil(date), puede_dar_seguimiento(text, smallint), puede_ver_solicitud(text, text, smallint) to authenticated;
revoke execute on function vencer_reservas() from public, anon, authenticated;

-- 12. Tarea diaria (lunes a viernes, 6:10 a. m. de El Salvador = 12:10 UTC) --------------------------------
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'sigam-vencer-reservas';
    perform cron.schedule('sigam-vencer-reservas', '10 12 * * 1-5', 'select vencer_reservas()');
  end if;
end $$;

-- 13. JPII: Wendy Hernández llama por los medicamentos -----------------------------------------------------
insert into solicitud_responsables (tipo, area, email)
select 'medicamento', 'SEGUIMIENTO', 'wendy.hernandez@inabve.gob.sv'
 where exists (select 1 from perfiles where email = 'wendy.hernandez@inabve.gob.sv')
   and not exists (select 1 from solicitud_responsables where tipo = 'medicamento' and area = 'SEGUIMIENTO' and email = 'wendy.hernandez@inabve.gob.sv');
