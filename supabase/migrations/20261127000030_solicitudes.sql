-- =============================================================================
-- SIGAM-INABVE · 030 · Módulo de Solicitudes (reemplaza las listas de Microsoft)
-- Tipos: medicamento, insumo, aparato auditivo, lentes, cirugía oftálmica.
-- · Beneficiarios: tabla privada por DUI (9 dígitos); solo se consulta un DUI exacto
--   por función y cada consulta queda registrada. Sirve para autocompletar.
-- · Ruteo: medicamento primera vez → DSEC (un médico valida); pendiente de entrega → DSIN.
--   Insumo sin evaluación médica → DSEC; con evaluación → DSIN. Auditivos, lentes y
--   cirugías → DSEC. Lo que DSEC aprueba de medicamentos/insumos pasa a DSIN.
-- · Responsables por tipo y área (DSEC, DSIN, SEGUIMIENTO telefónico).
-- · Correos: cola correo_cola que vacía la Edge Function "enviar-correos" (Gmail).
-- · Al entrar un producto (factura o traslado recibido) a una sede con solicitudes
--   pendientes, pasan a "Lista para entregar" y se avisa. Al despacharlo con el DUI
--   de la persona, la solicitud queda "Entregada".
-- =============================================================================

-- 1. Beneficiarios ---------------------------------------------------------------
create table beneficiarios (
  dui            char(9) primary key check (dui ~ '^\d{9}$'),
  nombre         text not null,
  telefono       text,
  telefono2      text,
  sector         text,
  departamento   text,
  sede_id        smallint references sedes,
  actualizado_at timestamptz not null default now(),
  actualizado_por text
);
alter table beneficiarios enable row level security;   -- sin políticas: solo por funciones
revoke all on beneficiarios from anon, authenticated;

create table beneficiario_consultas (
  id      bigint generated always as identity primary key,
  dui     char(9) not null,
  por     text not null,
  at      timestamptz not null default now(),
  motivo  text
);
alter table beneficiario_consultas enable row level security;
create policy leer_admin on beneficiario_consultas for select to authenticated using ((select es_admin()));
create index on beneficiario_consultas (dui, at desc);

create or replace function normalizar_dui(p text) returns text language sql immutable as $$
  select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '')
$$;
create or replace function enmascarar_dui(p text) returns text language sql immutable as $$
  select case when p is null then '' else '•••••' || right(p, 4) end
$$;

-- 2. Tipos, estados y responsables -----------------------------------------------
create table solicitud_tipos (
  clave        text primary key,
  nombre       text not null,
  icono        text,
  orden        smallint not null,
  area_defecto text not null check (area_defecto in ('DSEC', 'DSIN')),
  dias_validar smallint not null default 2,     -- semáforo: días hábiles para validar
  lista_espera boolean not null default false,  -- muestra posición en la lista de espera
  estados      jsonb not null                   -- [{k, t, final}]
);
insert into solicitud_tipos values
 ('medicamento', 'Medicamento', '💊', 1, 'DSIN', 2, false,
  '[{"k":"registrada","t":"Pendiente de validación"},{"k":"aprobada","t":"Aprobada"},{"k":"en_gestion","t":"En gestión"},
    {"k":"sin_disponibilidad","t":"Sin disponibilidad del proveedor"},{"k":"lista","t":"Lista para entregar"},
    {"k":"avisado","t":"Beneficiario avisado"},{"k":"entregada","t":"Entregada","final":true},
    {"k":"no_procede","t":"No procede","final":true},{"k":"cancelada","t":"Cancelada","final":true}]'),
 ('insumo', 'Insumo médico', '🩹', 2, 'DSIN', 2, false,
  '[{"k":"registrada","t":"Pendiente de validación"},{"k":"aprobada","t":"Aprobada"},{"k":"en_gestion","t":"En gestión"},
    {"k":"sin_disponibilidad","t":"Sin disponibilidad del proveedor"},{"k":"lista","t":"Lista para entregar"},
    {"k":"avisado","t":"Beneficiario avisado"},{"k":"entregada","t":"Entregada","final":true},
    {"k":"no_procede","t":"No procede","final":true},{"k":"cancelada","t":"Cancelada","final":true}]'),
 ('auditivo', 'Aparato auditivo', '🦻', 3, 'DSEC', 5, true,
  '[{"k":"registrada","t":"Pendiente de validación"},{"k":"contactado","t":"Contactado"},{"k":"evaluado","t":"Evaluado"},
    {"k":"aprobada","t":"Aprobada"},{"k":"en_gestion","t":"En gestión"},{"k":"lista","t":"Lista para entregar"},
    {"k":"avisado","t":"Beneficiario avisado"},{"k":"entregada","t":"Entregado","final":true},
    {"k":"no_procede","t":"No procede","final":true},{"k":"cancelada","t":"Cancelada","final":true}]'),
 ('lentes', 'Lentes', '👓', 4, 'DSEC', 5, true,
  '[{"k":"registrada","t":"Pendiente de validación"},{"k":"contactado","t":"Contactado"},{"k":"evaluado","t":"Evaluado"},
    {"k":"aprobada","t":"Aprobada"},{"k":"en_gestion","t":"En gestión"},{"k":"lista","t":"Lista para entregar"},
    {"k":"avisado","t":"Beneficiario avisado"},{"k":"entregada","t":"Entregados","final":true},
    {"k":"no_procede","t":"No procede","final":true},{"k":"cancelada","t":"Cancelada","final":true}]'),
 ('cirugia_oftalmica', 'Cirugía oftálmica', '👁️', 5, 'DSEC', 5, true,
  '[{"k":"registrada","t":"Pendiente de seguimiento"},{"k":"contactado","t":"Contactado"},{"k":"evaluado","t":"Evaluado"},
    {"k":"programada","t":"Cirugía programada"},{"k":"operado","t":"Operado","final":true},
    {"k":"no_procede","t":"No procede","final":true},{"k":"cancelada","t":"Cancelada","final":true}]');
