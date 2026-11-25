-- =============================================================================
-- SIGAM-INABVE · 018 · Traslados "Ya migrado a SIVET" y proveedores de SIFAR
-- * El Excel para SIVET solo se genera cuando el traslado fue recibido y coincide
--   (estado recibido o cerrado, sin diferencias pendientes). Al generarlo, el traslado
--   queda como "Ya migrado a SIVET" (columnas sivet_efectivo / sivet_efectivo_at / _por /
--   sivet_referencia = nombre del archivo).
-- * Los traslados históricos de SIFAR ya recibidos quedan como migrados: las existencias se
--   igualaron a SIVET el 24/11/2026, así que volver a migrarlos los duplicaría en SIVET.
-- * Los lotes de "CARGA INICIAL INVENTARIO" de SIFAR son de CEFAFA.
-- * TECMED se eliminó como proveedor: ya es CIENFUEGOS.
-- =============================================================================

-- Proveedores -------------------------------------------------------------------
update facturas set proveedor_id = 1 where proveedor_id = (select id from proveedores where es_carga_inicial);
update lotes    set proveedor_id = 1 where proveedor_id = (select id from proveedores where es_carga_inicial);
update polizas  set proveedor_id = 1 where proveedor_id = (select id from proveedores where es_carga_inicial);

update facturas set proveedor_id = 9 where proveedor_id = 11;
update lotes    set proveedor_id = 9 where proveedor_id = 11;
update polizas  set proveedor_id = 9 where proveedor_id = 11;
delete from proveedores p
 where p.id = 11
   and not exists (select 1 from facturas where proveedor_id = 11)
   and not exists (select 1 from lotes where proveedor_id = 11)
   and not exists (select 1 from polizas where proveedor_id = 11)
   and not exists (select 1 from contratos where proveedor_id = 11);

-- ¿Listo para migrar a SIVET? ----------------------------------------------------
create or replace function traslado_listo_sivet(p_traslado bigint) returns boolean
language sql stable set search_path = public as $$
  select t.estado in ('recibido', 'cerrado')
         and not exists (select 1 from traslado_diferencias d where d.traslado_id = t.id and d.estado = 'pendiente')
    from traslados t where t.id = p_traslado
$$;

-- Se llama al generar el Excel: valida y marca "Ya migrado a SIVET"
create or replace function migrar_traslados_sivet(p_traslados bigint[], p_archivo text default null) returns int
language plpgsql security definer set search_path = public as $$
declare v_no text; n int;
begin
  perform exigir(es_admin(), 'Solo un administrador genera el Excel para SIVET');
  perform exigir(coalesce(array_length(p_traslados, 1), 0) > 0, 'Seleccione al menos un traslado');
  select string_agg(numero, ', ' order by numero) into v_no
    from traslados where id = any(p_traslados) and not coalesce(traslado_listo_sivet(id), false);
  perform exigir(v_no is null, 'Estos traslados aún no se han recibido o tienen diferencias por resolver: ' || v_no);
  select string_agg(numero, ', ' order by numero) into v_no
    from traslados where id = any(p_traslados) and sivet_efectivo;
  perform exigir(v_no is null, 'Estos traslados ya fueron migrados a SIVET: ' || v_no);
  update traslados set sivet_efectivo = true, enviado_sivet = true, sivet_efectivo_at = now(),
         sivet_efectivo_por = app_email(), sivet_referencia = coalesce(nullif(trim(p_archivo), ''), sivet_referencia)
   where id = any(p_traslados);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function migrar_traslados_sivet(bigint[], text), traslado_listo_sivet(bigint) from public, anon;
grant execute on function migrar_traslados_sivet(bigint[], text), traslado_listo_sivet(bigint) to authenticated;

-- Quitar la marca solo con motivo (por si el Excel no llegó a SIVET)
create or replace function marcar_efectivo_sivet(p_traslados bigint[], p_efectivo boolean default true,
                                                 p_referencia text default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform exigir(es_admin(), 'Solo un administrador cambia el estado SIVET de un traslado');
  perform exigir(coalesce(array_length(p_traslados, 1), 0) > 0, 'Seleccione al menos un traslado');
  if p_efectivo then
    return migrar_traslados_sivet(p_traslados, p_referencia);
  end if;
  update traslados set sivet_efectivo = false, sivet_efectivo_at = null, sivet_efectivo_por = null,
         sivet_referencia = case when nullif(trim(p_referencia), '') is null then null
                                 else 'Marca quitada: ' || trim(p_referencia) end
   where id = any(p_traslados) and sivet_efectivo;
  get diagnostics n = row_count;
  return n;
end $$;

-- Bitácora con la columna listo_sivet (al final)
create or replace view v_bitacora_traslados with (security_invoker = true) as
select t.id, t.numero, t.fecha, t.estado,
       bo.nombre as bodega_origen, so.nombre as sede_origen, bd.nombre as bodega_destino, sd.nombre as sede_destino,
       categoria_reporte(null::tipo_producto, bd.tipo) as categoria_destino,
       t.enviado_por, t.enviado_at, t.recibido_por, t.recibido_at, t.anulado_por, t.motivo_anulacion, t.enviado_sivet,
       count(d.id) as lineas, sum(d.cantidad_enviada) as unidades_enviadas, sum(d.cantidad_recibida) as unidades_recibidas,
       round(sum(d.cantidad_enviada * lo.precio_unitario), 2) as monto,
       (select count(*) from traslado_diferencias df where df.traslado_id = t.id and df.estado = 'pendiente') as diferencias_pendientes,
       string_agg(distinct p.tipo::text, ', ') as tipos_producto,
       t.observaciones, t.bodega_origen_id, t.bodega_destino_id,
       t.sivet_efectivo, t.sivet_efectivo_at, t.sivet_efectivo_por, t.sivet_referencia,
       (t.estado in ('recibido', 'cerrado')
        and not exists (select 1 from traslado_diferencias df where df.traslado_id = t.id and df.estado = 'pendiente')) as listo_sivet
  from traslados t
  join bodegas bo on bo.id = t.bodega_origen_id join sedes so on so.id = bo.sede_id
  join bodegas bd on bd.id = t.bodega_destino_id join sedes sd on sd.id = bd.sede_id
  left join traslado_detalle d on d.traslado_id = t.id
  left join lotes lo on lo.id = d.lote_origen_id
  left join productos p on p.id = d.producto_id
 group by t.id, bo.nombre, so.nombre, bd.nombre, sd.nombre, bd.tipo;

-- Históricos de SIFAR ya recibidos: ya están reflejados en SIVET
update traslados t
   set sivet_efectivo = true, enviado_sivet = true, sivet_efectivo_at = now(), sivet_efectivo_por = 'migración SIFAR',
       sivet_referencia = 'Histórico de SIFAR (existencias igualadas a SIVET el 24/11/2026)'
 where t.sifar_id is not null and not t.sivet_efectivo and traslado_listo_sivet(t.id);
