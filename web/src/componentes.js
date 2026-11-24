// SIGAM-INABVE · componentes compartidos
import { h, toast, num, fecha, chipsProducto, debounce } from './ui.js';
import { productos, productoPorCodigo, buscarProductos, sb, q } from './api.js';
import { escanearConCamara, camaraDisponible } from './escaner.js';

// Buscador de producto: lector USB (Enter), cámara o texto (nombre, código, principio activo)
export function buscadorProducto({ alElegir, placeholder = 'Escanee o escriba nombre, código o principio activo', autofocus = true, filtro } = {}) {
  const lista = h('div', { class: 'sugerencias', role: 'listbox' });
  const input = h('input', { class: 'campo campo-busqueda', type: 'search', placeholder, autocomplete: 'off', inputmode: 'search', autofocus });
  let resultados = [];
  const elegir = p => { lista.replaceChildren(); input.value = ''; resultados = []; alElegir(p); input.focus(); };
  const pintar = rs => {
    resultados = rs;
    lista.replaceChildren(...rs.map(p => h('button', { type: 'button', class: 'sugerencia', role: 'option', onclick: () => elegir(p) },
      h('div', {}, h('strong', {}, p.nombre_comercial), ' ', chipsProducto(p)),
      h('small', {}, [p.codigo || 'sin código', p.principio_activo, p.presentacion].filter(Boolean).join(' · ')))));
  };
  input.addEventListener('input', debounce(async () => {
    const t = input.value.trim();
    if (t.length < 2) return pintar([]);
    let ps = await productos(); if (filtro) ps = ps.filter(filtro);
    pintar(buscarProductos(ps.filter(p => p.activo), t));
  }, 180));
  input.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const t = input.value.trim(); if (!t) return;
    const p = await productoPorCodigo(t);
    if (p && (!filtro || filtro(p))) return elegir(p);
    if (resultados.length === 1) return elegir(resultados[0]);
    if (/^[\w'-]{5,}$/.test(t) && !resultados.length) toast(`El código ${t} no está en el catálogo`, 'error');
  });
  const camara = camaraDisponible() ? h('button', { type: 'button', class: 'btn btn-sec btn-camara', title: 'Escanear con la cámara',
    onclick: () => escanearConCamara(async cod => {
      const p = await productoPorCodigo(cod);
      if (p) elegir(p); else toast(`El código ${cod} no está en el catálogo`, 'error');
    }) }, '📷 Cámara') : null;
  return h('div', { class: 'buscador' }, h('div', { class: 'buscador-fila' }, input, camara), lista);
}

// Existencias por lote de un producto en una bodega (activos y no vencidos, en orden PVPS)
export async function lotesDisponibles(bodegaId, productoId) {
  return q(sb.from('lotes').select('id,numero_lote,fecha_vencimiento,disponible,precio_unitario,estado,proveedor_id')
    .eq('bodega_id', bodegaId).eq('producto_id', productoId).gt('disponible', 0)
    .order('fecha_vencimiento', { ascending: true, nullsFirst: false }));
}

export function resumenLotes(lotes) {
  const hoy = new Date().toISOString().slice(0, 10);
  const utiles = lotes.filter(l => l.estado === 'activo' && (!l.fecha_vencimiento || l.fecha_vencimiento >= hoy));
  return { total: utiles.reduce((s, l) => s + Number(l.disponible), 0), utiles, bloqueados: lotes.filter(l => l.estado !== 'activo') };
}

export function textoLote(l) {
  return `${l.numero_lote || 's/lote'} · vence ${fecha(l.fecha_vencimiento) || 's/f'} · ${num(l.disponible)} disp.`;
}

// Selector de bodega agrupado por sede
export function selectorBodega(bodegas, valor, { alCambiar, vacio } = {}) {
  const porSede = {};
  bodegas.forEach(b => { (porSede[b.sede_id] ||= []).push(b); });
  const sel = h('select', { class: 'campo' },
    vacio ? h('option', { value: '' }, vacio) : null,
    Object.values(porSede).map(bs => h('optgroup', { label: bs[0]._sede || '' },
      bs.map(b => h('option', { value: b.id, selected: String(b.id) === String(valor) }, b.nombre)))));
  if (alCambiar) sel.addEventListener('change', () => alCambiar(sel.value ? Number(sel.value) : null));
  return sel;
}

export function filtros(...controles) {
  return h('div', { class: 'filtros' }, controles);
}