alter table solicitud_tipos enable row level security;
create policy leer_todos on solicitud_tipos for select to authenticated using (true);
create policy admin_edita on solicitud_tipos for update to authenticated using ((select es_admin()));

create table solicitud_responsables (
  id     bigint generated always as identity primary key,
  tipo   text not null references solicitud_tipos,
  area   text not null check (area in ('DSEC', 'DSIN', 'SEGUIMIENTO')),
  email  text not null references perfiles(email) on update cascade on delete cascade,
  unique (tipo, area, email)
);
alter table solicitud_responsables enable row level security;
create policy leer_todos on solicitud_responsables for select to authenticated using (true);

create or replace function es_responsable(p_tipo text, p_area text default null) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from solicitud_responsables r
                  where r.email = app_email() and r.tipo = p_tipo and (p_area is null or r.area = p_area))
$$;

-- 3. Solicitudes, historial y correos ---------------------------------------------
create sequence solicitud_numero_seq;
create table solicitudes (
  id                bigint generated always as identity primary key,
  numero            text unique,
  tipo              text not null references solicitud_tipos,
  dui               char(9) not null references beneficiarios on update cascade,
  sede_id           smallint not null references sedes,
  origen            text not null default 'llamada' check (origen in ('llamada', 'consulta', 'jornada', 'referencia_hmc', 'otro')),
  origen_detalle    text,
  prioridad         text not null default 'normal' check (prioridad in ('normal', 'urgente')),
  modalidad         text check (modalidad in ('primera_vez', 'pendiente_entrega')),   -- medicamentos
  primera_entrega   boolean,                                                         -- insumos
  tiene_evaluacion  boolean,                                                         -- insumos
  producto_id       bigint references productos,
  producto_texto    text,      -- fuera del catálogo: descripción
  principio_activo  text,
  concentracion     text,
  forma             text,
  cantidad          numeric(12,2),
  unidad            text,
  lado              text check (lado in ('derecho', 'izquierdo', 'bilateral')),
  diagnostico       text,
  justificacion     text,
  comentario        text,
  area              text not null check (area in ('DSEC', 'DSIN')),
  estado            text not null default 'registrada',
  creado_por        text not null,
  creado_nombre     text,
  creado_at         timestamptz not null default now(),
  validado_por      text,
  validado_nombre   text,
  validado_at       timestamptz,
  motivo            text,
  asignado_a        text references perfiles(email) on update cascade on delete set null,
  estado_at         timestamptz not null default now(),
  producto_disponible_at timestamptz,
  ultimo_contacto_at timestamptz,
  ultimo_resultado  text,
  proximo_contacto  date,
  intentos          int not null default 0,
  salida_id         bigint references salidas,
  cerrada_at        timestamptz,
  origen_lista      text,      -- migración desde Microsoft Lists
  origen_lista_id   int,
  check (producto_id is not null or producto_texto is not null or tipo not in ('medicamento', 'insumo'))
);
create index on solicitudes (dui);
create index on solicitudes (tipo, area, estado);
create index on solicitudes (producto_id, sede_id) where cerrada_at is null;
alter table solicitudes enable row level security;    -- se lee por la vista v_solicitudes

