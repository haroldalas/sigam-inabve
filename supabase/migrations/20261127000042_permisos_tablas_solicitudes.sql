-- En Supabase las tablas nuevas de solicitudes no tenían permiso de tabla para "authenticated" (solo políticas RLS):
-- Solicitudes, Seguimiento telefónico, CEFAFA, Estados y Administración respondían "No tiene permiso".
-- Las políticas RLS siguen decidiendo quién ve o cambia qué (escritura solo administración).
grant select on solicitud_tipos, cefafa_config to authenticated;
grant select, insert, delete on solicitud_responsables, feriados to authenticated;
grant usage on sequence solicitud_responsables_id_seq to authenticated;
