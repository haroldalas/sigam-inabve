-- 1. Seguimiento telefónico por usuario (administración lo marca en Administración → Usuarios).
--    Quien lo tiene llama a los beneficiarios de SU sede (medicamentos e insumos).
-- 2. Cualquier usuario activo (Contact Center, médicos, todos) ve todas las solicitudes y su estado.
-- 3. Cualquier usuario puede avisar a administración que el beneficiario llegó y el producto está en Reservas.
-- 4. Entrada de factura a Bodega Central con personas esperando ese producto → aviso para trasladarlo a Reservas.
-- 5. Tablero de solicitudes ampliado (gráficos para jefaturas).

alter table perfiles add column if not exists seguimiento boolean not null default false;
-- conserva lo de hoy: dependientes de las regionales y Wendy Hernández (JPII)
update perfiles set seguimiento = true
 where activo and (rol = 'dependiente' and sede_id <> 1 or email = 'wendy.hernandez@inabve.gob.sv');

create or replace function app_seguimiento() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select seguimiento from perfiles where id = auth.uid() and activo), false)
$$;

create or replace function puede_dar_seguimiento(p_tipo text, p_sede smallint) returns boolean
language sql stable security definer set search_path = public as $$
  select es_admin()
      or es_responsable(p_tipo, 'DSIN')
      or (p_tipo in ('medicamento', 'insumo') and app_seguimiento() and app_sede() = p_sede)
$$;

create or replace function seguimiento_de(p_tipo text, p_sede smallint) returns text[]
language sql stable security definer set search_path = public as $$
  select array(select email from perfiles where activo and seguimiento and sede_id = p_sede and p_tipo in ('medicamento', 'insumo'))
$$;

-- todos los usuarios activos ven las solicitudes; gestionar sigue siendo de responsables
create or replace function puede_ver_solicitud(p_tipo text, p_creado_por text) returns boolean
language sql stable security definer set search_path = public as $$
  select app_rol() is not null
$$;

-- aviso "llegó a retirar": cualquier usuario activo (médico, Contact Center, quien llama)
create or replace function solicitar_pase_despacho(p_id bigint, p_nota text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s solicitudes;
begin
  select * into s from solicitudes where id = p_id for update;
  perform exigir(found and s.estado in ('lista', 'avisado'), 'Solo se avisa lo que ya llegó a la sede y espera retiro');
  perform exigir(app_rol() is not null, 'Sin acceso');
  update solicitudes set estado = 'por_pasar', estado_at = now() where id = p_id;
  perform registrar_evento(p_id, 'estado', s.estado, 'por_pasar', coalesce(nullif(trim(p_nota), ''), 'El beneficiario llegó a retirar'));
  perform encolar_correo_solicitud(p_id, array(select email from perfiles where activo and rol = 'administrador'),
    'Llegó a retirar: pasar a Despacho · ' || (select nombre from sedes where id = s.sede_id),
    nombre_usuario(app_email()) || ' avisa que el beneficiario llegó a retirar <b>' || producto_solicitado(s) || '</b> × ' || coalesce(s.cantidad::text, '') ||
    ' en ' || (select nombre from sedes where id = s.sede_id) || '. Está en Reservas (fuera de SIVET): páselo a Despacho en SIGAM ' ||
    '(Seguimiento telefónico → Por pasar a Despacho) y regístrelo en SIVET para que se le pueda despachar.' ||
    coalesce('<br>Nota: ' || nullif(trim(p_nota), ''), ''));
end $$;

-- existencia del producto de la solicitud en su sede, por bodega (para que el médico confirme si está)
create or replace function disponibilidad_solicitud(p_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('tipo', b.tipo, 'bodega', b.nombre, 'cantidad', x.cant) order by b.tipo), '[]')
    from (select l.bodega_id, sum(l.disponible) cant
            from solicitudes s join lotes l on l.producto_id = s.producto_id
            join bodegas b on b.id = l.bodega_id and b.sede_id = s.sede_id
           where s.id = p_id and app_rol() is not null and l.disponible > 0 and l.estado = 'activo'
             and b.tipo in ('despacho_medicamentos', 'almacen_insumos', 'reservas')
           group by l.bodega_id) x
    join bodegas b on b.id = x.bodega_id
$$;

-- consulta por DUI: agrega la clave del estado para que la pantalla oriente al médico
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
        'solicita', producto_solicitado(s), 'sede', se.nombre, 'estado', estado_txt(s.tipo, s.estado), 'estado_k', s.estado,
        'final', estado_final(s.tipo, s.estado), 'creado_at', s.creado_at, 'estado_at', s.estado_at, 'retiro_limite', s.retiro_limite,
        'dias', current_date - (s.creado_at at time zone 'America/El_Salvador')::date,
        'posicion', case when t.lista_espera and s.cerrada_at is null then
           (select count(*) from solicitudes x where x.tipo = s.tipo and x.sede_id = s.sede_id and x.cerrada_at is null
               and (x.prioridad = 'urgente' and s.prioridad = 'normal' or x.prioridad = s.prioridad and x.creado_at <= s.creado_at)) end,
        'ultimo', (select e.nota from solicitud_eventos e where e.solicitud_id = s.id and e.nota is not null order by e.at desc limit 1))
        order by s.cerrada_at nulls first, s.creado_at desc), '[]')
       from solicitudes s join solicitud_tipos t on t.clave = s.tipo join sedes se on se.id = s.sede_id where s.dui = v_dui));