create table solicitud_eventos (
  id             bigint generated always as identity primary key,
  solicitud_id   bigint not null references solicitudes on delete cascade,
  at             timestamptz not null default now(),
  por            text,
  por_nombre     text,
  tipo           text not null,   -- creada, validacion, estado, comentario, llamada, llegada, entrega, area, asignacion
  estado_anterior text,
  estado_nuevo   text,
  nota           text,
  datos          jsonb
);
create index on solicitud_eventos (solicitud_id, at);
alter table solicitud_eventos enable row level security;

create table correo_cola (
  id         bigint generated always as identity primary key,
  para       text[] not null,
  asunto     text not null,
  html       text not null,
  creado_at  timestamptz not null default now(),
  enviado_at timestamptz,
  intentos   int not null default 0,
  error      text
);
create index on correo_cola (creado_at) where enviado_at is null;
alter table correo_cola enable row level security;
create policy leer_admin on correo_cola for select to authenticated using ((select es_admin()));

-- La Edge Function toma correos pendientes (con su clave de servicio) y luego los marca
create or replace function tomar_correos(p_max int default 20) returns setof correo_cola
language sql security definer set search_path = public as $$
  update correo_cola c set intentos = intentos + 1
   where c.id in (select id from correo_cola where enviado_at is null and intentos < 5
                   order by id limit p_max for update skip locked)
  returning c.*
$$;
create or replace function marcar_correo(p_id bigint, p_error text default null) returns void
language sql security definer set search_path = public as $$
  update correo_cola set enviado_at = case when p_error is null then now() end, error = p_error where id = p_id
$$;
revoke all on function tomar_correos(int), marcar_correo(bigint, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function tomar_correos(int), marcar_correo(bigint, text) to service_role;
  end if;
end $$;

-- 4. Ayudantes -----------------------------------------------------------------------
create or replace function nombre_usuario(p_email text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nombre from perfiles where email = p_email), p_email)
$$;

create or replace function estado_txt(p_tipo text, p_estado text) returns text
language sql stable set search_path = public as $$
  select coalesce((select e->>'t' from solicitud_tipos t, jsonb_array_elements(t.estados) e
                    where t.clave = p_tipo and e->>'k' = p_estado), p_estado)
$$;
create or replace function estado_final(p_tipo text, p_estado text) returns boolean
language sql stable set search_path = public as $$
  select coalesce((select (e->>'final')::boolean from solicitud_tipos t, jsonb_array_elements(t.estados) e
                    where t.clave = p_tipo and e->>'k' = p_estado), false)
$$;

create or replace function producto_solicitado(s solicitudes) returns text
language sql stable set search_path = public as $$
  select case
    when s.producto_id is not null then (select nombre_comercial from productos where id = s.producto_id)
    when s.producto_texto is not null then s.producto_texto || ' (fuera de catálogo)'
    when s.tipo = 'cirugia_oftalmica' then coalesce(s.diagnostico, 'Cirugía oftálmica')
    else (select nombre from solicitud_tipos where clave = s.tipo) || coalesce(' · ' || s.lado, '') end
$$;

-- correo con el formato institucional; enlace directo a la solicitud
create or replace function encolar_correo_solicitud(p_id bigint, p_para text[], p_asunto text, p_mensaje text)
returns void language plpgsql security definer set search_path = public as $$
declare s solicitudes; v_para text[]; v_html text; t solicitud_tipos;
begin
  select array_agg(distinct x) into v_para from unnest(p_para) x where x ~* '^[^@\s]+@[^@\s]+$';
  if v_para is null then return; end if;
  select * into s from solicitudes where id = p_id;
  select * into t from solicitud_tipos where clave = s.tipo;
  v_html := format($h$<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;color:#1f2a44">
  <div style="background:#233152;color:#fff;padding:14px 18px;border-bottom:4px solid #b08a3e">
    <div style="font-size:12px;letter-spacing:.08em;opacity:.85">INABVE · SIGAM</div>
    <div style="font-size:18px;font-weight:700">%s</div></div>
  <div style="padding:16px 18px;border:1px solid #dde2ec;border-top:0">
    <p style="margin:0 0 12px">%s</p>
    <table style="border-collapse:collapse;font-size:14px;width:100%%">
      <tr><td style="padding:4px 0;color:#5b6478;width:140px">Solicitud</td><td><b>%s</b> · %s %s</td></tr>
      <tr><td style="padding:4px 0;color:#5b6478">Beneficiario</td><td>%s · DUI %s</td></tr>
      <tr><td style="padding:4px 0;color:#5b6478">Solicita</td><td>%s</td></tr>
      <tr><td style="padding:4px 0;color:#5b6478">Sede</td><td>%s</td></tr>
      <tr><td style="padding:4px 0;color:#5b6478">Estado</td><td><b>%s</b>%s</td></tr>
      <tr><td style="padding:4px 0;color:#5b6478">Registrada por</td><td>%s · %s</td></tr>
    </table>
    <p style="margin:18px 0 6px"><a href="https://sigam-inabve.netlify.app/#solicitudes?id=%s"
       style="background:#233152;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;display:inline-block">Abrir en SIGAM</a></p>
    <p style="font-size:12px;color:#8a92a6;margin-top:18px">Correo automático de SIGAM-INABVE. No responda a este mensaje.</p>
  </div></div>$h$,
    p_asunto, p_mensaje, s.numero, coalesce(t.icono, ''), t.nombre,
    (select nombre from beneficiarios where dui = s.dui), enmascarar_dui(s.dui),
    producto_solicitado(s) || coalesce(' · ' || trim(to_char(s.cantidad, 'FM999G999D##')) || coalesce(' ' || s.unidad, ''), ''),
    (select nombre from sedes where id = s.sede_id),
    estado_txt(s.tipo, s.estado), case when s.prioridad = 'urgente' then ' · <span style="color:#b3261e">URGENTE</span>' else '' end,
    coalesce(s.creado_nombre, s.creado_por), to_char(s.creado_at at time zone 'America/El_Salvador', 'DD/MM/YYYY HH24:MI'),
    s.id);
  insert into correo_cola (para, asunto, html) values (v_para, p_asunto || ' · ' || s.numero, v_html);
