-- =============================================================================
-- SIGAM-INABVE · Migración 7: modo sin conexión
-- Cada despacho lleva un identificador generado en el equipo (client_id). Si la
-- red se cae y el equipo reintenta, el despacho no se duplica. Un despacho hecho
-- sin conexión conserva la fecha en que se entregó (nunca futura ni de hace más de 7 días).
-- =============================================================================
alter table salidas add column client_id uuid unique;

create or replace function registrar_salida(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_bod bodegas; v_tipo tipo_salida := coalesce(nullif(p->>'tipo',''),'beneficiario')::tipo_salida;
  v_id bigint; v_num text; ln jsonb; r record; v_out jsonb := '[]'; n int := 0; v_dui text;
  v_cliente uuid := nullif(p->>'client_id','')::uuid;
begin
  -- Idempotencia: si el equipo reenvía un despacho ya guardado (modo sin conexión), se devuelve el existente
  if v_cliente is not null then
    select id, numero into v_id, v_num from salidas where client_id = v_cliente;
    if found then
      return jsonb_build_object('salida_id', v_id, 'numero', v_num, 'duplicado', true);
    end if;
  end if;
  select * into v_bod from bodegas where id = (p->>'bodega_id')::smallint;
  perform exigir(found and v_bod.activa, 'Bodega no válida');
  perform exigir(v_bod.tipo <> 'descarte', 'No se despacha desde la bodega de descarte');
  perform exigir(puede_operar_bodega(v_bod.id), 'Solo puede despachar desde las bodegas de su sede');
  perform exigir(jsonb_array_length(coalesce(p->'lineas','[]')) > 0, 'La salida no tiene productos');

  if v_tipo = 'beneficiario' then
    v_dui := normalizar_dui(p->>'dui');
  elsif v_tipo = 'personal' then
    perform exigir(nullif(trim(p->>'persona_recibe'),'') is not null, 'Indique la persona que recibe');
    if nullif(p->>'dui','') is not null then v_dui := normalizar_dui(p->>'dui'); end if;
  end if;

  v_num := siguiente_numero('salida', 'S-');
  insert into salidas(numero, bodega_id, tipo, dui, expediente, persona_recibe, persona_solicita, observaciones, creado_por, client_id, fecha)
  values (v_num, v_bod.id, v_tipo, v_dui, nullif(trim(p->>'expediente'),''),
          nullif(trim(p->>'persona_recibe'),''),
          coalesce(nullif(trim(p->>'persona_solicita'),''), nullif(trim(p->>'persona_recibe'),'')),
          p->>'observaciones', app_email(), v_cliente,
          greatest(least(coalesce(nullif(p->>'fecha','')::date, hoy()), hoy()), hoy() - 7))
  returning id into v_id;

  for ln in select * from jsonb_array_elements(p->'lineas') loop
    n := n + 1;
    perform exigir(nullif(ln->>'cantidad','')::numeric > 0, 'Línea ' || n || ': cantidad inválida');
    for r in select * from consumir_pvps(v_bod.id, (ln->>'producto_id')::bigint, (ln->>'cantidad')::numeric,
                                         nullif(ln->>'lote_id','')::bigint, 'salida', 'salida', v_id) loop
      insert into salida_detalle(salida_id, producto_id, lote_id, cantidad)
      values (v_id, (ln->>'producto_id')::bigint, r.lote_id, r.cantidad);
      v_out := v_out || jsonb_build_object('producto_id', (ln->>'producto_id')::bigint, 'lote_id', r.lote_id, 'cantidad', r.cantidad);
    end loop;
  end loop;

  return jsonb_build_object('salida_id', v_id, 'numero', v_num, 'detalle', v_out);
end $$;

grant execute on function registrar_salida(jsonb) to authenticated;
