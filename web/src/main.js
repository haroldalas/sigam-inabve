// SIGAM-INABVE · aplicación principal
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import './estilos.css';
import { h, $, toast, error, cargando, fechaHora } from './ui.js';
import { sb, estado, cargarPerfil, cargarCatalogosBase, iniciarSesionMicrosoft, cerrarSesion, esAdmin, esDependiente,
  DOMINIO, correoInstitucional, entrarConClave, crearCuenta, cambiarClave,
  nombreSede, pendientes, alCambiarCola, sincronizar, q, rpc, productos } from './api.js';

const RUTAS = {
  inicio:       { t: 'Notificaciones',       i: '🔔', roles: ['administrador', 'dependiente'], v: () => import('./vistas/notificaciones.js') },
  novedades:    { t: 'Medicamentos nuevos',  i: '🆕', roles: ['consulta'], v: () => import('./vistas/novedades.js') },
  solicitudes:  { t: 'Solicitudes',          i: '📨', roles: ['administrador', 'dependiente', 'consulta', 'jefatura'], v: () => import('./vistas/solicitudes.js') },
  seguimiento:  { t: 'Seguimiento telefónico', i: '📞', roles: ['administrador', 'dependiente', 'consulta', 'jefatura'], si: () => estado.hagoSeguimiento, v: () => import('./vistas/seguimiento.js') },
  existencias:  { t: 'Existencias',          i: '📦', roles: ['administrador', 'dependiente', 'consulta', 'jefatura'], v: () => import('./vistas/existencias.js') },
  despacho:     { t: 'Despacho',             i: '🧾', roles: ['administrador', 'dependiente'], v: () => import('./vistas/despacho.js') },
  recepcion:    { t: 'Recibir traslados',    i: '📥', roles: ['administrador', 'dependiente'], v: () => import('./vistas/recepcion.js') },
  traslados:    { t: 'Traslados',            i: '🚚', roles: ['administrador', 'dependiente'], v: () => import('./vistas/traslados.js') },
  entradas:     { t: 'Entradas (facturas)',  i: '📑', roles: ['administrador'], v: () => import('./vistas/entradas.js') },
  conteo:       { t: 'Conteo físico',        i: '🔢', roles: ['administrador', 'dependiente'], v: () => import('./vistas/conteo.js') },
  ajustes:      { t: 'Ajustes',              i: '⚖️', roles: ['administrador', 'dependiente'], v: () => import('./vistas/ajustes.js') },
  devoluciones: { t: 'Devoluciones',         i: '↩️', roles: ['administrador', 'dependiente'], v: () => import('./vistas/devoluciones.js') },
  kardex:       { t: 'Kardex',               i: '📒', roles: ['administrador', 'dependiente', 'jefatura'], v: () => import('./vistas/kardex.js') },
  pendientes:   { t: 'Bandeja de revisión',  i: '✅', roles: ['administrador'], v: () => import('./vistas/pendientes.js') },
  lotes:        { t: 'Bloqueo de lotes',     i: '⛔', roles: ['administrador'], v: () => import('./vistas/lotes.js') },
  tablero:      { t: 'Tableros',   i: '📊', roles: ['administrador', 'jefatura'], v: () => import('./vistas/tablero.js') },
  polizas:      { t: 'Pólizas CEFAFA',       i: '🧮', roles: ['administrador'], v: () => import('./vistas/polizas.js') },
  conciliacion: { t: 'Conciliar con SIVET',  i: '🔁', roles: ['administrador'], v: () => import('./vistas/conciliacion.js') },
  liquidacion:  { t: 'Liquidación',          i: '💵', roles: ['administrador'], v: () => import('./vistas/liquidacion.js') },
  admin:        { t: 'Administración',       i: '⚙️', roles: ['administrador'], v: () => import('./vistas/admin.js') },
};
const GRUPOS = [
  ['General', ['inicio', 'novedades', 'solicitudes', 'seguimiento', 'existencias']],
  ['Operación', ['despacho', 'recepcion', 'traslados', 'entradas']],
  ['Inventario', ['conteo', 'ajustes', 'devoluciones', 'kardex']],
  ['Coordinación', ['pendientes', 'lotes', 'tablero', 'polizas', 'conciliacion', 'liquidacion', 'admin']],
];

