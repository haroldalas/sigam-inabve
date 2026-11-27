-- 1. Medicamentos: el médico puede pedir por producto, por principio activo o ambos; DSIN valida el producto
--    que entregará CEFAFA (puede ser un alterno con el mismo principio activo) y queda registrado el pedido original.
-- 2. "Lista" de inmediato: al validar o al definir el producto, si ya hay existencia en la sede (Reservas o Despacho).
-- 3. Administración crea cuentas con contraseña temporal (que escribe el administrador) para quien aún no la tiene.

alter table solicitudes add column if not exists producto_pedido_id bigint references productos(id);
alter table solicitudes drop constraint if exists solicitudes_check;
alter table solicitudes add constraint solicitudes_producto_check
  check (producto_id is not null or producto_texto is not null or principio_activo is not null or tipo not in ('medicamento', 'insumo'));

create or replace function producto_solicitado(s solicitudes) returns text
language sql stable set search_path = public as $$
  select case
    when s.producto_id is not null then (select nombre_comercial from productos where id = s.producto_id)
      || coalesce(' (alterno de ' || (select nombre_comercial from productos where id = s.producto_pedido_id and id <> s.producto_id) || ')', '')
    when s.producto_texto is not null then s.producto_texto || ' (fuera de catálogo)'
    when s.principio_activo is not null then s.principio_activo || coalesce(' ' || s.concentracion, '') || ' (principio activo: DSIN define el producto)'
    when s.tipo = 'cirugia_oftalmica' then coalesce(s.diagnostico, 'Cirugía oftálmica')
    else (select nombre from solicitud_tipos where clave = s.tipo) || coalesce(' · ' || s.lado, '') end
$$;

