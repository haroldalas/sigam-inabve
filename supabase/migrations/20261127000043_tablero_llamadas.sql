-- Tablero de llamadas (seguimiento telefónico) para administración y jefatura.
create or replace function tablero_llamadas(p_desde date, p_hasta date, p_sede smallint default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_semanal boolean := p_hasta - p_desde > 31; v_hoy date := (now() at time zone 'America/El_Salvador')::date;
begin
  perform exigir(app_rol() in ('administrador', 'jefatura'), 'Solo administración y jefatura');
  return (with ll as (
      select e.*, e.datos->>'resultado' as res, (e.at at time zone 'America/El_Salvador') as loc, s.sede_id, s.dui, s.tipo as tipo_sol
        from solicitud_eventos e join solicitudes s on s.id = e.solicitud_id
       where e.tipo = 'llamada' and (e.at at time zone 'America/El_Salvador')::date between p_desde and p_hasta
         and (p_sede is null or s.sede_id = p_sede)),
    av as (select * from solicitudes where avisado_at is not null and (avisado_at at time zone 'America/El_Salvador')::date between p_desde and p_hasta
                                       and (p_sede is null or sede_id = p_sede)),
    ab as (select * from solicitudes where cerrada_at is null and (p_sede is null or sede_id = p_sede))
  select jsonb_build_object(
    'llamadas', (select count(*) from ll),
    'beneficiarios', (select count(distinct dui) from ll),
    'contestaron', (select count(*) from ll where res not in ('no_contesto', 'numero_equivocado')),
    'no_contesto', (select count(*) from ll where res = 'no_contesto'),
    'equivocado', (select count(*) from ll where res = 'numero_equivocado'),
    'avisados', (select count(*) from av),
    'retiraron', (select count(*) from av where estado in ('entregada', 'en_despacho', 'por_pasar')),
    'no_retiraron', (select count(*) from av where estado in ('retiro_vencido', 'no_retirado')),
    'intentos_promedio', (select round(avg(n), 1) from (select solicitud_id, count(*) n from ll group by 1) x),
    'horas_a_llamar', (select round(avg(extract(epoch from (pl.primera - ev.at)) / 3600)::numeric, 1)
                         from (select solicitud_id, min(at) at from solicitud_eventos where estado_nuevo = 'lista' group by 1) ev
                         join (select solicitud_id, min(at) primera from solicitud_eventos where tipo = 'llamada' group by 1) pl using (solicitud_id)
                         join solicitudes s on s.id = ev.solicitud_id
                        where pl.primera >= ev.at and (pl.primera at time zone 'America/El_Salvador')::date between p_desde and p_hasta
                          and (p_sede is null or s.sede_id = p_sede)),
    'por_resultado', (select coalesce(jsonb_agg(jsonb_build_object('clave', t, 'n', n) order by n desc), '[]') from (
        select case res when 'contesto' then 'Contestó' when 'no_contesto' then 'No contestó' when 'numero_equivocado' then 'Número equivocado'
                        when 'avisado_retirar' then 'Avisado: pasará a retirar' when 'ya_recibio' then 'Ya lo recibió'
                        when 'ya_no_necesita' then 'Ya no lo necesita' else coalesce(res, 'Otro') end t, count(*) n from ll group by 1) x),
    'serie', (select coalesce(jsonb_agg(x order by x.periodo), '[]') from (
        select g::date periodo, to_char(g, 'DD/MM') et,
               (select count(*) from ll where date_trunc(case when v_semanal then 'week' else 'day' end, ll.loc) = g) llamadas,
               (select count(*) from ll where date_trunc(case when v_semanal then 'week' else 'day' end, ll.loc) = g and res not in ('no_contesto', 'numero_equivocado')) contestaron
          from generate_series(date_trunc(case when v_semanal then 'week' else 'day' end, p_desde::timestamp),
                               date_trunc(case when v_semanal then 'week' else 'day' end, least(p_hasta, v_hoy)::timestamp),
                               case when v_semanal then interval '1 week' else interval '1 day' end) g) x),
    'por_persona', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select coalesce(por_nombre, por) clave, count(*) n,
               count(*) filter (where res not in ('no_contesto', 'numero_equivocado')) contestaron,
               count(*) filter (where res = 'avisado_retirar' or estado_nuevo = 'avisado') avisados
          from ll group by 1) x),
    'por_sede', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select coalesce(se.nombre, 'Sin sede') clave, count(*) n from ll left join sedes se on se.id = ll.sede_id group by 1) x),
    'por_tipo', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
        select t.nombre clave, count(*) n from ll join solicitud_tipos t on t.clave = ll.tipo_sol group by 1) x),
    'hoy', jsonb_build_object(
        'por_llamar', (select count(*) from ab where estado = 'lista' or proximo_contacto <= v_hoy),
        'sin_contacto', (select count(*) from ab where intentos >= 3 and ultimo_resultado in ('no_contesto', 'numero_equivocado')),
        'esperando', (select count(*) from ab where estado = 'avisado'),
        'por_vencer', (select count(*) from ab where estado = 'avisado' and dias_habiles_restantes(retiro_limite) <= 2),
        'vencidos', (select count(*) from ab where estado = 'retiro_vencido'))
  ));
end $$;
revoke all on function tablero_llamadas(date, date, smallint) from public, anon;
grant execute on function tablero_llamadas(date, date, smallint) to authenticated;
