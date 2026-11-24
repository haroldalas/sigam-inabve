-- =============================================================================
-- SIGAM-INABVE · Migración 8: columnas adicionales en vistas de traslados
-- (identificadores de bodega y cantidades enviadas/recibidas por línea)
-- =============================================================================
create or replace view v_bitacora_traslados with (security_invoker = true) as
select t.id, t.numero, t.fecha, t.estado,
       bo.nombre as bodega_origen, so.nombre as sede_origen, bd.nombre as bodega_destino, sd.nombre as sede_destino,
       categoria_reporte(null::tipo_producto, bd.tipo) as categoria_destino,
       t.enviado_por, t.enviado_at, t.recibido_por, t.recibido_at, t.anulado_por, t.motivo_anulacion, t.enviado_sivet,
       count(d.id) as lineas, sum(d.cantidad_enviada) as unidades_enviadas, sum(d.cantidad_recibida) as unidades_recibidas,
       round(sum(d.cantidad_enviada * lo.precio_unitario), 2) as monto,
       (select count(*) from traslado_diferencias df where df.traslado_id = t.id and df.estado = 'pendiente') as diferencias_pendientes,
       string_agg(distinct p.tipo::text, ', ') as tipos_producto,
       t.observaciones, t.bodega_origen_id, t.bodega_destino_id
  from traslados t
  join bodegas bo on bo.id = t.bodega_origen_id join sedes so on so.id = bo.sede_id
  join bodegas bd on bd.id = t.bodega_destino_id join sedes sd on sd.id = bd.sede_id
  left join traslado_detalle d on d.traslado_id = t.id
  left join lotes lo on lo.id = d.lote_origen_id
  left join productos p on p.id = d.producto_id
 group by t.id, bo.nombre, so.nombre, bd.nombre, sd.nombre, bd.tipo;

create or replace view v_sivet_traslado with (security_invoker = true) as
select t.id as traslado_id, t.numero as numero_traslado, t.fecha as fecha_traslado, t.estado,
       row_number() over (partition by t.id order by d.id) as correlativo,
       p.codigo, coalesce(least(d.cantidad_recibida, d.cantidad_enviada), d.cantidad_enviada) as cantidad,
       lo.precio_unitario as precio,
       round(coalesce(least(d.cantidad_recibida, d.cantidad_enviada), d.cantidad_enviada) * lo.precio_unitario, 2) as total,
       fa.numero_sivet as factura, fa.fecha_factura,
       coalesce(c.nombre_sivet, pr.nombre_sivet || ' - ' ||
                case when p.tipo = 'insumo' then 'INSUMOS' else 'MEDICAMENTOS' end || ' - ' || sd.nombre_sivet)
         as nombre_contrato_sivetweb,
       lo.numero_lote as lote, lo.fecha_vencimiento, etiqueta_aware(p.aware) as clasificacion_aware,
       case when p.cadena_frio then 'SÍ' else 'NO' end as refrigerado,
       case when p.controlado then 'SÍ' else 'NO' end as controlado,
       categoria_reporte(p.tipo, bd.tipo) as categoria,
       p.nombre_comercial, p.principio_activo, p.presentacion,
       bo.nombre as bodega_origen, bd.nombre as bodega_destino, sd.nombre as sede_destino,
       pr.nombre as proveedor, d.id as detalle_id, d.cantidad_enviada, d.cantidad_recibida
  from traslados t
  join traslado_detalle d on d.traslado_id = t.id
  join productos p on p.id = d.producto_id
  join lotes lo on lo.id = d.lote_origen_id
  join bodegas bo on bo.id = t.bodega_origen_id
  join bodegas bd on bd.id = t.bodega_destino_id
  join sedes sd on sd.id = bd.sede_id
  left join proveedores pr on pr.id = lo.proveedor_id
  left join contratos c on c.proveedor_id = lo.proveedor_id and c.sede_id = bd.sede_id and c.tipo = p.tipo
  left join factura_detalle fd on fd.id = lo.factura_detalle_id
  left join facturas fa on fa.id = fd.factura_id
 where t.estado <> 'anulado';

grant select on v_bitacora_traslados, v_sivet_traslado to authenticated;
revoke all on all tables in schema public from anon;
