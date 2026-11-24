// SIGAM-INABVE · utilidades de interfaz
export function h(tag, attrs = {}, ...hijos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of hijos.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, raiz = document) => raiz.querySelector(sel);

// ---------------------------------------------------------------- formatos
const nf = new Intl.NumberFormat('es-SV', { maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('es-SV', { maximumFractionDigits: 0 });
const mf = new Intl.NumberFormat('es-SV', { style: 'currency', currency: 'USD' });
export const num = v => (v === null || v === undefined || v === '') ? '' : nf.format(Number(v));
export const ent = v => (v === null || v === undefined || v === '') ? '' : nf0.format(Number(v));
export const dinero = v => (v === null || v === undefined || v === '') ? '' : mf.format(Number(v));
export function fecha(v) {
  if (!v) return '';
  const s = String(v).slice(0, 10).split('-');
  return s.length === 3 ? `${s[2]}/${s[1]}/${s[0]}` : String(v);
}
export function fechaHora(v) {
  if (!v) return '';
  return new Date(v).toLocaleString('es-SV', { timeZone: 'America/El_Salvador', dateStyle: 'short', timeStyle: 'short' });
}

// ---------------------------------------------------------------- etiquetas
const AWARE = {
  acceso: ['Acceso', 'aw-acceso'], precaucion: ['Precaución', 'aw-precaucion'], reserva: ['Reserva', 'aw-reserva'],
  no_recomendado: ['No recomendado', 'aw-norec'], otros: ['Otros', 'aw-otros'],
  'Acceso': ['Acceso', 'aw-acceso'], 'Precaución': ['Precaución', 'aw-precaucion'], 'Reserva': ['Reserva', 'aw-reserva'],
  'No recomendado': ['No recomendado', 'aw-norec'], 'Otros': ['Otros', 'aw-otros'],
};
export const chipAware = v => v && AWARE[v] ? h('span', { class: 'chip ' + AWARE[v][1], title: 'Clasificación AWaRe (OMS)' }, AWARE[v][0]) : null;
export const chip = (texto, clase = '') => h('span', { class: 'chip ' + clase }, texto);
export function chipsProducto(p) {
  return [chipAware(p.aware),
    p.cadena_frio ? chip('❄ Cadena de frío', 'chip-frio') : null,
    p.controlado ? chip('Controlado', 'chip-control') : null];
}
export const ESTADOS = {
  enviado: ['En tránsito', 'st-warn'], recibido: ['Recibido', 'st-ok'], con_diferencias: ['Con diferencias', 'st-danger'],
  cerrado: ['Cerrado', 'st-ok'], anulado: ['Anulado', 'st-muted'], confirmada: ['Confirmada', 'st-ok'], anulada: ['Anulada', 'st-muted'],
  pendiente: ['Pendiente', 'st-warn'], en_proceso: ['En proceso', 'st-info'], liquidada: ['Liquidada', 'st-ok'],
  pendiente_aprobacion: ['Por aprobar', 'st-warn'], aplicado: ['Aplicado', 'st-ok'],
  reingresada: ['Reingresada', 'st-ok'], averia: ['Avería', 'st-danger'], rechazada: ['Rechazada', 'st-muted'],
  activo: ['Activo', 'st-ok'], bloqueado: ['Bloqueado', 'st-danger'], cuarentena: ['Cuarentena', 'st-warn'], agotado: ['Agotado', 'st-muted'],
  vencido: ['Vencido', 'st-danger'], critico: ['Crítico', 'st-danger'], por_vencer: ['Por vencer', 'st-warn'],
  agotado_n: ['Agotado', 'st-danger'], por_agotarse: ['Por agotarse', 'st-warn'],
  en_revision: ['En revisión', 'st-warn'], conforme: ['Conforme', 'st-ok'], con_observaciones: ['Con observaciones', 'st-danger'],
  coincide: ['Coincide', 'st-ok'], monto_distinto: ['Monto distinto', 'st-danger'], no_ingresada: ['No ingresada', 'st-danger'],
  fecha_distinta: ['No ingresada (mismo número, otra fecha)', 'st-danger'], anulada_en_sigam: ['Anulada en SIGAM', 'st-danger'],
};
export const estadoChip = (e, alt) => { const [t, c] = ESTADOS[alt || e] || [e, '']; return h('span', { class: 'estado ' + c }, t); };
export const TIPO_BODEGA = {
  central: 'Bodega central', despacho_medicamentos: 'Despacho de medicamentos', almacen_insumos: 'Almacén de insumos médicos',
  pequena_cirugia: 'Pequeña cirugía', campo: 'Campo', descarte: 'Descarte',
};

// ---------------------------------------------------------------- avisos
export function toast(msg, tipo = 'ok', ms = 4500) {
  let cont = $('#toasts');
  if (!cont) { cont = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(cont); }
  const t = h('div', { class: 'toast toast-' + tipo }, msg);
  cont.append(t);
  setTimeout(() => t.classList.add('fuera'), ms);
  setTimeout(() => t.remove(), ms + 400);
}
export const error = e => toast(e?.message || String(e), 'error', 8000);

export function modal(titulo, contenido, { acciones = [], ancho = '640px', alCerrar } = {}) {
  const fondo = h('div', { class: 'modal-fondo' });
  const cerrar = () => { fondo.remove(); document.removeEventListener('keydown', esc); alCerrar && alCerrar(); };
  const esc = e => { if (e.key === 'Escape') cerrar(); };
  const caja = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', style: { maxWidth: ancho } },
    h('div', { class: 'modal-cab' }, h('h3', {}, titulo), h('button', { class: 'btn-icono', 'aria-label': 'Cerrar', onclick: cerrar }, '✕')),
    h('div', { class: 'modal-cuerpo' }, contenido),
    acciones.length ? h('div', { class: 'modal-pie' }, acciones.map(a =>
      h('button', { class: 'btn ' + (a.clase || ''), onclick: async ev => {
        const b = ev.currentTarget; b.disabled = true;
        try { const r = await a.accion(); if (r !== false) cerrar(); } catch (e) { error(e); } finally { b.disabled = false; }
      } }, a.texto))) : null);
  fondo.append(caja);
  fondo.addEventListener('click', e => { if (e.target === fondo) cerrar(); });
  document.addEventListener('keydown', esc);
  document.body.append(fondo);
  setTimeout(() => caja.querySelector('input,select,textarea')?.focus(), 50);
  return { cerrar, caja };
}

export function confirmar(titulo, mensaje, textoOk = 'Confirmar', clase = 'btn-primario') {
  return new Promise(res => {
    const m = modal(titulo, h('p', {}, mensaje), {
      acciones: [{ texto: 'Cancelar', clase: 'btn-sec', accion: () => res(false) }, { texto: textoOk, clase, accion: () => res(true) }],
      alCerrar: () => res(false),
    });
    return m;
  });
}

export function pedirTexto(titulo, etiqueta, { minimo = 5, valor = '' } = {}) {
  return new Promise(res => {
    const inp = h('textarea', { rows: 3, class: 'campo' }, valor);
    modal(titulo, h('label', { class: 'fila-campo' }, h('span', {}, etiqueta), inp), {
      acciones: [{ texto: 'Cancelar', clase: 'btn-sec', accion: () => res(null) },
        { texto: 'Aceptar', clase: 'btn-primario', accion: () => {
          if (inp.value.trim().length < minimo) { toast(`Escriba al menos ${minimo} caracteres`, 'error'); return false; }
          res(inp.value.trim());
        } }],
      alCerrar: () => res(null),
    });
  });
}

// ---------------------------------------------------------------- tablas
// cols: [{t: 'Título', k: 'campo' | f: fila => valor/nodo, num: true, ancho, exportar: fila => valor}]
export function tabla(cols, filas, { vacio = 'Sin resultados', alClic, claseFila, max = 500 } = {}) {
  let orden = null, asc = true;
  const cuerpo = h('tbody');
  const pintar = () => {
    let fs = filas;
    if (orden) {
      const c = cols[orden];
      const val = r => c.ord ? c.ord(r) : c.k ? r[c.k] : (c.exportar ? c.exportar(r) : '');
      fs = [...filas].sort((a, b) => {
        const x = val(a), y = val(b);
        const r = (x ?? '') < (y ?? '') ? -1 : (x ?? '') > (y ?? '') ? 1 : 0;
        return asc ? r : -r;
      });
    }
    cuerpo.replaceChildren(...(fs.length ? fs.slice(0, max).map(r => {
      const tr = h('tr', { class: (claseFila ? claseFila(r) : '') + (alClic ? ' clicable' : '') },
        cols.map(c => h('td', { class: c.num ? 'num' : '' }, c.f ? c.f(r) : (c.num ? num(r[c.k]) : r[c.k] ?? ''))));
      if (alClic) tr.addEventListener('click', () => alClic(r));
      return tr;
    }) : [h('tr', {}, h('td', { colspan: cols.length, class: 'vacio' }, vacio))]));
  };
  const cab = h('thead', {}, h('tr', {}, cols.map((c, i) => h('th', {
    class: (c.num ? 'num ' : '') + 'ordenable', style: c.ancho ? { width: c.ancho } : null,
    onclick: () => { asc = orden === i ? !asc : true; orden = i; pintar(); },
  }, c.t))));
  pintar();
  const envoltura = h('div', { class: 'tabla-cont' }, h('table', { class: 'tabla' }, cab, cuerpo));
  if (filas.length > max) envoltura.append(h('p', { class: 'nota' }, `Se muestran ${max} de ${filas.length} filas. Use los filtros o exporte a Excel para ver todo.`));
  return envoltura;
}

// Exporta filas a Excel (carga la librería solo cuando se usa)
export async function exportarExcel(nombre, hojas) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook(); wb.creator = 'SIGAM-INABVE';
  for (const { titulo, cols, filas } of hojas) {
    const ws = wb.addWorksheet(titulo.slice(0, 31));
    ws.columns = cols.map(c => ({ header: c.t, key: c.t, width: c.ancho_xl || Math.max(12, c.t.length + 2) }));
    filas.forEach(r => ws.addRow(Object.fromEntries(cols.map(c => [c.t, c.exportar ? c.exportar(r) : r[c.k]]))));
    ws.getRow(1).eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF233152' } }; });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  }
  descargar(await wb.xlsx.writeBuffer(), nombre.endsWith('.xlsx') ? nombre : nombre + '.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

export function descargar(buffer, nombre, tipo) {
  const url = URL.createObjectURL(new Blob([buffer], { type: tipo }));
  const a = h('a', { href: url, download: nombre }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------------------------------------------------------- formularios
export const campo = (etiqueta, control, ayuda) =>
  h('label', { class: 'fila-campo' }, h('span', {}, etiqueta), control, ayuda ? h('small', {}, ayuda) : null);
export function select(opciones, valor, attrs = {}) {
  return h('select', { class: 'campo', ...attrs }, opciones.map(o => {
    const [v, t] = Array.isArray(o) ? o : [o.value ?? o.id, o.label ?? o.nombre];
    return h('option', { value: v, selected: String(v) === String(valor) }, t);
  }));
}
export const cargando = (texto = 'Cargando…') => h('div', { class: 'cargando' }, h('span', { class: 'giro' }), texto);
export const vacio = (texto, accion) => h('div', { class: 'vacio-grande' }, h('p', {}, texto), accion);

export function tarjeta(titulo, ...contenido) {
  return h('section', { class: 'tarjeta' }, titulo ? h('h2', {}, titulo) : null, ...contenido);
}

export function debounce(fn, ms = 250) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
