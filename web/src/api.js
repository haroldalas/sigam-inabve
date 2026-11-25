// SIGAM-INABVE · conexión con Supabase, sesión y modo sin conexión
import { createClient } from '@supabase/supabase-js';
import { get, set, del, keys } from 'idb-keyval';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_KEY;

export const sb = createClient(URL, KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', debug: import.meta.env.VITE_AUTH_DEBUG === '1' },
});

export const estado = {
  perfil: null,      // fila de perfiles del usuario
  sedes: [],
  bodegas: [],       // visibles para el usuario
  enLinea: navigator.onLine,
};

// ---------------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------------
export async function iniciarSesionMicrosoft() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'azure',
    options: { scopes: 'email openid profile', redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
}

// Correo institucional + contraseña (mientras Informática registra SIGAM en Microsoft Entra ID)
export const DOMINIO = '@inabve.gob.sv';
export const correoInstitucional = u => {
  const e = String(u || '').trim().toLowerCase().replace(/@.*$/, '');
  return e ? e + DOMINIO : '';
};
const MENSAJES_AUTH = [
  [/invalid login credentials/i, 'Correo o contraseña incorrectos'],
  [/already (been )?registered|already exists/i, 'Ya existe una cuenta con ese correo. Entre con su contraseña; si usted no la creó, avise a un administrador.'],
  [/database error saving new user/i, 'Solo se permiten cuentas institucionales @inabve.gob.sv'],
  [/password should be at least/i, 'La contraseña es muy corta'],
  [/rate limit|too many/i, 'Demasiados intentos. Espere unos minutos y vuelva a intentar.'],
  [/email not confirmed/i, 'Su correo aún no está confirmado'],
];
const errorAuth = e => { const m = MENSAJES_AUTH.find(([r]) => r.test(e?.message || '')); return m ? new Error(m[1]) : e; };

export async function entrarConClave(usuario, clave) {
  const email = correoInstitucional(usuario);
  const { error } = await sb.auth.signInWithPassword({ email, password: clave });
  if (error) throw errorAuth(error);
}

export async function crearCuenta(usuario, clave, nombre) {
  const email = correoInstitucional(usuario);
  const { data, error } = await sb.auth.signUp({ email, password: clave, options: { data: { full_name: nombre.trim() } } });
  if (error) throw errorAuth(error);
  return !!data.session;          // false: hay que confirmar el correo antes de entrar
}

export async function cambiarClave(clave) {
  const { error } = await sb.auth.updateUser({ password: clave });
  if (error) throw errorAuth(error);
  const { error: e2 } = await sb.rpc('clave_cambiada');
  if (e2) throw e2;
}

export async function cerrarSesion() {
  await sb.auth.signOut();
  estado.perfil = null;
  location.hash = '';
  location.reload();
}

export async function cargarPerfil() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const email = session.user.email?.toLowerCase();
  if (!/@inabve\.gob\.sv$/.test(email || '')) {
    await sb.auth.signOut();
    throw new Error('Solo se permiten cuentas institucionales @inabve.gob.sv');
  }
  let perfil = null;
  try {
    const { data, error } = await sb.from('perfiles').select('*').eq('id', session.user.id).maybeSingle();
    if (error) throw error;
    perfil = data;
    if (perfil) await set('perfil', perfil);
  } catch (e) {
    if (!navigator.onLine) perfil = await get('perfil');   // sin conexión: último perfil conocido
    else throw e;
  }
  estado.perfil = perfil || { email, nombre: session.user.user_metadata?.full_name || email, activo: false };
  return estado.perfil;
}

export const esAdmin = () => estado.perfil?.rol === 'administrador';
export const esDependiente = () => estado.perfil?.rol === 'dependiente';
export const esConsulta = () => estado.perfil?.rol === 'consulta';

export async function cargarCatalogosBase() {
  const [s, b] = await Promise.all([
    cacheado('sedes', () => sb.from('sedes').select('*').eq('activa', true).order('id')),
    cacheado('bodegas', () => sb.from('bodegas').select('*').eq('activa', true).order('sede_id').order('id')),
  ]);
  estado.sedes = s; estado.bodegas = b;
}

// Bodegas donde el usuario puede operar (dependiente: su sede; admin: todas)
export function bodegasOperables({ incluirCentral = true } = {}) {
  return estado.bodegas.filter(b =>
    (esAdmin() || (esDependiente() && b.sede_id === estado.perfil.sede_id && !b.solo_admin)) &&
    (incluirCentral || b.tipo !== 'central'));
}
export const nombreSede = id => estado.sedes.find(s => s.id === id)?.nombre ?? '';
export const bodega = id => estado.bodegas.find(b => b.id === id);

// ---------------------------------------------------------------------------
// Consultas con manejo de errores y caché para trabajar sin conexión
// ---------------------------------------------------------------------------
export async function q(promesa) {
  const { data, error, count } = await promesa;
  if (error) throw traducirError(error);
  return count !== undefined && count !== null ? { data, count } : data;
}

export async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw traducirError(error);
  return data;
}

