// Liquidación de facturas: carga semanal del Excel de despachos y seguimiento por factura
import { h, toast, error, num, fecha, fechaHora, dinero, tabla, estadoChip, modal, select, confirmar, exportarExcel } from '../ui.js';
import { sb, q, rpc, todas, quitarTildes } from '../api.js';

const CAMPOS = [
  ['fecha', 'Fecha', ['fecha', 'fecha despacho', 'fecha de despacho', 'fecha entrega']],
  ['sede', 'Sede', ['sede', 'clinica', 'clínica', 'region', 'región', 'establecimiento']],
  ['codigo', 'Código del producto *', ['codigo', 'código', 'cod', 'codigo producto', 'codigo de barras']],
  ['cantidad', 'Cantidad *', ['cantidad', 'cant', 'unidades', 'cantidad entregada', 'cantidad despachada']],
  ['factura', 'Factura', ['factura', 'numero factura', 'n factura', 'no factura']],
  ['lote', 'Lote', ['lote', 'numero lote']],
  ['dui', 'DUI', ['dui', 'documento']],
  ['contrato', 'Contrato', ['contrato', 'nombrecontrato_sivetweb', 'nombre contrato']],
];

export default async function () {
  let pestana = 'facturas';
  const raiz = h('div');
  const pintar = async () => {
    raiz.replaceChildren(h('div', { class: 'pestanas' },
      [['facturas', 'Facturas'], ['cargar', 'Cargar Excel semanal'], ['cargas', 'Cargas anteriores']].map(([k, t]) =>
      h('button', { class: pestana === k ? 'activo' : '', onclick: () => { pestana = k; pintar(); } }, t))),
      pestana === 'facturas' ? await facturas() : pestana === 'cargar' ? cargar(() => { pestana = 'facturas'; pintar(); }) : await cargas());
  };
  await pintar();
  return raiz;
}

