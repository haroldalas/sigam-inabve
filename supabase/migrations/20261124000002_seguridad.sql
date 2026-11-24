-- =============================================================================
-- SIGAM-INABVE · Migración 2: usuarios, roles y seguridad por fila (RLS)
-- Regla general: se LEE con RLS; se ESCRIBE solo mediante funciones (RPC)
-- que validan rol, sede y reglas de negocio en una sola transacción.
-- =============================================================================

-- Perfil del usuario actual -----------------------------------------------------
create or replace function app_perfil() returns perfiles
language sql stable security definer set search_path = public as $$
  select p.* from perfiles p where p.id = auth.uid() and p.activo
$$;

create or replace function app_rol() returns rol_usuario
language sql stable security definer set search_path = public as $$
  select rol from perfiles where id = auth.uid() and activo
$$;

create or replace function app_sede() returns smallint
language sql stable security definer set search_path = public as $$
  select sede_id from perfiles where id = auth.uid() and activo
$$;

create or replace function app_email() returns text
language sql stable security definer set search_path = public as $$
  select email from perfiles where id = auth.uid()
$$;

create or replace function es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select rol = 'administrador' from perfiles where id = auth.uid() and activo), false)
$$;

-- Ver: administradores todo; los demás todo menos bodegas solo_admin (Descarte)
create or replace function puede_ver_bodega(p_bodega smallint) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when app_rol() is null then false
    when app_rol() = 'administrador' then true
    else not coalesce((select solo_admin from bodegas where id = p_bodega), true)
  end
$$;