end $$;

create or replace function responsables_de(p_tipo text, p_area text) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(r.email), '{}') from solicitud_responsables r join perfiles p on p.email = r.email
   where r.tipo = p_tipo and r.area = p_area and p.activo
$$;

create or replace function puede_ver_solicitud(p_tipo text, p_creado_por text) returns boolean
language sql stable security definer set search_path = public as $$
  select app_rol() in ('administrador', 'jefatura') or p_creado_por = app_email() or es_responsable(p_tipo)
$$;
create or replace function puede_gestionar_solicitud(p_tipo text) returns boolean
language sql stable security definer set search_path = public as $$
  select es_admin() or es_responsable(p_tipo)
$$;

create or replace function registrar_evento(p_id bigint, p_tipo text, p_ant text, p_nuevo text, p_nota text, p_datos jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into solicitud_eventos (solicitud_id, por, por_nombre, tipo, estado_anterior, estado_nuevo, nota, datos)
  values (p_id, app_email(), nombre_usuario(app_email()), p_tipo, p_ant, p_nuevo, nullif(trim(p_nota), ''), p_datos)
$$;

-- 5. Vista para la app (aplica los permisos; trae los datos del beneficiario) ------------
create or replace view v_solicitudes as
select s.*, t.nombre as tipo_nombre, t.icono, t.lista_espera, t.dias_validar,
       estado_txt(s.tipo, s.estado) as estado_texto, estado_final(s.tipo, s.estado) as es_final,
       b.nombre as beneficiario, b.telefono, b.telefono2, b.sector, b.departamento,
       se.nombre as sede, producto_solicitado(s) as solicita,
       p.codigo as producto_codigo, p.tipo::text as producto_tipo,
       (current_date - (s.creado_at at time zone 'America/El_Salvador')::date) as dias,
       (current_date - (s.estado_at at time zone 'America/El_Salvador')::date) as dias_estado,
       case when t.lista_espera and not estado_final(s.tipo, s.estado) then
         (select count(*) from solicitudes x where x.tipo = s.tipo and x.sede_id = s.sede_id and x.cerrada_at is null
             and (x.prioridad = 'urgente' and s.prioridad = 'normal' or x.prioridad = s.prioridad and x.creado_at <= s.creado_at)) end as posicion,
       nombre_usuario(s.asignado_a) as asignado_nombre
  from solicitudes s
  join solicitud_tipos t on t.clave = s.tipo
  join beneficiarios b on b.dui = s.dui
  join sedes se on se.id = s.sede_id
  left join productos p on p.id = s.producto_id
 where puede_ver_solicitud(s.tipo, s.creado_por);
grant select on v_solicitudes to authenticated;

create or replace view v_solicitud_eventos as
select e.* from solicitud_eventos e join solicitudes s on s.id = e.solicitud_id
 where puede_ver_solicitud(s.tipo, s.creado_por);
grant select on v_solicitud_eventos to authenticated;

-- 6. Beneficiario por DUI (autocompletar) y consulta de solicitudes por DUI ---------------
create or replace function buscar_beneficiario(p_dui text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_dui text := normalizar_dui(p_dui); b beneficiarios;
begin
  perform exigir(app_rol() is not null, 'Sin acceso');
  perform exigir(v_dui ~ '^\d{9}$', 'El DUI debe tener 9 dígitos');
  insert into beneficiario_consultas (dui, por, motivo) values (v_dui, app_email(), 'autocompletar');
  select * into b from beneficiarios where dui = v_dui;
  if not found then return null; end if;
  return jsonb_build_object('dui', b.dui, 'nombre', b.nombre, 'telefono', b.telefono, 'telefono2', b.telefono2,
    'sector', b.sector, 'departamento', b.departamento, 'sede_id', b.sede_id,
    'abiertas', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'numero', s.numero, 'tipo', s.tipo,
        'solicita', producto_solicitado(s), 'producto_id', s.producto_id, 'estado', estado_txt(s.tipo, s.estado),
        'creado_at', s.creado_at) order by s.creado_at desc), '[]')
       from solicitudes s where s.dui = v_dui and s.cerrada_at is null));
