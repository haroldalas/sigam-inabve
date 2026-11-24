-- =============================================================================
-- SIGAM-INABVE · Migración 4: vistas de consulta y reportes
-- security_invoker = true: cada vista respeta la RLS del usuario que la consulta
-- =============================================================================

-- Categoría de reporte: medicamento / insumo médico / pequeña cirugía
create or replace function categoria_reporte(p_tipo tipo_producto, p_tipo_bodega tipo_bodega) returns text
language sql immutable set search_path = public as $$
  select case when p_tipo_bodega = 'pequena_cirugia' then 'PEQUEÑA CIRUGÍA'
              when p_tipo = 'insumo' then 'INSUMO MÉDICO' else 'MEDICAMENTO' end
$$;

create or replace function etiqueta_aware(p categoria_aware) returns text language sql immutable set search_path = public as $$
  select case p when 'acceso' then 'Acceso' when 'precaucion' then 'Precaución' when 'reserva' then 'Reserva'
                when 'no_recomendado' then 'No recomendado' when 'otros' then 'Otros' end
$$;

-- Existencias por lote (consulta de existencias / Contact Center) ----------------
create or replace view v_existencias with (security_invoker = true) as
select l.id as lote_id, p.id as producto_id, p.codigo, p.nombre_comercial, p.principio_activo,
       p.concentracion, p.presentacion, f.nombre as familia, p.tipo, etiqueta_aware(p.aware) as aware,
       p.controlado, p.cadena_frio,
       s.id as sede_id, s.nombre as sede, b.id as bodega_id, b.nombre as bodega, b.tipo as tipo_bodega,
       pr.nombre as proveedor, fa.numero_sivet as factura, l.numero_lote, l.fecha_vencimiento,
       (l.fecha_vencimiento - hoy()) as dias_para_vencer,
       case when l.fecha_vencimiento < hoy() then 'VENCIDO'
            when l.fecha_vencimiento - hoy() <= 90 then 'CRÍTICO'
            when l.fecha_vencimiento - hoy() <= 180 then 'POR VENCER' end as alerta_vencimiento,
       l.disponible, l.precio_unitario, round(l.disponible * l.precio_unitario, 2) as valor, l.estado
  from lotes l
  join productos p on p.id = l.producto_id
  join bodegas b on b.id = l.bodega_id
  join sedes s on s.id = b.sede_id
  left join familias f on f.id = p.familia_id
  left join proveedores pr on pr.id = l.proveedor_id
  left join factura_detalle fd on fd.id = l.factura_detalle_id
  left join facturas fa on fa.id = fd.factura_id
 where l.disponible > 0;

-- Resumen por producto y bodega (incluye lo que viene en tránsito)
create or replace view v_existencias_resumen with (security_invoker = true) as
with disp as (
  select producto_id, bodega_id, sum(disponible) as disponible, min(fecha_vencimiento) as proximo_vencimiento
    from lotes where disponible > 0 and estado = 'activo' group by 1,2),
transito as (
  select d.producto_id, t.bodega_destino_id as bodega_id, sum(d.cantidad_enviada) as en_transito
    from traslado_detalle d join traslados t on t.id = d.traslado_id
   where t.estado = 'enviado' group by 1,2),
consumo as (
  select sd.producto_id, s.bodega_id, sum(sd.cantidad) as consumo_30d
    from salida_detalle sd join salidas s on s.id = sd.salida_id
   where s.estado = 'confirmada' and s.fecha >= hoy() - 30 group by 1,2),
base as (select producto_id, bodega_id from disp union select producto_id, bodega_id from transito)
select p.id as producto_id, p.codigo, p.nombre_comercial, p.principio_activo, p.presentacion, p.tipo,
       f.nombre as familia, etiqueta_aware(p.aware) as aware, p.cadena_frio, p.controlado,
       s.nombre as sede, b.id as bodega_id, b.nombre as bodega, b.tipo as tipo_bodega,
       coalesce(disp.disponible,0) as disponible, coalesce(tr.en_transito,0) as en_transito,
       disp.proximo_vencimiento, coalesce(c.consumo_30d,0) as consumo_30d,
       case when coalesce(c.consumo_30d,0) > 0 then round(coalesce(disp.disponible,0) / (c.consumo_30d / 30.0)) end
         as dias_cobertura
  from base
  join productos p on p.id = base.producto_id
  join bodegas b on b.id = base.bodega_id
  join sedes s on s.id = b.sede_id
  left join familias f on f.id = p.familia_id
  left join disp on disp.producto_id = base.producto_id and disp.bodega_id = base.bodega_id
  left join transito tr on tr.producto_id = base.producto_id and tr.bodega_id = base.bodega_id
  left join consumo c on c.producto_id = base.producto_id and c.bodega_id = base.bodega_id
 where puede_ver_bodega(b.id);

-- Alertas de vencimiento (6 meses o menos)
create or replace view v_alertas_vencimiento with (security_invoker = true) as
select * from v_existencias
 where fecha_vencimiento is not null and dias_para_vencer <= 180
 order by fecha_vencimiento;

-- =============================================================================
-- Excel para TICS / SIVET: mismo formato que la hoja MIGRAR + columnas nuevas
-- =============================================================================
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
       pr.nombre as proveedor
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

