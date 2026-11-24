// SIGAM-INABVE · aplicación principal
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import './estilos.css';
import { h, $, toast, error, cargando } from './ui.js';
import { sb, estado, cargarPerfil, cargarCatalogosBase, iniciarSesionMicrosoft, cerrarSesion, esAdmin, esDependiente,
  nombreSede, pendientes, alCambiarCola, sincronizar, q, productos } from './api.js';

const RUTAS = {
  inicio:       { t: 'Notificaciones',       i: '🔔', roles: ['administrador', 'dependiente', 'consulta'], v: () => import('./vistas/notificaciones.js') },
  existencias:  { t: 'Existencias',          i: '📦', roles: ['administrador', 'dependiente', 'consulta'], v: () => import('./vistas/existencias.js') },
  despacho:     { t: 'Despacho',             i: '🧾', roles: ['administrador', 'dependiente'], v: () => import('./vistas/despacho.js') },
  recepcion:    { t: 'Recibir traslados',    i: '📥', roles: ['administrador', 'dependiente'], v: () => import('./vistas/recepcion.js') },
  traslados:    { t: 'Traslados',            i: '🚚', roles: ['administrador', 'dependiente'], v: () => import('./vistas/traslados.js') },
  entradas:     { t: 'Entradas (facturas)',  i: '📑', roles: ['administrador', 'dependiente'], central: true, v: () => import('./vistas/entradas.js') },
  conteo:       { t: 'Conteo físico',        i: '🔢', roles: ['administrador', 'dependiente'], v: () => import('./vistas/conteo.js') },
  ajustes:      { t: 'Ajustes',              i: '⚖️', roles: ['administrador', 'dependiente'], v: () => import('./vistas/ajustes.js') },
  devoluciones: { t: 'Devoluciones',         i: '↩️', roles: ['administrador', 'dependiente'], v: () => import('./vistas/devoluciones.js') },
  kardex:       { t: 'Kardex',               i: '📒', roles: ['administrador', 'dependiente'], v: () => import('./vistas/kardex.js') },
  pendientes:   { t: 'Bandeja de revisión',  i: '✅', roles: ['administrador'], v: () => import('./vistas/pendientes.js') },
  lotes:        { t: 'Bloqueo de lotes',     i: '⛔', roles: ['administrador'], v: () => import('./vistas/lotes.js') },
  tablero:      { t: 'Tablero de consumo',   i: '📊', roles: ['administrador'], v: () => import('./vistas/tablero.js') },
  conciliacion: { t: 'Conciliar con SIVET',  i: '🔁', roles: ['administrador'], v: () => import('./vistas/conciliacion.js') },
  liquidacion:  { t: 'Liquidación',          i: '💵', roles: ['administrador'], v: () => import('./vistas/liquidacion.js') },
  admin:        { t: 'Administración',       i: '⚙️', roles: ['administrador'], v: () => import('./vistas/admin.js') },
};
const GRUPOS = [
  ['General', ['inicio', 'existencias']],
  ['Operación', ['despacho', 'recepcion', 'traslados', 'entradas']],
  ['Inventario', ['conteo', 'ajustes', 'devoluciones', 'kardex']],
  ['Coordinación', ['pendientes', 'lotes', 'tablero', 'conciliacion', 'liquidacion', 'admin']],
];

const app = $('#app');

function rutaPermitida(clave) {
  const r = RUTAS[clave];
  if (!r || !r.roles.includes(estado.perfil?.rol)) return false;
  if (r.central && !esAdmin()) {   // entradas: solo quien opera la sede de la bodega central
    const central = estado.bodegas.find(b => b.permite_entradas);
    return central && central.sede_id === estado.perfil.sede_id;
  }
  return true;
}

