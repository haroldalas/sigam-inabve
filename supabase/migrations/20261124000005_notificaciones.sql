-- =============================================================================
-- SIGAM-INABVE · Migración 5: notificaciones por sede
--   · Vencimiento: vencido / crítico (≤ 90 días) / por vencer (≤ 180 días)
--   · Abastecimiento: agotado / por agotarse (según consumo de 30 días o mínimo definido)
-- =============================================================================

insert into parametros values
  ('dias_cobertura_minima', '30', 'Por agotarse: la existencia alcanza para menos de estos días según el consumo de 30 días'),
  ('dias_cobertura_critica', '15', 'Crítico: la existencia alcanza para menos de estos días')
on conflict (clave) do nothing;

-- Mínimo opcional por producto y sede (si se define, manda sobre el cálculo por consumo)
create table stock_minimo (
  producto_id bigint not null references productos(id),
  sede_id     smallint not null references sedes(id),
  minimo      numeric(14,2) not null check (minimo >= 0),
  actualizado_por text,
  actualizado_at  timestamptz not null default now(),
  primary key (producto_id, sede_id)
);
create index on stock_minimo (sede_id);
alter table stock_minimo enable row level security;
create policy leer on stock_minimo for select to authenticated using ((select app_rol()) is not null);
create policy admin_escribe on stock_minimo for all to authenticated
  using ((select es_admin())) with check ((select es_admin()));
grant select, insert, update, delete on stock_minimo to authenticated;

