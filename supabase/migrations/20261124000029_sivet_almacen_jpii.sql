-- =============================================================================
-- SIGAM-INABVE · 029 · JPII insumos: igual que 027 + 028 para CEFAFA - INSUMOS - JUAN PABLO II
-- 1. Devuelve al Almacén de Insumos JPII lo que la conciliación dejó en la Bodega Central.
-- 2. Resta los ajustes positivos hechos desde el 25/11 (en la bodega donde se hicieron)
--    que ya compensaban esa falta, sin pasar de lo devuelto.
-- =============================================================================
do $$
declare
  v_conc bigint := (select c.id from conciliaciones c join contratos ct on ct.id = c.contrato_id
                     where ct.nombre_sivet = 'CEFAFA - INSUMOS - JUAN PABLO II' order by c.id desc limit 1);
  v_alm smallint := (select id from bodegas where sede_id = 1 and tipo = 'almacen_insumos');
  v_prov smallint := (select proveedor_id from contratos where nombre_sivet = 'CEFAFA - INSUMOS - JUAN PABLO II');
  r record; m lotes; l record; v_dest bigint; pend numeric; q numeric;
begin
  if exists (select 1 from movimientos where documento = 'conciliacion' and documento_id = v_conc and observacion like 'Devuelto al Almacén%') then
    raise notice 'Ya aplicada'; return;
  end if;
  -- 1. devolución
  for r in select (d->>'producto_id')::bigint producto_id, (d->>'conservado')::numeric cant
             from conciliaciones c, jsonb_array_elements(c.detalle) d
            where c.id = v_conc and (d->>'conservado')::numeric > 0 loop
    select x.* into m from lotes x join bodegas b on b.id = x.bodega_id
     where x.producto_id = r.producto_id and b.sede_id = 1 and b.tipo in ('central', 'almacen_insumos')
     order by (b.tipo = 'central') desc, (x.disponible > 0) desc, x.fecha_vencimiento nulls last, x.id limit 1;
    v_dest := null;
    select id into v_dest from lotes
     where producto_id = r.producto_id and bodega_id = v_alm and proveedor_id is not distinct from coalesce(m.proveedor_id, v_prov)
       and numero_lote is not distinct from m.numero_lote and fecha_vencimiento is not distinct from m.fecha_vencimiento
     order by id limit 1;
    if v_dest is null then
      insert into lotes(factura_detalle_id, producto_id, bodega_id, proveedor_id, numero_lote, fecha_vencimiento,
                        precio_unitario, cantidad_inicial, disponible, estado, lote_origen_id)
      values (m.factura_detalle_id, r.producto_id, v_alm, coalesce(m.proveedor_id, v_prov), coalesce(m.numero_lote, 'SIVET-S/F'),
              coalesce(m.fecha_vencimiento, date '2099-12-31'), coalesce(m.precio_unitario, 0), r.cant, 0, 'agotado', m.id)
      returning id into v_dest;
    end if;
    perform mover_lote(v_dest, r.cant, 'ajuste_positivo', 'conciliacion', v_conc,
      'Devuelto al Almacén: el contrato SIVET de JPII corresponde al Almacén de Insumos, no a la Bodega Central (decisión 26/11/2026)');
  end loop;
  -- 2. restar ajustes ya compensados
  for r in
    with corr as (select producto_id, sum(cantidad) devuelto from movimientos
                   where documento_id = v_conc and observacion like 'Devuelto al Almacén%' group by 1)
    select m2.producto_id, m2.bodega_id, sum(m2.cantidad) ajustado, string_agg(distinct m2.documento_id::text, ', ') ajustes,
           array_agg(distinct m2.lote_id) lotes, max(c.devuelto) devuelto
      from movimientos m2 join corr c using (producto_id) join bodegas b on b.id = m2.bodega_id
     where b.sede_id = 1 and b.tipo in ('almacen_insumos', 'despacho_medicamentos')
       and m2.fecha >= '2026-11-25 00:00-06' and m2.documento = 'ajuste' and m2.tipo = 'ajuste_positivo'
     group by 1, 2
  loop
    pend := least(r.ajustado, r.devuelto);
    for l in select id, disponible from lotes where producto_id = r.producto_id and bodega_id = r.bodega_id and disponible > 0
              order by (id = any(r.lotes)) desc, fecha_vencimiento nulls last, id loop
      exit when pend <= 0;
      q := least(pend, l.disponible);
      perform mover_lote(l.id, -q, 'ajuste_negativo', 'conciliacion', v_conc,
        'Se resta ajuste ya compensado por la devolución al Almacén del 26/11 (ajuste N° ' || r.ajustes || ')');
      pend := pend - q;
    end loop;
    if pend > 0 then raise exception 'Producto %: faltan % unidades para restar', r.producto_id, pend; end if;
  end loop;
end $$;
