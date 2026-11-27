-- Ajustes del 27/11/2026 (Harold):
-- 1. Auditivos, lentes y cirugías van a DSIN. DSEC solo para medicamento de primera vez e insumo sin evaluación;
--    lo que DSEC aprueba finaliza ahí (no pasa a DSIN).
-- 2. Estados nuevos con color para medicamentos e insumos: Solicitado (rojo), Ya gestionado (amarillo),
--    Sin disponibilidad por CEFAFA (azul), En espera de aprobación de JD (morado), Disponible para entregar (verde),
--    No aplica, No disponible. DSIN valida → "Ya gestionado".
-- 3. Sede de entrega obligatoria solo para medicamentos e insumos. Contact Center: lo que registran queda "Captado por CC".
-- 4. Fuera de catálogo: quien valida lo agrega al catálogo (nombre comercial, principio activo, presentación; sin código).
-- 5. Resumen periódico a CEFAFA (cada 7 o 15 días, fecha editable) y registro de su respuesta: hay, no hay, alterno, JD.
-- 6. Responsables DSIN: Verónica Echeverría (lentes, auditivos); Jocelyn Flores (medicamentos, insumos).

-- 1 · estados -------------------------------------------------------------------------------------
update solicitud_tipos set estados = '[
 {"k":"registrada","t":"Solicitado","c":"rojo"},
 {"k":"en_gestion","t":"Ya gestionado","c":"amarillo"},
 {"k":"sin_disponibilidad","t":"Sin disponibilidad por CEFAFA","c":"azul"},
 {"k":"espera_jd","t":"En espera de aprobación de JD","c":"morado"},
 {"k":"lista","t":"Disponible para entregar","c":"verde"},
 {"k":"avisado","t":"Disponible · llamado, esperando retiro","c":"verde"},
 {"k":"por_pasar","t":"Disponible · llegó a retirar (por pasar a Despacho)","c":"verde"},
 {"k":"en_despacho","t":"Disponible en Despacho: entregar con su DUI","c":"verde"},
 {"k":"retiro_vencido","t":"No retiró: pasar a Despacho","c":"naranja"},
 {"k":"entregada","t":"Entregado","c":"gris","final":true},
 {"k":"aprobada","t":"Aprobado por DSEC (finalizado)","c":"gris","final":true},
 {"k":"no_aplica","t":"No aplica","c":"gris","final":true},
 {"k":"no_disponible","t":"No disponible","c":"gris","final":true},
 {"k":"no_retirado","t":"No retiró: caso cerrado","c":"gris","final":true},
 {"k":"cancelada","t":"Cancelada","c":"gris","final":true}]'::jsonb where clave = 'medicamento';
update solicitud_tipos set estados = '[
 {"k":"registrada","t":"Solicitado","c":"rojo"},
 {"k":"en_gestion","t":"Ya gestionado","c":"amarillo"},
 {"k":"sin_disponibilidad","t":"Sin disponibilidad del proveedor","c":"azul"},
 {"k":"espera_jd","t":"En espera de aprobación de JD","c":"morado"},
 {"k":"lista","t":"Disponible para entregar","c":"verde"},
 {"k":"avisado","t":"Disponible · llamado, esperando retiro","c":"verde"},
 {"k":"por_pasar","t":"Disponible · llegó a retirar (por pasar a Despacho)","c":"verde"},
 {"k":"en_despacho","t":"Disponible en Despacho: entregar con su DUI","c":"verde"},
 {"k":"retiro_vencido","t":"No retiró: pasar a Despacho","c":"naranja"},
 {"k":"entregada","t":"Entregado","c":"gris","final":true},
 {"k":"aprobada","t":"Aprobado por DSEC (finalizado)","c":"gris","final":true},
 {"k":"no_aplica","t":"No aplica","c":"gris","final":true},
 {"k":"no_disponible","t":"No disponible","c":"gris","final":true},
 {"k":"no_retirado","t":"No retiró: caso cerrado","c":"gris","final":true},
 {"k":"cancelada","t":"Cancelada","c":"gris","final":true}]'::jsonb where clave = 'insumo';
update solicitud_tipos set estados = '[
 {"k":"registrada","t":"Solicitado","c":"rojo"},
 {"k":"contactado","t":"Contactado","c":"amarillo"},
 {"k":"evaluado","t":"Evaluado","c":"amarillo"},
 {"k":"aprobada","t":"Aprobado","c":"amarillo"},
 {"k":"en_gestion","t":"Ya gestionado","c":"amarillo"},
 {"k":"espera_jd","t":"En espera de aprobación de JD","c":"morado"},
 {"k":"lista","t":"Disponible para entregar","c":"verde"},
 {"k":"avisado","t":"Beneficiario avisado","c":"verde"},
 {"k":"entregada","t":"Entregado","c":"gris","final":true},
 {"k":"no_procede","t":"No aplica","c":"gris","final":true},
 {"k":"no_disponible","t":"No disponible","c":"gris","final":true},
 {"k":"cancelada","t":"Cancelada","c":"gris","final":true}]'::jsonb where clave in ('auditivo', 'lentes');
