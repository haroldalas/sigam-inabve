-- =============================================================================
-- SIGAM-INABVE · 025 · Jefatura, tableros y entradas solo para administradores
-- · Jefatura: solo lectura de Existencias, Kardex y Tableros de todas las sedes
--   (sin Descarte). No opera bodegas ni ve el detalle de beneficiarios.
-- · Entradas de facturas: solo administradores (antes también el dependiente de la sede central).
-- · tablero_consumo(): datos agregados para los dashboards (prioritarias quincenales,
--   medicamentos entregados, impacto presupuestario de medicamentos e insumos).
-- =============================================================================

-- 1. Entradas: solo administradores ---------------------------------------------
do $$
declare v_def text := pg_get_functiondef('registrar_entrada(jsonb)'::regprocedure); v_nueva text;
begin
  v_nueva := replace(v_def, $q$  select * into v_bod from bodegas where id = (p->>'bodega_id')::smallint;$q$,
    $q$  perform exigir(es_admin(), 'Solo un administrador registra entradas de facturas');
  select * into v_bod from bodegas where id = (p->>'bodega_id')::smallint;$q$);
  if v_def like '%Solo un administrador registra entradas%' then return; end if;   -- ya aplicada
  if v_nueva = v_def then raise exception 'registrar_entrada: no se encontró dónde agregar la validación'; end if;
  execute v_nueva;
end $$;

-- 2. La solicitud de acceso puede pedir Jefatura ------------------------------------
do $$
declare v_def text := pg_get_functiondef('enviar_solicitud_acceso(jsonb)'::regprocedure); v_nueva text;
begin
  v_nueva := replace(v_def, $q$in ('dependiente', 'consulta', 'administrador')$q$, $q$in ('dependiente', 'consulta', 'jefatura', 'administrador')$q$);
  if v_def like '%''jefatura''%' then return; end if;   -- ya aplicada
  if v_nueva = v_def then raise exception 'enviar_solicitud_acceso: no se encontró la lista de roles'; end if;
  execute v_nueva;
end $$;

-- 3. Jefatura lee traslados y facturas (para el Kardex); no lee despachos a beneficiarios
drop policy if exists leer_jefatura on traslados;
create policy leer_jefatura on traslados        for select to authenticated using ((select app_rol()) = 'jefatura');
drop policy if exists leer_jefatura on traslado_detalle;
create policy leer_jefatura on traslado_detalle for select to authenticated using ((select app_rol()) = 'jefatura');
drop policy if exists leer_jefatura on facturas;
create policy leer_jefatura on facturas         for select to authenticated using ((select app_rol()) = 'jefatura');
drop policy if exists leer_jefatura on factura_detalle;
create policy leer_jefatura on factura_detalle  for select to authenticated using ((select app_rol()) = 'jefatura');

