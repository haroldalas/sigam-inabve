-- =============================================================================
-- SIGAM-INABVE · Migración 9: recomendaciones del asesor de rendimiento de Supabase
--   · índices para llaves foráneas sin índice
--   · políticas de escritura separadas por acción (la lectura evalúa una sola política)
-- =============================================================================
create index on ajustes (producto_id);
create index on devoluciones (producto_id);
create index on perfiles (sede_id);
create index on traslado_diferencias (producto_id);
create index on traslado_diferencias (traslado_detalle_id);

drop policy admin_escribe on sedes;
create policy admin_inserta on sedes for insert to authenticated with check ((select es_admin()));
create policy admin_modifica on sedes for update to authenticated using ((select es_admin())) with check ((select es_admin()));
create policy admin_elimina on sedes for delete to authenticated using ((select es_admin()));
drop policy admin_escribe on familias;
create policy admin_inserta on familias for insert to authenticated with check ((select es_admin()));
create policy admin_modifica on familias for update to authenticated using ((select es_admin())) with check ((select es_admin()));
create policy admin_elimina on familias for delete to authenticated using ((select es_admin()));
drop policy admin_escribe on productos;
create policy admin_inserta on productos for insert to authenticated with check ((select es_admin()));
create policy admin_modifica on productos for update to authenticated using ((select es_admin())) with check ((select es_admin()));
create policy admin_elimina on productos for delete to authenticated using ((select es_admin()));
drop policy admin_escribe on proveedores;
create policy admin_inserta on proveedores for insert to authenticated with check ((select es_admin()));
create policy admin_modifica on proveedores for update to authenticated using ((select es_admin())) with check ((select es_admin()));
create policy admin_elimina on proveedores for delete to authenticated using ((select es_admin()));
drop policy admin_escribe on contratos;
create policy admin_inserta on contratos for insert to authenticated with check ((select es_admin()));
create policy admin_modifica on contratos for update to authenticated using ((select es_admin())) with check ((select es_admin()));
create policy admin_elimina on contratos for delete to authenticated using ((select es_admin()));
drop policy admin_escribe on bodegas;
create policy admin_inserta on bodegas for insert to authenticated with check ((select es_admin()));
create policy admin_modifica on bodegas for update to authenticated using ((select es_admin())) with check ((select es_admin()));
create policy admin_elimina on bodegas for delete to authenticated using ((select es_admin()));
drop policy admin_escribe on parametros;
create policy admin_inserta on parametros for insert to authenticated with check ((select es_admin()));
create policy admin_modifica on parametros for update to authenticated using ((select es_admin())) with check ((select es_admin()));
create policy admin_elimina on parametros for delete to authenticated using ((select es_admin()));
drop policy admin_escribe on stock_minimo;
create policy admin_inserta on stock_minimo for insert to authenticated with check ((select es_admin()));
create policy admin_modifica on stock_minimo for update to authenticated using ((select es_admin())) with check ((select es_admin()));
create policy admin_elimina on stock_minimo for delete to authenticated using ((select es_admin()));
drop policy admin_gestiona on perfiles;
create policy admin_inserta on perfiles for insert to authenticated with check ((select es_admin()));
create policy admin_modifica on perfiles for update to authenticated using ((select es_admin())) with check ((select es_admin()));
create policy admin_elimina on perfiles for delete to authenticated using ((select es_admin()));