// ----------------------------------------------------------------------------- pantallas sin sesión
function pantallaLogin(mensaje) {
  app.replaceChildren(h('main', { class: 'login' },
    h('div', { class: 'login-caja' },
      h('img', { src: '/img/inabve-color.png', alt: 'INABVE', class: 'login-logo' }),
      h('h1', {}, 'SIGAM-INABVE'),
      h('p', { class: 'login-sub' }, 'Sistema Integrado de Gestión de Abastecimiento Médico'),
      mensaje ? h('p', { class: 'aviso aviso-error' }, mensaje) : null,
      h('button', { class: 'btn btn-primario btn-grande btn-ms', onclick: async () => {
        try { await iniciarSesionMicrosoft(); } catch (e) { error(e); }
      } }, h('span', { class: 'ms-logo', 'aria-hidden': 'true' }), 'Iniciar sesión con cuenta institucional'),
      h('p', { class: 'login-nota' }, 'Solo cuentas @inabve.gob.sv'),
    ),
    h('footer', { class: 'login-pie' }, 'Departamento de Programas de Salud Integral · INABVE')));
}

function pantallaPendiente() {
  app.replaceChildren(h('main', { class: 'login' }, h('div', { class: 'login-caja' },
    h('img', { src: '/img/inabve-color.png', alt: 'INABVE', class: 'login-logo' }),
    h('h1', {}, 'Acceso pendiente'),
    h('p', {}, `Su cuenta ${estado.perfil.email} quedó registrada. Un administrador debe asignarle un rol y una sede para que pueda usar el sistema.`),
    h('button', { class: 'btn btn-sec', onclick: cerrarSesion }, 'Cerrar sesión'))));
}

// ----------------------------------------------------------------------------- estructura
let contenido, insigniaNotif, insigniaCola, insigniaPend, insigniaRecep;

function armarEstructura() {
  const p = estado.perfil;
  const rolTxt = { administrador: 'Administrador', dependiente: 'Dependiente', consulta: 'Consulta' }[p.rol];
  insigniaCola = h('button', { class: 'cola oculto', title: 'Despachos guardados sin conexión', onclick: () => { location.hash = '#despacho'; } });
  const menu = h('nav', { class: 'menu', 'aria-label': 'Menú principal' },
    GRUPOS.map(([g, claves]) => {
      const items = claves.filter(rutaPermitida);
      if (!items.length) return null;
      return h('div', { class: 'menu-grupo' }, h('div', { class: 'menu-titulo' }, g),
        items.map(k => h('a', { href: '#' + k, class: 'menu-item', 'data-ruta': k },
          h('span', { class: 'menu-icono', 'aria-hidden': 'true' }, RUTAS[k].i), h('span', {}, RUTAS[k].t),
          k === 'inicio' ? (insigniaNotif = h('span', { class: 'insignia oculto' })) : null,
          k === 'pendientes' ? (insigniaPend = h('span', { class: 'insignia oculto' })) : null,
          k === 'recepcion' ? (insigniaRecep = h('span', { class: 'insignia oculto' })) : null)));
    }));
  contenido = h('main', { class: 'contenido', id: 'contenido', tabindex: '-1' });
  const botonMenu = h('button', { class: 'btn-menu', 'aria-label': 'Abrir menú', onclick: () => document.body.classList.toggle('menu-abierto') }, '☰');
  app.replaceChildren(
    h('header', { class: 'cabecera' },
      botonMenu,
      h('a', { href: '#inicio', class: 'marca' },
        h('img', { src: '/img/inabve-blanco.png', alt: 'INABVE', class: 'marca-logo' }),
        h('div', { class: 'marca-texto' }, h('strong', {}, 'SIGAM-INABVE'), h('small', {}, 'Gestión de Abastecimiento Médico'))),
      h('div', { class: 'cabecera-der' },
        h('span', { class: 'indicador-red', title: 'Estado de la conexión' }),
        insigniaCola,
        h('div', { class: 'usuario' }, h('strong', {}, p.nombre),
          h('small', {}, rolTxt + (p.sede_id ? ' · ' + nombreSede(p.sede_id) : ''))),
        h('button', { class: 'btn btn-claro btn-peq', onclick: cerrarSesion }, 'Salir'),
        h('img', { src: '/img/gobierno-blanco.png', alt: 'Gobierno de El Salvador', class: 'gob-logo' }))),
    h('div', { class: 'cuerpo' }, menu, h('div', { class: 'velo', onclick: () => document.body.classList.remove('menu-abierto') }), contenido));
  if (!navigator.onLine) document.body.classList.add('sin-red');
}

