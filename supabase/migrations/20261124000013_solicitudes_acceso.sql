-- =============================================================================
-- SIGAM-INABVE · 013 · Solicitudes de acceso
-- Cada persona entra con su cuenta Microsoft @inabve.gob.sv y envía su solicitud
-- (cargo, sede, tipo de acceso). Un administrador la aprueba asignando rol y sede,
-- o la rechaza. Los usuarios que venían de SIFAR quedan con un rol sugerido.
-- =============================================================================
create type estado_solicitud as enum ('sin_enviar', 'pendiente', 'aprobada', 'rechazada');

alter table perfiles
  add column estado_solicitud   estado_solicitud not null default 'sin_enviar',
  add column cargo              text,
  add column telefono           text,
  add column sede_solicitada    smallint references sedes(id),
  add column rol_solicitado     rol_usuario,
  add column comentario         text,
  add column solicitado_at      timestamptz,
  add column rol_sugerido       rol_usuario,          -- según SIFAR, solo como referencia
  add column revisado_por       text,
  add column revisado_at        timestamptz,
  add column motivo_rechazo     text;
create index perfiles_solicitudes_idx on perfiles (solicitado_at) where estado_solicitud = 'pendiente';

-- los que ya están habilitados se consideran aprobados
update perfiles set estado_solicitud = 'aprobada' where activo;

-- El usuario (aún sin acceso) envía o corrige su solicitud
create or replace function enviar_solicitud_acceso(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v perfiles;
begin
  select * into v from perfiles where id = auth.uid();
  perform exigir(found, 'Inicie sesión con su cuenta institucional');
  perform exigir(not v.activo, 'Su cuenta ya tiene acceso');
  perform exigir(length(trim(coalesce(p->>'nombre', ''))) >= 5, 'Escriba su nombre completo');
  perform exigir(length(trim(coalesce(p->>'cargo', ''))) >= 3, 'Escriba su cargo');
  perform exigir(exists (select 1 from sedes where id = nullif(p->>'sede_id', '')::smallint), 'Elija su sede');
  perform exigir(p->>'rol' in ('dependiente', 'consulta', 'administrador'), 'Elija el tipo de acceso');
  update perfiles set nombre = trim(p->>'nombre'), cargo = trim(p->>'cargo'), telefono = nullif(trim(p->>'telefono'), ''),
         sede_solicitada = (p->>'sede_id')::smallint, rol_solicitado = (p->>'rol')::rol_usuario,
         comentario = nullif(trim(p->>'comentario'), ''), estado_solicitud = 'pendiente', solicitado_at = now(),
         motivo_rechazo = null
   where email = v.email;
end $$;

-- El administrador aprueba (con rol y sede) o rechaza
create or replace function resolver_solicitud_acceso(p_email text, p_aprobar boolean, p_rol rol_usuario default null,
                                                     p_sede smallint default null, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v perfiles;
begin
  perform exigir(es_admin(), 'Solo un administrador resuelve solicitudes de acceso');
  select * into v from perfiles where email = lower(p_email) for update;
  perform exigir(found, 'Usuario no encontrado');
  if p_aprobar then
    perform exigir(p_rol is not null, 'Asigne un rol');
    perform exigir(p_rol <> 'dependiente' or p_sede is not null, 'Un dependiente debe tener sede');
    update perfiles set rol = p_rol, sede_id = p_sede, activo = true, estado_solicitud = 'aprobada',
           revisado_por = app_email(), revisado_at = now(), motivo_rechazo = null
     where email = v.email;
  else
    perform exigir(length(trim(coalesce(p_motivo, ''))) >= 5, 'Indique el motivo del rechazo');
    update perfiles set activo = false, estado_solicitud = 'rechazada', revisado_por = app_email(), revisado_at = now(),
           motivo_rechazo = trim(p_motivo)
     where email = v.email;
  end if;
end $$;

revoke all on function enviar_solicitud_acceso(jsonb), resolver_solicitud_acceso(text, boolean, rol_usuario, smallint, text) from public, anon;
grant execute on function enviar_solicitud_acceso(jsonb), resolver_solicitud_acceso(text, boolean, rol_usuario, smallint, text) to authenticated;

-- Las sedes se pueden leer al llenar la solicitud (antes de tener acceso)
drop policy if exists leer_solicitud on sedes;
create policy leer_solicitud on sedes for select to authenticated using (true);

-- Aparecen en la bandeja del administrador
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
 where dv.estado = 'pendiente' and es_admin()
union all
select 'solicitud_acceso', null::bigint, pf.solicitado_at, pf.email, s.nombre, pf.nombre,
       coalesce(pf.cargo, '') || ' · solicita ' || coalesce(pf.rol_solicitado::text, ''), pf.comentario
  from perfiles pf left join sedes s on s.id = pf.sede_solicitada
 where pf.estado_solicitud = 'pendiente' and es_admin();

-- Solo cuentas Microsoft (Entra ID) del dominio @inabve.gob.sv: se rechaza cualquier otro
-- proveedor (correo y contraseña, Google, etc.) aunque el correo sea institucional.
create or replace function auth_validar_dominio() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is null or new.email !~* '^[^@]+@inabve\.gob\.sv$' then
    raise exception 'Solo se permiten cuentas institucionales @inabve.gob.sv';
  end if;
  if coalesce(new.raw_app_meta_data->>'provider', 'azure') <> 'azure' then
    raise exception 'Solo se puede entrar con la cuenta Microsoft institucional';
  end if;
  return new;
end $$;
