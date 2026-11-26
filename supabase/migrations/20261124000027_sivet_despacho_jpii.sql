-- =============================================================================
-- SIGAM-INABVE · 027 · JPII: el stock del contrato SIVET va completo al Despacho
-- Decisión 26/11/2026: lo que trae el contrato SIVET de Juan Pablo II está en el
-- Despacho de Medicamentos, no en la Bodega Central (la Central entra a SIVET solo
-- cuando se traslada a farmacia). La conciliación del 24/11 había descontado del
-- Despacho lo que SIFAR tenía en la Central ("conservado"); aquí se devuelve al
-- Despacho esa cantidad, por producto, sin tocar la Bodega Central. Se toman como
-- molde el lote y vencimiento del lote de la Central (o del Despacho si ya no hay).
-- Contrato: CEFAFA - MEDICAMENTOS - JUAN PABLO II (conciliación 14).
-- =============================================================================
do $$
declare
  v_conc bigint := (select c.id from conciliaciones c join contratos ct on ct.id = c.contrato_id
                     where ct.nombre_sivet = 'CEFAFA - MEDICAMENTOS - JUAN PABLO II' order by c.id desc limit 1);
  v_desp smallint := (select id from bodegas where sede_id = 1 and tipo = 'despacho_medicamentos');
  v_prov smallint := (select proveedor_id from contratos where nombre_sivet = 'CEFAFA - MEDICAMENTOS - JUAN PABLO II');
  r record; m lotes; v_dest bigint; v_obs text;
begin
  if exists (select 1 from movimientos where documento = 'conciliacion' and documento_id = v_conc and observacion like 'Devuelto al Despacho%') then
    raise notice 'Ya aplicada'; return;
  end if;
  for r in select (d->>'producto_id')::bigint producto_id, (d->>'conservado')::numeric cant
             from conciliaciones c, jsonb_array_elements(c.detalle) d
            where c.id = v_conc and (d->>'conservado')::numeric > 0 loop
    select l.* into m from lotes l join bodegas b on b.id = l.bodega_id
     where l.producto_id = r.producto_id and b.sede_id = 1 and b.tipo in ('central', 'despacho_medicamentos')
     order by (b.tipo = 'central') desc, (l.disponible > 0) desc, l.fecha_vencimiento nulls last, l.id
     limit 1;
    select id into v_dest from lotes
     where producto_id = r.producto_id and bodega_id = v_desp and proveedor_id is not distinct from coalesce(m.proveedor_id, v_prov)
       and numero_lote is not distinct from m.numero_lote and fecha_vencimiento is not distinct from m.fecha_vencimiento
     order by id limit 1;
    if v_dest is null then
      insert into lotes(factura_detalle_id, producto_id, bodega_id, proveedor_id, numero_lote, fecha_vencimiento,
                        precio_unitario, cantidad_inicial, disponible, estado, lote_origen_id)
      values (m.factura_detalle_id, r.producto_id, v_desp, coalesce(m.proveedor_id, v_prov), coalesce(m.numero_lote, 'SIVET-S/F'),
              coalesce(m.fecha_vencimiento, date '2099-12-31'), coalesce(m.precio_unitario, 0), r.cant, 0, 'agotado', m.id)
      returning id into v_dest;
    end if;
    v_obs := 'Devuelto al Despacho: el contrato SIVET de JPII corresponde al Despacho, no a la Bodega Central (decisión 26/11/2026)';
    perform mover_lote(v_dest, r.cant, 'ajuste_positivo', 'conciliacion', v_conc, v_obs);
  end loop;
end $$;

-- Conciliaciones futuras: la Bodega Central ya no se descuenta del stock SIVET
-- (sus lotes no se tocan; Despacho/Almacén quedan con todo lo que dice SIVET).
do $$
declare v_def text := pg_get_functiondef('conciliar_sivet(smallint,jsonb,boolean,text)'::regprocedure); v_nueva text;
begin
  if v_def like '%false conservar%' then return; end if;
  v_nueva := replace(v_def, $q$b.tipo = 'central' conservar,$q$, $q$false conservar,$q$);
  v_nueva := replace(v_nueva, $q$and b.tipo in ('central','despacho_medicamentos','almacen_insumos')$q$, $q$and b.tipo in ('despacho_medicamentos','almacen_insumos')$q$);
  if v_nueva = v_def or v_nueva like '%b.tipo = ''central'' conservar%' then raise exception 'conciliar_sivet: no se pudo cambiar la regla de la Central'; end if;
  execute v_nueva;
end $$;
