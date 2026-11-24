// Conciliación de existencias con SIVET (solo administradores).
// Se sube el Excel "DetallesContrato" de cada contrato; SIVET manda.
// Bodega Central y Pequeña Cirugía conservan lo que tiene SIGAM; el resto de la
// sede (despacho, almacén, campo) queda igual a SIVET.
import { h, toast, error, num, fechaHora, tabla, select, confirmar, exportarExcel } from '../ui.js';
import { sb, q, rpc, quitarTildes } from '../api.js';
import { leerArchivo } from './liquidacion.js';

const norm = s => quitarTildes(String(s ?? '')).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

// "Contrato_CEFAFA_-_MEDICAMENTOS_-_JUAN_PABLO_II-1_4.xlsx" → contrato "CEFAFA - MEDICAMENTOS - JUAN PABLO II"
export function detectarContrato(nombreArchivo, contratos) {
  let n = norm(nombreArchivo.replace(/\.[a-z]+$/i, '').replace(/^contrato[_\s-]*/i, ''));
  const cands = contratos.map(c => ({ c, k: norm(c.nombre_sivet) })).sort((a, b) => b.k.length - a.k.length);
  for (let i = 0; i < 4; i++) {
    const hit = cands.find(x => n === x.k) || cands.find(x => n.startsWith(x.k + ' ') || n.startsWith(x.k));
    if (hit) return hit.c.id;
    n = n.replace(/\s*\d+(\s\d+)?$/, '').trim();    // quita sufijos como "1 4" o "(2)"
  }
  return '';
}

const COLS = { codigo: ['CODIGO'], producto: ['PRODUCTO'], factura: ['NUM FACTURA', 'NUMERO FACTURA', 'NO FACTURA', 'FACTURA'],
  stock: ['STOCK', 'EXISTENCIA', 'DISPONIBLE ACTUAL'], precio: ['PRECIO'], fecha: ['FECHA FACTURA'] };

export function aFilasSivet(filas) {
  if (!filas.length) throw new Error('El archivo no tiene filas');
  const cab = Object.keys(filas[0]);
  const m = Object.fromEntries(Object.entries(COLS).map(([k, alias]) => [k, cab.find(c => alias.includes(norm(c)))]));
  if (!m.stock || (!m.codigo && !m.producto)) throw new Error('No parece un Excel de contrato de SIVET: faltan las columnas "Codigo", "Producto" o "Stock"');
  const txt = v => v instanceof Date ? v.toISOString().slice(0, 10) : v === null || v === undefined ? null : String(v).trim();
  return filas.map(r => ({ codigo: txt(r[m.codigo]), producto: txt(r[m.producto]), factura: m.factura ? txt(r[m.factura]) : null,
    stock: txt(r[m.stock]) ?? '0', precio: m.precio ? txt(r[m.precio]) : null, fecha: m.fecha ? txt(r[m.fecha]) : null }))
    .filter(r => r.codigo || r.producto);
}

export default async function () {
  const contratos = await q(sb.from('contratos').select('id, nombre_sivet, tipo, sede_id').eq('activo', true).order('nombre_sivet'));
  let pestana = 'cargar';
  const raiz = h('div');
  const pintar = async () => raiz.replaceChildren(
    h('div', { class: 'pestanas' }, [['cargar', 'Conciliar con SIVET'], ['historial', 'Historial']].map(([k, t]) =>
      h('button', { class: pestana === k ? 'activo' : '', onclick: () => { pestana = k; pintar(); } }, t))),
    pestana === 'cargar' ? cargar(contratos) : await historial());
  await pintar();
  return raiz;
}

