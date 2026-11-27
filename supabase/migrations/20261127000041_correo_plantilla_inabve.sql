-- Plantilla de correo con la identidad del INABVE: logos (INABVE y Gobierno de El Salvador), azul institucional y dorado,
-- y el estado con su color. Diseño en tablas para que se vea bien en Outlook y Gmail.

create or replace function color_estado_css(p_c text) returns text
language sql immutable as $$
  select case p_c
    when 'rojo' then 'background:#fde2e1;color:#b42318'      when 'amarillo' then 'background:#fef3c7;color:#92400e'
    when 'azul' then 'background:#dbeafe;color:#1e40af'      when 'morado' then 'background:#ede9fe;color:#5b21b6'
    when 'verde' then 'background:#dcfce7;color:#166534'     when 'naranja' then 'background:#ffedd5;color:#9a3412'
    when 'rosa' then 'background:#fce7f3;color:#9d174d'      when 'celeste' then 'background:#cffafe;color:#155e75'
    when 'cafe' then 'background:#efe4d6;color:#6b4423'      else 'background:#eef0f4;color:#4b5563' end
$$;

create or replace function plantilla_correo(p_etiqueta text, p_titulo text, p_cuerpo text, p_enlace text default null,
                                            p_boton text default 'Abrir en SIGAM') returns text
language sql immutable as $$
  select format($h$<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#eef1f6">
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background:#eef1f6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%%;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:'Segoe UI',Calibri,Arial,sans-serif;color:#1f2a44">
  <tr><td style="background:#233152;padding:16px 22px;border-bottom:4px solid #b47d25">
    <table role="presentation" width="100%%" cellpadding="0" cellspacing="0"><tr>
      <td valign="middle" width="56"><img src="https://sigam-inabve.netlify.app/img/inabve-blanco.png" width="48" height="47" alt="INABVE" style="display:block;border:0"></td>
      <td valign="middle" style="padding-left:12px;color:#ffffff">
        <div style="font-size:17px;font-weight:700;letter-spacing:.02em">SIGAM-INABVE</div>
        <div style="font-size:12px;color:#cfd6e6">Gestión de Abastecimiento Médico</div></td>
      <td valign="middle" align="right"><img src="https://sigam-inabve.netlify.app/img/gobierno-blanco.png" width="105" height="36" alt="Gobierno de El Salvador" style="display:block;border:0"></td>
    </tr></table></td></tr>
  <tr><td style="padding:24px 26px 8px">
    <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#b47d25">%s</div>
    <div style="font-size:21px;font-weight:700;color:#233152;margin:6px 0 14px;line-height:1.3">%s</div>
    <div style="font-size:14px;line-height:1.55">%s</div>
  </td></tr>
  %s
  <tr><td style="background:#e9edf5;padding:16px 26px;font-size:11.5px;line-height:1.5;color:#5b6478;border-top:1px solid #dde2ec">
    <b style="color:#233152">Instituto Administrador de los Beneficios de los Veteranos y Excombatientes (INABVE)</b><br>
    Departamento de Programas de Salud Integral · Coordinación de medicamentos e insumos médicos<br>
    Correo automático de SIGAM. Por favor no responda a este mensaje.</td></tr>
</table></td></tr></table></body></html>$h$,
    p_etiqueta, p_titulo, p_cuerpo,
    case when p_enlace is null then '' else format($b$<tr><td style="padding:8px 26px 26px">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#233152;border-radius:6px;border-bottom:3px solid #b47d25">
      <a href="%s" style="display:inline-block;padding:11px 22px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none">%s →</a></td></tr></table></td></tr>$b$, p_enlace, p_boton) end)
$$;

create or replace function encolar_correo_solicitud(p_id bigint, p_para text[], p_asunto text, p_mensaje text) returns void
language plpgsql security definer set search_path = public as $$
declare s solicitudes; v_para text[]; t solicitud_tipos; v_color text; fila text :=
  '<tr><td style="padding:7px 12px;color:#5b6478;font-size:13px;width:130px;border-bottom:1px solid #e6eaf1">%s</td><td style="padding:7px 12px;font-size:14px;border-bottom:1px solid #e6eaf1">%s</td></tr>';
begin
  select array_agg(distinct x) into v_para from unnest(p_para) x where x ~* '^[^@\s]+@[^@\s]+$';
  if v_para is null then return; end if;
  select * into s from solicitudes where id = p_id;
  select * into t from solicitud_tipos where clave = s.tipo;
  select e->>'c' into v_color from jsonb_array_elements(t.estados) e where e->>'k' = s.estado;
  insert into correo_cola (para, asunto, html) values (v_para, p_asunto || ' · ' || s.numero, plantilla_correo(
    'Solicitud ' || s.numero || ' · ' || t.nombre,
    p_asunto,
    '<p style="margin:0 0 16px">' || p_mensaje || '</p>' ||
    '<p style="margin:0 0 16px"><span style="display:inline-block;padding:5px 12px;border-radius:999px;font-size:13px;font-weight:700;' ||
      color_estado_css(v_color) || '">' || estado_txt(s.tipo, s.estado) || '</span>' ||
      case when s.prioridad = 'urgente' then ' <span style="display:inline-block;padding:5px 12px;border-radius:999px;font-size:13px;font-weight:700;background:#b42318;color:#fff">URGENTE</span>' else '' end || '</p>' ||
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fb;border-left:4px solid #b47d25;border-radius:4px">' ||
      format(fila, 'Beneficiario', coalesce((select nombre from beneficiarios where dui = s.dui), '—') || ' · DUI ' || enmascarar_dui(s.dui)) ||
      format(fila, 'Solicita', coalesce(t.icono || ' ', '') || producto_solicitado(s) ||
             coalesce(' · ' || trim(to_char(s.cantidad, 'FM999G999D##')) || coalesce(' ' || s.unidad, ''), '')) ||
      format(fila, 'Sede', coalesce((select nombre from sedes where id = s.sede_id), case when s.captado_cc then 'Captado por Contact Center' else '—' end)) ||
      format(fila, 'Registrada por', coalesce(s.creado_nombre, s.creado_por) || ' · ' || to_char(s.creado_at at time zone 'America/El_Salvador', 'DD/MM/YYYY HH24:MI')) ||
    '</table>',
    'https://sigam-inabve.netlify.app/#solicitudes?id=' || s.id));
end $$;

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
    plantilla_correo('Recordatorio · CEFAFA', 'Toca redactar la solicitud a CEFAFA',
      '<p style="margin:0 0 12px">Hay <b>' || v_n || '</b> medicamento(s) en estado ' ||
      '<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-weight:700;' || color_estado_css('rojo') || '">Solicitado</span> pendientes de solicitar a CEFAFA.</p>' ||
      '<p style="margin:0;color:#5b6478;font-size:13px">Seleccione los productos, copie el correo para la jefatura y SIGAM los marcará como "Ya gestionado con CEFAFA".</p>',
      'https://sigam-inabve.netlify.app/#solicitudes?ver=cefafa', 'Redactar en SIGAM')
    from solicitud_responsables r where r.tipo = 'medicamento' and r.area = 'DSIN'
  having count(*) > 0;
  return v_n;
end $$;
revoke execute on function recordar_cefafa() from public, anon, authenticated;
revoke execute on function plantilla_correo(text, text, text, text, text) from public, anon;
