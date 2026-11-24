-- =============================================================================
-- SIGAM-INABVE · Migración 3: operaciones (RPC). Cada función es una sola
-- transacción: si algo falla (incluida la red), no queda nada a medias.
-- =============================================================================

-- Utilidades ------------------------------------------------------------------
create or replace function siguiente_numero(p_doc text, p_prefijo text, p_ancho int default 6)
returns text language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  insert into correlativos(documento, ultimo) values (p_doc, 1)
  on conflict (documento) do update set ultimo = correlativos.ultimo + 1
  returning ultimo into v;
  return p_prefijo || to_char((now() at time zone 'America/El_Salvador'), 'YYYY') || '-' || lpad(v::text, p_ancho, '0');
end $$;

create or replace function hoy() returns date language sql stable set search_path = public as
$$ select (now() at time zone 'America/El_Salvador')::date $$;

create or replace function normalizar_dui(p text) returns text language plpgsql immutable set search_path = public as $$
declare d text := regexp_replace(coalesce(p,''), '\D', '', 'g');
begin
  if length(d) <> 9 then
    raise exception 'DUI inválido: "%". Debe tener 9 dígitos (00000000-0)', p;
  end if;
  return substr(d,1,8) || '-' || substr(d,9,1);
end $$;

create or replace function exigir(p_cond boolean, p_msg text) returns void language plpgsql set search_path = public as $$
begin if not coalesce(p_cond,false) then raise exception '%', p_msg; end if; end $$;

create or replace function nombre_producto(p_id bigint) returns text language sql stable set search_path = public as
$$ select coalesce(codigo,'s/c') || ' · ' || nombre_comercial from productos where id = p_id $$;