-- Lista de bodegas visibles/operables, calculada una vez por consulta (rápido en RLS)
create or replace function bodegas_visibles() returns smallint[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from bodegas b where puede_ver_bodega(b.id)
$$;

-- Operar: administradores todo; dependientes solo bodegas de SU sede (no Descarte)
create or replace function puede_operar_bodega(p_bodega smallint) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when app_rol() = 'administrador' then true
    when app_rol() = 'dependiente' then exists (
      select 1 from bodegas b
      where b.id = p_bodega and b.sede_id = app_sede() and not b.solo_admin and b.activa)
    else false
  end
$$;

-- Solo cuentas @inabve.gob.sv pueden registrarse ---------------------------------
create or replace function auth_validar_dominio() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is null or new.email !~* '^[^@]+@inabve\.gob\.sv$' then
    raise exception 'Solo se permiten cuentas institucionales @inabve.gob.sv';
  end if;
  return new;
end $$;

-- Al primer inicio de sesión se enlaza el perfil precargado (o se crea pendiente)
create or replace function auth_enlazar_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfiles (id, email, nombre, rol, activo)
  values (new.id, lower(new.email),
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
          'consulta', false)
  on conflict (email) do update set id = excluded.id;
  return new;
end $$;

drop trigger if exists sigam_validar_dominio on auth.users;
create trigger sigam_validar_dominio before insert or update of email on auth.users
  for each row execute function auth_validar_dominio();
drop trigger if exists sigam_enlazar_perfil on auth.users;
create trigger sigam_enlazar_perfil after insert on auth.users
  for each row execute function auth_enlazar_perfil();

-- AWaRe obligatorio para antibióticos (productos nuevos o cambio de familia) -----
create or replace function productos_validar() returns trigger
language plpgsql set search_path = public as $$
declare v_fam text;
begin
  select nombre into v_fam from familias where id = new.familia_id;
  if v_fam = 'ANTIBIOTICO' and new.aware is null
     and (tg_op = 'INSERT' or new.familia_id is distinct from old.familia_id) then
    raise exception 'La clasificación AWaRe es obligatoria para productos de la familia ANTIBIOTICO';
  end if;
  if new.codigo is not null then new.codigo := trim(new.codigo); end if;
  return new;
end $$;
create trigger productos_validar before insert or update on productos
  for each row execute function productos_validar();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table sedes                  enable row level security;
alter table bodegas                enable row level security;
alter table perfiles               enable row level security;
alter table familias               enable row level security;
alter table productos              enable row level security;
alter table proveedores            enable row level security;
alter table contratos              enable row level security;
alter table facturas               enable row level security;
alter table factura_detalle        enable row level security;
alter table lotes                  enable row level security;
alter table movimientos            enable row level security;
alter table salidas                enable row level security;
alter table salida_detalle         enable row level security;
alter table traslados              enable row level security;
alter table traslado_detalle       enable row level security;
alter table traslado_diferencias   enable row level security;
alter table ajustes                enable row level security;
alter table devoluciones           enable row level security;
alter table importaciones_despacho enable row level security;
alter table adjuntos               enable row level security;
alter table parametros             enable row level security;
alter table correlativos           enable row level security;

-- Catálogos: lectura para todo usuario activo; edición solo administradores
create policy leer on sedes       for select to authenticated using ((select app_rol()) is not null);
create policy leer on familias    for select to authenticated using ((select app_rol()) is not null);
create policy leer on productos   for select to authenticated using ((select app_rol()) is not null);
create policy leer on proveedores for select to authenticated using ((select app_rol()) is not null);
create policy leer on contratos   for select to authenticated using ((select app_rol()) is not null);
create policy leer on parametros  for select to authenticated using ((select app_rol()) is not null);
create policy leer on bodegas     for select to authenticated using (puede_ver_bodega(id));

create policy admin_escribe on sedes       for all to authenticated using ((select es_admin())) with check ((select es_admin()));
create policy admin_escribe on familias    for all to authenticated using ((select es_admin())) with check ((select es_admin()));
create policy admin_escribe on productos   for all to authenticated using ((select es_admin())) with check ((select es_admin()));
create policy admin_escribe on proveedores for all to authenticated using ((select es_admin())) with check ((select es_admin()));
create policy admin_escribe on contratos   for all to authenticated using ((select es_admin())) with check ((select es_admin()));
create policy admin_escribe on bodegas     for all to authenticated using ((select es_admin())) with check ((select es_admin()));
create policy admin_escribe on parametros  for all to authenticated using ((select es_admin())) with check ((select es_admin()));

-- Perfiles: cada quien ve el suyo; administradores ven y gestionan todos
create policy ver_propio on perfiles for select to authenticated using (id = (select auth.uid()) or (select es_admin()));
create policy admin_gestiona on perfiles for all to authenticated using ((select es_admin())) with check ((select es_admin()));

-- Inventario y documentos: lectura según bodega visible
create policy leer on lotes       for select to authenticated using (bodega_id in (select unnest(bodegas_visibles())));
create policy leer on movimientos for select to authenticated using (bodega_id in (select unnest(bodegas_visibles())));
create policy leer on facturas    for select to authenticated using ((select app_rol()) in ('administrador','dependiente'));
create policy leer on factura_detalle for select to authenticated using ((select app_rol()) in ('administrador','dependiente'));
create policy leer on salidas     for select to authenticated
  using ((select es_admin()) or ((select app_rol()) = 'dependiente' and puede_operar_bodega(bodega_id)));
create policy leer on salida_detalle for select to authenticated
  using (exists (select 1 from salidas s where s.id = salida_id
                 and ((select es_admin()) or ((select app_rol()) = 'dependiente' and puede_operar_bodega(s.bodega_id)))));
create policy leer on traslados   for select to authenticated
  using ((select es_admin()) or ((select app_rol()) = 'dependiente'
         and (puede_operar_bodega(bodega_origen_id) or puede_operar_bodega(bodega_destino_id))));
create policy leer on traslado_detalle for select to authenticated
  using (exists (select 1 from traslados t where t.id = traslado_id and ((select es_admin()) or ((select app_rol()) = 'dependiente'
         and (puede_operar_bodega(t.bodega_origen_id) or puede_operar_bodega(t.bodega_destino_id))))));
create policy leer on traslado_diferencias for select to authenticated
  using (exists (select 1 from traslados t where t.id = traslado_id and ((select es_admin()) or ((select app_rol()) = 'dependiente'
         and (puede_operar_bodega(t.bodega_origen_id) or puede_operar_bodega(t.bodega_destino_id))))));
create policy leer on ajustes      for select to authenticated using ((select es_admin()) or puede_operar_bodega(bodega_id));
create policy leer on devoluciones for select to authenticated using ((select es_admin()) or puede_operar_bodega(bodega_id));
create policy leer on importaciones_despacho for select to authenticated using ((select es_admin()));
create policy leer on adjuntos     for select to authenticated using ((select app_rol()) in ('administrador','dependiente'));
-- correlativos: sin políticas (solo funciones)

-- Permisos de tabla (RLS decide las filas)
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on sedes, familias, productos, proveedores, contratos, bodegas, parametros, perfiles
  to authenticated;
revoke all on correlativos from authenticated;
-- anon (sin sesión) no tiene acceso a nada de SIGAM
revoke all on all tables in schema public from anon;
