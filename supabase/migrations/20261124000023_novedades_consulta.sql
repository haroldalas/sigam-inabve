-- =============================================================================
-- SIGAM-INABVE · 023 · Novedades para usuarios de consulta
-- Los de consulta (médicos, Contact Center) no ven vencimientos ni abastecimiento:
-- solo se enteran cuando un medicamento llega a una sede que no lo tenía
-- (compra o traslado recibido en el Despacho de Medicamentos, con existencia previa en 0).
-- Las conciliaciones con SIVET y la carga inicial no cuentan como novedad.
-- =============================================================================
create or replace function novedades_medicamentos(p_dias int default 30)
returns table (fecha timestamptz, sede_id smallint, sede text, producto_id bigint, codigo text, producto text,
               principio_activo text, presentacion text, cantidad numeric, existencia numeric, origen text)
language sql stable security definer set search_path = public as $$
  with m as (
    select mv.id, mv.fecha, mv.tipo, mv.cantidad, mv.producto_id, mv.bodega_id, mv.documento, mv.documento_id, b.sede_id,
           coalesce(sum(mv.cantidad) over (partition by mv.producto_id, mv.bodega_id order by mv.fecha, mv.id
                                           rows between unbounded preceding and 1 preceding), 0) as antes
      from movimientos mv
      join bodegas b on b.id = mv.bodega_id and b.tipo = 'despacho_medicamentos'
      join productos p on p.id = mv.producto_id and p.tipo = 'medicamento'
  ), llegadas as (
    select distinct on (m.producto_id, m.sede_id) m.*
      from m
     where m.tipo in ('entrada', 'traslado_recepcion') and m.cantidad > 0 and m.antes <= 0
       and m.fecha >= now() - make_interval(days => greatest(coalesce(p_dias, 30), 1))
     order by m.producto_id, m.sede_id, m.fecha desc
  )
  select l.fecha, l.sede_id, s.nombre, p.id, p.codigo, p.nombre_comercial, p.principio_activo, p.presentacion, l.cantidad,
         (select coalesce(sum(x.disponible), 0) from lotes x where x.producto_id = l.producto_id and x.bodega_id = l.bodega_id and x.estado = 'activo'),
         case when l.tipo = 'entrada' then 'Compra'
              else 'Traslado desde ' || coalesce((select so.nombre from traslados t join bodegas bo on bo.id = t.bodega_origen_id
                                                   join sedes so on so.id = bo.sede_id where t.id = l.documento_id), 'otra sede') end
    from llegadas l join sedes s on s.id = l.sede_id join productos p on p.id = l.producto_id
   where app_rol() is not null
     and (select coalesce(sum(x.disponible), 0) from lotes x where x.producto_id = l.producto_id and x.bodega_id = l.bodega_id and x.estado = 'activo') > 0
   order by l.fecha desc
$$;
revoke all on function novedades_medicamentos(int) from public, anon;
grant execute on function novedades_medicamentos(int) to authenticated;