// replaceChildren/append nativos convierten null en el texto "null": se ignoran los vacíos (… ? x : null)
for (const m of ['replaceChildren', 'append', 'prepend']) {
  const orig = Element.prototype[m];
  Element.prototype[m] = function (...hijos) { return orig.apply(this, hijos.filter(x => x !== null && x !== undefined && x !== false)); };
}

const app = $('#app');

const rutaInicial = () => ['inicio', 'novedades', 'tablero', 'existencias'].find(rutaPermitida) || 'existencias';

function rutaPermitida(clave) {
  const r = RUTAS[clave];
  if (!r || !r.roles.includes(estado.perfil?.rol)) return false;
  if (r.si && !r.si()) return false;
  if (r.central && !esAdmin()) {   // entradas: solo quien opera la sede de la bodega central
    const central = estado.bodegas.find(b => b.permite_entradas);
    return central && central.sede_id === estado.perfil.sede_id;
  }
  return true;
}

// ----------------------------------------------------------------------------- pantallas sin sesión
// Con VITE_LOGIN_MICROSOFT=1 el botón usa Microsoft Entra ID; sin él, correo institucional + contraseña
const LOGIN_MICROSOFT = import.meta.env.VITE_LOGIN_MICROSOFT === '1';

function pantallaLogin(mensaje) {
  const caja = h('div', { class: 'login-caja' });
  const cabecera = () => [
    h('img', { src: '/img/inabve-color.png', alt: 'INABVE', class: 'login-logo' }),
    h('h1', {}, 'SIGAM-INABVE'),
    h('p', { class: 'login-sub' }, 'Sistema Integrado de Gestión de Abastecimiento Médico')];
  const avisoError = h('p', { class: 'aviso aviso-error', role: 'alert' });
  const mostrarError = m => { avisoError.textContent = m || ''; avisoError.classList.toggle('oculto', !m); };
  const campoUsuario = () => h('div', { class: 'campo-correo' },
    h('input', { class: 'campo', name: 'usuario', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', placeholder: 'nombre.apellido' }),
    h('span', {}, DOMINIO));
  const campoClave = (ph, ac = 'current-password') => h('input', { class: 'campo', type: 'password', autocomplete: ac, placeholder: ph });
  const enviar = (form, fn) => form.addEventListener('submit', async ev => {
    ev.preventDefault(); mostrarError('');
    const b = form.querySelector('button[type=submit]'); b.disabled = true;
    try { await fn(); } catch (e) { mostrarError(e.message || String(e)); } finally { b.disabled = false; }
  });
  const enlace = (texto, fn) => h('button', { type: 'button', class: 'btn-enlace', onclick: fn }, texto);

  const inicio = () => {
    mostrarError(mensaje);
    caja.replaceChildren(...cabecera(), avisoError,
      h('button', { class: 'btn btn-primario btn-grande btn-ms', onclick: async () => {
        if (!LOGIN_MICROSOFT) return entrar();
        try { await iniciarSesionMicrosoft(); } catch (e) { error(e); }
      } }, h('span', { class: 'ms-logo', 'aria-hidden': 'true' }), 'Iniciar sesión con cuenta institucional'),
      h('p', { class: 'login-nota' }, 'Solo cuentas @inabve.gob.sv'));
  };

  const pasoMs = (titulo, ...hijos) => caja.replaceChildren(
    h('div', { class: 'ms-paso-cab' }, h('span', { class: 'ms-logo', 'aria-hidden': 'true' }), h('span', {}, 'Cuenta institucional INABVE')),
    h('h2', { class: 'ms-titulo' }, titulo), avisoError, ...hijos);

  const entrar = () => {
    mostrarError('');
    const usuario = campoUsuario(); const clave = campoClave('Contraseña');
    const form = h('form', { class: 'ms-form' }, usuario, clave,
      h('button', { type: 'submit', class: 'btn btn-primario btn-grande' }, 'Entrar'));
    enviar(form, async () => {
      const u = usuario.querySelector('input').value;
      if (!correoInstitucional(u)) throw new Error('Escriba su usuario institucional');
      if (!clave.value) throw new Error('Escriba su contraseña');
      await entrarConClave(u, clave.value); await iniciar();
    });
    pasoMs('Iniciar sesión', form,
      h('div', { class: 'ms-enlaces' },
        enlace('¿Primera vez? Crear mi cuenta', crear),
        enlace('¿Olvidó su contraseña?', olvido),
        enlace('← Regresar', inicio)));
    setTimeout(() => usuario.querySelector('input').focus(), 30);
  };

  const crear = () => {
    mostrarError('');
    const nombre = h('input', { class: 'campo', autocomplete: 'name', placeholder: 'Nombre completo' });
    const usuario = campoUsuario(); const clave = campoClave('Contraseña (mínimo 8 caracteres)', 'new-password');
    const clave2 = campoClave('Repita la contraseña', 'new-password');
    const form = h('form', { class: 'ms-form' }, nombre, usuario, clave, clave2,
      h('button', { type: 'submit', class: 'btn btn-primario btn-grande' }, 'Crear cuenta'));
    enviar(form, async () => {
      const u = usuario.querySelector('input').value;
      if (nombre.value.trim().length < 5) throw new Error('Escriba su nombre completo');
      if (!correoInstitucional(u)) throw new Error('Escriba su usuario institucional (lo que va antes de @inabve.gob.sv)');
      if (clave.value.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
      if (clave.value !== clave2.value) throw new Error('Las contraseñas no coinciden');
      const conSesion = await crearCuenta(u, clave.value, nombre.value);
      if (conSesion) return iniciar();
      pasoMs('Revise su correo', h('p', {}, `Enviamos un enlace de confirmación a ${correoInstitucional(u)}. Ábralo y luego entre con su contraseña.`),
        enlace('← Regresar', inicio));
    });
    pasoMs('Crear mi cuenta', h('p', { class: 'nota' }, 'Use su correo institucional. Después llenará una solicitud y un administrador le dará acceso.'), form,
      h('div', { class: 'ms-enlaces' }, enlace('Ya tengo cuenta: iniciar sesión', entrar), enlace('← Regresar', inicio)));
    setTimeout(() => nombre.focus(), 30);
  };

  const olvido = () => {
    mostrarError('');
    pasoMs('¿Olvidó su contraseña?',
      h('p', {}, 'Pida a un administrador de SIGAM (Harold Alas u Oscar Rivas) que le asigne una contraseña temporal. Al entrar con ella, el sistema le pedirá crear una nueva.'),
      h('div', { class: 'ms-enlaces' }, enlace('← Iniciar sesión', entrar)));
  };

  inicio();
  app.replaceChildren(h('main', { class: 'login' }, caja,
    h('footer', { class: 'login-pie' }, 'Departamento de Programas de Salud Integral · INABVE')));
}

// Contraseña temporal asignada por un administrador, o cambio voluntario
function pantallaCambioClave(obligatorio = true) {
  const caja = h('div', { class: 'login-caja' });
  const avisoError = h('p', { class: 'aviso aviso-error oculto', role: 'alert' });
  const clave = h('input', { class: 'campo', type: 'password', autocomplete: 'new-password', placeholder: 'Nueva contraseña (mínimo 8 caracteres)' });
  const clave2 = h('input', { class: 'campo', type: 'password', autocomplete: 'new-password', placeholder: 'Repita la nueva contraseña' });
  const form = h('form', { class: 'ms-form' }, clave, clave2, h('button', { type: 'submit', class: 'btn btn-primario btn-grande' }, 'Guardar contraseña'));
  form.addEventListener('submit', async ev => {
    ev.preventDefault(); avisoError.classList.add('oculto');
    const b = form.querySelector('button'); b.disabled = true;
    try {
      if (clave.value.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres');
      if (clave.value !== clave2.value) throw new Error('Las contraseñas no coinciden');
      await cambiarClave(clave.value); toast('Contraseña actualizada');
      if (obligatorio) iniciar(); else location.reload();
    } catch (e) { avisoError.textContent = e.message; avisoError.classList.remove('oculto'); } finally { b.disabled = false; }
  });
  caja.append(
    h('div', { class: 'ms-paso-cab' }, h('span', { class: 'ms-logo', 'aria-hidden': 'true' }), h('span', {}, estado.perfil?.email || 'Cuenta institucional INABVE')),
    h('h2', { class: 'ms-titulo' }, obligatorio ? 'Cree una contraseña nueva' : 'Cambiar contraseña'),
    obligatorio ? h('p', { class: 'nota' }, 'Entró con una contraseña temporal. Escriba una nueva que solo usted conozca.') : null,
    avisoError, form,
    h('div', { class: 'ms-enlaces' }, obligatorio
      ? h('button', { type: 'button', class: 'btn-enlace', onclick: cerrarSesion }, 'Cerrar sesión')
      : h('button', { type: 'button', class: 'btn-enlace', onclick: () => location.reload() }, '← Regresar')));
  app.replaceChildren(h('main', { class: 'login' }, caja));
  setTimeout(() => clave.focus(), 30);
}

// Usuario sin acceso: envía su solicitud; un administrador le asigna rol y sede
async function pantallaPendiente() {
  const p = estado.perfil;
  const caja = h('div', { class: 'login-caja login-solicitud' },
    h('img', { src: '/img/inabve-color.png', alt: 'INABVE', class: 'login-logo' }), h('h1', {}, 'Solicitud de acceso'));
  app.replaceChildren(h('main', { class: 'login' }, caja));
  const pie = h('div', { class: 'botones', style: { justifyContent: 'center', marginTop: '10px' } },
    h('button', { class: 'btn btn-sec', onclick: () => iniciar() }, '↻ Actualizar'),
    h('button', { class: 'btn btn-sec', onclick: cerrarSesion }, 'Cerrar sesión'));
  if (!p.email || !p.estado_solicitud) {           // sin perfil (sin conexión) o base sin la migración
    caja.append(h('p', {}, `Su cuenta ${p.email || ''} aún no tiene acceso. Un administrador debe habilitarla.`), pie); return;
  }
  if (p.estado_solicitud === 'pendiente') {
    caja.append(h('p', { class: 'aviso aviso-info' }, `Solicitud enviada el ${fechaHora(p.solicitado_at)}. Un administrador revisará su acceso y le asignará un rol.`),
      h('p', { class: 'nota' }, `${p.nombre} · ${p.cargo || ''} · ${p.email}`),
      h('button', { class: 'btn-enlace', onclick: () => formulario() }, 'Corregir mi solicitud'), pie);
    return;
  }
  const formulario = async () => {
    let sedes = [];
    try { sedes = await q(sb.from('sedes').select('id,nombre').eq('activa', true).order('id')); } catch { /* sin sedes */ }
    const nombre = h('input', { class: 'campo', value: p.nombre || '', autocomplete: 'name' });
    const cargo = h('input', { class: 'campo', value: p.cargo || '', placeholder: 'Ej.: Dependiente de farmacia, Médico, Contact Center' });
    const tel = h('input', { class: 'campo', value: p.telefono || '', inputmode: 'tel', placeholder: 'Opcional' });
    const sede = h('select', { class: 'campo' }, h('option', { value: '' }, '— Elija su sede —'),
      sedes.map(s => h('option', { value: s.id, selected: s.id === (p.sede_solicitada || p.sede_id) }, s.nombre)));
    const TIPOS = [['dependiente', 'Dependiente: despacho, traslados y bodega de mi sede'], ['consulta', 'Consulta: ver existencias y dónde están (médicos, Contact Center)'], ['jefatura', 'Jefatura: existencias, kardex y tableros de consumo de todas las sedes'], ['administrador', 'Administrador (coordinación)']];
    const rol = h('select', { class: 'campo' }, TIPOS.map(([v, t]) => h('option', { value: v, selected: v === (p.rol_solicitado || p.rol_sugerido || 'dependiente') }, t)));
    const com = h('textarea', { class: 'campo', rows: 2, placeholder: 'Comentario para el administrador (opcional)' }, p.comentario || '');
    const btn = h('button', { class: 'btn btn-primario btn-grande', onclick: async () => {
      btn.disabled = true;
      try {
        await rpc('enviar_solicitud_acceso', { p: { nombre: nombre.value, cargo: cargo.value, telefono: tel.value, sede_id: sede.value, rol: rol.value, comentario: com.value } });
        toast('Solicitud enviada'); iniciar();
      } catch (e) { error(e); btn.disabled = false; }
    } }, 'Enviar solicitud');
    caja.replaceChildren(caja.firstChild, h('h1', {}, 'Solicitud de acceso'),
      p.estado_solicitud === 'rechazada' ? h('p', { class: 'aviso aviso-error' }, `Su solicitud anterior fue rechazada: ${p.motivo_rechazo || ''}`) : null,
      h('p', { class: 'nota' }, `Cuenta: ${p.email}. Complete sus datos; un administrador definirá su rol y su sede.`),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Nombre completo'), nombre),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Cargo'), cargo),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Sede donde trabaja'), sede),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Acceso que necesita'), rol),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Teléfono o extensión'), tel),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Comentario'), com),
      btn, pie);
  };
  formulario();
}

