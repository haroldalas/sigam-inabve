-- Administración puede cambiar el nombre y el color de los estados de solicitud, ordenarlos, ocultarlos de la lista manual
-- y agregar estados propios. Los estados que usa SIGAM internamente ("s": true) no se pueden borrar ni cambiar si cierran el caso.

update solicitud_tipos set estados = (
  select jsonb_agg(e || '{"s":true}'::jsonb order by o) from jsonb_array_elements(estados) with ordinality x(e, o))
 where true;

create or replace function guardar_estados_tipo(p_tipo text, p_estados jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ant jsonb; v_nuevo jsonb := '[]'; e jsonb; v_k text; v_t text; v_c text; v_i int := 0;
begin
  perform exigir(es_admin(), 'Solo administración puede editar los estados');
  select estados into v_ant from solicitud_tipos where clave = p_tipo for update;
  perform exigir(found, 'Tipo de solicitud no válido');
  perform exigir(jsonb_typeof(p_estados) = 'array' and jsonb_array_length(p_estados) > 0, 'Lista de estados vacía');
  for e in select * from jsonb_array_elements(p_estados) loop
    v_i := v_i + 1;
    v_t := trim(coalesce(e->>'t', ''));
    v_c := coalesce(e->>'c', 'gris');
    perform exigir(length(v_t) between 2 and 60, 'Cada estado necesita un nombre (2 a 60 caracteres)');
    perform exigir(v_c in ('rojo','amarillo','azul','morado','verde','naranja','gris','rosa','celeste','cafe'), 'Color no válido: ' || v_c);
    v_k := nullif(trim(coalesce(e->>'k', '')), '');
    if v_k is null then  -- estado nuevo: clave a partir del nombre
      v_k := 'x_' || left(trim(both '_' from regexp_replace(lower(translate(v_t, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun')), '[^a-z0-9]+', '_', 'g')), 30);
      while exists (select 1 from jsonb_array_elements(v_ant || v_nuevo) a where a->>'k' = v_k) loop v_k := v_k || '_' || v_i; end loop;
    end if;
    perform exigir(not exists (select 1 from jsonb_array_elements(v_nuevo) a where a->>'k' = v_k), 'Estado repetido: ' || v_t);
    if exists (select 1 from jsonb_array_elements(v_ant) a where a->>'k' = v_k and (a->>'s')::boolean) then
      -- estado del sistema: se conserva si cierra el caso o no
      v_nuevo := v_nuevo || jsonb_build_object('k', v_k, 't', v_t, 'c', v_c, 's', true,
        'final', coalesce((select (a->>'final')::boolean from jsonb_array_elements(v_ant) a where a->>'k' = v_k), false),
        'oculto', coalesce((e->>'oculto')::boolean, false));
    else
      v_nuevo := v_nuevo || jsonb_build_object('k', v_k, 't', v_t, 'c', v_c,
        'final', coalesce((e->>'final')::boolean, false), 'oculto', coalesce((e->>'oculto')::boolean, false));
    end if;
  end loop;
  -- no se pueden quitar estados del sistema ni estados en uso
  select string_agg(a->>'t', ', ') into v_t from jsonb_array_elements(v_ant) a
   where not exists (select 1 from jsonb_array_elements(v_nuevo) b where b->>'k' = a->>'k') and (a->>'s')::boolean;
  perform exigir(v_t is null, 'No se pueden eliminar estados que usa SIGAM: ' || coalesce(v_t, ''));
  select string_agg(a->>'t', ', ') into v_t from jsonb_array_elements(v_ant) a
   where not exists (select 1 from jsonb_array_elements(v_nuevo) b where b->>'k' = a->>'k')
     and exists (select 1 from solicitudes s where s.tipo = p_tipo and s.estado = a->>'k');
  perform exigir(v_t is null, 'Hay solicitudes en estos estados; cámbielas antes de eliminarlos: ' || coalesce(v_t, ''));
  -- si un estado nuevo deja de cerrar el caso, las solicitudes en ese estado se reabren (y al revés)
  update solicitudes s set cerrada_at = case when (b->>'final')::boolean then coalesce(s.cerrada_at, now()) end
    from jsonb_array_elements(v_nuevo) b
   where s.tipo = p_tipo and s.estado = b->>'k' and not coalesce((b->>'s')::boolean, false)
     and (s.cerrada_at is null) = (b->>'final')::boolean;
  update solicitud_tipos set estados = v_nuevo where clave = p_tipo;
  return v_nuevo;
end $$;
grant execute on function guardar_estados_tipo(text, jsonb) to authenticated;