create or replace function parametro_num(p_clave text, p_defecto numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select valor::numeric from parametros where clave = p_clave), p_defecto)
$$;
grant execute on function parametro_num(text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Vencimientos (por lote)
-- ---------------------------------------------------------------------------
create or replace view v_notif_vencimiento with (security_invoker = true) as
select case when l.fecha_vencimiento < hoy() then 'vencido'
            when l.fecha_vencimiento - hoy() <= parametro_num('dias_criticos_vencimiento', 90) then 'critico'
            else 'por_vencer' end as nivel,
       s.id as sede_id, s.nombre as sede, b.id as bodega_id, b.nombre as bodega, b.tipo as tipo_bodega,
       p.id as producto_id, p.codigo, p.nombre_comercial, p.principio_activo, p.presentacion, p.tipo,
       l.id as lote_id, l.numero_lote, l.fecha_vencimiento, (l.fecha_vencimiento - hoy()) as dias_para_vencer,
       l.disponible, round(l.disponible * l.precio_unitario, 2) as valor, pr.nombre as proveedor
  from lotes l
  join productos p on p.id = l.producto_id
  join bodegas b on b.id = l.bodega_id
  join sedes s on s.id = b.sede_id
  left join proveedores pr on pr.id = l.proveedor_id
 where l.disponible > 0 and l.estado in ('activo','bloqueado','cuarentena')
   and l.fecha_vencimiento is not null
   and l.fecha_vencimiento - hoy() <= parametro_num('dias_alerta_vencimiento', 180)
   and b.tipo <> 'descarte';

-- ---------------------------------------------------------------------------
-- Abastecimiento (por producto y sede; suma las bodegas operativas de la sede)
-- ---------------------------------------------------------------------------
create or replace view v_notif_abastecimiento with (security_invoker = true) as
with disp as (
  select b.sede_id, l.producto_id, sum(l.disponible) as disponible
    from lotes l join bodegas b on b.id = l.bodega_id
   where l.estado = 'activo' and l.disponible > 0 and b.tipo <> 'descarte'
     and (l.fecha_vencimiento is null or l.fecha_vencimiento >= hoy())
   group by 1, 2),
cons as (
  select b.sede_id, sd.producto_id, sum(sd.cantidad) as consumo_30d
    from salida_detalle sd join salidas s on s.id = sd.salida_id join bodegas b on b.id = s.bodega_id
   where s.estado = 'confirmada' and s.fecha >= hoy() - 30
   group by 1, 2),
transito as (
  select b.sede_id, d.producto_id, sum(d.cantidad_enviada) as en_transito
    from traslado_detalle d join traslados t on t.id = d.traslado_id join bodegas b on b.id = t.bodega_destino_id
   where t.estado = 'enviado' group by 1, 2),
central as (
  select l.producto_id, sum(l.disponible) as disponible from lotes l join bodegas b on b.id = l.bodega_id
   where b.tipo = 'central' and l.estado = 'activo' and l.disponible > 0 group by 1),
base as (
  select sede_id, producto_id from cons
  union select sede_id, producto_id from stock_minimo),
calc as (
  select base.sede_id, base.producto_id, coalesce(d.disponible, 0) as disponible,
         coalesce(c.consumo_30d, 0) as consumo_30d, coalesce(t.en_transito, 0) as en_transito,
         m.minimo,
         case when coalesce(c.consumo_30d, 0) > 0
              then round(coalesce(d.disponible, 0) / (c.consumo_30d / 30.0), 1) end as dias_cobertura
    from base
    left join disp d on d.sede_id = base.sede_id and d.producto_id = base.producto_id
    left join cons c on c.sede_id = base.sede_id and c.producto_id = base.producto_id
    left join transito t on t.sede_id = base.sede_id and t.producto_id = base.producto_id
    left join stock_minimo m on m.sede_id = base.sede_id and m.producto_id = base.producto_id)
select case when calc.disponible = 0 then 'agotado'
            when calc.minimo is not null and calc.disponible <= calc.minimo / 2 then 'critico'
            when calc.minimo is not null and calc.disponible <= calc.minimo then 'por_agotarse'
            when calc.minimo is null and calc.dias_cobertura < parametro_num('dias_cobertura_critica', 15) then 'critico'
            else 'por_agotarse' end as nivel,
       s.id as sede_id, s.nombre as sede, p.id as producto_id, p.codigo, p.nombre_comercial, p.principio_activo,
       p.presentacion, p.tipo, calc.disponible, calc.en_transito, calc.consumo_30d,
       round(calc.consumo_30d / 30.0, 2) as consumo_diario, calc.dias_cobertura, calc.minimo,
       -- sugerencia para cubrir 60 días de consumo
       greatest(ceil(calc.consumo_30d * 2 - calc.disponible - calc.en_transito), 0) as sugerido_60_dias,
       coalesce(ce.disponible, 0) as disponible_central
  from calc
  left join central ce on ce.producto_id = calc.producto_id
  join sedes s on s.id = calc.sede_id
  join productos p on p.id = calc.producto_id
 where p.activo
   and (calc.disponible = 0
        or (calc.minimo is not null and calc.disponible <= calc.minimo)
        or (calc.minimo is null and calc.dias_cobertura < parametro_num('dias_cobertura_minima', 30)));

-- Conteos para las insignias del menú y el tablero por sede (cada vista se calcula una sola vez)
create or replace view v_notif_resumen with (security_invoker = true) as
with v as (select sede_id, nivel, count(*) n from v_notif_vencimiento group by 1, 2),
     a as (select sede_id, nivel, count(*) n from v_notif_abastecimiento group by 1, 2)
select s.id as sede_id, s.nombre as sede,
       coalesce(sum(v.n) filter (where v.nivel = 'vencido'), 0)    as vencidos,
       coalesce(sum(v.n) filter (where v.nivel = 'critico'), 0)    as vencen_90_dias,
       coalesce(sum(v.n) filter (where v.nivel = 'por_vencer'), 0) as vencen_180_dias,
       coalesce((select sum(n) from a where a.sede_id = s.id and a.nivel = 'agotado'), 0)      as agotados,
       coalesce((select sum(n) from a where a.sede_id = s.id and a.nivel = 'critico'), 0)      as cobertura_critica,
       coalesce((select sum(n) from a where a.sede_id = s.id and a.nivel = 'por_agotarse'), 0) as por_agotarse
  from sedes s left join v on v.sede_id = s.id
 where s.activa
 group by s.id, s.nombre
 order by s.id;

grant select on v_notif_vencimiento, v_notif_abastecimiento, v_notif_resumen to authenticated;
revoke execute on function parametro_num(text, numeric) from public, anon;
revoke all on all tables in schema public from anon;