-- deja "Lista" si el producto ya está en la sede (prefiere Reservas; si no, Despacho/Almacén)
create or replace function marcar_lista_si_hay(p_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare s solicitudes; v_bod smallint;
begin
  select * into s from solicitudes where id = p_id;
  if s.producto_id is null or s.tipo not in ('medicamento', 'insumo') or s.estado not in ('aprobada', 'en_gestion', 'sin_disponibilidad') then return false; end if;
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

-- DSIN define/valida el producto que se entregará (el de CEFAFA, alterno con el mismo principio activo)
create or replace function vincular_producto_solicitud(p_id bigint, p_producto bigint) returns void
language plpgsql security definer set search_path = public as $$
declare s solicitudes; v_nom text;
begin
  select * into s from solicitudes where id = p_id for update;
  perform exigir(found and (puede_gestionar_solicitud(s.tipo) or es_responsable(s.tipo, 'DSIN')), 'Solo DSIN o administración definen el producto');
  perform exigir(s.cerrada_at is null, 'La solicitud ya está cerrada');
  perform exigir(s.estado not in ('lista', 'avisado', 'por_pasar', 'en_despacho', 'retiro_vencido'), 'Ya hay producto reservado para esta solicitud; no se puede cambiar');
  perform exigir(exists (select 1 from productos where id = p_producto and tipo::text = s.tipo), 'El producto no corresponde al tipo');
  select nombre_comercial into v_nom from productos where id = p_producto;
  update solicitudes set producto_pedido_id = coalesce(producto_pedido_id, producto_id), producto_id = p_producto,
         principio_activo = coalesce(principio_activo, (select upper(principio_activo) from productos where id = p_producto))
   where id = p_id;
  perform registrar_evento(p_id, 'comentario', null, null,
    'Producto que se entregará: ' || v_nom ||
    case when s.producto_id is not null and s.producto_id <> p_producto then ' (alterno de ' || (select nombre_comercial from productos where id = s.producto_id) || ')'
         when s.producto_texto is not null then ' (pedido fuera de catálogo: ' || s.producto_texto || ')'
         when s.principio_activo is not null and s.producto_id is null then ' (pedido por principio activo: ' || s.principio_activo || ')' else '' end);
  perform marcar_lista_si_hay(p_id);
end $$;

-- Administración crea la cuenta (correo institucional) con una contraseña temporal escrita por el administrador;
-- la persona la cambia al entrar. Sirve para quien no ha podido crearla.
create or replace function admin_crear_cuenta(p_email text, p_clave text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v perfiles; v_id uuid := gen_random_uuid(); v_mail text := lower(trim(p_email));
begin
  perform exigir(es_admin(), 'Solo un administrador crea cuentas');
  perform exigir(v_mail ~ '^[^@]+@inabve\.gob\.sv$', 'Debe ser un correo @inabve.gob.sv');
  perform exigir(length(coalesce(p_clave, '')) >= 8, 'La contraseña temporal debe tener al menos 8 caracteres');
  select * into v from perfiles where email = v_mail for update;
  perform exigir(found, 'Primero registre a la persona en Usuarios');
  perform exigir(v.id is null and not exists (select 1 from auth.users where lower(email) = v_mail), 'Esa persona ya tiene cuenta: use "Contraseña temporal"');
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_mail, crypt(p_clave, gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', v.nombre), now(), now(), '', '', '', '');
  insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
  values (gen_random_uuid(), v_id::text, v_id, jsonb_build_object('sub', v_id::text, 'email', v_mail, 'email_verified', true), 'email', now(), now(), null);
  -- el enlace automático deja el perfil sin acceso; aquí lo crea el administrador, así que se restituye
  update perfiles set id = v_id, rol = v.rol, sede_id = v.sede_id, activo = true, estado_solicitud = 'aprobada',
         rol_sugerido = null, debe_cambiar_clave = true, revisado_por = app_email(), revisado_at = now()
   where email = v_mail;
end $$;
revoke all on function admin_crear_cuenta(text, text) from public, anon;
grant execute on function admin_crear_cuenta(text, text), marcar_lista_si_hay(bigint) to authenticated;

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
  perform exigir(nullif(p->>'sede_id', '') is not null, 'Elija la sede de entrega');
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
          nullif(p->>'sector', ''), nullif(p->>'departamento', ''), (p->>'sede_id')::smallint, app_email())
  on conflict (dui) do update set nombre = excluded.nombre,
     telefono = coalesce(excluded.telefono, b.telefono), telefono2 = coalesce(excluded.telefono2, b.telefono2),
     sector = coalesce(excluded.sector, b.sector), departamento = coalesce(excluded.departamento, b.departamento),
     sede_id = excluded.sede_id, actualizado_at = now(), actualizado_por = app_email();

  v_area := area_inicial(v_tipo, p->>'modalidad', (p->>'tiene_evaluacion')::boolean);
  v_num := 'SOL-' || to_char(now() at time zone 'America/El_Salvador', 'YYYY') || '-' || lpad(nextval('solicitud_numero_seq')::text, 5, '0');
  insert into solicitudes (numero, tipo, dui, sede_id, origen, origen_detalle, prioridad, modalidad, primera_entrega, tiene_evaluacion,
                           producto_id, producto_texto, principio_activo, concentracion, forma, cantidad, unidad, lado, diagnostico,
                           justificacion, comentario, area, creado_por, creado_nombre)
  values (v_num, v_tipo, v_dui, (p->>'sede_id')::smallint, coalesce(nullif(p->>'origen', ''), 'llamada'), nullif(trim(p->>'origen_detalle'), ''),
          coalesce(nullif(p->>'prioridad', ''), 'normal'), nullif(p->>'modalidad', ''),
          (p->>'primera_entrega')::boolean, (p->>'tiene_evaluacion')::boolean,
          v_prod, case when v_prod is null then upper(v_texto) end, v_pa,
          nullif(upper(trim(p->>'concentracion')), ''), nullif(trim(p->>'forma'), ''),
          nullif(p->>'cantidad', '')::numeric, nullif(trim(p->>'unidad'), ''), nullif(p->>'lado', ''), nullif(trim(p->>'diagnostico'), ''),
          nullif(trim(p->>'justificacion'), ''), nullif(trim(p->>'comentario'), ''), v_area, app_email(), nombre_usuario(app_email()))
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
declare s solicitudes; v_nuevo text; v_area text;
begin
  select * into s from solicitudes where id = p_id for update;
  perform exigir(found, 'No existe la solicitud');
  perform exigir(es_admin() or es_responsable(s.tipo, s.area), 'Solo los responsables de ' || s.area || ' para este tipo pueden validarla');
  perform exigir(s.estado in ('registrada', 'contactado', 'evaluado'), 'Esta solicitud ya fue validada');
  perform exigir(p_aprobar or length(trim(coalesce(p_nota, ''))) >= 5, 'Indique el motivo por el que no procede');
  v_nuevo := case when not p_aprobar then 'no_procede'
                  when s.tipo = 'cirugia_oftalmica' then 'evaluado' else 'aprobada' end;
  -- lo que DSEC aprueba de medicamentos e insumos pasa a DSIN para la gestión y entrega
  v_area := case when p_aprobar and s.area = 'DSEC' and s.tipo in ('medicamento', 'insumo') then 'DSIN' else s.area end;
  update solicitudes set estado = v_nuevo, estado_at = now(), area = v_area, validado_por = app_email(),
         validado_nombre = nombre_usuario(app_email()), validado_at = now(), motivo = nullif(trim(p_nota), ''),
         cerrada_at = case when estado_final(s.tipo, v_nuevo) then now() end
   where id = p_id;
  perform registrar_evento(p_id, 'validacion', s.estado, v_nuevo, p_nota, jsonb_build_object('aprobada', p_aprobar, 'area', v_area));
  perform encolar_correo_solicitud(p_id, array[s.creado_por],
    case when p_aprobar then 'Solicitud validada' else 'Solicitud no procede' end,
    case when p_aprobar then 'Su solicitud fue <b>validada</b> por ' || nombre_usuario(app_email()) || '.'
         else 'Su solicitud fue revisada por ' || nombre_usuario(app_email()) || ' y <b>no procede</b>.' end ||
    coalesce('<br>Comentario: ' || nullif(trim(p_nota), ''), ''));
  if v_area <> s.area then
    perform registrar_evento(p_id, 'area', null, null, 'Pasa de ' || s.area || ' a ' || v_area || ' para gestión y entrega');
    perform encolar_correo_solicitud(p_id, responsables_de(s.tipo, 'DSIN'),
      'Solicitud aprobada por DSEC', 'DSEC aprobó esta solicitud (' || nombre_usuario(app_email()) || '). Pasa a DSIN para su gestión y entrega.');
  end if;
  -- si el producto ya está en la sede, queda lista de una vez
  if p_aprobar then perform marcar_lista_si_hay(p_id); end if;
end $$;

-- DSEC: Beatriz Quele y Josselin Aguillón (todos los tipos); perfiles habilitados como Consulta
update perfiles set activo = true, estado_solicitud = 'aprobada', rol = coalesce(rol, 'consulta'), sede_id = coalesce(sede_id, 1)
 where email in ('beatriz.quele@inabve.gob.sv', 'josselin.aguillon@inabve.gob.sv');
insert into solicitud_responsables (tipo, area, email)
select t.clave, 'DSEC', e.email from solicitud_tipos t
 cross join (values ('beatriz.quele@inabve.gob.sv'), ('josselin.aguillon@inabve.gob.sv')) e(email)
 where exists (select 1 from perfiles p where p.email = e.email)
   and not exists (select 1 from solicitud_responsables r where r.tipo = t.clave and r.area = 'DSEC' and r.email = e.email);
