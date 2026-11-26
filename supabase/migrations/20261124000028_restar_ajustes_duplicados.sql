-- =============================================================================
-- SIGAM-INABVE · 028 · Restar ajustes que ya compensaban lo devuelto al Despacho JPII
-- Entre el 25/11 y el 26/11 el Despacho JPII registró ajustes positivos para poder
-- despachar productos que la conciliación había dejado en la Bodega Central. Con la
-- devolución de la migración 027 esas unidades quedaron contadas dos veces: se resta,
-- por producto, lo ajustado (sin pasar de lo devuelto). Se descuenta primero del lote
-- del ajuste y luego por vencimiento.
-- =============================================================================
do $$
declare
  v_desp smallint := (select id from bodegas where sede_id = 1 and tipo = 'despacho_medicamentos');
  v_conc bigint := (select distinct documento_id from movimientos where observacion like 'Devuelto al Despacho%' limit 1);
  r record; l record; pend numeric; q numeric;
begin
  if exists (select 1 from movimientos where observacion like 'Se resta ajuste ya compensado%') then raise notice 'Ya aplicada'; return; end if;
  for r in
    with corr as (select producto_id, sum(cantidad) devuelto from movimientos where observacion like 'Devuelto al Despacho%' group by 1),
         aj as (select m.producto_id, sum(m.cantidad) ajustado, string_agg(distinct m.documento_id::text, ', ') ajustes,
                       array_agg(distinct m.lote_id) lotes
                  from movimientos m join corr c using (producto_id)
                 where m.bodega_id = v_desp and m.fecha >= '2026-11-25 00:00-06' and m.documento = 'ajuste' and m.tipo = 'ajuste_positivo'
                 group by 1)
    select a.producto_id, least(a.ajustado, c.devuelto) restar, a.ajustes, a.lotes from aj a join corr c using (producto_id)
  loop
    pend := r.restar;
    for l in select id, disponible from lotes
              where producto_id = r.producto_id and bodega_id = v_desp and disponible > 0
              order by (id = any(r.lotes)) desc, fecha_vencimiento nulls last, id loop
      exit when pend <= 0;
      q := least(pend, l.disponible);
      perform mover_lote(l.id, -q, 'ajuste_negativo', 'conciliacion', v_conc,
        'Se resta ajuste ya compensado por la devolución al Despacho del 26/11 (ajuste N° ' || r.ajustes || ')');
      pend := pend - q;
    end loop;
    if pend > 0 then raise exception 'Producto %: faltan % unidades en el Despacho para restar', r.producto_id, pend; end if;
  end loop;
end $$;