end $$;

-- estado de todas las solicitudes de un DUI (Contact Center, médicos): sin teléfonos
create or replace function consultar_solicitudes_dui(p_dui text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_dui text := normalizar_dui(p_dui);
begin
  perform exigir(app_rol() is not null, 'Sin acceso');
  perform exigir(v_dui ~ '^\d{9}$', 'El DUI debe tener 9 dígitos');
  insert into beneficiario_consultas (dui, por, motivo) values (v_dui, app_email(), 'consulta de estado');
  return jsonb_build_object(
    'beneficiario', (select nombre from beneficiarios where dui = v_dui),
    'solicitudes', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'numero', s.numero, 'tipo', t.nombre, 'icono', t.icono,
        'solicita', producto_solicitado(s), 'sede', se.nombre, 'estado', estado_txt(s.tipo, s.estado),
        'final', estado_final(s.tipo, s.estado), 'creado_at', s.creado_at, 'estado_at', s.estado_at,
        'dias', current_date - (s.creado_at at time zone 'America/El_Salvador')::date,
        'posicion', case when t.lista_espera and s.cerrada_at is null then
           (select count(*) from solicitudes x where x.tipo = s.tipo and x.sede_id = s.sede_id and x.cerrada_at is null
               and (x.prioridad = 'urgente' and s.prioridad = 'normal' or x.prioridad = s.prioridad and x.creado_at <= s.creado_at)) end,
        'ultimo', (select e.nota from solicitud_eventos e where e.solicitud_id = s.id and e.nota is not null order by e.at desc limit 1))
        order by s.cerrada_at nulls first, s.creado_at desc), '[]')
       from solicitudes s join solicitud_tipos t on t.clave = s.tipo join sedes se on se.id = s.sede_id where s.dui = v_dui));
end $$;

-- 7. Crear solicitud ------------------------------------------------------------------------
create or replace function area_inicial(p_tipo text, p_modalidad text, p_tiene_evaluacion boolean) returns text
language sql immutable as $$
  select case p_tipo
    when 'medicamento' then case when p_modalidad = 'primera_vez' then 'DSEC' else 'DSIN' end
    when 'insumo' then case when coalesce(p_tiene_evaluacion, false) then 'DSIN' else 'DSEC' end
    else 'DSEC' end
$$;