end $$;

-- llegó a Bodega Central algo que esperan beneficiarios: trasladarlo a Reservas de su sede
create or replace function por_reservar() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.producto, x.sede), '[]') from (
    select p.id as producto_id, p.codigo, p.nombre_comercial as producto, se.id as sede_id, se.nombre as sede,
           count(*) as personas, sum(coalesce(s.cantidad, 0)) as cantidad,
           (select coalesce(sum(l.disponible), 0) from lotes l join bodegas b on b.id = l.bodega_id
             where l.producto_id = p.id and b.tipo = 'central' and l.estado = 'activo') as en_central,
           (select string_agg(numero, ', ' order by s2.creado_at) from solicitudes s2
             where s2.producto_id = p.id and s2.sede_id = se.id and s2.cerrada_at is null and s2.estado in ('aprobada', 'en_gestion', 'sin_disponibilidad')) as numeros
      from solicitudes s join productos p on p.id = s.producto_id join sedes se on se.id = s.sede_id
     where es_admin() and s.cerrada_at is null and s.estado in ('aprobada', 'en_gestion', 'sin_disponibilidad')
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
   where s.producto_id = new.producto_id and s.cerrada_at is null and s.estado in ('aprobada', 'en_gestion', 'sin_disponibilidad');
  if v_n = 0 then return new; end if;
  -- un solo aviso por producto y día
  if exists (select 1 from correo_cola where asunto like 'Por reservar: ' || (select nombre_comercial from productos where id = new.producto_id) || '%'
             and creado_at > now() - interval '12 hours') then return new; end if;
  perform encolar_correo_solicitud(
    (select id from solicitudes where producto_id = new.producto_id and cerrada_at is null and estado in ('aprobada', 'en_gestion', 'sin_disponibilidad') order by creado_at limit 1),
    array(select email from perfiles where activo and rol = 'administrador'),
    'Por reservar: ' || (select nombre_comercial from productos where id = new.producto_id) || ' · ' || v_n || ' persona(s) esperando',
    'Entró <b>' || (select nombre_comercial from productos where id = new.producto_id) || '</b> a la Bodega Central y hay <b>' || v_n ||
    '</b> persona(s) esperándolo (' || v_html || '). Trasládelo a la bodega Reservas de solicitudes de cada sede; al recibirlo, quien hace seguimiento ' ||
    'les llamará y empezarán a correr los 7 días hábiles. Lo ve también en Seguimiento telefónico → Por reservar.');
  return new;
end $$;
drop trigger if exists t_solicitudes_entrada_central on movimientos;
create trigger t_solicitudes_entrada_central after insert on movimientos for each row execute function solicitudes_entrada_central();

-- insignias: agrega "por reservar" para administración y usa el permiso por usuario para "llamar"
create or replace function mis_solicitudes_pendientes() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'validar', (select count(*) from solicitudes s where s.cerrada_at is null and s.estado in ('registrada', 'contactado', 'evaluado')
                   and (es_admin() and not exists (select 1 from solicitud_responsables where tipo = s.tipo and area = s.area)
                        or es_responsable(s.tipo, s.area))),
    'llamar', (select count(*) from solicitudes s where s.cerrada_at is null
                  and (s.estado = 'lista' or s.proximo_contacto <= current_date and s.estado not in ('avisado', 'por_pasar', 'en_despacho', 'retiro_vencido'))
                  and (s.asignado_a = app_email()
                       or s.asignado_a is null and not es_admin() and s.tipo in ('medicamento', 'insumo') and app_seguimiento() and app_sede() = s.sede_id)),
    'pasar', (select count(*) from solicitudes s where es_admin() and s.estado in ('por_pasar', 'retiro_vencido')),
    'sivet', (select jsonb_array_length(traslados_pendientes_sivet())),
    'reservar', (select jsonb_array_length(por_reservar())))
$$;

