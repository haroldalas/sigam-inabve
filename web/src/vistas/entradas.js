// Entradas (facturas) en la bodega central.
// Medicamento o proveedor CEFAFA: todo obligatorio. Otro proveedor con insumo médico: solo el precio unitario.
import { h, toast, error, num, fecha, dinero, chipsProducto, tabla, estadoChip, modal, confirmar, pedirTexto, exportarExcel, select } from '../ui.js';
import { sb, q, rpc, todas, estado, esAdmin, hoyISO } from '../api.js';
import { buscadorProducto } from '../componentes.js';

export default async function () {
  const centrales = estado.bodegas.filter(b => b.permite_entradas);
  const provs = await q(sb.from('proveedores').select('*').eq('activo', true).eq('es_carga_inicial', false).order('nombre'));
  const st = { bodega: centrales[0]?.id, proveedor: provs.find(p => p.es_cefafa)?.id, lineas: [] };
  const numero = h('input', { class: 'campo', placeholder: 'Número de factura o DTE' });
  const fechaF = h('input', { class: 'campo', type: 'date', max: hoyISO() });
  const acta = h('input', { class: 'campo', placeholder: 'Número de acta de recepción' });
  const obs = h('input', { class: 'campo', placeholder: 'Observaciones' });
  const zona = h('div', { class: 'lineas' });
  const zonaRecientes = h('div');
  const prov = () => provs.find(p => p.id === st.proveedor);
  const completo = p => p.tipo === 'medicamento' || prov()?.es_cefafa;

  const pintar = () => {
    const hayCompleto = st.lineas.some(l => completo(l.p));
    [numero, fechaF].forEach(c => c.required = hayCompleto || prov()?.es_cefafa);
    zona.replaceChildren(...(st.lineas.length ? st.lineas.map(l => {
      const req = completo(l.p);
      const c = (k, attrs) => { const i = h('input', { class: 'campo', value: l[k] ?? '', ...attrs }); i.oninput = () => { l[k] = i.value; i.classList.remove('campo-error'); }; return i; };
      return h('div', { class: 'linea', style: { gridTemplateColumns: '1.6fr repeat(4, minmax(90px, 1fr)) auto' } },
        h('div', { class: 'linea-nombre' }, h('strong', {}, l.p.nombre_comercial, ' ', chipsProducto(l.p)),
          h('small', {}, [l.p.codigo, l.p.presentacion, l.p.tipo === 'insumo' ? 'Insumo médico' : 'Medicamento'].filter(Boolean).join(' · ')),
          h('small', { style: { display: 'block', color: req ? 'var(--danger)' : 'var(--suave)' } }, req ? 'Todos los campos son obligatorios' : 'Solo el precio es obligatorio')),
        h('label', { class: 'fila-campo' }, h('span', {}, 'Cantidad *'), c('cantidad', { type: 'number', min: 0, step: 'any', 'data-k': 'cantidad' })),
        h('label', { class: 'fila-campo' }, h('span', {}, 'Precio unitario *'), c('precio', { type: 'number', min: 0, step: '0.0001', 'data-k': 'precio' })),
        h('label', { class: 'fila-campo' }, h('span', {}, 'Lote' + (req ? ' *' : '')), c('lote', { 'data-k': 'lote' })),
        h('label', { class: 'fila-campo' }, h('span', {}, 'Vencimiento' + (req ? ' *' : '')), c('venc', { type: 'date', min: hoyISO(), 'data-k': 'venc' })),
        h('button', { class: 'btn-icono', onclick: () => { st.lineas = st.lineas.filter(x => x !== l); pintar(); } }, '🗑'));
    }) : [h('p', { class: 'nota' }, 'Escanee o busque cada producto de la factura.')]));
  };

  const guardar = async ev => {
    if (!st.lineas.length) return toast('Agregue los productos de la factura', 'error');
    const faltan = [];
    st.lineas.forEach((l, i) => {
      if (!(Number(l.cantidad) > 0)) faltan.push(`línea ${i + 1}: cantidad`);
      if (l.precio === undefined || l.precio === '') faltan.push(`línea ${i + 1}: precio`);
      if (completo(l.p) && (!l.lote || !l.venc)) faltan.push(`línea ${i + 1}: lote y vencimiento`);
    });
    if (st.lineas.some(l => completo(l.p)) && (!numero.value.trim() || !fechaF.value)) faltan.push('número y fecha de factura');
    if (faltan.length) return toast('Falta: ' + faltan.join('; '), 'error', 8000);
    const total = st.lineas.reduce((s, l) => s + Number(l.cantidad) * Number(l.precio), 0);
    if (!await confirmar('Registrar entrada', `${prov().nombre} · ${st.lineas.length} producto(s) · ${dinero(total)}. ¿Registrar?`, 'Registrar')) return;
    ev.target.disabled = true;
    try {
      const r = await rpc('registrar_entrada', { p: { bodega_id: st.bodega, proveedor_id: st.proveedor, numero: numero.value.trim() || null,
        fecha_factura: fechaF.value || null, acta_recepcion: acta.value.trim() || null, observaciones: obs.value.trim() || null,
        lineas: st.lineas.map(l => ({ producto_id: l.p.id, cantidad: Number(l.cantidad), precio_unitario: Number(l.precio),
          numero_lote: l.lote || null, fecha_vencimiento: l.venc || null })) } });
      toast(`Entrada registrada (${r.lineas} productos)`);
      st.lineas = []; [numero, fechaF, acta, obs].forEach(c => { c.value = ''; }); pintar(); recientes();
    } catch (e) { error(e); } finally { ev.target.disabled = false; }
  };

  const recientes = async () => {
    const filas = await q(sb.from('facturas').select('id,numero,numero_sivet,fecha_factura,creado_at,creado_por,estado,proveedores(nombre),factura_detalle(cantidad,precio_unitario)')
      .order('id', { ascending: false }).limit(50));
    zonaRecientes.replaceChildren(h('section', { class: 'tarjeta' }, h('h2', {}, 'Últimas entradas'),
      tabla([
        { t: 'Registro', f: r => fecha(r.creado_at) }, { t: 'Proveedor', f: r => r.proveedores?.nombre },
        { t: 'Factura', k: 'numero' }, { t: 'Fecha factura', f: r => fecha(r.fecha_factura) },
        { t: 'Productos', f: r => r.factura_detalle.length, num: true },
        { t: 'Monto', f: r => dinero(r.factura_detalle.reduce((s, d) => s + d.cantidad * d.precio_unitario, 0)), num: true },
        { t: 'Estado', f: r => estadoChip(r.estado) }, { t: 'Registró', k: 'creado_por' },
        { t: '', f: r => h('div', { class: 'botones' },
          h('button', { class: 'btn btn-sec btn-peq', onclick: async e => { e.stopPropagation(); await excelEntrada(r); } }, '⬇ TICS'),
          esAdmin() && r.estado === 'confirmada' ? h('button', { class: 'btn btn-sec btn-peq', onclick: async e => {
            e.stopPropagation(); const m = await pedirTexto('Anular entrada', 'Motivo'); if (!m) return;
            try { await rpc('anular_entrada', { p_factura: r.id, p_motivo: m }); toast('Entrada anulada'); recientes(); } catch (er) { error(er); }
          } }, 'Anular') : null) },
      ], filas)));
  };

  const selProv = select(provs.map(p => [p.id, p.nombre]), st.proveedor); selProv.onchange = () => { st.proveedor = Number(selProv.value); pintar(); };
  const selBod = select(centrales.map(b => [b.id, b.nombre]), st.bodega); selBod.onchange = () => { st.bodega = Number(selBod.value); };
  pintar(); recientes();
  return h('div', {},
    h('section', { class: 'tarjeta' },
      h('div', { class: 'fila' },
        h('label', { class: 'fila-campo' }, h('span', {}, 'Bodega'), selBod),
        h('label', { class: 'fila-campo' }, h('span', {}, 'Proveedor (contrato)'), selProv),
        h('label', { class: 'fila-campo' }, h('span', {}, 'Número de factura'), numero),
        h('label', { class: 'fila-campo' }, h('span', {}, 'Fecha de factura'), fechaF),
        h('label', { class: 'fila-campo' }, h('span', {}, 'Acta de recepción'), acta)),
      h('div', { style: { height: '12px' } }),
      buscadorProducto({ alElegir: p => { st.lineas.unshift({ p, cantidad: '', precio: '', lote: '', venc: '' }); pintar(); setTimeout(() => zona.querySelector('[data-k="cantidad"]')?.focus(), 30); } }),
      zona,
      h('label', { class: 'fila-campo' }, h('span', {}, 'Observaciones'), obs),
      h('div', { class: 'botones', style: { marginTop: '12px' } }, h('button', { class: 'btn btn-primario btn-grande', onclick: guardar }, '📑 Registrar entrada'))),
    zonaRecientes);
}

async function excelEntrada(f) {
  const filas = await todas(() => sb.from('v_sivet_entrada').select('*').eq('factura_id', f.id).order('correlativo'));
  await exportarExcel(`SIGAM_entrada_${f.numero_sivet || f.id}_SIVET`, [{ titulo: 'MIGRAR', filas, cols: [
    { t: 'Correlativo', k: 'correlativo' }, { t: 'Codigo', k: 'codigo' }, { t: 'Cantidad', k: 'cantidad', exportar: r => Number(r.cantidad) },
    { t: 'Precio', exportar: r => Number(r.precio) }, { t: 'Total', exportar: r => Number(r.total) }, { t: 'Factura', k: 'factura' },
    { t: 'Fecha de factura', k: 'fecha_factura' }, { t: 'NombreContrato_SIVETWEB', k: 'nombre_contrato_sivetweb', ancho_xl: 40 },
    { t: 'Lote', k: 'lote' }, { t: 'Fecha de vencimiento', k: 'fecha_vencimiento' }, { t: 'Clasificacion AWaRe', k: 'clasificacion_aware' },
    { t: 'Refrigerado', k: 'refrigerado' }, { t: 'Controlado', k: 'controlado' }, { t: 'Categoria', k: 'categoria' }] }]);
}