// ----------------------------------------------------------------------------- facturas
async function facturas() {
  const f = { fuente: 'excel', proveedor: '', estado: '', lista: false, texto: '' };
  const zona = h('div');
  const cargarDatos = async () => {
    zona.replaceChildren(h('p', { class: 'nota' }, 'Calculando…'));
    const vista = f.fuente === 'excel' ? 'v_liquidacion_excel' : 'v_avance_factura';
    let filas = await todas(() => sb.from(vista).select('*').order('fecha_factura', { ascending: false }));
    const provs = [...new Set(filas.map(r => r.proveedor))].sort();
    filas = filas.filter(r => (!f.proveedor || r.proveedor === f.proveedor) && (!f.estado || r.estado_liquidacion === f.estado) && (!f.lista || r.lista_para_liquidar)
      && (!f.texto || String(r.numero || '').includes(f.texto) || String(r.numero_sivet || '').includes(f.texto)));
    const cols = [
      { t: 'Factura', f: r => h('div', {}, h('strong', {}, r.numero_sivet || '—'), h('div', { class: 'nota' }, r.numero || '')), exportar: r => r.numero, ord: r => r.numero_sivet },
      { t: 'Fecha', f: r => fecha(r.fecha_factura), exportar: r => r.fecha_factura, ord: r => r.fecha_factura }, { t: 'Proveedor', k: 'proveedor' },
      { t: 'Productos', k: 'productos', num: true }, { t: 'Comprado', k: 'unidades_compradas', num: true }, { t: 'Entregado', k: 'unidades_entregadas', num: true },
      { t: 'Avance', f: r => h('div', { style: { minWidth: '110px' } }, h('div', { class: 'progreso' }, h('div', { style: { width: `${Math.min(100, r.porcentaje_entregado || 0)}%` } })), h('small', {}, `${num(r.porcentaje_entregado)} %`)),
        exportar: r => Number(r.porcentaje_entregado), ord: r => Number(r.porcentaje_entregado) },
      { t: 'Monto factura', f: r => dinero(r.monto_factura), num: true, exportar: r => Number(r.monto_factura), ord: r => Number(r.monto_factura) },
      { t: 'Lista', f: r => r.lista_para_liquidar ? h('span', { class: 'estado st-ok' }, '100 %') : '', exportar: r => r.lista_para_liquidar ? 'SÍ' : 'NO' },
      { t: 'Liquidación', f: r => estadoChip(r.estado_liquidacion), exportar: r => r.estado_liquidacion },
      { t: 'Fecha liq.', f: r => fecha(r.liquidacion_fecha), exportar: r => r.liquidacion_fecha },
    ];
    const tot = filas.filter(r => r.lista_para_liquidar && r.estado_liquidacion !== 'liquidada');
    zona.replaceChildren(
      h('div', { class: 'rejilla' },
        k('Facturas', filas.length), k('Listas para liquidar (no liquidadas)', tot.length, dinero(tot.reduce((s, r) => s + Number(r.monto_factura), 0))),
        k('En proceso', filas.filter(r => r.estado_liquidacion === 'en_proceso').length), k('Liquidadas', filas.filter(r => r.estado_liquidacion === 'liquidada').length)),
      h('div', { class: 'filtros', style: { marginTop: '12px' } },
        h('label', { class: 'fila-campo' }, h('span', {}, 'Calcular entregas con'), sel('fuente', [['excel', 'Excel cargado (SIVET)'], ['sigam', 'Despachos registrados en SIGAM']])),
        h('label', { class: 'fila-campo' }, h('span', {}, 'Proveedor'), sel('proveedor', [['', 'Todos'], ...provs.map(p => [p, p])])),
        h('label', { class: 'fila-campo' }, h('span', {}, 'Estado'), sel('estado', [['', 'Todos'], ['pendiente', 'Pendiente'], ['en_proceso', 'En proceso'], ['liquidada', 'Liquidada']])),
        h('label', { class: 'fila-campo' }, h('span', {}, 'Factura'), (() => { const i = h('input', { class: 'campo', value: f.texto, placeholder: 'Número' }); i.onchange = () => { f.texto = i.value.trim(); cargarDatos(); }; return i; })()),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.lista, onchange: e => { f.lista = e.target.checked; cargarDatos(); } }), 'Solo listas para liquidar'),
        h('button', { class: 'btn btn-sec', style: { flex: '0 0 auto' }, onclick: () => exportarExcel('SIGAM_liquidacion_facturas', [{ titulo: 'Facturas', cols, filas }]) }, '⬇ Excel')),
      tabla(cols, filas, { alClic: r => detalle(r, f.fuente, cargarDatos), claseFila: r => r.lista_para_liquidar && r.estado_liquidacion !== 'liquidada' ? 'fila-ok' : '' }));
  };
  const sel = (key, o) => { const s = select(o, f[key]); s.onchange = () => { f[key] = s.value; cargarDatos(); }; return s; };
  const k = (t, v, s) => h('div', { class: 'kpi' }, h('div', { class: 'kpi-titulo' }, t), h('div', { class: 'kpi-valor' }, num(v)), s ? h('div', { class: 'kpi-sub' }, s) : null);
  await cargarDatos();
  return h('section', { class: 'tarjeta' }, h('p', { class: 'nota' },
    'Una factura está lista para liquidar cuando se entregó el 100 % de lo comprado. Las entregas sin número de factura se asignan a la factura más antigua del mismo producto.'), zona);
}