// Trae todas las filas (PostgREST limita a 1000 por consulta)
export async function todas(consultaFn, tam = 1000) {
  let desde = 0, salida = [];
  for (;;) {
    const lote = await q(consultaFn().range(desde, desde + tam - 1));
    salida = salida.concat(lote);
    if (lote.length < tam) return salida;
    desde += tam;
  }
}

async function cacheado(clave, consulta) {
  try {
    const data = await q(consulta());
    await set('cache:' + clave, { data, t: Date.now() });
    return data;
  } catch (e) {
    const c = await get('cache:' + clave);
    if (c) return c.data;
    throw e;
  }
}
export { cacheado };

export function traducirError(error) {
  const msg = error?.message || String(error);
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return new Error('Sin conexión con el servidor. Revise la señal e intente de nuevo.');
  if (/JWT expired/i.test(msg)) return new Error('La sesión venció. Vuelva a iniciar sesión.');
  if (/permission denied/i.test(msg)) return new Error('No tiene permiso para esta acción.');
  return new Error(msg.replace(/^.*?ERROR:\s*/, ''));
}

// ---------------------------------------------------------------------------
// Catálogo de productos (se guarda en el equipo para buscar sin conexión)
// ---------------------------------------------------------------------------
let _productos = null;
export async function productos(forzar = false) {
  if (_productos && !forzar) return _productos;
  try {
    _productos = await todas(() => sb.from('productos')
      .select('id,codigo,nombre_comercial,principio_activo,concentracion,presentacion,familia_id,tipo,aware,controlado,cadena_frio,activo')
      .order('nombre_comercial'));
    await set('cache:productos', _productos);
  } catch (e) {
    _productos = (await get('cache:productos')) || [];
    if (!_productos.length) throw e;
  }
  return _productos;
}

const variantes = c => {
  const v = new Set([c, c.replace(/-/g, "'"), c.replace(/'/g, '-'), c.toUpperCase()]);
  if (/^\d+$/.test(c)) { v.add(c.replace(/^0+/, '')); v.add(c.padStart(13, '0')); }
  return [...v];
};
// El lector o la cámara pueden leer "INS-0001" donde el catálogo tiene "INS'0001": se prueban ambas formas
export async function productoPorCodigo(codigo) {
  const ps = await productos();
  const c = String(codigo || '').trim();
  for (const v of variantes(c)) { const p = ps.find(x => x.codigo === v); if (p) return p; }
  return null;
}

export function buscarProductos(ps, texto, lim = 30) {
  const t = quitarTildes(texto.trim().toLowerCase());
  if (!t) return [];
  const partes = t.split(/\s+/);
  return ps.filter(p => {
    const s = quitarTildes(`${p.codigo || ''} ${p.nombre_comercial} ${p.principio_activo || ''} ${p.presentacion || ''}`.toLowerCase());
    return partes.every(x => s.includes(x));
  }).slice(0, lim);
}
export const quitarTildes = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

// ---------------------------------------------------------------------------
// Modo sin conexión: despachos en cola
// ---------------------------------------------------------------------------
const COLA = 'cola:';
const oyentes = new Set();
export const alCambiarCola = fn => oyentes.add(fn);
const avisar = async () => { const n = (await pendientes()).length; oyentes.forEach(f => f(n)); };

export async function pendientes() {
  return (await keys()).filter(k => String(k).startsWith(COLA));
}
export async function listarPendientes() {
  const ks = await pendientes();
  return Promise.all(ks.map(async k => ({ clave: k, ...(await get(k)) })));
}

// Registra un despacho: si hay red se envía; si no, queda en cola y se envía solo al volver la señal
export async function registrarSalida(payload) {
  payload.client_id = payload.client_id || crypto.randomUUID();
  payload.fecha = payload.fecha || hoyISO();
  if (navigator.onLine) {
    try {
      return { enviado: true, ...(await rpc('registrar_salida', { p: payload })) };
    } catch (e) {
      if (!/Sin conexión/.test(e.message)) throw e;   // error de negocio: se muestra al usuario
    }
  }
  await set(COLA + payload.client_id, { payload, creado: new Date().toISOString(), error: null });
  avisar();
  return { enviado: false, client_id: payload.client_id };
}

let sincronizando = false;
export async function sincronizar() {
  if (sincronizando || !navigator.onLine) return { enviados: 0, errores: 0 };
  sincronizando = true;
  let enviados = 0, errores = 0;
  try {
    for (const k of await pendientes()) {
      const item = await get(k);
      try {
        await rpc('registrar_salida', { p: item.payload });
        await del(k); enviados++;
      } catch (e) {
        if (/Sin conexión/.test(e.message)) break;
        item.error = e.message; await set(k, item); errores++;
      }
    }
  } finally { sincronizando = false; avisar(); }
  return { enviados, errores };
}
export async function descartarPendiente(clave) { await del(clave); avisar(); }

window.addEventListener('online', () => { estado.enLinea = true; sincronizar(); document.body.classList.remove('sin-red'); });
window.addEventListener('offline', () => { estado.enLinea = false; document.body.classList.add('sin-red'); });
setInterval(() => sincronizar(), 60_000);

export function hoyISO() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/El_Salvador' }));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

if (import.meta.env.VITE_AUTH_DEBUG === '1') window.__sb = sb;   // solo en pruebas locales