-- Registra un movimiento de kardex y actualiza estado del lote ------------------
create or replace function mover_lote(p_lote bigint, p_delta numeric, p_tipo tipo_movimiento,
                                      p_doc text, p_doc_id bigint, p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
declare l lotes;
begin
  update lotes set disponible = disponible + p_delta,
                   estado = case when disponible + p_delta <= 0 and estado = 'activo' then 'agotado'
                                 when disponible + p_delta > 0 and estado = 'agotado' then 'activo'
                                 else estado end
   where id = p_lote returning * into l;
  if l.disponible < 0 then raise exception 'Existencia insuficiente en lote %', p_lote; end if;
  insert into movimientos(tipo, lote_id, producto_id, bodega_id, cantidad, saldo_lote, documento, documento_id, usuario, observacion)
  values (p_tipo, l.id, l.producto_id, l.bodega_id, p_delta, l.disponible, p_doc, p_doc_id, app_email(), p_obs);
end $$;

-- Consume una cantidad de un producto en una bodega siguiendo PVPS (primero en
-- vencer, primero en salir), en varios lotes si hace falta. Devuelve los lotes usados.
create or replace function consumir_pvps(p_bodega smallint, p_producto bigint, p_cantidad numeric,
                                         p_lote bigint, p_tipo tipo_movimiento, p_doc text, p_doc_id bigint)
returns table(lote_id bigint, cantidad numeric)
language plpgsql security definer set search_path = public as $$
declare
  r record; pendiente numeric := p_cantidad; tomar numeric; total numeric;
begin
  if p_lote is not null then
    -- lote elegido por el usuario
    select * into r from lotes where id = p_lote for update;
    perform exigir(found and r.bodega_id = p_bodega and r.producto_id = p_producto,
                   'El lote indicado no corresponde al producto o a la bodega');
    perform exigir(r.estado in ('activo'), 'El lote ' || coalesce(r.numero_lote,'') || ' está ' || r.estado);
    perform exigir(r.fecha_vencimiento is null or r.fecha_vencimiento >= hoy(),
                   'El lote ' || coalesce(r.numero_lote,'') || ' está vencido');
    perform exigir(r.disponible >= p_cantidad,
                   'Lote ' || coalesce(r.numero_lote,'') || ': disponible ' || r.disponible || ', solicitado ' || p_cantidad);
    perform mover_lote(r.id, -p_cantidad, p_tipo, p_doc, p_doc_id);
    lote_id := r.id; cantidad := p_cantidad; return next; return;
  end if;

  select coalesce(sum(l.disponible),0) into total from lotes l
   where l.bodega_id = p_bodega and l.producto_id = p_producto and l.estado = 'activo'
     and l.disponible > 0 and (l.fecha_vencimiento is null or l.fecha_vencimiento >= hoy());
  if total < p_cantidad then
    raise exception 'Existencia insuficiente de %: disponible %, solicitado %',
      nombre_producto(p_producto), total, p_cantidad;
  end if;

  for r in select * from lotes l
            where l.bodega_id = p_bodega and l.producto_id = p_producto and l.estado = 'activo'
              and l.disponible > 0 and (l.fecha_vencimiento is null or l.fecha_vencimiento >= hoy())
            order by l.fecha_vencimiento nulls last, l.id
            for update
  loop
    exit when pendiente <= 0;
    tomar := least(r.disponible, pendiente);
    perform mover_lote(r.id, -tomar, p_tipo, p_doc, p_doc_id);
    lote_id := r.id; cantidad := tomar; return next;
    pendiente := pendiente - tomar;
  end loop;
end $$;

-- Busca (o crea) en una bodega la copia de un lote, conservando factura y datos
create or replace function lote_en_bodega(p_lote_origen bigint, p_bodega smallint)
returns bigint language plpgsql security definer set search_path = public as $$
declare o lotes; v bigint;
begin
  select * into o from lotes where id = p_lote_origen;
  select id into v from lotes
   where bodega_id = p_bodega and producto_id = o.producto_id
     and factura_detalle_id is not distinct from o.factura_detalle_id
     and numero_lote is not distinct from o.numero_lote
     and fecha_vencimiento is not distinct from o.fecha_vencimiento
     and precio_unitario = o.precio_unitario
   order by id limit 1 for update;
  if v is null then
    insert into lotes(factura_detalle_id, producto_id, bodega_id, proveedor_id, numero_lote,
                      fecha_vencimiento, precio_unitario, cantidad_inicial, disponible, estado, lote_origen_id)
    values (o.factura_detalle_id, o.producto_id, p_bodega, o.proveedor_id, o.numero_lote,
            o.fecha_vencimiento, o.precio_unitario, 0, 0, 'agotado', coalesce(o.lote_origen_id, o.id))
    returning id into v;
  end if;
  return v;
end $$;

-- =============================================================================
-- ENTRADAS (solo bodega central)
-- p = {bodega_id, proveedor_id, numero, fecha_factura, acta_recepcion, observaciones,
--      lineas:[{producto_id, cantidad, precio_unitario, numero_lote, fecha_vencimiento}]}
-- Medicamento o proveedor CEFAFA: todos los datos obligatorios.
-- Otro proveedor con insumo médico: solo el precio unitario es obligatorio.
-- =============================================================================
create or replace function registrar_entrada(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_bod bodegas; v_prov proveedores; v_fac bigint; v_det bigint; v_lote bigint;
  ln jsonb; v_prod productos; v_completo boolean; n int := 0;
  v_lote_txt text; v_venc date; v_cant numeric; v_precio numeric;
begin
  select * into v_bod from bodegas where id = (p->>'bodega_id')::smallint;
  perform exigir(found and v_bod.permite_entradas, 'Solo la bodega central registra entradas');
  perform exigir(puede_operar_bodega(v_bod.id), 'No tiene permiso para registrar entradas en esta bodega');
  select * into v_prov from proveedores where id = (p->>'proveedor_id')::smallint and activo;
  perform exigir(found, 'Proveedor no válido');
  perform exigir(jsonb_array_length(coalesce(p->'lineas','[]')) > 0, 'La entrada no tiene productos');

  if nullif(trim(p->>'numero'),'') is not null then
    perform exigir(not exists (select 1 from facturas f where f.proveedor_id = v_prov.id
                     and f.estado = 'confirmada' and f.numero = trim(p->>'numero')),
                   'La factura ' || (p->>'numero') || ' de ' || v_prov.nombre || ' ya fue ingresada');
  end if;

  insert into facturas(numero, fecha_factura, proveedor_id, bodega_id, acta_recepcion, observaciones, creado_por)
  values (nullif(trim(p->>'numero'),''), nullif(p->>'fecha_factura','')::date, v_prov.id, v_bod.id,
          nullif(trim(p->>'acta_recepcion'),''), p->>'observaciones', app_email())
  returning id into v_fac;

  for ln in select * from jsonb_array_elements(p->'lineas') loop
    n := n + 1;
    select * into v_prod from productos where id = (ln->>'producto_id')::bigint and activo;
    perform exigir(found, 'Línea ' || n || ': producto no válido o inactivo');
    v_cant := nullif(ln->>'cantidad','')::numeric;
    v_precio := nullif(ln->>'precio_unitario','')::numeric;
    v_lote_txt := nullif(trim(ln->>'numero_lote'),'');
    v_venc := nullif(ln->>'fecha_vencimiento','')::date;
    perform exigir(v_cant > 0, 'Línea ' || n || ': cantidad inválida');
    perform exigir(v_precio is not null and v_precio >= 0, 'Línea ' || n || ': el precio unitario es obligatorio');

    v_completo := v_prod.tipo = 'medicamento' or v_prov.es_cefafa;
    if v_completo then
      perform exigir(nullif(trim(p->>'numero'),'') is not null and nullif(p->>'fecha_factura','') is not null
                     and v_lote_txt is not null and v_venc is not null,
        'Línea ' || n || ' (' || v_prod.nombre_comercial || '): para medicamentos y productos de CEFAFA son obligatorios '
        || 'número y fecha de factura, lote y fecha de vencimiento');
    end if;
    perform exigir(v_venc is null or v_venc >= hoy(), 'Línea ' || n || ': el producto ya está vencido');

    insert into factura_detalle(factura_id, producto_id, cantidad, precio_unitario, numero_lote, fecha_vencimiento)
    values (v_fac, v_prod.id, v_cant, v_precio, v_lote_txt, v_venc) returning id into v_det;

    insert into lotes(factura_detalle_id, producto_id, bodega_id, proveedor_id, numero_lote, fecha_vencimiento,
                      precio_unitario, cantidad_inicial, disponible, estado)
    values (v_det, v_prod.id, v_bod.id, v_prov.id, v_lote_txt, v_venc, v_precio, v_cant, 0, 'agotado')
    returning id into v_lote;
    perform mover_lote(v_lote, v_cant, 'entrada', 'factura', v_fac);
  end loop;

  return jsonb_build_object('factura_id', v_fac, 'lineas', n);
end $$;

create or replace function anular_entrada(p_factura bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform exigir(es_admin(), 'Solo un administrador puede anular entradas');
  perform exigir(length(trim(coalesce(p_motivo,''))) >= 5, 'Indique el motivo');
  -- solo si ningún lote de la factura se ha movido
  for r in select l.* from lotes l join factura_detalle d on d.id = l.factura_detalle_id
            where d.factura_id = p_factura for update of l loop
    perform exigir(r.lote_origen_id is null and r.disponible = r.cantidad_inicial,
                   'No se puede anular: hay productos de esta factura ya despachados o trasladados');
    perform mover_lote(r.id, -r.disponible, 'entrada', 'factura', p_factura, 'Anulación: ' || p_motivo);
  end loop;
  update facturas set estado = 'anulada', observaciones = concat_ws(' | ', observaciones, 'ANULADA: ' || p_motivo)
   where id = p_factura;
end $$;

-- =============================================================================
-- SALIDAS (despacho). El dependiente elige la bodega de su sede desde la misma
-- pantalla (despacho de medicamentos, almacén de insumos, pequeña cirugía, campo).
-- p = {bodega_id, tipo, dui, expediente, persona_recibe, persona_solicita, observaciones,
--      lineas:[{producto_id, cantidad, lote_id?}]}
-- =============================================================================
create or replace function registrar_salida(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_bod bodegas; v_tipo tipo_salida := coalesce(nullif(p->>'tipo',''),'beneficiario')::tipo_salida;
  v_id bigint; v_num text; ln jsonb; r record; v_out jsonb := '[]'; n int := 0; v_dui text;
begin
  select * into v_bod from bodegas where id = (p->>'bodega_id')::smallint;
  perform exigir(found and v_bod.activa, 'Bodega no válida');
  perform exigir(v_bod.tipo <> 'descarte', 'No se despacha desde la bodega de descarte');
  perform exigir(puede_operar_bodega(v_bod.id), 'Solo puede despachar desde las bodegas de su sede');
  perform exigir(jsonb_array_length(coalesce(p->'lineas','[]')) > 0, 'La salida no tiene productos');

  if v_tipo = 'beneficiario' then
    v_dui := normalizar_dui(p->>'dui');
  elsif v_tipo = 'personal' then
    perform exigir(nullif(trim(p->>'persona_recibe'),'') is not null, 'Indique la persona que recibe');
    if nullif(p->>'dui','') is not null then v_dui := normalizar_dui(p->>'dui'); end if;
  end if;

  v_num := siguiente_numero('salida', 'S-');
  insert into salidas(numero, bodega_id, tipo, dui, expediente, persona_recibe, persona_solicita, observaciones, creado_por)
  values (v_num, v_bod.id, v_tipo, v_dui, nullif(trim(p->>'expediente'),''),
          nullif(trim(p->>'persona_recibe'),''),
          coalesce(nullif(trim(p->>'persona_solicita'),''), nullif(trim(p->>'persona_recibe'),'')),
          p->>'observaciones', app_email())
  returning id into v_id;

  for ln in select * from jsonb_array_elements(p->'lineas') loop
    n := n + 1;
    perform exigir(nullif(ln->>'cantidad','')::numeric > 0, 'Línea ' || n || ': cantidad inválida');
    for r in select * from consumir_pvps(v_bod.id, (ln->>'producto_id')::bigint, (ln->>'cantidad')::numeric,
                                         nullif(ln->>'lote_id','')::bigint, 'salida', 'salida', v_id) loop
      insert into salida_detalle(salida_id, producto_id, lote_id, cantidad)
      values (v_id, (ln->>'producto_id')::bigint, r.lote_id, r.cantidad);
      v_out := v_out || jsonb_build_object('producto_id', (ln->>'producto_id')::bigint, 'lote_id', r.lote_id, 'cantidad', r.cantidad);
    end loop;
  end loop;

  return jsonb_build_object('salida_id', v_id, 'numero', v_num, 'detalle', v_out);
end $$;

create or replace function anular_salida(p_salida bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare s salidas; d record;
begin
  select * into s from salidas where id = p_salida for update;
  perform exigir(found and s.estado = 'confirmada', 'La salida no existe o ya está anulada');
  perform exigir(puede_operar_bodega(s.bodega_id), 'No tiene permiso sobre esta bodega');
  perform exigir(length(trim(coalesce(p_motivo,''))) >= 5, 'Indique el motivo de la anulación');
  for d in select * from salida_detalle where salida_id = p_salida and lote_id is not null loop
    perform mover_lote(d.lote_id, d.cantidad, 'anulacion_salida', 'salida', p_salida, p_motivo);
  end loop;
  update salidas set estado = 'anulada', anulada_por = app_email(), anulada_at = now(), motivo_anulacion = p_motivo
   where id = p_salida;
end $$;

-- =============================================================================
-- TRASLADOS
-- p = {bodega_origen_id, bodega_destino_id, observaciones, lineas:[{producto_id, cantidad, lote_id?}]}
-- Bloquea lotes vencidos. Lo enviado queda "en tránsito" hasta que la sede lo reciba.
-- =============================================================================
create or replace function crear_traslado(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o bodegas; d bodegas; v_id bigint; v_num text; ln jsonb; r record; n int := 0;
begin
  select * into o from bodegas where id = (p->>'bodega_origen_id')::smallint;
  select * into d from bodegas where id = (p->>'bodega_destino_id')::smallint;
  perform exigir(o.id is not null and d.id is not null and o.id <> d.id, 'Origen y destino deben ser bodegas distintas');
  perform exigir(d.activa, 'La bodega de destino está inactiva');
  perform exigir(puede_operar_bodega(o.id) or (o.solo_admin and es_admin()), 'No tiene permiso sobre la bodega de origen');
  perform exigir(not (o.solo_admin or d.solo_admin) or es_admin(),
                 'Solo un administrador puede trasladar desde o hacia la bodega de descarte');
  perform exigir(jsonb_array_length(coalesce(p->'lineas','[]')) > 0, 'El traslado no tiene productos');

  v_num := siguiente_numero('traslado', 'T-');
  insert into traslados(numero, bodega_origen_id, bodega_destino_id, observaciones, enviado_por)
  values (v_num, o.id, d.id, p->>'observaciones', app_email()) returning id into v_id;

  for ln in select * from jsonb_array_elements(p->'lineas') loop
    n := n + 1;
    perform exigir(nullif(ln->>'cantidad','')::numeric > 0, 'Línea ' || n || ': cantidad inválida');
    for r in select * from consumir_pvps(o.id, (ln->>'producto_id')::bigint, (ln->>'cantidad')::numeric,
                                         nullif(ln->>'lote_id','')::bigint, 'traslado_envio', 'traslado', v_id) loop
      insert into traslado_detalle(traslado_id, producto_id, lote_origen_id, cantidad_enviada)
      values (v_id, (ln->>'producto_id')::bigint, r.lote_id, r.cantidad);
    end loop;
  end loop;
  return jsonb_build_object('traslado_id', v_id, 'numero', v_num);
end $$;

-- Recepción en la sede de destino.
-- p_lineas = [{detalle_id, cantidad_recibida, observacion}]  (todas las líneas del traslado)
-- p_extras = [{producto_id, cantidad, observacion}]          (llegó algo que no venía en el traslado)
-- Lo que coincide se suma de inmediato; cada diferencia queda pendiente para el administrador.
create or replace function recibir_traslado(p_traslado bigint, p_lineas jsonb, p_extras jsonb default '[]')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t traslados; det traslado_detalle; ln jsonb; v_rec numeric; v_lote bigint; v_dif int := 0; ex jsonb;
begin
  select * into t from traslados where id = p_traslado for update;
  perform exigir(found and t.estado = 'enviado', 'El traslado no está pendiente de recepción');
  perform exigir(puede_operar_bodega(t.bodega_destino_id), 'Solo la sede de destino puede recibir este traslado');

  for det in select * from traslado_detalle where traslado_id = p_traslado order by id for update loop
    ln := null;
    select x.value into ln from jsonb_array_elements(coalesce(p_lineas,'[]')) as x
     where (x.value->>'detalle_id')::bigint = det.id limit 1;
    perform exigir(ln is not null, 'Falta indicar la cantidad recibida de ' || nombre_producto(det.producto_id));
    v_rec := nullif(ln->>'cantidad_recibida','')::numeric;
    perform exigir(v_rec is not null and v_rec >= 0, 'Cantidad recibida inválida para ' || nombre_producto(det.producto_id));

    v_lote := lote_en_bodega(det.lote_origen_id, t.bodega_destino_id);
    if least(v_rec, det.cantidad_enviada) > 0 then
      perform mover_lote(v_lote, least(v_rec, det.cantidad_enviada), 'traslado_recepcion', 'traslado', t.id);
    end if;
    update traslado_detalle set cantidad_recibida = v_rec, lote_destino_id = v_lote,
           observacion = nullif(ln->>'observacion','') where id = det.id;

    if v_rec <> det.cantidad_enviada then
      v_dif := v_dif + 1;
      insert into traslado_diferencias(traslado_id, traslado_detalle_id, producto_id, tipo, cantidad_enviada,
                                       cantidad_recibida, observacion_sede)
      values (t.id, det.id, det.producto_id,
              case when v_rec < det.cantidad_enviada then 'faltante' else 'sobrante' end::tipo_diferencia,
              det.cantidad_enviada, v_rec, nullif(ln->>'observacion',''));
    end if;
  end loop;

  for ex in select * from jsonb_array_elements(coalesce(p_extras,'[]')) loop
    perform exigir(exists (select 1 from productos where id = (ex->>'producto_id')::bigint), 'Producto adicional no válido');
    v_dif := v_dif + 1;
    insert into traslado_diferencias(traslado_id, producto_id, tipo, cantidad_enviada, cantidad_recibida, observacion_sede)
    values (t.id, (ex->>'producto_id')::bigint, 'producto_no_enviado', 0, (ex->>'cantidad')::numeric, ex->>'observacion');
  end loop;

  update traslados set estado = case when v_dif > 0 then 'con_diferencias' else 'recibido' end::estado_traslado,
         recibido_por = app_email(), recibido_at = now()
   where id = t.id;
  return jsonb_build_object('estado', case when v_dif > 0 then 'con_diferencias' else 'recibido' end, 'diferencias', v_dif);
end $$;

-- Resolución de diferencias (administrador)
-- faltante:            'devolver_origen' | 'acreditar_destino' | 'perdida'
-- sobrante:            'acreditar_destino' (descuenta el excedente del lote de origen) | 'rechazar'
-- producto_no_enviado: 'acreditar_destino' (requiere p_lote_origen) | 'rechazar'
create or replace function resolver_diferencia(p_dif bigint, p_accion text, p_obs text default null,
                                               p_lote_origen bigint default null)
returns void language plpgsql security definer set search_path = public as $$
declare df traslado_diferencias; t traslados; det traslado_detalle; v_cant numeric; v_lote bigint;
begin
  perform exigir(es_admin(), 'Solo un administrador resuelve diferencias de traslado');
  select * into df from traslado_diferencias where id = p_dif for update;
  perform exigir(found and df.estado = 'pendiente', 'La diferencia no existe o ya fue resuelta');
  select * into t from traslados where id = df.traslado_id;
  if df.traslado_detalle_id is not null then select * into det from traslado_detalle where id = df.traslado_detalle_id; end if;

  if df.tipo = 'faltante' then
    v_cant := df.cantidad_enviada - df.cantidad_recibida;
    if p_accion = 'devolver_origen' then
      perform mover_lote(det.lote_origen_id, v_cant, 'traslado_devolucion_origen', 'traslado', t.id, p_obs);
    elsif p_accion = 'acreditar_destino' then
      perform mover_lote(det.lote_destino_id, v_cant, 'traslado_recepcion', 'traslado', t.id, p_obs);
    elsif p_accion <> 'perdida' then raise exception 'Acción no válida para faltante';
    end if;
  elsif df.tipo = 'sobrante' then
    v_cant := df.cantidad_recibida - df.cantidad_enviada;
    if p_accion = 'acreditar_destino' then
      perform mover_lote(det.lote_origen_id, -v_cant, 'traslado_envio', 'traslado', t.id, 'Excedente: ' || coalesce(p_obs,''));
      perform mover_lote(det.lote_destino_id, v_cant, 'traslado_recepcion', 'traslado', t.id, p_obs);
    elsif p_accion <> 'rechazar' then raise exception 'Acción no válida para sobrante';
    end if;
  else
    if p_accion = 'acreditar_destino' then
      perform exigir(p_lote_origen is not null, 'Indique de qué lote de origen salió el producto');
      perform exigir(exists (select 1 from lotes where id = p_lote_origen and bodega_id = t.bodega_origen_id
                             and producto_id = df.producto_id), 'El lote no corresponde al producto en la bodega de origen');
      perform mover_lote(p_lote_origen, -df.cantidad_recibida, 'traslado_envio', 'traslado', t.id, p_obs);
      v_lote := lote_en_bodega(p_lote_origen, t.bodega_destino_id);
      perform mover_lote(v_lote, df.cantidad_recibida, 'traslado_recepcion', 'traslado', t.id, p_obs);
      insert into traslado_detalle(traslado_id, producto_id, lote_origen_id, lote_destino_id, cantidad_enviada,
                                   cantidad_recibida, observacion)
      values (t.id, df.producto_id, p_lote_origen, v_lote, df.cantidad_recibida, df.cantidad_recibida,
              'Agregado al resolver diferencia');
    elsif p_accion <> 'rechazar' then raise exception 'Acción no válida';
    end if;
  end if;

  update traslado_diferencias set estado = 'resuelta', resolucion = p_accion || coalesce(': ' || p_obs, ''),
         resuelto_por = app_email(), resuelto_at = now() where id = p_dif;
  if not exists (select 1 from traslado_diferencias where traslado_id = t.id and estado = 'pendiente') then
    update traslados set estado = 'cerrado' where id = t.id;
  end if;
end $$;

create or replace function anular_traslado(p_traslado bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare t traslados; d record;
begin
  select * into t from traslados where id = p_traslado for update;
  perform exigir(found and t.estado = 'enviado', 'Solo se anulan traslados aún no recibidos');
  perform exigir(es_admin() or puede_operar_bodega(t.bodega_origen_id), 'No tiene permiso para anular este traslado');
  perform exigir(length(trim(coalesce(p_motivo,''))) >= 5, 'Indique el motivo');
  for d in select * from traslado_detalle where traslado_id = p_traslado loop
    perform mover_lote(d.lote_origen_id, d.cantidad_enviada, 'anulacion_traslado', 'traslado', t.id, p_motivo);
  end loop;
  update traslados set estado = 'anulado', anulado_por = app_email(), motivo_anulacion = p_motivo where id = t.id;
end $$;

-- =============================================================================
-- AJUSTES (administradores y dependientes de la sede)
-- =============================================================================
create or replace function registrar_ajuste(p_lote bigint, p_tipo tipo_ajuste, p_cantidad numeric, p_motivo text)
returns bigint language plpgsql security definer set search_path = public as $$
declare l lotes; v_id bigint;
begin
  select * into l from lotes where id = p_lote for update;
  perform exigir(found, 'Lote no válido');
  perform exigir(puede_operar_bodega(l.bodega_id) or (es_admin()), 'No tiene permiso sobre esta bodega');
  perform exigir(p_cantidad > 0, 'Cantidad inválida');
  perform exigir(length(trim(coalesce(p_motivo,''))) >= 5, 'El motivo del ajuste es obligatorio');
  perform exigir(p_tipo = 'positivo' or l.disponible >= p_cantidad,
                 'El ajuste negativo supera la existencia del lote (' || l.disponible || ')');
  insert into ajustes(bodega_id, lote_id, producto_id, tipo, cantidad, motivo, usuario)
  values (l.bodega_id, l.id, l.producto_id, p_tipo, p_cantidad, p_motivo, app_email()) returning id into v_id;
  perform mover_lote(l.id, case when p_tipo = 'positivo' then p_cantidad else -p_cantidad end,
                     case when p_tipo = 'positivo' then 'ajuste_positivo' else 'ajuste_negativo' end::tipo_movimiento,
                     'ajuste', v_id, p_motivo);
  return v_id;
end $$;

-- =============================================================================
-- DEVOLUCIONES: el dependiente registra; el administrador valida.
-- p = {bodega_id, producto_id, numero_factura, dui, fecha_receta, cantidad, motivo, estado_fisico, observacion}
-- =============================================================================
create or replace function registrar_devolucion(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_bod smallint := (p->>'bodega_id')::smallint; v_prod bigint := (p->>'producto_id')::bigint;
        v_fac text := nullif(trim(p->>'numero_factura'),''); v_lote bigint; v_id bigint; v_corto text;
begin
  perform exigir(puede_operar_bodega(v_bod), 'Solo puede registrar devoluciones en bodegas de su sede');
  perform exigir(v_fac is not null, 'El número de factura es obligatorio');
  perform exigir(nullif(p->>'fecha_receta','') is not null, 'La fecha de la receta es obligatoria');
  perform exigir(nullif(p->>'cantidad','')::numeric > 0, 'Cantidad inválida');
  v_corto := lpad(right(regexp_replace(v_fac,'\D','','g'),6),6,'0');
  -- identifica el lote por factura + producto en la bodega (o, si no, en cualquier bodega)
  select l.id into v_lote from lotes l
    join factura_detalle d on d.id = l.factura_detalle_id join facturas f on f.id = d.factura_id
   where l.producto_id = v_prod and (f.numero = v_fac or f.numero_sivet = v_corto)
   order by (l.bodega_id = v_bod) desc, l.id desc limit 1;
  insert into devoluciones(bodega_id, producto_id, numero_factura, dui, fecha_receta, cantidad, motivo,
                           estado_fisico, observacion, lote_id, registrado_por)
  values (v_bod, v_prod, v_fac, normalizar_dui(p->>'dui'), (p->>'fecha_receta')::date, (p->>'cantidad')::numeric,
          coalesce(nullif(trim(p->>'motivo'),''), 'Sin motivo'), (p->>'estado_fisico')::estado_fisico_devolucion,
          p->>'observacion', v_lote, app_email())
  returning id into v_id;
  return v_id;
end $$;

-- p_decision: 'reingresar' (vuelve al stock de la bodega, mismo lote/factura)
--             'averia'     (pasa a la bodega de Descarte)
--             'rechazar'   (no procede; no cambia existencias)
create or replace function validar_devolucion(p_id bigint, p_decision text, p_obs text default null,
                                              p_lote bigint default null)
returns void language plpgsql security definer set search_path = public as $$
declare dv devoluciones; v_lote bigint; v_desc smallint; v_dest bigint;
begin
  perform exigir(es_admin(), 'Solo un administrador valida devoluciones');
  select * into dv from devoluciones where id = p_id for update;
  perform exigir(found and dv.estado = 'pendiente', 'La devolución no existe o ya fue validada');
  v_lote := coalesce(p_lote, dv.lote_id);

  if p_decision in ('reingresar','averia') then
    perform exigir(v_lote is not null, 'No se identificó el lote: indique el lote de la factura');
    if p_decision = 'reingresar' then
      v_dest := lote_en_bodega(v_lote, dv.bodega_id);
      perform mover_lote(v_dest, dv.cantidad, 'devolucion_reingreso', 'devolucion', dv.id, p_obs);
    else
      select id into v_desc from bodegas where tipo = 'descarte' order by id limit 1;
      v_dest := lote_en_bodega(v_lote, v_desc);
      perform mover_lote(v_dest, dv.cantidad, 'devolucion_averia', 'devolucion', dv.id, p_obs);
    end if;
  elsif p_decision <> 'rechazar' then
    raise exception 'Decisión no válida';
  end if;

  update devoluciones set estado = case p_decision when 'reingresar' then 'reingresada'
                                    when 'averia' then 'averia' else 'rechazada' end::estado_devolucion,
         lote_id = v_lote, validado_por = app_email(), validado_at = now(), obs_validacion = p_obs
   where id = p_id;
end $$;

-- =============================================================================
-- LIQUIDACIÓN de facturas (administrador)
-- =============================================================================
create or replace function marcar_liquidacion(p_factura bigint, p_estado estado_liquidacion, p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform exigir(es_admin(), 'Solo un administrador cambia el estado de liquidación');
  update facturas set estado_liquidacion = p_estado,
         liquidacion_fecha = case when p_estado = 'liquidada' then hoy() end,
         liquidacion_por = app_email(), liquidacion_obs = p_obs
   where id = p_factura;
end $$;

-- Permisos de ejecución
revoke execute on all functions in schema public from public, anon;
-- Las funciones internas que mueven existencias NO se pueden llamar directamente
revoke execute on function mover_lote(bigint,numeric,tipo_movimiento,text,bigint,text),
  consumir_pvps(smallint,bigint,numeric,bigint,tipo_movimiento,text,bigint),
  lote_en_bodega(bigint,smallint), siguiente_numero(text,text,int)
  from authenticated;
grant execute on function registrar_entrada(jsonb), anular_entrada(bigint,text), registrar_salida(jsonb),
  anular_salida(bigint,text), crear_traslado(jsonb), recibir_traslado(bigint,jsonb,jsonb),
  resolver_diferencia(bigint,text,text,bigint), anular_traslado(bigint,text),
  registrar_ajuste(bigint,tipo_ajuste,numeric,text), registrar_devolucion(jsonb),
  validar_devolucion(bigint,text,text,bigint), marcar_liquidacion(bigint,estado_liquidacion,text),
  app_perfil(), app_rol(), app_sede(), app_email(), es_admin(), puede_ver_bodega(smallint),
  puede_operar_bodega(smallint), bodegas_visibles(), hoy(), normalizar_dui(text), nombre_producto(bigint), exigir(boolean,text)
  to authenticated;