-- tablero ampliado (administración y jefatura); p_sede opcional
drop function if exists tablero_solicitudes(date, date);
create or replace function tablero_solicitudes(p_desde date, p_hasta date, p_sede smallint default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_semanal boolean := p_hasta - p_desde <= 120;
begin
  perform exigir(app_rol() in ('administrador', 'jefatura'), 'Solo administración y jefatura');
  return (with s as (select * from solicitudes where (creado_at at time zone 'America/El_Salvador')::date between p_desde and p_hasta
                                                and (p_sede is null or sede_id = p_sede)),
               abiertas as (select * from solicitudes where cerrada_at is null and (p_sede is null or sede_id = p_sede))
  select jsonb_build_object(
    'total', (select count(*) from s),
    'abiertas', (select count(*) from abiertas),
    'urgentes', (select count(*) from abiertas where prioridad = 'urgente'),
    'atendidas', (select count(*) from s where estado in ('entregada', 'operado')),
    'dias_validar', (select round(avg(extract(epoch from validado_at - creado_at) / 86400)::numeric, 1) from s where validado_at is not null),
    'dias_cerrar', (select round(avg(extract(epoch from cerrada_at - creado_at) / 86400)::numeric, 1) from s where cerrada_at is not null and estado in ('entregada', 'operado')),
    'semanal', v_semanal,
    'serie', (select coalesce(jsonb_agg(x order by x.periodo), '[]') from (
        select g::date as periodo,
               to_char(g, case when v_semanal then 'DD/MM' else 'TMmon YY' end) as et,
               (select count(*) from s where date_trunc(case when v_semanal then 'week' else 'month' end, (s.creado_at at time zone 'America/El_Salvador')) = g) as registradas,
               (select count(*) from solicitudes c where (p_sede is null or c.sede_id = p_sede) and c.estado in ('entregada', 'operado')
                   and date_trunc(case when v_semanal then 'week' else 'month' end, (c.cerrada_at at time zone 'America/El_Salvador')) = g) as atendidas
          from generate_series(date_trunc(case when v_semanal then 'week' else 'month' end, p_desde::timestamp),
                               p_hasta::timestamp, case when v_semanal then interval '1 week' else interval '1 month' end) g) x),
    'por_tipo', (select coalesce(jsonb_agg(x order by x.orden), '[]') from (
        select t.nombre clave, t.orden, count(s.id) n, count(s.id) filter (where s.cerrada_at is null) abiertas,
               count(s.id) filter (where s.estado in ('entregada', 'operado')) atendidas,
               round(avg(extract(epoch from s.cerrada_at - s.creado_at) / 86400) filter (where s.estado in ('entregada', 'operado'))::numeric, 1) dias
          from solicitud_tipos t left join s on s.tipo = t.clave group by t.clave, t.nombre, t.orden) x),
    'por_estado', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select estado_txt(tipo, estado) clave, count(*) n from abiertas group by 1) x),
    'por_sede', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select se.nombre clave, count(*) n, count(*) filter (where s.cerrada_at is null) abiertas from s join sedes se on se.id = s.sede_id group by 1) x),
    'por_sector', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select coalesce(b.sector, 'Sin dato') clave, count(*) n from s join beneficiarios b on b.dui = s.dui group by 1) x),
    'por_origen', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select case origen when 'llamada' then 'Llamada' when 'consulta' then 'Consulta médica' when 'jornada' then 'Jornada'
                           when 'referencia_hmc' then 'Referencia HMC' else 'Otro' end clave, count(*) n from s group by 1) x),
    'por_departamento', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select coalesce(b.departamento, 'Sin dato') clave, count(*) n from s join beneficiarios b on b.dui = s.dui group by 1 order by 2 desc limit 14) x),
    'antiguedad', (select coalesce(jsonb_agg(x order by x.o), '[]') from (
        select case when d <= 7 then 'Hasta 7 días' when d <= 30 then '8 a 30 días' when d <= 60 then '31 a 60 días' else 'Más de 60 días' end clave,
               case when d <= 7 then 1 when d <= 30 then 2 when d <= 60 then 3 else 4 end o, count(*) n
          from (select current_date - (creado_at at time zone 'America/El_Salvador')::date d from abiertas) a group by 1, 2) x),
    'retiro', (select jsonb_build_object(
        'avisados', count(*) filter (where avisado_at is not null),
        'retiraron', count(*) filter (where avisado_at is not null and estado = 'entregada'),
        'no_retiraron', count(*) filter (where estado = 'no_retirado'),
        'esperando', count(*) filter (where estado = 'avisado'),
        'por_pasar', count(*) filter (where estado in ('por_pasar', 'retiro_vencido')))
        from solicitudes where (p_sede is null or sede_id = p_sede) and tipo in ('medicamento', 'insumo')),
    'fuera_catalogo', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select coalesce(principio_activo, producto_texto) clave, count(*) n, count(distinct dui) personas
          from s where tipo in ('medicamento', 'insumo') and producto_id is null and producto_texto is not null group by 1 order by 2 desc limit 10) x),
    'mas_pedidos', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select p.nombre_comercial clave, p.tipo::text tipo, count(*) n, count(distinct s.dui) personas, sum(coalesce(s.cantidad, 0)) unidades
          from s join productos p on p.id = s.producto_id group by 1, 2 order by 3 desc limit 10) x),
    'diagnosticos', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select diagnostico clave, count(*) n from s where tipo in ('cirugia_oftalmica', 'auditivo', 'lentes') and diagnostico is not null
         group by 1 order by 2 desc limit 8) x)));
end $$;

grant execute on function app_seguimiento(), disponibilidad_solicitud(bigint), por_reservar(), tablero_solicitudes(date, date, smallint),
  solicitar_pase_despacho(bigint, text), consultar_solicitudes_dui(text) to authenticated;
