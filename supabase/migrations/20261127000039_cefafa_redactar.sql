-- CEFAFA: SIGAM no envía el correo. Quien valida selecciona los medicamentos "Solicitado", SIGAM redacta el correo
-- (se copia y lo envía la jefatura desde su cuenta) y esas solicitudes pasan a "Ya gestionado con CEFAFA".
-- La fecha/frecuencia queda como recordatorio para DSIN (medicamentos).
-- Toda solicitud nace "Solicitado"; los medicamentos de DSIN ya no se "validan" uno por uno: se gestionan con CEFAFA.

update solicitud_tipos set estados = (
  select jsonb_agg(case when e->>'k' = 'en_gestion' then e || '{"t":"Ya gestionado con CEFAFA"}'::jsonb else e end order by o)
    from jsonb_array_elements(estados) with ordinality x(e, o))
 where clave = 'medicamento';

-- grupos de medicamentos: 'solicitar' (Solicitado en DSIN; opcional los que CEFAFA no tenía) o 'respuesta' (ya gestionados)
drop function if exists resumen_cefafa();
create or replace function resumen_cefafa(p_grupo text default 'respuesta', p_incluir_sin_disp boolean default false) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.producto), '[]') from (
    select coalesce('p' || s.producto_id, 'a' || s.principio_activo, 't' || s.producto_texto) as clave,
           coalesce(p.nombre_comercial, s.producto_texto, s.principio_activo || coalesce(' ' || s.concentracion, '')) as producto,
           max(coalesce(p.codigo, '')) as codigo, max(coalesce(upper(p.principio_activo), s.principio_activo, '')) as principio_activo,
           max(coalesce(p.presentacion, '')) as presentacion,
           sum(coalesce(s.cantidad, 0)) as cantidad, count(distinct s.dui) as personas, count(*) as solicitudes,
           string_agg(distinct se.nombre, ', ') as sedes,
           count(*) filter (where s.estado = 'sin_disponibilidad') as sin_disponibilidad,
           count(*) filter (where s.estado = 'espera_jd') as espera_jd,
           min(s.creado_at) as desde,
           array_agg(s.id order by s.creado_at) as ids
      from solicitudes s left join productos p on p.id = s.producto_id left join sedes se on se.id = s.sede_id
     where puede_cefafa() and s.tipo = 'medicamento' and s.cerrada_at is null
       and case when p_grupo = 'solicitar'
                then (s.estado = 'registrada' and s.area = 'DSIN') or (p_incluir_sin_disp and s.estado = 'sin_disponibilidad')
                else s.estado in ('en_gestion', 'sin_disponibilidad', 'espera_jd') end
     group by 1, 2) x
$$;

-- al copiar el correo: las solicitudes seleccionadas pasan a "Ya gestionado con CEFAFA"
create or replace function marcar_gestionado_cefafa(p_ids bigint[]) returns int
language plpgsql security definer set search_path = public as $$
declare x solicitudes; v_n int := 0; v_hoy date := (now() at time zone 'America/El_Salvador')::date;
begin
  perform exigir(puede_cefafa(), 'Solo administración o DSIN de medicamentos');
  for x in select * from solicitudes where id = any(p_ids) and tipo = 'medicamento' and cerrada_at is null
                                         and estado in ('registrada', 'sin_disponibilidad') for update loop
    update solicitudes set estado = 'en_gestion', estado_at = now(),
           validado_por = coalesce(validado_por, app_email()), validado_nombre = coalesce(validado_nombre, nombre_usuario(app_email())),
           validado_at = coalesce(validado_at, now())
     where id = x.id;
    perform registrar_evento(x.id, 'estado', x.estado, 'en_gestion', 'Incluida en la solicitud a CEFAFA del ' || to_char(v_hoy, 'DD/MM/YYYY'));
    perform marcar_lista_si_hay(x.id);
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    update cefafa_config set ultimo_envio = now(), proximo_envio = v_hoy + frecuencia_dias, actualizado_por = app_email(), actualizado_at = now() where id = 1;
  end if;
  return v_n;
end $$;

-- recordatorio a DSIN (medicamentos) cuando llega la fecha y hay medicamentos por solicitar (un correo por día)
drop function if exists enviar_resumen_cefafa(boolean);
create or replace function recordar_cefafa() returns int
language plpgsql security definer set search_path = public as $$
declare c cefafa_config; v_n int; v_hoy date := (now() at time zone 'America/El_Salvador')::date;
begin
  select * into c from cefafa_config where id = 1;
  if not c.activo or c.proximo_envio is null or c.proximo_envio > v_hoy then return 0; end if;
  select count(distinct coalesce('p' || producto_id, 'a' || principio_activo, 't' || producto_texto)) into v_n
    from solicitudes where tipo = 'medicamento' and cerrada_at is null and estado = 'registrada' and area = 'DSIN';
  if v_n = 0 then return 0; end if;
  insert into correo_cola (para, asunto, html)
  select array_agg(distinct r.email), 'Recordatorio: redactar la solicitud a CEFAFA (' || v_n || ' medicamento(s))',
    '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;color:#1f2a44">' ||
    '<div style="background:#233152;color:#fff;padding:14px 18px;border-bottom:4px solid #b08a3e">' ||
    '<div style="font-size:12px;letter-spacing:.08em;opacity:.85">INABVE · SIGAM</div>' ||
    '<div style="font-size:18px;font-weight:700">Toca redactar la solicitud a CEFAFA</div></div>' ||
    '<div style="padding:16px 18px;border:1px solid #dde2ec;border-top:0;font-size:14px">' ||
    '<p>Hay <b>' || v_n || '</b> medicamento(s) en estado "Solicitado" pendientes de solicitar a CEFAFA.</p>' ||
    '<p><a href="https://sigam-inabve.netlify.app/#solicitudes?ver=cefafa" style="background:#233152;color:#fff;padding:9px 16px;border-radius:6px;text-decoration:none">Abrir en SIGAM</a></p>' ||
    '<p style="color:#6b7280;font-size:12px">Seleccione los productos, copie el correo para la jefatura y SIGAM los marcará como "Ya gestionado con CEFAFA".</p></div></div>'
    from solicitud_responsables r where r.tipo = 'medicamento' and r.area = 'DSIN'
  having count(*) > 0;
  return v_n;
end $$;
revoke execute on function recordar_cefafa() from public, anon, authenticated;
grant execute on function resumen_cefafa(text, boolean), marcar_gestionado_cefafa(bigint[]) to authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('sigam-resumen-cefafa', 'sigam-recordar-cefafa');
    perform cron.schedule('sigam-recordar-cefafa', '20 13 * * 1-5', 'select recordar_cefafa()');
  end if;
end $$;