create or replace function crear_solicitud(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_dui text := normalizar_dui(p->>'dui');
  v_tipo text := p->>'tipo';
  v_prod bigint := nullif(p->>'producto_id', '')::bigint;
  v_texto text := nullif(trim(p->>'producto_texto'), '');
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
    perform exigir(v_prod is not null or v_texto is not null, 'Elija el producto del catálogo o descríbalo si no está');
    if v_prod is not null then
      perform exigir(exists (select 1 from productos where id = v_prod and tipo::text = v_tipo), 'El producto no corresponde al tipo de solicitud');
    end if;
  end if;

  -- duplicado: misma persona, mismo tipo y mismo producto con una solicitud abierta
  select numero into v_dup from solicitudes
   where dui = v_dui and tipo = v_tipo and cerrada_at is null
     and (v_tipo not in ('medicamento', 'insumo') or producto_id = v_prod
          or (v_prod is null and producto_texto is not null and lower(producto_texto) = lower(v_texto)))
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
          v_prod, case when v_prod is null then upper(v_texto) end, nullif(upper(trim(p->>'principio_activo')), ''),
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

-- 8. Validar (aprobar / no procede) ------------------------------------------------------------
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
    perform encolar_correo_solicitud(p_id, responsables_de(s.tipo, 'DSIN') || responsables_de(s.tipo, 'SEGUIMIENTO'),
      'Solicitud aprobada por DSEC', 'DSEC aprobó esta solicitud (' || nombre_usuario(app_email()) || '). Pasa a DSIN para su gestión y entrega.');
  end if;
end $$;

-- 9. Cambiar estado, comentar, asignar, vincular producto ---------------------------------------
create or replace function cambiar_estado_solicitud(p_id bigint, p_estado text, p_nota text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s solicitudes;
begin
  select * into s from solicitudes where id = p_id for update;
  perform exigir(found, 'No existe la solicitud');
  perform exigir(puede_gestionar_solicitud(s.tipo), 'Solo los responsables de este tipo pueden cambiar el estado');
  perform exigir(exists (select 1 from solicitud_tipos t, jsonb_array_elements(t.estados) e where t.clave = s.tipo and e->>'k' = p_estado), 'Estado no válido');
  perform exigir(p_estado <> s.estado, 'La solicitud ya está en ese estado');
  perform exigir(p_estado not in ('no_procede', 'cancelada') or length(trim(coalesce(p_nota, ''))) >= 5, 'Indique el motivo');
  update solicitudes set estado = p_estado, estado_at = now(),
         cerrada_at = case when estado_final(s.tipo, p_estado) then now() end
   where id = p_id;
  perform registrar_evento(p_id, 'estado', s.estado, p_estado, p_nota);
  if estado_final(s.tipo, p_estado) or p_estado in ('lista', 'sin_disponibilidad', 'programada') then
    perform encolar_correo_solicitud(p_id, array[s.creado_por], 'Solicitud: ' || estado_txt(s.tipo, p_estado),
      'La solicitud cambió a <b>' || estado_txt(s.tipo, p_estado) || '</b> (' || nombre_usuario(app_email()) || ').' ||
      coalesce('<br>Comentario: ' || nullif(trim(p_nota), ''), ''));
  end if;
end $$;

create or replace function comentar_solicitud(p_id bigint, p_nota text) returns void
language plpgsql security definer set search_path = public as $$
declare s solicitudes;
begin
  select * into s from solicitudes where id = p_id;
  perform exigir(found and puede_ver_solicitud(s.tipo, s.creado_por), 'No existe la solicitud');
  perform exigir(length(trim(coalesce(p_nota, ''))) >= 2, 'Escriba el comentario');
  perform registrar_evento(p_id, 'comentario', null, null, p_nota);
end $$;

create or replace function asignar_solicitud(p_id bigint, p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare s solicitudes;
begin
  select * into s from solicitudes where id = p_id for update;
  perform exigir(found and puede_gestionar_solicitud(s.tipo), 'Solo los responsables pueden asignar');
  update solicitudes set asignado_a = nullif(p_email, '') where id = p_id;
  perform registrar_evento(p_id, 'asignacion', null, null, 'Seguimiento asignado a ' || coalesce(nombre_usuario(nullif(p_email, '')), 'nadie'));
end $$;

-- producto que no estaba en el catálogo: al agregarlo, se vincula para el aviso de llegada
create or replace function vincular_producto_solicitud(p_id bigint, p_producto bigint) returns void
language plpgsql security definer set search_path = public as $$
declare s solicitudes;
begin
  select * into s from solicitudes where id = p_id for update;
  perform exigir(found and puede_gestionar_solicitud(s.tipo), 'Solo los responsables pueden vincular el producto');
  perform exigir(exists (select 1 from productos where id = p_producto and tipo::text = s.tipo), 'El producto no corresponde al tipo');
  update solicitudes set producto_id = p_producto where id = p_id;
  perform registrar_evento(p_id, 'comentario', null, null,
    'Producto del catálogo vinculado: ' || (select nombre_comercial from productos where id = p_producto) ||
    coalesce(' (antes: ' || s.producto_texto || ')', ''));
end $$;

-- 10. Seguimiento telefónico -----------------------------------------------------------------------
create or replace function registrar_llamada(p_id bigint, p_resultado text, p_nota text default null, p_proximo date default null)
returns void language plpgsql security definer set search_path = public as $$
declare s solicitudes; v_estado text;
begin
  select * into s from solicitudes where id = p_id for update;
  perform exigir(found and puede_gestionar_solicitud(s.tipo), 'Solo los responsables pueden registrar llamadas');
  perform exigir(p_resultado in ('contesto', 'no_contesto', 'numero_equivocado', 'avisado_retirar', 'ya_recibio', 'ya_no_necesita'), 'Resultado no válido');
  v_estado := case p_resultado
    when 'avisado_retirar' then 'avisado'
    when 'ya_recibio' then case when s.tipo = 'cirugia_oftalmica' then 'operado' else 'entregada' end
    when 'ya_no_necesita' then 'cancelada'
    when 'contesto' then case when s.estado = 'registrada' and s.tipo in ('auditivo', 'lentes', 'cirugia_oftalmica') then 'contactado' else s.estado end
    else s.estado end;
  update solicitudes set intentos = intentos + 1, ultimo_contacto_at = now(), ultimo_resultado = p_resultado,
         proximo_contacto = case when estado_final(s.tipo, v_estado) then null
                                 else coalesce(p_proximo, case when p_resultado = 'no_contesto' then current_date + 1 end) end,
         estado = v_estado, estado_at = case when v_estado <> s.estado then now() else estado_at end,
         cerrada_at = case when estado_final(s.tipo, v_estado) then now() end
   where id = p_id;
  perform registrar_evento(p_id, 'llamada', case when v_estado <> s.estado then s.estado end, case when v_estado <> s.estado then v_estado end,
    p_nota, jsonb_build_object('resultado', p_resultado, 'intento', s.intentos + 1, 'proximo', p_proximo));
  if v_estado <> s.estado and estado_final(s.tipo, v_estado) then
    perform encolar_correo_solicitud(p_id, array[s.creado_por], 'Solicitud: ' || estado_txt(s.tipo, v_estado),
      'Según el seguimiento telefónico de ' || nombre_usuario(app_email()) || ', la solicitud quedó como <b>' || estado_txt(s.tipo, v_estado) || '</b>.' ||
      coalesce('<br>Nota: ' || nullif(trim(p_nota), ''), ''));
  end if;
end $$;

-- 11. Llegada del producto y entrega por despacho ---------------------------------------------------
create or replace function solicitudes_llegada_producto() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_sede smallint; v_n int; v_ids bigint[]; r record; v_para text[] := '{}';
begin
  if new.tipo not in ('entrada', 'traslado_recepcion') or new.cantidad <= 0 then return new; end if;
  select sede_id into v_sede from bodegas where id = new.bodega_id and tipo in ('despacho_medicamentos', 'almacen_insumos', 'central');
  if v_sede is null then return new; end if;
  with x as (
    update solicitudes set estado = 'lista', estado_at = now(), producto_disponible_at = now(),
           proximo_contacto = coalesce(proximo_contacto, current_date)
     where producto_id = new.producto_id and sede_id = v_sede and cerrada_at is null
       and estado in ('aprobada', 'en_gestion', 'sin_disponibilidad')
     returning id, estado, creado_por, tipo)
  select count(*), array_agg(id) into v_n, v_ids from x;
  if v_n = 0 then return new; end if;
  insert into solicitud_eventos (solicitud_id, por, por_nombre, tipo, estado_anterior, estado_nuevo, nota)
  select i, app_email(), 'SIGAM', 'llegada', null, 'lista',
         'Llegó ' || (select nombre_comercial from productos where id = new.producto_id) || ' a ' || (select nombre from sedes where id = v_sede) ||
         ' (' || case when new.tipo = 'entrada' then 'factura' else 'traslado recibido' end || ')'
    from unnest(v_ids) i;
  for r in select distinct s.tipo from solicitudes s where s.id = any(v_ids) loop
    v_para := v_para || responsables_de(r.tipo, 'DSIN') || responsables_de(r.tipo, 'SEGUIMIENTO');
  end loop;
  v_para := v_para || array(select distinct s.creado_por from solicitudes s where s.id = any(v_ids));
  perform encolar_correo_solicitud(v_ids[1], v_para,
    'Llegó producto: ' || v_n || ' persona(s) pendiente(s) de entrega',
    'Llegó <b>' || (select nombre_comercial from productos where id = new.producto_id) || '</b> a ' || (select nombre from sedes where id = v_sede) ||
    '. Hay <b>' || v_n || '</b> persona(s) pendiente(s) de entrega; ya aparecen en Seguimiento telefónico para avisarles. Abajo, la primera de la lista.');
  return new;
end $$;
create trigger t_solicitudes_llegada after insert on movimientos for each row execute function solicitudes_llegada_producto();

create or replace function solicitudes_entrega_despacho() returns trigger
language plpgsql security definer set search_path = public as $$
declare sa salidas; r record;
begin
  select * into sa from salidas where id = new.salida_id;
  if sa.dui is null or sa.estado <> 'confirmada' then return new; end if;
  for r in update solicitudes s set estado = 'entregada', estado_at = now(), cerrada_at = now(), salida_id = sa.id
            where s.dui = normalizar_dui(sa.dui) and s.producto_id = new.producto_id and s.cerrada_at is null
              and s.tipo in ('medicamento', 'insumo')
           returning s.id, s.creado_por, s.estado loop
    perform registrar_evento(r.id, 'entrega', null, 'entregada', 'Entregado en el despacho ' || sa.numero);
    perform encolar_correo_solicitud(r.id, array[r.creado_por], 'Solicitud entregada',
      'El producto fue entregado al beneficiario en el despacho <b>' || sa.numero || '</b>.');
  end loop;
  return new;
end $$;
create trigger t_solicitudes_entrega after insert on salida_detalle for each row execute function solicitudes_entrega_despacho();

-- 12. Insignia del menú: lo que me toca --------------------------------------------------------------
create or replace function mis_solicitudes_pendientes() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'validar', (select count(*) from solicitudes s where s.cerrada_at is null and s.estado in ('registrada', 'contactado', 'evaluado')
                   and (es_admin() and not exists (select 1 from solicitud_responsables where tipo = s.tipo and area = s.area)
                        or es_responsable(s.tipo, s.area))),
    'llamar', (select count(*) from solicitudes s where s.cerrada_at is null and s.proximo_contacto <= current_date
                  and (s.asignado_a = app_email() or s.asignado_a is null and es_responsable(s.tipo, 'SEGUIMIENTO'))))
$$;

-- 13. Tablero ------------------------------------------------------------------------------------------
create or replace function tablero_solicitudes(p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform exigir(app_rol() in ('administrador', 'jefatura'), 'Solo administración y jefatura');
  return (with s as (select * from solicitudes where (creado_at at time zone 'America/El_Salvador')::date between p_desde and p_hasta)
  select jsonb_build_object(
    'total', (select count(*) from s),
    'abiertas', (select count(*) from s where cerrada_at is null),
    'urgentes', (select count(*) from s where cerrada_at is null and prioridad = 'urgente'),
    'dias_validar', (select round(avg(extract(epoch from validado_at - creado_at) / 86400)::numeric, 1) from s where validado_at is not null),
    'dias_cerrar', (select round(avg(extract(epoch from cerrada_at - creado_at) / 86400)::numeric, 1) from s where cerrada_at is not null and estado in ('entregada', 'operado')),
    'por_tipo', (select coalesce(jsonb_agg(x order by x.orden), '[]') from (
        select t.nombre clave, t.orden, count(s.id) total, count(s.id) filter (where s.cerrada_at is null) abiertas,
               count(s.id) filter (where s.estado in ('entregada', 'operado')) atendidas
          from solicitud_tipos t left join s on s.tipo = t.clave group by t.clave, t.nombre, t.orden) x),
    'por_estado', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select estado_txt(tipo, estado) clave, count(*) n from s group by 1) x),
    'por_sede', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select se.nombre clave, count(*) n, count(*) filter (where s.cerrada_at is null) abiertas from s join sedes se on se.id = s.sede_id group by 1) x),
    'fuera_catalogo', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select coalesce(principio_activo, producto_texto) clave, count(*) n, count(distinct dui) personas,
               string_agg(distinct producto_texto, ' · ') nombres
          from s where tipo = 'medicamento' and producto_texto is not null group by 1 order by 2 desc limit 15) x),
    'mas_pedidos', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select p.nombre_comercial clave, p.tipo::text tipo, count(*) n, count(distinct s.dui) personas
          from s join productos p on p.id = s.producto_id group by 1, 2 order by 3 desc limit 10) x)));
