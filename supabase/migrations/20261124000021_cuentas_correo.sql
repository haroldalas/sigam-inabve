-- =============================================================================
-- SIGAM-INABVE · 021 · Cuentas con correo institucional y contraseña
-- Mientras Informática registra SIGAM en Microsoft Entra ID, cada persona crea su
-- cuenta con su correo @inabve.gob.sv y una contraseña. Como el correo no se
-- verifica, ninguna cuenta nueva hereda permisos: todas quedan sin acceso hasta que
-- un administrador apruebe su solicitud (también los perfiles que venían de SIFAR).
-- Los administradores pueden restablecer contraseñas y eliminar cuentas suplantadas.
-- =============================================================================
alter table perfiles add column if not exists debe_cambiar_clave boolean not null default false;

-- Dominio institucional obligatorio; se aceptan Microsoft (Entra ID) y correo + contraseña
create or replace function auth_validar_dominio() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is null or new.email !~* '^[^@]+@inabve\.gob\.sv$' then
    raise exception 'Solo se permiten cuentas institucionales @inabve.gob.sv';
  end if;
  if coalesce(new.raw_app_meta_data->>'provider', 'email') not in ('azure', 'email') then
    raise exception 'Use su cuenta institucional @inabve.gob.sv';
  end if;
  return new;
end $$;

-- Microsoft verifica la identidad: el perfil precargado se enlaza tal cual.
-- Correo + contraseña no la verifica: el perfil se enlaza sin acceso y el rol que traía
-- queda solo como sugerencia para el administrador.
create or replace function auth_enlazar_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.raw_app_meta_data->>'provider', 'email') = 'azure' then
    insert into perfiles (id, email, nombre, rol, activo)
    values (new.id, lower(new.email),
            coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
            'consulta', false)
    on conflict (email) do update set id = excluded.id;
  else
    insert into perfiles (id, email, nombre, rol, activo)
    values (new.id, lower(new.email),
            coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email,'@',1)),
            'consulta', false)
    on conflict (email) do update set
      id = excluded.id,
      rol_sugerido = case when perfiles.activo then perfiles.rol else perfiles.rol_sugerido end,
      estado_solicitud = case when perfiles.activo then 'sin_enviar'::estado_solicitud else perfiles.estado_solicitud end,
      rol = 'consulta', sede_id = null, activo = false, debe_cambiar_clave = false;
  end if;
  return new;
end $$;

-- El administrador asigna una contraseña temporal; la persona la cambia al entrar
create or replace function admin_restablecer_clave(p_email text, p_clave text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v perfiles;
begin
  perform exigir(es_admin(), 'Solo un administrador restablece contraseñas');
  perform exigir(length(coalesce(p_clave, '')) >= 8, 'La contraseña temporal debe tener al menos 8 caracteres');
  select * into v from perfiles where email = lower(trim(p_email));
  perform exigir(found and v.id is not null, 'Esa persona todavía no ha creado su cuenta');
  perform exigir(v.id <> auth.uid(), 'Para su propia cuenta use “Cambiar contraseña”');
  update auth.users set encrypted_password = crypt(p_clave, gen_salt('bf')), updated_at = now() where id = v.id;
  update perfiles set debe_cambiar_clave = true where email = v.email;
end $$;

-- La persona ya cambió la contraseña temporal
create or replace function clave_cambiada() returns void
language sql security definer set search_path = public as $$
  update perfiles set debe_cambiar_clave = false where id = auth.uid();
$$;

-- Elimina una cuenta creada por otra persona (suplantación) para que el dueño real la cree.
-- El perfil, su historial y sus registros se conservan.
create or replace function admin_eliminar_cuenta(p_email text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v perfiles;
begin
  perform exigir(es_admin(), 'Solo un administrador elimina cuentas');
  perform exigir(length(trim(coalesce(p_motivo, ''))) >= 5, 'Indique el motivo');
  select * into v from perfiles where email = lower(trim(p_email)) for update;
  perform exigir(found and v.id is not null, 'Esa persona no tiene cuenta creada');
  perform exigir(v.id <> auth.uid(), 'No puede eliminar su propia cuenta');
  update perfiles set activo = false, estado_solicitud = 'sin_enviar', debe_cambiar_clave = false,
         motivo_rechazo = 'Cuenta eliminada: ' || trim(p_motivo), revisado_por = app_email(), revisado_at = now()
   where email = v.email;
  delete from auth.users where id = v.id;
end $$;

revoke all on function admin_restablecer_clave(text, text), clave_cambiada(), admin_eliminar_cuenta(text, text) from public, anon;
grant execute on function admin_restablecer_clave(text, text), clave_cambiada(), admin_eliminar_cuenta(text, text) to authenticated;