async function detalle(fa, fuente, recargar) {
  const vista = fuente === 'excel' ? 'v_liquidacion_excel_detalle' : 'v_avance_factura_detalle';
  const lineas = await q(sb.from(vista).select('*').eq('factura_id', fa.factura_id));
  const prods = await q(sb.from('factura_detalle').select('id,cantidad,precio_unitario,numero_lote,fecha_vencimiento,productos(codigo,nombre_comercial)').eq('factura_id', fa.factura_id));
  const est = select([['pendiente', 'Pendiente'], ['en_proceso', 'En proceso de liquidar'], ['liquidada', 'Liquidada']], fa.estado_liquidacion);
  const obs = h('input', { class: 'campo', value: fa.liquidacion_obs || '', placeholder: 'Ej.: número de liquidación, fecha de envío a UFI' });
  modal(`Factura ${fa.numero_sivet || fa.numero} · ${fa.proveedor}`, h('div', {},
    tabla([{ t: 'Código', f: r => r.productos?.codigo }, { t: 'Producto', f: r => r.productos?.nombre_comercial }, { t: 'Lote', k: 'numero_lote' },
      { t: 'Comprado', k: 'cantidad', num: true }, { t: 'Entregado', f: r => num(Math.min(Number(lineas.find(l => l.factura_detalle_id === r.id)?.entregado || 0), Number(r.cantidad))), num: true },
      { t: 'Precio', f: r => dinero(r.precio_unitario), num: true }], prods),
    h('div', { class: 'fila', style: { marginTop: '12px' } }, h('label', { class: 'fila-campo' }, h('span', {}, 'Estado de liquidación'), est),
      h('label', { class: 'fila-campo', style: { flex: '2 1 300px' } }, h('span', {}, 'Observación'), obs))), {
    ancho: '960px',
    acciones: [{ texto: 'Guardar estado', clase: 'btn-primario', accion: async () => {
      if (est.value === 'liquidada' && !fa.lista_para_liquidar && !await confirmar('Factura incompleta', 'Esta factura no tiene el 100 % entregado. ¿Marcarla como liquidada de todas formas?', 'Sí, liquidar')) return false;
      await rpc('marcar_liquidacion', { p_factura: fa.factura_id, p_estado: est.value, p_obs: obs.value || null });
      toast('Estado de liquidación actualizado'); recargar();
    } }] });
}

// ----------------------------------------------------------------------------- carga semanal
function cargar(alTerminar) {
  const zona = h('div');
  const archivo = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', class: 'campo' });
  archivo.onchange = async () => {
    const file = archivo.files[0]; if (!file) return;
    zona.replaceChildren(h('p', { class: 'nota' }, 'Leyendo el archivo…'));
    try {
      const filas = await leerArchivo(file);
      if (!filas.length) throw new Error('El archivo no tiene filas');
      mapear(file.name, filas);
    } catch (e) { error(e); zona.replaceChildren(); }
  };
  const mapear = (nombre, filas) => {
    const cabeceras = Object.keys(filas[0]);
    const norm = s => quitarTildes(String(s).toLowerCase()).replace(/[_\-.]/g, ' ').replace(/\s+/g, ' ').trim();
    const mapa = {};
    CAMPOS.forEach(([k, , sin]) => { mapa[k] = cabeceras.find(c => sin.map(norm).includes(norm(c))) || ''; });
    const sels = CAMPOS.map(([k, t]) => { const s = select([['', '— no viene —'], ...cabeceras.map(c => [c, c])], mapa[k]); s.onchange = () => { mapa[k] = s.value; vista(); }; return h('label', { class: 'fila-campo' }, h('span', {}, t), s); });
    const prev = h('div');
    const vista = () => prev.replaceChildren(tabla(CAMPOS.map(([k, t]) => ({ t, f: r => mapa[k] ? String(r[mapa[k]] ?? '') : '' })), filas.slice(0, 8)));
    vista();
    zona.replaceChildren(h('h3', {}, `${nombre} · ${filas.length} filas`), h('p', { class: 'nota' }, 'Revise qué columna del Excel corresponde a cada dato. Se guardan solo los nombres de columna reconocidos; el resto de la fila queda como respaldo.'),
      h('div', { class: 'rejilla' }, sels), h('h3', { style: { marginTop: '12px' } }, 'Vista previa'), prev,
      h('div', { class: 'botones', style: { marginTop: '12px' } }, h('button', { class: 'btn btn-primario', onclick: async ev => {
        if (!mapa.codigo || !mapa.cantidad) return toast('Indique al menos las columnas de código y cantidad', 'error');
        ev.target.disabled = true;
        try {
          const p_filas = filas.map(r => ({ ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 10) : v])),
            fecha: aFecha(r[mapa.fecha]), sede: mapa.sede ? r[mapa.sede] : null, codigo: String(r[mapa.codigo] ?? '').trim(), cantidad: aNum(r[mapa.cantidad]),
            factura: mapa.factura ? String(r[mapa.factura] ?? '') : null, lote: mapa.lote ? String(r[mapa.lote] ?? '') : null,
            dui: mapa.dui ? String(r[mapa.dui] ?? '') : null, contrato: mapa.contrato ? String(r[mapa.contrato] ?? '') : null }))
            .filter(r => r.codigo && r.cantidad);
          const res = await rpc('importar_despachos', { p_archivo: nombre, p_filas });
          toast(`Carga guardada: ${res.filas} filas${res.sin_producto ? ` (${res.sin_producto} con código que no está en el catálogo)` : ''}`, res.sin_producto ? 'info' : 'ok', 8000);
          alTerminar();
        } catch (e) { error(e); } finally { ev.target.disabled = false; }
      } }, '⬆ Guardar carga')));
  };
  return h('section', { class: 'tarjeta' },
    h('p', {}, 'Suba cada semana el Excel con todo lo despachado. El sistema reparte esas entregas entre las facturas y marca las que ya se pueden liquidar.'),
    h('label', { class: 'fila-campo' }, h('span', {}, 'Archivo (.xlsx o .csv)'), archivo), zona);
}

