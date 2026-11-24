\set ON_ERROR_STOP 0
\pset pager off
-- usuarios de prueba (simulan el primer inicio de sesión con Microsoft)
insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-000000000001','harold.alas@inabve.gob.sv'),
 ('00000000-0000-0000-0000-000000000002','iris.ramirez@inabve.gob.sv'),
 ('00000000-0000-0000-0000-000000000003','jose.avila@inabve.gob.sv'),
 ('00000000-0000-0000-0000-000000000004','nuevo.usuario@inabve.gob.sv');
\echo '--- T1 cuenta no institucional (debe fallar)'
insert into auth.users(email) values ('alguien@gmail.com');
select email, rol, sede_id, activo, id is not null as enlazado from perfiles
 where email in ('harold.alas@inabve.gob.sv','iris.ramirez@inabve.gob.sv','jose.avila@inabve.gob.sv','nuevo.usuario@inabve.gob.sv');

create or replace function como(p text) returns void language plpgsql security definer set search_path=public as $$
begin perform set_config('request.jwt.claim.sub', (select id::text from perfiles where email = p), false); end $$;
grant execute on function como(text) to authenticated;
set role authenticated;

\echo '=== ADMIN (harold) ==='
select como('harold.alas@inabve.gob.sv');
\echo '--- T2 medicamento sin lote (debe fallar)'
select registrar_entrada('{"bodega_id":1,"proveedor_id":1,"numero":"DTE-01-S001P001-000000000099991","fecha_factura":"2026-11-20",
 "lineas":[{"producto_id":47,"cantidad":100,"precio_unitario":0.25}]}');
\echo '--- T3 entrada completa CEFAFA'
select registrar_entrada('{"bodega_id":1,"proveedor_id":1,"numero":"DTE-01-S001P001-000000000099991","fecha_factura":"2026-11-20",
 "lineas":[{"producto_id":47,"cantidad":100,"precio_unitario":0.25,"numero_lote":"AMX-001","fecha_vencimiento":"2027-03-31"},
           {"producto_id":47,"cantidad":50,"precio_unitario":0.25,"numero_lote":"AMX-002","fecha_vencimiento":"2028-01-31"}]}');
\echo '--- T4 factura repetida (debe fallar)'
select registrar_entrada('{"bodega_id":1,"proveedor_id":1,"numero":"DTE-01-S001P001-000000000099991","fecha_factura":"2026-11-20",
 "lineas":[{"producto_id":47,"cantidad":1,"precio_unitario":0.25,"numero_lote":"X","fecha_vencimiento":"2027-03-31"}]}');
\echo '--- T5 insumo de otro proveedor solo con precio'
select registrar_entrada(jsonb_build_object('bodega_id',1,'proveedor_id',7)
  || jsonb_build_object('lineas', jsonb_build_array(jsonb_build_object('producto_id',(select id from productos where tipo='insumo' and activo limit 1),'cantidad',20,'precio_unitario',1.15))));
\echo '--- T6 entrada en despacho (debe fallar)'
select registrar_entrada('{"bodega_id":10,"proveedor_id":7,"lineas":[{"producto_id":47,"cantidad":1,"precio_unitario":1}]}');
\echo '--- T7 traslado central -> Despacho Medicamentos Santa Ana (PVPS: debe tomar AMX-001 primero)'
select crear_traslado('{"bodega_origen_id":1,"bodega_destino_id":10,"lineas":[{"producto_id":47,"cantidad":120}]}') as t \gset
\echo :t
select d.id, l.numero_lote, l.fecha_vencimiento, d.cantidad_enviada from traslado_detalle d join lotes l on l.id=d.lote_origen_id
 where traslado_id = (:'t'::jsonb->>'traslado_id')::bigint order by d.id;
\echo '--- T8 traslado a Descarte por admin (permitido)'
select crear_traslado('{"bodega_origen_id":1,"bodega_destino_id":18,"lineas":[{"producto_id":47,"cantidad":1}]}')->>'numero';

\echo '=== DEPENDIENTE SANTA ANA (iris) ==='
select como('iris.ramirez@inabve.gob.sv');
\echo '--- T9 ve el traslado pendiente de su sede'
select numero, estado from traslados where id = (:'t'::jsonb->>'traslado_id')::bigint;
\echo '--- T10 recibe: segunda línea con 2 menos + producto extra no enviado'
select recibir_traslado((:'t'::jsonb->>'traslado_id')::bigint,
  (select jsonb_agg(jsonb_build_object('detalle_id',id,'cantidad_recibida', case when rn=2 then cantidad_enviada-2 else cantidad_enviada end,
          'observacion', case when rn=2 then 'Llegaron 2 menos' end))
     from (select id, cantidad_enviada, row_number() over (order by id) rn from traslado_detalle
            where traslado_id=(:'t'::jsonb->>'traslado_id')::bigint) x),
  '[{"producto_id":48,"cantidad":3,"observacion":"Vino en la caja sin estar en el listado"}]');
