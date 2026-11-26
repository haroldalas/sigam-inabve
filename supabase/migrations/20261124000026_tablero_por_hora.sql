-- =============================================================================
-- SIGAM-INABVE · 026 · Tableros: movimiento por hora (para ver el día presente)
-- Agrega 'por_hora' (hora de El Salvador) a tablero_consumo().
-- =============================================================================
do $$
declare
  v_def text := pg_get_functiondef('tablero_consumo(date,date,smallint,text,smallint)'::regprocedure);
  v_nueva text;
begin
  if v_def like '%''por_hora''%' then return; end if;   -- ya aplicada
  v_nueva := replace(v_def, 'select s.id as salida_id, s.fecha, s.tipo as tipo_salida,',
    'select s.id as salida_id, s.fecha, extract(hour from s.creado_at at time zone ''America/El_Salvador'')::int as hora, s.tipo as tipo_salida,');
  v_nueva := replace(v_nueva, $q$    'quincenal', (select$q$, $q$    'por_hora', (select coalesce(jsonb_agg(x order by x.hora), '[]') from (
              select hora, count(distinct salida_id) despachos, sum(cantidad) unidades, sum(monto) monto,
                     count(distinct persona) personas from d group by 1) x),
    'quincenal', (select$q$);
  if v_nueva !~ 'as hora' or v_nueva !~ '''por_hora''' then raise exception 'tablero_consumo: no se pudo agregar por_hora'; end if;
  execute v_nueva;
end $$;