update solicitud_tipos set estados = '[
 {"k":"registrada","t":"Solicitado","c":"rojo"},
 {"k":"contactado","t":"Contactado","c":"amarillo"},
 {"k":"evaluado","t":"Evaluado","c":"amarillo"},
 {"k":"espera_jd","t":"En espera de aprobación de JD","c":"morado"},
 {"k":"programada","t":"Cirugía programada","c":"azul"},
 {"k":"operado","t":"Operado","c":"gris","final":true},
 {"k":"no_procede","t":"No aplica","c":"gris","final":true},
 {"k":"cancelada","t":"Cancelada","c":"gris","final":true}]'::jsonb where clave = 'cirugia_oftalmica';
-- lo que ya existiera con los estados anteriores
update solicitudes set estado = 'en_gestion' where tipo in ('medicamento', 'insumo') and estado = 'aprobada' and area = 'DSIN';
update solicitudes set estado = 'no_aplica' where tipo in ('medicamento', 'insumo') and estado = 'no_procede';

-- 2 · ruteo: DSEC solo medicamento de primera vez e insumo sin evaluación ----------------------------
create or replace function area_inicial(p_tipo text, p_modalidad text, p_tiene_evaluacion boolean) returns text
language sql immutable as $$
  select case p_tipo
    when 'medicamento' then case when p_modalidad = 'primera_vez' then 'DSEC' else 'DSIN' end
    when 'insumo' then case when coalesce(p_tiene_evaluacion, false) then 'DSIN' else 'DSEC' end
    else 'DSIN' end
$$;
update solicitudes set area = 'DSIN' where tipo in ('auditivo', 'lentes', 'cirugia_oftalmica') and area = 'DSEC' and cerrada_at is null;

-- 3 · sede opcional (salvo medicamentos e insumos) y Contact Center ----------------------------------
alter table perfiles add column if not exists contact_center boolean not null default false;
alter table solicitudes add column if not exists captado_cc boolean not null default false;
alter table solicitudes alter column sede_id drop not null;
alter table solicitudes drop constraint if exists solicitudes_sede_check;
alter table solicitudes add constraint solicitudes_sede_check check (sede_id is not null or tipo not in ('medicamento', 'insumo'));
update perfiles set contact_center = true, sede_id = null where email = 'jose.garcia@inabve.gob.sv';
update solicitudes s set captado_cc = true from perfiles p where p.email = s.creado_por and p.contact_center;

drop view if exists v_solicitud_eventos;
drop view if exists v_solicitudes;
create view v_solicitudes as
select s.*, t.nombre as tipo_nombre, t.icono, t.lista_espera, t.dias_validar,
       estado_txt(s.tipo, s.estado) as estado_texto, estado_final(s.tipo, s.estado) as es_final,
       (select e->>'c' from jsonb_array_elements(t.estados) e where e->>'k' = s.estado) as estado_color,
       b.nombre as beneficiario, b.telefono, b.telefono2, b.sector, b.departamento,
       se.nombre as sede, producto_solicitado(s) as solicita,
       p.codigo as producto_codigo, p.tipo::text as producto_tipo,
       (current_date - (s.creado_at at time zone 'America/El_Salvador')::date) as dias,
       (current_date - (s.estado_at at time zone 'America/El_Salvador')::date) as dias_estado,
       case when t.lista_espera and not estado_final(s.tipo, s.estado) then
         (select count(*) from solicitudes x where x.tipo = s.tipo and x.sede_id is not distinct from s.sede_id and x.cerrada_at is null
             and (x.prioridad = 'urgente' and s.prioridad = 'normal' or x.prioridad = s.prioridad and x.creado_at <= s.creado_at)) end as posicion,
       nombre_usuario(s.asignado_a) as asignado_nombre,
       br.nombre as bodega_reserva, br.tipo::text as bodega_reserva_tipo,
       case when s.estado = 'avisado' and s.retiro_limite is not null then dias_habiles_restantes(s.retiro_limite) end as dias_retiro,
       tr.numero as traslado_numero,
       case when s.captado_cc then 'Contact Center' else (select sc.nombre from perfiles pc join sedes sc on sc.id = pc.sede_id where pc.email = s.creado_por) end as captado
  from solicitudes s
  join solicitud_tipos t on t.clave = s.tipo
  join beneficiarios b on b.dui = s.dui
  left join sedes se on se.id = s.sede_id
  left join productos p on p.id = s.producto_id
  left join bodegas br on br.id = s.bodega_reserva_id
  left join traslados tr on tr.id = s.traslado_id
 where puede_ver_solicitud(s.tipo, s.creado_por, s.sede_id);