end $$;

-- permisos de las funciones
revoke all on function buscar_beneficiario(text), consultar_solicitudes_dui(text), crear_solicitud(jsonb), validar_solicitud(bigint, boolean, text),
  cambiar_estado_solicitud(bigint, text, text), comentar_solicitud(bigint, text), asignar_solicitud(bigint, text),
  vincular_producto_solicitud(bigint, bigint), registrar_llamada(bigint, text, text, date), mis_solicitudes_pendientes(),
  tablero_solicitudes(date, date), encolar_correo_solicitud(bigint, text[], text, text), registrar_evento(bigint, text, text, text, text, jsonb)
  from public, anon;
grant execute on function buscar_beneficiario(text), consultar_solicitudes_dui(text), crear_solicitud(jsonb), validar_solicitud(bigint, boolean, text),
  cambiar_estado_solicitud(bigint, text, text), comentar_solicitud(bigint, text), asignar_solicitud(bigint, text),
  vincular_producto_solicitud(bigint, bigint), registrar_llamada(bigint, text, text, date), mis_solicitudes_pendientes(),
  tablero_solicitudes(date, date) to authenticated;
revoke execute on function encolar_correo_solicitud(bigint, text[], text, text), registrar_evento(bigint, text, text, text, text, jsonb) from authenticated;

-- responsables: solo administración los edita
create policy admin_inserta on solicitud_responsables for insert to authenticated with check ((select es_admin()));
create policy admin_borra on solicitud_responsables for delete to authenticated using ((select es_admin()));