\echo '--- T11 despacho a beneficiario desde Despacho SA (DUI)'
select registrar_salida('{"bodega_id":10,"tipo":"beneficiario","dui":"01234567-8","lineas":[{"producto_id":47,"cantidad":5}]}')->>'numero';
\echo '--- T12 DUI inválido (debe fallar)'
select registrar_salida('{"bodega_id":10,"dui":"1234","lineas":[{"producto_id":47,"cantidad":1}]}');
\echo '--- T13 despachar desde bodega de otra sede (debe fallar)'
select registrar_salida('{"bodega_id":2,"dui":"012345678","lineas":[{"producto_id":47,"cantidad":1}]}');
\echo '--- T14 cantidad mayor a existencia (debe fallar con mensaje claro)'
select registrar_salida('{"bodega_id":10,"dui":"012345678","lineas":[{"producto_id":47,"cantidad":99999}]}');
\echo '--- T15 salida a personal desde Pequeña Cirugía SA (sin existencia: debe fallar por existencia, no por permiso)'
select registrar_salida('{"bodega_id":12,"tipo":"personal","persona_recibe":"Lic. Enfermería","lineas":[{"producto_id":47,"cantidad":1}]}');
\echo '--- T16 ajuste negativo como dependiente'
select registrar_ajuste((select lote_id from salida_detalle order by id desc limit 1), 'negativo', 1, 'Blíster dañado en estante');
\echo '--- T17 devolución'
select registrar_devolucion('{"bodega_id":10,"producto_id":47,"numero_factura":"99991","dui":"012345678","fecha_receta":"2026-11-24",
  "cantidad":2,"motivo":"Paciente cambió tratamiento","estado_fisico":"completo_sellado"}') as dev \gset
\echo '--- T18 dependiente no ve Descarte ni puede trasladar allá'
select count(*) as bodegas_descarte_visibles from bodegas where tipo='descarte';
select crear_traslado('{"bodega_origen_id":10,"bodega_destino_id":18,"lineas":[{"producto_id":47,"cantidad":1}]}');
\echo '--- T19 dependiente no puede validar devolución'
select validar_devolucion(:dev, 'reingresar');

\echo '=== CONSULTA (jose.avila, médico) ==='
select como('jose.avila@inabve.gob.sv');
\echo '--- T20 consulta existencias en todas las sedes'
select sede, bodega, nombre_comercial, sum(disponible) from v_existencias where producto_id=47 group by 1,2,3 order by 1,2;
\echo '--- T21 consulta no puede despachar ni ver salidas'
select registrar_salida('{"bodega_id":10,"dui":"012345678","lineas":[{"producto_id":47,"cantidad":1}]}');
select count(*) as salidas_visibles from salidas;
\echo '--- T22 usuario nuevo sin activar no ve nada'
select como('nuevo.usuario@inabve.gob.sv');
select count(*) as productos_visibles from productos;

\echo '=== ADMIN resuelve pendientes ==='
select como('harold.alas@inabve.gob.sv');
select tipo, documento, bodega, producto, detalle, observacion from v_pendientes_admin where documento like 'T-2026-%' and fecha > now() - interval '1 hour' or tipo='devolucion';
select resolver_diferencia(id, case when tipo='faltante' then 'devolver_origen' else 'acreditar_destino' end, 'Revisado por coordinación',
       case when tipo='producto_no_enviado' then (select id from lotes where bodega_id=1 and producto_id=48 and disponible>=3 order by fecha_vencimiento limit 1) end)
  from traslado_diferencias where traslado_id = (:'t'::jsonb->>'traslado_id')::bigint;
select numero, estado from traslados where id = (:'t'::jsonb->>'traslado_id')::bigint;
select validar_devolucion(:dev, 'reingresar', 'Producto sellado, apto');
select estado, lote_id is not null as lote_identificado from devoluciones where id = :dev;
\echo '--- T23 Excel SIVET del traslado (formato MIGRAR + columnas nuevas)'
select correlativo, codigo, cantidad, precio, total, factura, fecha_factura, nombre_contrato_sivetweb, lote, fecha_vencimiento,
       clasificacion_aware, refrigerado, controlado, categoria
  from v_sivet_traslado where traslado_id = (:'t'::jsonb->>'traslado_id')::bigint;
\echo '--- T24 avance de liquidación de la factura de prueba'
select numero_sivet, proveedor, unidades_compradas, unidades_entregadas, porcentaje_entregado, lista_para_liquidar, estado_liquidacion
  from v_avance_factura where numero like '%99991';
\echo '--- T25 kardex del lote AMX-001'
select m.tipo, m.cantidad, m.saldo_lote, b.codigo, m.usuario from movimientos m join lotes l on l.id=m.lote_id join bodegas b on b.id=m.bodega_id
 where l.numero_lote='AMX-001' order by m.id;
reset role;