grant select on v_solicitudes to authenticated;
create view v_solicitud_eventos as
select e.* from solicitud_eventos e join solicitudes s on s.id = e.solicitud_id
 where puede_ver_solicitud(s.tipo, s.creado_por, s.sede_id);
grant select on v_solicitud_eventos to authenticated;

create or replace function crear_solicitud(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_dui text := normalizar_dui(p->>'dui');
  v_tipo text := p->>'tipo';
  v_prod bigint := nullif(p->>'producto_id', '')::bigint;
  v_texto text := nullif(trim(p->>'producto_texto'), '');
  v_pa text := nullif(upper(trim(p->>'principio_activo')), '');
  v_area text; v_id bigint; v_num text; v_dup text; s solicitudes;
begin
  perform exigir(app_rol() is not null, 'Sin acceso');
  perform exigir(exists (select 1 from solicitud_tipos where clave = v_tipo), 'Tipo de solicitud no válido');
  perform exigir(v_dui ~ '^\d{9}$', 'El DUI debe tener 9 dígitos, sin guion');
  perform exigir(length(trim(coalesce(p->>'nombre', ''))) >= 5, 'Escriba el nombre completo del beneficiario');
  perform exigir(v_tipo not in ('medicamento', 'insumo') or nullif(p->>'sede_id', '') is not null,
                 'Elija la sede de entrega (obligatoria para medicamentos e insumos)');
  if v_tipo = 'medicamento' then
    perform exigir(p->>'modalidad' in ('primera_vez', 'pendiente_entrega'), 'Indique si es primera vez o medicamento pendiente de entrega');
  end if;
  if v_tipo = 'insumo' then
    perform exigir(p ? 'primera_entrega' and p ? 'tiene_evaluacion', 'Indique si es primera entrega y si tiene evaluación médica');
  end if;
  if v_tipo in ('medicamento', 'insumo') then
    perform exigir(v_prod is not null or v_texto is not null or v_pa is not null,
                   'Elija el producto o el principio activo del catálogo, o escríbalos si no están');
    if v_prod is not null then
      perform exigir(exists (select 1 from productos where id = v_prod and tipo::text = v_tipo), 'El producto no corresponde al tipo de solicitud');
    end if;
  end if;

  -- duplicado: misma persona, mismo tipo y mismo producto con una solicitud abierta
  select numero into v_dup from solicitudes
   where dui = v_dui and tipo = v_tipo and cerrada_at is null
     and (v_tipo not in ('medicamento', 'insumo') or producto_id = v_prod
          or (v_prod is null and producto_texto is not null and lower(producto_texto) = lower(v_texto))
          or (v_prod is null and v_texto is null and principio_activo = v_pa))
   limit 1;
  if v_dup is not null and not coalesce((p->>'forzar')::boolean, false) then
    raise exception 'DUPLICADA:%', v_dup;
  end if;

  insert into beneficiarios as b (dui, nombre, telefono, telefono2, sector, departamento, sede_id, actualizado_por)
  values (v_dui, upper(trim(p->>'nombre')), nullif(regexp_replace(coalesce(p->>'telefono', ''), '[^\d+]', '', 'g'), ''),
          nullif(regexp_replace(coalesce(p->>'telefono2', ''), '[^\d+]', '', 'g'), ''),
          nullif(p->>'sector', ''), nullif(p->>'departamento', ''), nullif(p->>'sede_id', '')::smallint, app_email())
  on conflict (dui) do update set nombre = excluded.nombre,
     telefono = coalesce(excluded.telefono, b.telefono), telefono2 = coalesce(excluded.telefono2, b.telefono2),
     sector = coalesce(excluded.sector, b.sector), departamento = coalesce(excluded.departamento, b.departamento),
     sede_id = coalesce(excluded.sede_id, b.sede_id), actualizado_at = now(), actualizado_por = app_email();

  v_area := area_inicial(v_tipo, p->>'modalidad', (p->>'tiene_evaluacion')::boolean);
  v_num := 'SOL-' || to_char(now() at time zone 'America/El_Salvador', 'YYYY') || '-' || lpad(nextval('solicitud_numero_seq')::text, 5, '0');
  insert into solicitudes (numero, tipo, dui, sede_id, origen, origen_detalle, prioridad, modalidad, primera_entrega, tiene_evaluacion,
                           producto_id, producto_texto, principio_activo, concentracion, forma, cantidad, unidad, lado, diagnostico,
                           justificacion, comentario, area, creado_por, creado_nombre, captado_cc)
  values (v_num, v_tipo, v_dui, nullif(p->>'sede_id', '')::smallint, coalesce(nullif(p->>'origen', ''), 'llamada'), nullif(trim(p->>'origen_detalle'), ''),
          coalesce(nullif(p->>'prioridad', ''), 'normal'), nullif(p->>'modalidad', ''),
          (p->>'primera_entrega')::boolean, (p->>'tiene_evaluacion')::boolean,
          v_prod, case when v_prod is null then upper(v_texto) end, v_pa,
          nullif(upper(trim(p->>'concentracion')), ''), nullif(trim(p->>'forma'), ''),
          nullif(p->>'cantidad', '')::numeric, nullif(trim(p->>'unidad'), ''), nullif(p->>'lado', ''), nullif(trim(p->>'diagnostico'), ''),
          nullif(trim(p->>'justificacion'), ''), nullif(trim(p->>'comentario'), ''), v_area, app_email(), nombre_usuario(app_email()),
          coalesce((select contact_center from perfiles where email = app_email()), false))
  returning * into s;
  perform registrar_evento(s.id, 'creada', null, 'registrada', s.comentario,
    jsonb_build_object('area', v_area, 'duplicada_de', v_dup));

  perform encolar_correo_solicitud(s.id, array[app_email()], 'Solicitud registrada',
    'Su solicitud quedó registrada y fue enviada a ' || v_area || ' para su validación. Le avisaremos por correo cuando la validen.');
  perform encolar_correo_solicitud(s.id, responsables_de(v_tipo, v_area),
    case when s.prioridad = 'urgente' then 'URGENTE · Nueva solicitud por validar' else 'Nueva solicitud por validar' end,
    'Hay una nueva solicitud que le corresponde validar a ' || v_area || '.' ||
    case when v_tipo = 'medicamento' and s.modalidad = 'primera_vez' then ' Es un medicamento solicitado por primera vez: requiere validación médica.'
         when v_tipo = 'insumo' and not coalesce(s.tiene_evaluacion, false) then ' El beneficiario aún no cuenta con evaluación médica.'
         else '' end);
  return jsonb_build_object('id', s.id, 'numero', s.numero, 'area', v_area);
end $$;

create or replace function validar_solicitud(p_id bigint, p_aprobar boolean, p_nota text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s solicitudes; v_nuevo text;
begin
  select * into s from solicitudes where id = p_id for update;
  perform exigir(found, 'No existe la solicitud');
  perform exigir(es_admin() or es_responsable(s.tipo, s.area), 'Solo los responsables de ' || s.area || ' para este tipo pueden validarla');
  perform exigir(s.estado in ('registrada', 'contactado', 'evaluado'), 'Esta solicitud ya fue validada');
  perform exigir(p_aprobar or length(trim(coalesce(p_nota, ''))) >= 5, 'Indique el motivo por el que no aplica');
  -- DSEC: la aprobación médica finaliza la gestión · DSIN: medicamentos e insumos quedan "Ya gestionado"
  v_nuevo := case when not p_aprobar then case when s.tipo in ('medicamento', 'insumo') then 'no_aplica' else 'no_procede' end
                  when s.area = 'DSEC' and s.tipo in ('medicamento', 'insumo') then 'aprobada'
                  when s.tipo in ('medicamento', 'insumo') then 'en_gestion'
                  when s.tipo = 'cirugia_oftalmica' then 'evaluado' else 'aprobada' end;
  update solicitudes set estado = v_nuevo, estado_at = now(), validado_por = app_email(),
         validado_nombre = nombre_usuario(app_email()), validado_at = now(), motivo = nullif(trim(p_nota), ''),
         cerrada_at = case when estado_final(s.tipo, v_nuevo) then now() end
   where id = p_id;
  perform registrar_evento(p_id, 'validacion', s.estado, v_nuevo, p_nota, jsonb_build_object('aprobada', p_aprobar, 'area', s.area));
  perform encolar_correo_solicitud(p_id, array[s.creado_por],
    case when p_aprobar then 'Solicitud validada: ' || estado_txt(s.tipo, v_nuevo) else 'Solicitud: no aplica' end,
    case when p_aprobar then 'Su solicitud fue <b>validada</b> por ' || nombre_usuario(app_email()) || ' (' || s.area || ') y quedó como <b>' || estado_txt(s.tipo, v_nuevo) || '</b>.'
         else 'Su solicitud fue revisada por ' || nombre_usuario(app_email()) || ' (' || s.area || ') y <b>no aplica</b>.' end ||
    coalesce('<br>Comentario: ' || nullif(trim(p_nota), ''), ''));
  if v_nuevo = 'en_gestion' then perform marcar_lista_si_hay(p_id); end if;
end $$;

-- 4 · espera de producto: "Ya gestionado" o "Sin disponibilidad" --------------------------------------
create or replace function solicitudes_llegada_producto() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sede smallint; v_n int; v_ids bigint[]; r record; v_para text[] := '{}';
begin
  if new.tipo not in ('entrada', 'traslado_recepcion') or new.cantidad <= 0 then return new; end if;
  select sede_id into v_sede from bodegas where id = new.bodega_id and tipo in ('despacho_medicamentos', 'almacen_insumos', 'reservas');
  if v_sede is null then return new; end if;
  with x as (
    update solicitudes set estado = 'lista', estado_at = now(), producto_disponible_at = now(), bodega_reserva_id = new.bodega_id,
           proximo_contacto = coalesce(proximo_contacto, current_date)
     where producto_id = new.producto_id and sede_id = v_sede and cerrada_at is null
       and estado in ('en_gestion', 'sin_disponibilidad')
     returning id, estado, creado_por, tipo)
  select count(*), array_agg(id) into v_n, v_ids from x;
  if v_n = 0 then return new; end if;
  insert into solicitud_eventos (solicitud_id, por, por_nombre, tipo, estado_anterior, estado_nuevo, nota)
  select i, app_email(), 'SIGAM', 'llegada', null, 'lista',
         'Llegó ' || (select nombre_comercial from productos where id = new.producto_id) || ' a ' || (select nombre from bodegas where id = new.bodega_id) ||
         ' (' || case when new.tipo = 'entrada' then 'factura' else 'traslado recibido' end || ')'
    from unnest(v_ids) i;
  for r in select distinct s.tipo from solicitudes s where s.id = any(v_ids) loop
    v_para := v_para || seguimiento_de(r.tipo, v_sede);
  end loop;
  v_para := v_para || array(select distinct s.creado_por from solicitudes s where s.id = any(v_ids));
  perform encolar_correo_solicitud(v_ids[1], v_para,
    'Llegó producto: ' || v_n || ' persona(s) pendiente(s) de entrega',
    'Llegó <b>' || (select nombre_comercial from productos where id = new.producto_id) || '</b> a ' || (select nombre from bodegas where id = new.bodega_id) ||
    '. Hay <b>' || v_n || '</b> persona(s) pendiente(s) de entrega; ya aparecen en Seguimiento telefónico para llamarles. ' ||
    'Desde la llamada tienen 7 días hábiles para retirar. Abajo, la primera de la lista.');
  return new;
end $$;

create or replace function marcar_lista_si_hay(p_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare s solicitudes; v_bod smallint;
begin
  select * into s from solicitudes where id = p_id;
  if s.producto_id is null or s.tipo not in ('medicamento', 'insumo') or s.estado not in ('en_gestion', 'sin_disponibilidad') then return false; end if;
  select b.id into v_bod from lotes l join bodegas b on b.id = l.bodega_id
   where l.producto_id = s.producto_id and b.sede_id = s.sede_id and l.disponible > 0 and l.estado = 'activo'
     and b.tipo in ('reservas', case when s.tipo = 'medicamento' then 'despacho_medicamentos' else 'almacen_insumos' end::tipo_bodega)
   group by b.id, b.tipo order by (b.tipo = 'reservas') desc, sum(l.disponible) desc limit 1;
  if v_bod is null then return false; end if;
  update solicitudes set estado = 'lista', estado_at = now(), producto_disponible_at = now(), bodega_reserva_id = v_bod,
         proximo_contacto = coalesce(proximo_contacto, current_date) where id = p_id;
  perform registrar_evento(p_id, 'llegada', s.estado, 'lista', 'Ya hay existencia en ' || (select nombre from bodegas where id = v_bod));
  perform encolar_correo_solicitud(p_id, seguimiento_de(s.tipo, s.sede_id) || s.creado_por, 'Producto disponible: llamar al beneficiario',
    'El producto de esta solicitud ya está en ' || (select nombre from bodegas where id = v_bod) || '. Llame al beneficiario: desde la llamada tiene 7 días hábiles para retirar.');
  return true;
end $$;

create or replace function por_reservar() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.producto, x.sede), '[]') from (
    select p.id as producto_id, p.codigo, p.nombre_comercial as producto, se.id as sede_id, se.nombre as sede,
           count(*) as personas, sum(coalesce(s.cantidad, 0)) as cantidad,
           (select coalesce(sum(l.disponible), 0) from lotes l join bodegas b on b.id = l.bodega_id
             where l.producto_id = p.id and b.tipo = 'central' and l.estado = 'activo') as en_central,
           (select string_agg(numero, ', ' order by s2.creado_at) from solicitudes s2
             where s2.producto_id = p.id and s2.sede_id = se.id and s2.cerrada_at is null and s2.estado in ('en_gestion', 'sin_disponibilidad')) as numeros
      from solicitudes s join productos p on p.id = s.producto_id join sedes se on se.id = s.sede_id
     where es_admin() and s.cerrada_at is null and s.estado in ('en_gestion', 'sin_disponibilidad')
     group by p.id, p.codigo, p.nombre_comercial, se.id, se.nombre) x
   where x.en_central > 0
$$;

create or replace function solicitudes_entrada_central() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_n int; v_html text;
begin
  if new.tipo <> 'entrada' or new.cantidad <= 0
     or not exists (select 1 from bodegas where id = new.bodega_id and tipo = 'central') then return new; end if;
  select count(*), string_agg(se.nombre || ': ' || s.numero, ' · ' order by se.nombre) into v_n, v_html
    from solicitudes s join sedes se on se.id = s.sede_id
   where s.producto_id = new.producto_id and s.cerrada_at is null and s.estado in ('en_gestion', 'sin_disponibilidad');
  if v_n = 0 then return new; end if;
  -- un solo aviso por producto y día
  if exists (select 1 from correo_cola where asunto like 'Por reservar: ' || (select nombre_comercial from productos where id = new.producto_id) || '%'
             and creado_at > now() - interval '12 hours') then return new; end if;
  perform encolar_correo_solicitud(
    (select id from solicitudes where producto_id = new.producto_id and cerrada_at is null and estado in ('en_gestion', 'sin_disponibilidad') order by creado_at limit 1),
    array(select email from perfiles where activo and rol = 'administrador'),
    'Por reservar: ' || (select nombre_comercial from productos where id = new.producto_id) || ' · ' || v_n || ' persona(s) esperando',
    'Entró <b>' || (select nombre_comercial from productos where id = new.producto_id) || '</b> a la Bodega Central y hay <b>' || v_n ||
    '</b> persona(s) esperándolo (' || v_html || '). Trasládelo a la bodega Reservas de solicitudes de cada sede; al recibirlo, quien hace seguimiento ' ||
    'les llamará y empezarán a correr los 7 días hábiles. Lo ve también en Seguimiento telefónico → Por reservar.');
  return new;
end $$;

-- 5 · fuera de catálogo: quien valida lo agrega al catálogo y queda vinculado --------------------------
create or replace function agregar_producto_solicitud(p_id bigint, p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare s solicitudes; v_prod bigint; v_nom text := upper(trim(coalesce(p->>'nombre_comercial', '')));
begin
  select * into s from solicitudes where id = p_id for update;
  perform exigir(found and s.tipo in ('medicamento', 'insumo'), 'Solo para medicamentos e insumos');
  perform exigir(es_admin() or es_responsable(s.tipo, s.area) or es_responsable(s.tipo, 'DSIN'), 'Solo quien valida puede agregar al catálogo');
  perform exigir(length(v_nom) >= 3, 'Escriba el nombre comercial');
  perform exigir(s.tipo <> 'medicamento' or length(trim(coalesce(p->>'principio_activo', ''))) >= 3, 'Escriba el principio activo');
  perform exigir(not exists (select 1 from productos where upper(nombre_comercial) = v_nom and tipo::text = s.tipo
                              and coalesce(upper(presentacion), '') = coalesce(upper(nullif(trim(p->>'presentacion'), '')), '')),
                 'Ya existe en el catálogo con ese nombre y presentación: búsquelo y vincúlelo');
  insert into productos (codigo, nombre_comercial, principio_activo, concentracion, presentacion, tipo, creado_por)
  values (null, v_nom, nullif(upper(trim(p->>'principio_activo')), ''), nullif(upper(trim(p->>'concentracion')), ''),
          nullif(upper(trim(p->>'presentacion')), ''), s.tipo::tipo_producto, app_email())
  returning id into v_prod;
  perform vincular_producto_solicitud(p_id, v_prod);
  perform registrar_evento(p_id, 'comentario', null, null, 'Agregado al catálogo (sin código de barras): ' || v_nom);
  return v_prod;
end $$;

-- 6 · resumen periódico a CEFAFA ---------------------------------------------------------------------
create table if not exists cefafa_config (
  id smallint primary key default 1 check (id = 1),
  destinatarios text[] not null default '{}',
  copia text[] not null default '{}',
  frecuencia_dias smallint not null default 15 check (frecuencia_dias between 1 and 60),
  proximo_envio date,
  activo boolean not null default false,
  ultimo_envio timestamptz,
  actualizado_por text, actualizado_at timestamptz
);
insert into cefafa_config (id) values (1) on conflict do nothing;
alter table cefafa_config enable row level security;
drop policy if exists leer on cefafa_config;
create policy leer on cefafa_config for select to authenticated using (true);

create or replace function puede_cefafa() returns boolean
language sql stable security definer set search_path = public as $$
  select es_admin() or es_responsable('medicamento', 'DSIN')
$$;

-- medicamentos esperando producto (Ya gestionado o Sin disponibilidad), agrupados; sin datos de beneficiarios
create or replace function resumen_cefafa() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.producto), '[]') from (
    select coalesce('p' || s.producto_id, 'a' || s.principio_activo, 't' || s.producto_texto) as clave,
           coalesce(p.nombre_comercial, s.producto_texto, s.principio_activo || coalesce(' ' || s.concentracion, '')) as producto,
           max(coalesce(p.codigo, '')) as codigo, max(coalesce(upper(p.principio_activo), s.principio_activo, '')) as principio_activo,
           max(coalesce(p.presentacion, '')) as presentacion,
           sum(coalesce(s.cantidad, 0)) as cantidad, count(distinct s.dui) as personas, count(*) as solicitudes,
           string_agg(distinct se.nombre, ', ') as sedes,
           count(*) filter (where s.estado = 'sin_disponibilidad') as sin_disponibilidad,
           array_agg(s.id order by s.creado_at) as ids
      from solicitudes s left join productos p on p.id = s.producto_id left join sedes se on se.id = s.sede_id
     where s.tipo = 'medicamento' and s.estado in ('en_gestion', 'sin_disponibilidad') and s.cerrada_at is null
     group by 1, 2) x
