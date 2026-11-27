-- =============================================================================
-- SIGAM-INABVE · 031 · Envío de correos cada 5 minutos (respaldo de la app)
-- pg_cron llama a la Edge Function enviar-correos, que solo vacía correo_cola.
-- =============================================================================
create extension if not exists pg_net;
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'sigam-enviar-correos';
select cron.schedule('sigam-enviar-correos', '*/5 * * * *', $$
  select net.http_post(url := 'https://jlskootxwfadjmnqradb.supabase.co/functions/v1/enviar-correos',
                       headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb)
   where exists (select 1 from public.correo_cola where enviado_at is null and intentos < 5)
$$);