// ----------------------------------------------------------------------------- estructura
let contenido, insigniaNotif, insigniaCola, insigniaPend, insigniaRecep, insigniaAdmin, insigniaSol, insigniaSeg, solicitudesVistas = -1;

function armarEstructura() {
  const p = estado.perfil;
  const rolTxt = { administrador: 'Administrador', dependiente: 'Dependiente', consulta: 'Consulta', jefatura: 'Jefatura' }[p.rol];
  insigniaCola = h('button', { class: 'cola oculto', title: 'Despachos guardados sin conexión', onclick: () => { location.hash = '#despacho'; } });
  const menu = h('nav', { class: 'menu', 'aria-label': 'Menú principal' },
    GRUPOS.map(([g, claves]) => {
      const items = claves.filter(rutaPermitida);
      if (!items.length) return null;
      return h('div', { class: 'menu-grupo' }, h('div', { class: 'menu-titulo' }, g),
        items.map(k => h('a', { href: '#' + k, class: 'menu-item', 'data-ruta': k },
          h('span', { class: 'menu-icono', 'aria-hidden': 'true' }, RUTAS[k].i), h('span', {}, RUTAS[k].t),
          k === 'inicio' || k === 'novedades' ? (insigniaNotif = h('span', { class: 'insignia oculto' })) : null,
          k === 'solicitudes' ? (insigniaSol = h('span', { class: 'insignia oculto', title: 'Solicitudes por validar' })) : null,
          k === 'seguimiento' ? (insigniaSeg = h('span', { class: 'insignia oculto', title: 'Llamadas, pases a Despacho y registros en SIVET pendientes' })) : null,
          k === 'pendientes' ? (insigniaPend = h('span', { class: 'insignia oculto' })) : null,
          k === 'admin' ? (insigniaAdmin = h('span', { class: 'insignia oculto', title: 'Solicitudes de acceso por revisar' })) : null,
          k === 'recepcion' ? (insigniaRecep = h('span', { class: 'insignia oculto' })) : null)));
    }));
  contenido = h('main', { class: 'contenido', id: 'contenido', tabindex: '-1' });
  const botonMenu = h('button', { class: 'btn-menu', 'aria-label': 'Abrir menú', onclick: () => document.body.classList.toggle('menu-abierto') }, '☰');
  app.replaceChildren(
    h('header', { class: 'cabecera' },
      botonMenu,
      h('a', { href: '#', class: 'marca' },
        h('img', { src: '/img/inabve-blanco.png', alt: 'INABVE', class: 'marca-logo' }),
        h('div', { class: 'marca-texto' }, h('strong', {}, 'SIGAM-INABVE'), h('small', {}, 'Gestión de Abastecimiento Médico'))),
      h('div', { class: 'cabecera-der' },
        h('span', { class: 'indicador-red', title: 'Estado de la conexión' }),
        insigniaCola,
        h('div', { class: 'usuario' }, h('strong', {}, p.nombre),
          h('small', {}, rolTxt + (p.sede_id ? ' · ' + nombreSede(p.sede_id) : ''))),
        LOGIN_MICROSOFT ? null : h('button', { class: 'btn btn-claro btn-peq', title: 'Cambiar contraseña', onclick: () => pantallaCambioClave(false) }, '🔑'),
        h('button', { class: 'btn btn-claro btn-peq', onclick: cerrarSesion }, 'Salir'),
        h('img', { src: '/img/gobierno-blanco.png', alt: 'Gobierno de El Salvador', class: 'gob-logo' }))),
    h('div', { class: 'cuerpo' }, menu, h('div', { class: 'velo', onclick: () => document.body.classList.remove('menu-abierto') }), contenido));
  if (!navigator.onLine) document.body.classList.add('sin-red');
}