$$;

create or replace function guardar_config_cefafa(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform exigir(puede_cefafa(), 'Solo administración o DSIN de medicamentos');
  update cefafa_config set
    destinatarios = array(select lower(trim(x)) from regexp_split_to_table(coalesce(p->>'destinatarios', ''), '[,; ]+') x where x ~* '^[^@\s]+@[^@\s]+$'),
    copia = array(select lower(trim(x)) from regexp_split_to_table(coalesce(p->>'copia', ''), '[,; ]+') x where x ~* '^[^@\s]+@[^@\s]+$'),
    frecuencia_dias = coalesce(nullif(p->>'frecuencia_dias', '')::smallint, frecuencia_dias),
    proximo_envio = nullif(p->>'proximo_envio', '')::date,
    activo = coalesce((p->>'activo')::boolean, activo),
    actualizado_por = app_email(), actualizado_at = now()
   where id = 1;
end $$;

-- p_forzar: "Enviar ahora" desde SIGAM; sin forzar lo usa la tarea diaria (solo si toca la fecha)
create or replace function enviar_resumen_cefafa(p_forzar boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare c cefafa_config; v_items jsonb; v_n int; v_filas text; v_hoy date := (now() at time zone 'America/El_Salvador')::date; v_ids bigint[];
begin
  select * into c from cefafa_config where id = 1 for update;
  if p_forzar then perform exigir(puede_cefafa(), 'Solo administración o DSIN de medicamentos');
  elsif not c.activo or c.proximo_envio is null or c.proximo_envio > v_hoy then return 0; end if;
  perform exigir(coalesce(array_length(c.destinatarios, 1), 0) > 0, 'Configure el correo de CEFAFA');
  v_items := resumen_cefafa();
  v_n := jsonb_array_length(v_items);
  update cefafa_config set ultimo_envio = now(), proximo_envio = v_hoy + frecuencia_dias where id = 1;
  if v_n = 0 then return 0; end if;
  select string_agg(format('<tr><td style="text-align:center">%s</td><td>%s</td><td><b>%s</b></td><td>%s</td><td>%s</td><td style="text-align:right">%s</td><td>%s</td><td></td></tr>',
           o, coalesce(nullif(x->>'codigo', ''), '—'), x->>'producto', coalesce(nullif(x->>'principio_activo', ''), '—'),
           coalesce(nullif(x->>'presentacion', ''), '—'), x->>'cantidad', coalesce(x->>'sedes', '')), '' order by o)
    into v_filas from jsonb_array_elements(v_items) with ordinality as t(x, o);
  insert into correo_cola (para, asunto, html)
  values (c.destinatarios || c.copia || array(select distinct r.email from solicitud_responsables r where r.tipo = 'medicamento' and r.area = 'DSIN'),
    'INABVE · Consulta de disponibilidad de medicamentos · ' || to_char(v_hoy, 'DD/MM/YYYY'),
    '<div style="font-family:Segoe UI,Arial,sans-serif;max-width:760px;color:#1f2a44">' ||
    '<div style="background:#233152;color:#fff;padding:14px 18px;border-bottom:4px solid #b08a3e">' ||
    '<div style="font-size:12px;letter-spacing:.08em;opacity:.85">INABVE · Departamento de Programas de Salud Integral</div>' ||
    '<div style="font-size:18px;font-weight:700">Consulta de disponibilidad de medicamentos</div></div>' ||
    '<div style="padding:16px 18px;border:1px solid #dde2ec;border-top:0;font-size:14px">' ||
    '<p>Estimados señores de CEFAFA:</p><p>Les solicitamos confirmar la disponibilidad de los siguientes medicamentos que tenemos pendientes de entregar a beneficiarios. ' ||
    'Por cada uno, por favor indiquen en la última columna: <b>HAY</b>, <b>NO HAY</b> o <b>ALTERNO</b> (con el nombre comercial del producto alterno con el mismo principio activo).</p>' ||
    '<table style="border-collapse:collapse;width:100%;font-size:13px" border="1" cellpadding="5">' ||
    '<tr style="background:#eef1f6"><th>#</th><th>Código</th><th>Medicamento</th><th>Principio activo</th><th>Presentación</th><th>Cantidad</th><th>Sedes</th><th>Respuesta CEFAFA</th></tr>' ||
    v_filas || '</table><p style="margin-top:14px">Agradecemos su respuesta a este mismo correo.</p>' ||
    '<p style="color:#6b7280;font-size:12px">Enviado desde SIGAM-INABVE. No incluye datos de beneficiarios.</p></div></div>');
  select array_agg(i::bigint) into v_ids from jsonb_array_elements(v_items) x, jsonb_array_elements_text(x->'ids') i;
  insert into solicitud_eventos (solicitud_id, por, por_nombre, tipo, nota)
  select i, coalesce(app_email(), 'sigam'), coalesce(nombre_usuario(app_email()), 'SIGAM'), 'comentario',
         'Incluida en la consulta de disponibilidad enviada a CEFAFA el ' || to_char(v_hoy, 'DD/MM/YYYY')
    from unnest(v_ids) i;
  return v_n;
end $$;

-- registrar la respuesta de CEFAFA por producto (todas las solicitudes del grupo)
create or replace function responder_cefafa(p_ids bigint[], p_respuesta text, p_producto bigint default null, p_nota text default null) returns int
language plpgsql security definer set search_path = public as $$
declare x solicitudes; v_n int := 0; v_nuevo text;
begin
  perform exigir(puede_cefafa(), 'Solo administración o DSIN de medicamentos');
  perform exigir(p_respuesta in ('hay', 'no_hay', 'alterno', 'jd', 'no_disponible'), 'Respuesta no válida');
  perform exigir(p_respuesta <> 'alterno' or p_producto is not null, 'Elija el producto alterno que ofrece CEFAFA');
  for x in select * from solicitudes where id = any(p_ids) and tipo = 'medicamento' and estado in ('en_gestion', 'sin_disponibilidad', 'espera_jd') for update loop
    v_nuevo := case p_respuesta when 'no_hay' then 'sin_disponibilidad' when 'jd' then 'espera_jd' when 'no_disponible' then 'no_disponible' else 'en_gestion' end;
    if p_respuesta = 'alterno' then
      update solicitudes set producto_pedido_id = coalesce(producto_pedido_id, producto_id), producto_id = p_producto,
             principio_activo = coalesce(principio_activo, (select upper(principio_activo) from productos where id = p_producto))
       where id = x.id;
    end if;
    update solicitudes set estado = v_nuevo, estado_at = case when v_nuevo <> x.estado then now() else estado_at end,
           cerrada_at = case when estado_final(x.tipo, v_nuevo) then now() end
     where id = x.id;
    perform registrar_evento(x.id, 'estado', case when v_nuevo <> x.estado then x.estado end, case when v_nuevo <> x.estado then v_nuevo end,
      case p_respuesta when 'hay' then 'CEFAFA confirma disponibilidad' when 'no_hay' then 'CEFAFA: sin disponibilidad'
           when 'alterno' then 'CEFAFA ofrece alterno: ' || (select nombre_comercial from productos where id = p_producto)
           when 'jd' then 'En espera de aprobación de Junta Directiva' else 'No disponible' end ||
      coalesce(' · ' || nullif(trim(p_nota), ''), ''));
    if v_nuevo = 'en_gestion' then perform marcar_lista_si_hay(x.id); end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

grant execute on function agregar_producto_solicitud(bigint, jsonb), resumen_cefafa(), guardar_config_cefafa(jsonb),
  enviar_resumen_cefafa(boolean), responder_cefafa(bigint[], text, bigint, text), puede_cefafa() to authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'sigam-resumen-cefafa';
    perform cron.schedule('sigam-resumen-cefafa', '20 13 * * 1-5', 'select enviar_resumen_cefafa(false)');
  end if;
end $$;

-- 7 · responsables -----------------------------------------------------------------------------------
delete from solicitud_responsables where area = 'DSEC' and tipo in ('auditivo', 'lentes', 'cirugia_oftalmica');
insert into solicitud_responsables (tipo, area, email)
select x.tipo, 'DSIN', x.email from (values ('lentes', 'veronica.echeverria@inabve.gob.sv'), ('auditivo', 'veronica.echeverria@inabve.gob.sv'),
                                            ('medicamento', 'jocelyn.flores@inabve.gob.sv'), ('insumo', 'jocelyn.flores@inabve.gob.sv')) x(tipo, email)
 where exists (select 1 from perfiles p where p.email = x.email)
   and not exists (select 1 from solicitud_responsables r where r.tipo = x.tipo and r.area = 'DSIN' and r.email = x.email);