export async function leerArchivo(file) {
  if (/\.csv$/i.test(file.name)) {
    const texto = await file.text();
    const [cab, ...lineas] = texto.split(/\r?\n/).filter(Boolean);
    const sep = cab.includes(';') ? ';' : ',';
    const cols = cab.split(sep).map(s => s.trim().replace(/^"|"$/g, ''));
    return lineas.map(l => Object.fromEntries(l.split(sep).map((v, i) => [cols[i], v.trim().replace(/^"|"$/g, '')])));
  }
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  let cab = null; const filas = [];
  ws.eachRow((row) => {
    const vals = row.values.slice(1).map(v => (v && typeof v === 'object' && 'result' in v) ? v.result : (v && typeof v === 'object' && 'text' in v) ? v.text : v);
    if (!cab) { if (vals.filter(v => v !== null && v !== undefined && v !== '').length >= 2) cab = vals.map((v, i) => String(v ?? `Columna ${i + 1}`).trim()); return; }
    if (vals.every(v => v === null || v === undefined || v === '')) return;
    filas.push(Object.fromEntries(cab.map((c, i) => [c, vals[i] ?? null])));
  });
  return filas;
}
const aNum = v => { if (v === null || v === undefined || v === '') return null; const n = Number(String(v).replace(/,/g, '')); return isFinite(n) ? n : null; };
function aFecha(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[0];
  if (/^\d{5}$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Number(s) * 864e5).toISOString().slice(0, 10);
  return null;
}

async function cargas() {
  const filas = await q(sb.from('importaciones_despacho').select('*').order('id', { ascending: false }));
  const zona = h('section', { class: 'tarjeta' }, tabla([
    { t: 'Cargado', f: r => fechaHora(r.cargado_at) }, { t: 'Archivo', k: 'archivo' }, { t: 'Desde', f: r => fecha(r.desde) }, { t: 'Hasta', f: r => fecha(r.hasta) },
    { t: 'Filas', k: 'filas', num: true }, { t: 'Sin producto', k: 'filas_sin_producto', num: true }, { t: 'Usuario', k: 'cargado_por' },
    { t: '', f: r => h('button', { class: 'btn btn-sec btn-peq', onclick: async () => {
      if (!await confirmar('Eliminar carga', `Se eliminará la carga "${r.archivo}" y sus ${r.filas} filas. La liquidación se recalcula sin ella.`, 'Eliminar', 'btn-peligro')) return;
      try { await rpc('eliminar_importacion', { p_id: r.id }); toast('Carga eliminada'); zona.replaceWith(await cargas()); } catch (e) { error(e); }
    } }, 'Eliminar') },
  ], filas, { vacio: 'Todavía no se ha cargado ningún Excel' }));
  return zona;
}