async function navegar() {
  const clave = (location.hash.slice(1).split('?')[0]) || rutaInicial();
  document.body.classList.remove('menu-abierto');
  document.querySelectorAll('.menu-item').forEach(a => a.classList.toggle('activo', a.dataset.ruta === clave));
  if (!rutaPermitida(clave)) { location.hash = '#' + rutaInicial(); return; }
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
    rpc('mis_solicitudes_pendientes').then(r => { marcar(insigniaSol, r?.validar || 0); marcar(insigniaSeg, (r?.llamar || 0) + (r?.pasar || 0) + (r?.sivet || 0)); }).catch(() => {});
    if (estado.perfil?.rol === 'jefatura') return;
    if (estado.perfil?.rol === 'consulta') {   // consulta: medicamentos nuevos de la última semana
      const nov = await rpc('novedades_medicamentos', { p_dias: 7 });
      return marcar(insigniaNotif, nov.length);
    }
    const [res, pend, recep, solic] = await Promise.all([
      q(sb.from('v_notif_resumen').select('*')),
      esAdmin() ? q(sb.from('v_pendientes_admin').select('id', { count: 'exact', head: true })) : null,
      q(sb.from('traslados').select('id,bodega_destino_id', { count: 'exact' }).eq('estado', 'enviado')),
      esAdmin() ? sb.from('perfiles').select('email', { count: 'exact', head: true }).eq('estado_solicitud', 'pendiente') : null,
    ]);
    if (solic) {
      const n = solic.count || 0;
      marcar(insigniaAdmin, n);
      if (n > solicitudesVistas && solicitudesVistas >= 0)
        toast(`${n - solicitudesVistas} solicitud(es) de acceso nueva(s) · Administración → Usuarios`, 'info', 10000);
      solicitudesVistas = n;
    }
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
    if (perfil.debe_cambiar_clave) return pantallaCambioClave(true);
    if (!perfil.activo || !perfil.rol) return pantallaPendiente();
    // ¿da seguimiento telefónico? administración, dependientes de regionales o responsables de Seguimiento/DSIN
    estado.hagoSeguimiento = perfil.rol === 'administrador' || (perfil.rol === 'dependiente' && perfil.sede_id !== 1);
    if (!estado.hagoSeguimiento) {
      try { estado.hagoSeguimiento = (await q(sb.from('solicitud_responsables').select('area').eq('email', perfil.email).in('area', ['SEGUIMIENTO', 'DSIN']))).length > 0; } catch { /* sin conexión */ }
    }
    await cargarCatalogosBase();
    estado.bodegas.forEach(b => { b._sede = nombreSede(b.sede_id); });
    armarEstructura();
    alCambiarCola(n => { insigniaCola.textContent = `⏳ ${n} sin enviar`; insigniaCola.classList.toggle('oculto', !n); });
    sincronizar().then(r => { if (r.enviados) toast(`${r.enviados} despacho(s) guardados sin conexión fueron enviados`); });
    pendientes().then(ks => { insigniaCola.textContent = `⏳ ${ks.length} sin enviar`; insigniaCola.classList.toggle('oculto', !ks.length); });
    productos().catch(() => {});        // precarga el catálogo para buscar sin conexión
    window.addEventListener('hashchange', navegar);
    await navegar();
    refrescarInsignias(); setInterval(refrescarInsignias, (esAdmin() ? 2 : 5) * 60_000);
    sb.from('perfiles').update({ ultimo_acceso: new Date().toISOString() }).eq('id', perfil.id).then(() => {});
  } catch (e) {
    pantallaLogin(e.message);
  }
}

sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') pantallaLogin(); });

// Versión nueva publicada: se avisa para recargar (no se recarga sola para no perder un despacho a medio llenar)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  let avisado = false;
  const avisar = () => {
    if (avisado) return; avisado = true;
    document.body.append(h('div', { class: 'aviso-version', role: 'status' },
      h('span', {}, 'Hay una versión nueva de SIGAM.'),
      h('button', { class: 'btn btn-primario btn-peq', onclick: () => location.reload() }, 'Actualizar')));
  };
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').then(reg => {
    const revisar = () => reg.update().catch(() => {});
    setInterval(revisar, 15 * 60_000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) revisar(); });
  }).catch(() => {}));
  const habia = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (habia) avisar(); });
}

iniciar();
