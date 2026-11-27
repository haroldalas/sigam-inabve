// SIGAM-INABVE · Envía los correos pendientes de correo_cola por SMTP de Gmail.
// Secretos (Supabase → Edge Functions → Secrets): GMAIL_USER, GMAIL_APP_PASSWORD.
// No recibe datos: solo vacía la cola, así que llamarla de más no hace daño.
// La llaman la app (después de crear/validar/cambiar una solicitud) y pg_cron cada 5 minutos.
import nodemailer from 'npm:nodemailer@6.9.16';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const usuario = Deno.env.get('GMAIL_USER');
  const clave = Deno.env.get('GMAIL_APP_PASSWORD');
  if (!usuario || !clave) {
    return Response.json({ error: 'Faltan los secretos GMAIL_USER y GMAIL_APP_PASSWORD' }, { status: 500, headers: cors });
  }
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const transporte = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: usuario, pass: clave.replace(/\s+/g, '') },
  });

  let enviados = 0, fallidos = 0;
  for (let vuelta = 0; vuelta < 5; vuelta++) {           // hasta 100 correos por llamada
    const { data: lote, error } = await sb.rpc('tomar_correos', { p_max: 20 });
    if (error) return Response.json({ error: error.message }, { status: 500, headers: cors });
    if (!lote?.length) break;
    for (const c of lote) {
      try {
        await transporte.sendMail({
          from: `"SIGAM-INABVE" <${usuario}>`,
          to: c.para.join(', '),
          subject: c.asunto,
          html: c.html,
        });
        await sb.rpc('marcar_correo', { p_id: c.id, p_error: null });
        enviados++;
      } catch (e) {
        await sb.rpc('marcar_correo', { p_id: c.id, p_error: String(e?.message || e).slice(0, 500) });
        fallidos++;
      }
    }
  }
  return Response.json({ enviados, fallidos }, { headers: cors });
});