-- Entradas a bodega central (para cargar en el contrato de Juan Pablo II)
create or replace view v_sivet_entrada with (security_invoker = true) as
select fa.id as factura_id, fa.creado_at::date as fecha_registro,
       row_number() over (partition by fa.id order by fd.id) as correlativo,
       p.codigo, fd.cantidad, fd.precio_unitario as precio, round(fd.cantidad * fd.precio_unitario, 2) as total,
       fa.numero_sivet as factura, fa.fecha_factura,
       coalesce(c.nombre_sivet, pr.nombre_sivet || ' - ' ||
                case when p.tipo = 'insumo' then 'INSUMOS' else 'MEDICAMENTOS' end || ' - ' || s.nombre_sivet)
         as nombre_contrato_sivetweb,
       fd.numero_lote as lote, fd.fecha_vencimiento, etiqueta_aware(p.aware) as clasificacion_aware,
       case when p.cadena_frio then 'SÍ' else 'NO' end as refrigerado,
       case when p.controlado then 'SÍ' else 'NO' end as controlado,
       categoria_reporte(p.tipo, b.tipo) as categoria, p.nombre_comercial, pr.nombre as proveedor
  from facturas fa
  join factura_detalle fd on fd.factura_id = fa.id
  join productos p on p.id = fd.producto_id
  join proveedores pr on pr.id = fa.proveedor_id
  join bodegas b on b.id = fa.bodega_id
  join sedes s on s.id = b.sede_id
  left join contratos c on c.proveedor_id = fa.proveedor_id and c.sede_id = b.sede_id and c.tipo = p.tipo
 where fa.estado = 'confirmada' and not pr.es_carga_inicial;

-- =============================================================================
-- Liquidación: avance de entrega por factura (entregas de todas las sedes,
-- porque las copias de lote conservan la línea de factura original)
-- =============================================================================
create or replace view v_avance_factura_detalle with (security_invoker = true) as
select fd.id as factura_detalle_id, fa.id as factura_id, p.codigo, p.nombre_comercial,
       fd.cantidad as comprado, fd.precio_unitario,
       coalesce(e.entregado,0) - coalesce(dv.devuelto,0) as entregado,
       greatest(fd.cantidad - (coalesce(e.entregado,0) - coalesce(dv.devuelto,0)), 0) as pendiente
  from factura_detalle fd
  join facturas fa on fa.id = fd.factura_id
  join productos p on p.id = fd.producto_id
  left join lateral (
    select sum(sd.cantidad) as entregado from salida_detalle sd
      join salidas s on s.id = sd.salida_id and s.estado = 'confirmada'
      join lotes l on l.id = sd.lote_id
     where l.factura_detalle_id = fd.id) e on true
  left join lateral (
    select sum(dv.cantidad) as devuelto from devoluciones dv join lotes l on l.id = dv.lote_id
     where l.factura_detalle_id = fd.id and dv.estado in ('reingresada','averia')) dv on true;

create or replace view v_avance_factura with (security_invoker = true) as
select fa.id as factura_id, fa.numero, fa.numero_sivet, fa.fecha_factura, pr.nombre as proveedor,
       count(*) as productos, sum(a.comprado) as unidades_compradas, sum(a.entregado) as unidades_entregadas,
       round(sum(a.comprado * a.precio_unitario), 2) as monto_factura,
       round(sum(a.entregado * a.precio_unitario), 2) as monto_entregado,
       round(100.0 * sum(a.entregado) / nullif(sum(a.comprado),0), 1) as porcentaje_entregado,
       (sum(a.pendiente) = 0) as lista_para_liquidar,
       fa.estado_liquidacion, fa.liquidacion_fecha, fa.liquidacion_por, fa.liquidacion_obs
  from facturas fa
  join proveedores pr on pr.id = fa.proveedor_id
  join v_avance_factura_detalle a on a.factura_id = fa.id
 where fa.estado = 'confirmada' and not pr.es_carga_inicial
 group by fa.id, pr.nombre;

-- Bandeja del administrador: diferencias de traslado y devoluciones por validar
create or replace view v_pendientes_admin with (security_invoker = true) as
select 'diferencia_traslado' as tipo, df.id, df.creado_at as fecha, t.numero as documento,
       bd.nombre as bodega, nombre_producto(df.producto_id) as producto,
       df.tipo::text || ': enviado ' || df.cantidad_enviada || ', recibido ' || df.cantidad_recibida as detalle,
       df.observacion_sede as observacion
  from traslado_diferencias df join traslados t on t.id = df.traslado_id join bodegas bd on bd.id = t.bodega_destino_id
 where df.estado = 'pendiente' and es_admin()
union all
select 'devolucion', dv.id, dv.creado_at, 'Factura ' || dv.numero_factura, b.nombre, nombre_producto(dv.producto_id),
       dv.cantidad || ' · DUI ' || dv.dui || ' · receta ' || to_char(dv.fecha_receta,'DD/MM/YYYY') || ' · ' || dv.estado_fisico,
       dv.motivo
  from devoluciones dv join bodegas b on b.id = dv.bodega_id
 where dv.estado = 'pendiente' and es_admin();

grant select on v_existencias, v_existencias_resumen, v_alertas_vencimiento, v_sivet_traslado, v_sivet_entrada,
  v_avance_factura_detalle, v_avance_factura, v_pendientes_admin to authenticated;
grant execute on function categoria_reporte(tipo_producto, tipo_bodega), etiqueta_aware(categoria_aware) to authenticated;
revoke execute on function categoria_reporte(tipo_producto, tipo_bodega), etiqueta_aware(categoria_aware) from public, anon;
revoke all on all tables in schema public from anon;