function cargar(contratos) {
  const lista = h('div');
  const archivo = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', multiple: true, class: 'campo' });
  archivo.onchange = async () => {
    for (const file of archivo.files) {
      const caja = h('section', { class: 'tarjeta' }, h('p', { class: 'nota' }, `Leyendo ${file.name}…`));
      lista.prepend(caja);
      try { await panelArchivo(caja, file, contratos); }
      catch (e) { caja.replaceChildren(h('h3', {}, file.name), h('p', { class: 'aviso aviso-error' }, e.message || String(e))); }
    }
    archivo.value = '';
  };
  return h('div', {},
    h('section', { class: 'tarjeta' },
      h('h2', {}, 'Conciliar existencias con SIVET'),
      h('p', {}, 'Descargue de SIVET el Excel de cada contrato (hoja "DetallesContrato") y súbalo aquí; puede seleccionar varios a la vez. SIVET manda:'),
      h('ul', {},
        h('li', {}, 'Bodega Central y Pequeña Cirugía no cambian: conservan las existencias de SIGAM y se descuentan del stock de SIVET.'),
        h('li', {}, 'Despacho de Medicamentos, Almacén de Insumos y Campo de la sede quedan con el resto, usando los lotes que ya existen (primero los de la misma factura).'),
        h('li', {}, 'Lo que falte se suma al lote de esa factura o se crea en el Despacho (medicamentos) o Almacén (insumos). Lo que SIVET ya no tiene queda en cero.'),
        h('li', {}, 'Primero verá una vista previa; nada cambia hasta que presione "Aplicar". Cada cambio queda en el kardex como "Conciliación SIVET".')),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Excel de contrato SIVET'), archivo)),
    lista);
}

async function panelArchivo(caja, file, contratos) {
  const filas = aFilasSivet(await leerArchivo(file));
  const sel = select([['', '— Elija el contrato —'], ...contratos.map(c => [c.id, c.nombre_sivet])], detectarContrato(file.name, contratos));
  const zona = h('div');
  const btnPrev = h('button', { class: 'btn btn-primario', onclick: () => previa() }, 'Ver vista previa');
  sel.onchange = () => zona.replaceChildren();
  caja.replaceChildren(
    h('h3', {}, file.name), h('p', { class: 'nota' }, `${filas.length} líneas de factura · stock total ${num(filas.reduce((s, r) => s + (Number(r.stock) || 0), 0))}`),
    h('div', { class: 'filtros' }, h('label', { class: 'fila-campo' }, h('span', {}, 'Contrato'), sel), btnPrev), zona);

  async function previa() {
    if (!sel.value) return toast('Elija el contrato al que corresponde el archivo', 'error');
    btnPrev.disabled = true; zona.replaceChildren(h('p', { class: 'nota' }, 'Calculando…'));
    try {
      const r = await rpc('conciliar_sivet', { p_contrato: Number(sel.value), p_filas: filas, p_aplicar: false });
      mostrar(r);
    } catch (e) { error(e); zona.replaceChildren(); } finally { btnPrev.disabled = false; }
  }

  function mostrar(r) {
    let soloCambios = true;
    const tablaZona = h('div');
    const cols = [
      { t: 'Código', k: 'codigo' }, { t: 'Producto', k: 'producto' },
      { t: 'SIVET', k: 'sivet', num: true }, { t: 'Central + P. Cirugía', k: 'central_pc', num: true },
      { t: 'SIGAM antes', k: 'actual', num: true }, { t: 'Queda', k: 'final', num: true },
      { t: 'Diferencia', num: true, f: x => h('strong', { style: { color: Number(x.diferencia) > 0 ? 'var(--ok)' : Number(x.diferencia) < 0 ? 'var(--danger)' : '' } }, (Number(x.diferencia) > 0 ? '+' : '') + num(x.diferencia)),
        exportar: x => Number(x.diferencia), ord: x => Number(x.diferencia) },
      { t: 'Nota', f: x => [Number(x.lotes_nuevos) ? 'lote nuevo' : '', Number(x.central_pc_excede) ? `Central/P.C. tiene ${num(x.central_pc_excede)} más que SIVET` : ''].filter(Boolean).join(' · '),
        exportar: x => [Number(x.lotes_nuevos) ? 'lote nuevo' : '', Number(x.central_pc_excede) ? `Central/P.C. excede ${x.central_pc_excede}` : ''].filter(Boolean).join(' · ') },
    ];
    const pintarTabla = () => tablaZona.replaceChildren(tabla(cols, soloCambios ? r.detalle.filter(x => Number(x.diferencia) !== 0 || Number(x.central_pc_excede)) : r.detalle, { vacio: 'Sin diferencias: SIGAM ya coincide con SIVET' }));
    const chk = h('input', { type: 'checkbox', checked: true, onchange: e => { soloCambios = e.target.checked; pintarTabla(); } });
    pintarTabla();
    const k = (t, v, color) => h('div', { class: 'kpi' }, h('div', { class: 'kpi-titulo' }, t), h('div', { class: 'kpi-valor', style: color ? { color } : null }, v));
    const btnAplicar = h('button', { class: 'btn btn-primario', onclick: aplicar }, '✔ Aplicar conciliación');
    zona.replaceChildren(
      h('div', { class: 'rejilla' },
        k('Stock SIVET', num(r.sivet_total)), k('Se conserva en Central y P. Cirugía', num(r.conservado_total)),
        k('Despacho/Almacén/Campo antes', num(r.actual_total)), k('Queda después', num(r.final_total)),
        k('Aumenta', '+' + num(r.aumenta), 'var(--ok)'), k('Disminuye', '−' + num(r.disminuye), 'var(--danger)'),
        k('Productos que cambian', num(r.productos_cambian)), k('Lotes que se crean o reponen', num(r.lotes_nuevos))),
      r.no_encontrados?.length ? h('div', { class: 'aviso aviso-warn' },
        h('strong', {}, `${r.no_encontrados.length} línea(s) de SIVET no se encontraron en el catálogo (${num(r.no_encontrado_total)} unidades) y no se cargarán:`),
        h('ul', {}, r.no_encontrados.slice(0, 15).map(x => h('li', {}, `Fila ${x.fila}: ${x.codigo || 'sin código'} · ${x.producto} · factura ${x.factura || '—'} · ${num(x.stock)} u.`))),
        h('small', {}, 'Agregue esos productos al catálogo (Administración) con el mismo código de SIVET y vuelva a subir el archivo.')) : null,
      Number(r.conservado_excede) > 0 ? h('div', { class: 'aviso aviso-info' },
        `Bodega Central y Pequeña Cirugía tienen ${num(r.conservado_excede)} unidades más de lo que SIVET registra para este contrato. No se modifican; revise esos productos (columna Nota).`) : null,
      Number(r.carga_inicial_sin_usar) > 0 ? h('p', { class: 'nota' },
        `${num(r.carga_inicial_sin_usar)} unidades en lotes sin contrato (carga inicial de SIFAR) no se usaron y se dejan como están: pueden pertenecer a otro contrato.`) : null,
      h('div', { class: 'filtros', style: { marginTop: '10px' } },
        h('label', { class: 'check' }, chk, ' Mostrar solo productos con diferencia'),
        h('button', { class: 'btn btn-sec', onclick: () => exportarExcel(`SIGAM_conciliacion_${(r.contrato || 'contrato').replace(/\W+/g, '_')}`,
          [{ titulo: 'Conciliación', cols, filas: r.detalle }, { titulo: 'No encontrados', cols: [{ t: 'Fila', k: 'fila' }, { t: 'Código', k: 'codigo' }, { t: 'Producto', k: 'producto' }, { t: 'Factura', k: 'factura' }, { t: 'Stock', k: 'stock' }], filas: r.no_encontrados || [] }]) }, '⬇ Excel'),
        btnAplicar),
      tablaZona);

    async function aplicar() {
      if (!await confirmar('Aplicar conciliación',
        `${r.contrato}: Despacho, Almacén y Campo de la sede quedarán con ${num(r.final_total)} unidades (antes ${num(r.actual_total)}). ` +
        'Central y Pequeña Cirugía no cambian. Cada cambio quedará en el kardex. ¿Continuar?', 'Aplicar')) return;
      btnAplicar.disabled = true;
      try {
        const res = await rpc('conciliar_sivet', { p_contrato: Number(sel.value), p_filas: filas, p_aplicar: true, p_archivo: file.name });
        toast(`Conciliación aplicada: +${num(res.aumenta)} / −${num(res.disminuye)}${res.lotes_sin_vencimiento ? ` · ${res.lotes_sin_vencimiento} lote(s) nuevos sin vencimiento: complételos en Administración` : ''}`, 'ok', 10000);
        caja.replaceChildren(h('h3', {}, `✔ ${file.name}`), h('p', {}, `${res.contrato} conciliado. Antes ${num(res.actual_total)} · ahora ${num(res.final_total)} unidades en Despacho/Almacén/Campo.`),
          res.lotes_sin_vencimiento ? h('p', { class: 'aviso aviso-warn' }, `${res.lotes_sin_vencimiento} lote(s) se crearon sin número de lote ni vencimiento (la factura no estaba en SIGAM). Aparecen como "SIVET-<factura>".`) : null);
      } catch (e) { error(e); btnAplicar.disabled = false; }
    }
  }
}

async function historial() {
  const filas = await q(sb.from('v_conciliaciones').select('*').order('id', { ascending: false }).limit(200));
  return h('section', { class: 'tarjeta' }, tabla([
    { t: 'Fecha', f: r => fechaHora(r.creado_at), ord: r => r.creado_at }, { t: 'Contrato', k: 'contrato' }, { t: 'Archivo', k: 'archivo' },
    { t: 'SIVET', k: 'sivet_total', num: true }, { t: 'Antes', k: 'antes', num: true }, { t: 'Después', k: 'despues', num: true },
    { t: 'Aumenta', k: 'aumenta', num: true }, { t: 'Disminuye', k: 'disminuye', num: true }, { t: 'Lotes creados', k: 'lotes_creados', num: true },
    { t: 'No encontrados', k: 'no_encontrados', num: true }, { t: 'Usuario', k: 'usuario' },
  ], filas, { vacio: 'Todavía no se ha conciliado ningún contrato' }));
}
