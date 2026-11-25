-- =============================================================================
-- SIGAM-INABVE · 022 · Conciliación compatible con pg_safeupdate
-- Supabase rechaza todo UPDATE/DELETE sin WHERE en las llamadas desde la app
-- ("UPDATE requires a WHERE clause"), también dentro de funciones. conciliar_sivet
-- actualizaba su tabla temporal _s completa sin WHERE (3 instrucciones); se agrega "where true".
-- =============================================================================
do $$
declare
  v_def text := pg_get_functiondef('conciliar_sivet(smallint,jsonb,boolean,text)'::regprocedure);
  v_nueva text;
begin
  v_nueva := replace(v_def, 'update _s set objetivo = greatest(stock - conservado, 0);',
                            'update _s set objetivo = greatest(stock - conservado, 0) where true;');
  v_nueva := replace(v_nueva, 'update _s set pendiente = objetivo;', 'update _s set pendiente = objetivo where true;');
  v_nueva := replace(v_nueva, 'and _l.factura is not distinct from _s.factura), 0));',
                              'and _l.factura is not distinct from _s.factura), 0)) where true;');
  if v_nueva = v_def then raise exception 'conciliar_sivet: no se encontraron las instrucciones a corregir'; end if;
  if v_nueva !~ 'pendiente = objetivo where true' or v_nueva !~ 'objetivo = greatest\(stock - conservado, 0\) where true'
     or v_nueva !~ '_s.factura\), 0\)\) where true' then
    raise exception 'conciliar_sivet: corrección incompleta';
  end if;
  execute v_nueva;
end $$;