-- 4. Datos de los tableros -----------------------------------------------------------
-- p_tipo: 'medicamento' | 'insumo' | null (ambos). Los montos usan el precio unitario del lote.
-- Las personas se cuentan una vez por período (expediente o DUI). En "top_personas" el DUI se enmascara.
create or replace function tablero_consumo(p_desde date, p_hasta date, p_sede smallint default null,
                                           p_tipo text default null, p_proveedor smallint default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  perform exigir(app_rol() in ('administrador', 'jefatura'), 'Solo administración y jefatura ven los tableros');
  perform exigir(p_desde is not null and p_hasta is not null and p_desde <= p_hasta, 'Período no válido');
  with d as (
    select s.id as salida_id, s.fecha, s.tipo as tipo_salida, se.id as sede_id, se.nombre as sede,
           case when s.tipo = 'beneficiario' then coalesce(nullif(trim(s.expediente), ''), nullif(trim(s.dui), '')) end as persona,
           p.id as producto_id, p.nombre_comercial as producto, p.tipo as tipo_producto,
           coalesce(f.nombre, 'SIN FAMILIA') as familia, coalesce(pr.nombre, 'SIN PROVEEDOR') as proveedor,
           sd.cantidad, round(sd.cantidad * coalesce(l.precio_unitario, 0), 2) as monto
      from salidas s
      join salida_detalle sd on sd.salida_id = s.id
      join productos p on p.id = sd.producto_id
      join bodegas b on b.id = s.bodega_id
      join sedes se on se.id = b.sede_id
      left join lotes l on l.id = sd.lote_id
      left join proveedores pr on pr.id = l.proveedor_id
      left join familias f on f.id = p.familia_id
     where s.estado = 'confirmada' and s.fecha between p_desde and p_hasta
       and (p_sede is null or se.id = p_sede)
       and (p_tipo is null or p.tipo::text = p_tipo)
       and (p_proveedor is null or l.proveedor_id = p_proveedor)
  ), prod as (
    select producto_id, producto, tipo_producto, sum(cantidad) unidades, sum(monto) monto, count(distinct persona) personas
      from d group by 1, 2, 3
  ), pers as (
    select persona, sum(cantidad) unidades, sum(monto) monto, count(distinct salida_id) despachos
      from d where length(persona) >= 3 group by 1   -- expedientes de relleno como "1" no cuentan
  )
  select jsonb_build_object(
    'kpi', (select jsonb_build_object(
              'monto', coalesce(sum(monto), 0), 'unidades', coalesce(sum(cantidad), 0),
              'despachos', count(distinct salida_id), 'personas', count(distinct persona),
              'productos', count(distinct producto_id),
              'monto_medicamentos', coalesce(sum(monto) filter (where tipo_producto = 'medicamento'), 0),
              'monto_insumos', coalesce(sum(monto) filter (where tipo_producto = 'insumo'), 0)) from d),
    'por_sede', (select coalesce(jsonb_agg(x order by x.monto desc), '[]') from (
              select sede as clave, sum(monto) monto, sum(cantidad) unidades, count(distinct persona) personas from d group by 1) x),
    'por_proveedor', (select coalesce(jsonb_agg(x order by x.monto desc), '[]') from (
              select proveedor as clave, sum(monto) monto, sum(cantidad) unidades from d group by 1) x),
    'por_familia', (select coalesce(jsonb_agg(x order by x.monto desc), '[]') from (
              select familia as clave, sum(monto) monto, sum(cantidad) unidades from d group by 1 order by 2 desc limit 10) x),
    'mensual', (select coalesce(jsonb_agg(x order by x.mes), '[]') from (
              select to_char(date_trunc('month', fecha), 'YYYY-MM') mes, sum(monto) monto, sum(cantidad) unidades,
                     count(distinct persona) personas from d group by 1) x),
    'quincenal', (select coalesce(jsonb_agg(x order by x.mes, x.q), '[]') from (
              select to_char(date_trunc('month', fecha), 'YYYY-MM') mes, case when extract(day from fecha) <= 15 then 1 else 2 end q,
                     sum(monto) monto, sum(cantidad) unidades from d group by 1, 2) x),
    'top_monto', (select coalesce(jsonb_agg(x order by x.monto desc), '[]') from (
              select producto as clave, tipo_producto as tipo, unidades, monto, personas from prod order by monto desc limit 10) x),
    'top_unidades', (select coalesce(jsonb_agg(x order by x.unidades desc), '[]') from (
              select producto as clave, tipo_producto as tipo, unidades, monto, personas from prod order by unidades desc limit 10) x),
    'dispersion', (select coalesce(jsonb_agg(x), '[]') from (
              select producto as clave, unidades, monto from prod order by monto desc limit 40) x),
    'top_personas', (select coalesce(jsonb_agg(x order by x.monto desc), '[]') from (
              select case when persona ~ '^\d{9}$' then '•••••' || right(persona, 4) else persona end as clave,
                     unidades, monto, despachos from pers order by monto desc limit 10) x),
    'existencias', (select jsonb_build_object(
              'valor', coalesce(round(sum(l.disponible * coalesce(l.precio_unitario, 0)), 2), 0),
              'productos', count(distinct l.producto_id) filter (where l.disponible > 0))
              from lotes l join bodegas b on b.id = l.bodega_id join productos p on p.id = l.producto_id
             where l.disponible > 0 and not b.solo_admin and (p_sede is null or b.sede_id = p_sede)
               and (p_tipo is null or p.tipo::text = p_tipo) and (p_proveedor is null or l.proveedor_id = p_proveedor)),
    'traslados', (select jsonb_build_object('enviados', count(*), 'recibidos', count(*) filter (where t.estado = 'recibido'))
              from traslados t join bodegas bd on bd.id = t.bodega_destino_id
             where t.estado <> 'anulado' and t.fecha between p_desde and p_hasta and (p_sede is null or bd.sede_id = p_sede))
  ) into r;
  return r;
end $$;
revoke all on function tablero_consumo(date, date, smallint, text, smallint) from public, anon;
grant execute on function tablero_consumo(date, date, smallint, text, smallint) to authenticated;
