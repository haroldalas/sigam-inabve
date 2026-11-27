-- Lo que espera la validación médica de DSEC no puede moverse desde DSIN ni por otros responsables.
create or replace function cambiar_estado_solicitud(p_id bigint, p_estado text, p_nota text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s solicitudes;
begin
  select * into s from solicitudes where id = p_id for update;
  perform exigir(found, 'No existe la solicitud');
  perform exigir(puede_gestionar_solicitud(s.tipo), 'Solo los responsables de este tipo pueden cambiar el estado');
  -- mientras espera la validación de DSEC (médico), solo DSEC o administración pueden moverla
  perform exigir(not (s.area = 'DSEC' and s.validado_at is null and s.cerrada_at is null)
                 or es_admin() or es_responsable(s.tipo, 'DSEC'),
                 'Esta solicitud espera la validación de DSEC; solo DSEC puede cambiar su estado');
  perform exigir(exists (select 1 from solicitud_tipos t, jsonb_array_elements(t.estados) e where t.clave = s.tipo and e->>'k' = p_estado), 'Estado no válido');
  perform exigir(p_estado <> s.estado, 'La solicitud ya está en ese estado');
  perform exigir(p_estado not in ('no_procede', 'cancelada') or length(trim(coalesce(p_nota, ''))) >= 5, 'Indique el motivo');
  update solicitudes set estado = p_estado, estado_at = now(),
         cerrada_at = case when estado_final(s.tipo, p_estado) then now() end
   where id = p_id;
  perform registrar_evento(p_id, 'estado', s.estado, p_estado, p_nota);
  if estado_final(s.tipo, p_estado) or p_estado in ('lista', 'sin_disponibilidad', 'programada') then
    perform encolar_correo_solicitud(p_id, array[s.creado_por], 'Solicitud: ' || estado_txt(s.tipo, p_estado),
      'La solicitud cambió a <b>' || estado_txt(s.tipo, p_estado) || '</b> (' || nombre_usuario(app_email()) || ').' ||
      coalesce('<br>Comentario: ' || nullif(trim(p_nota), ''), ''));
  end if;
end $$;