async function navegar() {
  const clave = (location.hash.slice(1).split('?')[0]) || 'inicio';
  document.body.classList.remove('menu-abierto');
  document.querySelectorAll('.menu-item').forEach(a => a.classList.toggle('activo', a.dataset.ruta === clave));
  if (!rutaPermitida(clave)) { location.hash = '#inicio'; return; }
  const r = RUTAS[clave];
  document.title = `${r.t} · SIGAM-INABVE`;
  contenido.replaceChildren(cargando());
  try {
    const mod = await r.v();
    const vista = await mod.default(new URLSearchParams(location.hash.split('?')[1] || ''));
    contenido.replaceChildren(h('div', { class: 'pagina' }, h('h1', { class: 'titulo-pagina' }, r.t), vista));
    contenido.focus({ preventScroll: true });
  } catch (e) {
    contenido.replaceChildren(h('div', { class: 'aviso aviso-error' }, e.message || String(e)));
    console.error(e);
  }
}

export async function refrescarInsignias() {
  try {
    const [res, pend, recep] = await Promise.all([
      q(sb.from('v_notif_resumen').select('*')),
      esAdmin() ? q(sb.from('v_pendientes_admin').select('id', { count: 'exact', head: true })) : null,
      q(sb.from('traslados').select('id,bodega_destino_id', { count: 'exact' }).eq('estado', 'enviado')),
    ]);
    const filas = esDependiente() ? res.filter(r => r.sede_id === estado.perfil.sede_id) : res;
    const n = filas.reduce((s, r) => s + Number(r.vencidos) + Number(r.vencen_90_dias) + Number(r.agotados) + Number(r.cobertura_critica), 0);
    marcar(insigniaNotif, n);
    if (pend) marcar(insigniaPend, pend.count);
    const misRecep = (recep.data || []).filter(t => esAdmin() || estado.bodegas.find(b => b.id === t.bodega_destino_id)?.sede_id === estado.perfil.sede_id);
    marcar(insigniaRecep, misRecep.length);
  } catch { /* sin conexión: se mantienen */ }
}
const marcar = (el, n) => { if (!el) return; el.textContent = n > 99 ? '99+' : n; el.classList.toggle('oculto', !n); };

async function iniciar() {
  app.replaceChildren(cargando('Iniciando SIGAM-INABVE…'));
  try {
    const perfil = await cargarPerfil();
    if (!perfil) return pantallaLogin();
    if (!perfil.activo || !perfil.rol) return pantallaPendiente();
    await cargarCatalogosBase();
    estado.bodegas.forEach(b => { b._sede = nombreSede(b.sede_id); });
    armarEstructura();
    alCambiarCola(n => { insigniaCola.textContent = `⏳ ${n} sin enviar`; insigniaCola.classList.toggle('oculto', !n); });
    sincronizar().then(r => { if (r.enviados) toast(`${r.enviados} despacho(s) guardados sin conexión fueron enviados`); });
    pendientes().then(ks => { insigniaCola.textContent = `⏳ ${ks.length} sin enviar`; insigniaCola.classList.toggle('oculto', !ks.length); });
    productos().catch(() => {});        // precarga el catálogo para buscar sin conexión
    window.addEventListener('hashchange', navegar);
    await navegar();
    refrescarInsignias(); setInterval(refrescarInsignias, 5 * 60_000);
    sb.from('perfiles').update({ ultimo_acceso: new Date().toISOString() }).eq('id', perfil.id).then(() => {});
  } catch (e) {
    pantallaLogin(e.message);
  }
}

sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') pantallaLogin(); });

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

iniciar();
