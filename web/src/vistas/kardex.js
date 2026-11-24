// Kardex: todos los movimientos de un producto (y lote) por bodega
import { h, num, fecha, fechaHora, tabla, exportarExcel, chipsProducto, select } from '../ui.js';
import { sb, todas, estado, esAdmin, hoyISO } from '../api.js';
import { buscadorProducto } from '../componentes.js';

export default async function () {
  const zona = h('div');
  const info = h('div');
  let prod = null;
  const bodegas = esAdmin() ? estado.bodegas : estado.bodegas.filter(b => !b.solo_admin);
  const selB = select([['', 'Todas las bodegas'], ...bodegas.map(b => [b.id, `${b._sede} · ${b.nombre}`])], '');
  const desde = h('input', { type: 'date', class: 'campo', value: '2026-01-01' });
  const hasta = h('input', { type: 'date', class: 'campo', value: hoyISO() });
  const cols = [
    { t: 'Fecha', f: r => fechaHora(r.fecha), exportar: r => r.fecha, ord: r => r.fecha },
    { t: 'Sede', k: 'sede' }, { t: 'Bodega', k: 'bodega' }, { t: 'Movimiento', k: 'movimiento' }, { t: 'Documento', k: 'documento' },
    { t: 'Lote', k: 'numero_lote' }, { t: 'Vence', f: r => fecha(r.fecha_vencimiento), exportar: r => r.fecha_vencimiento },
    { t: 'Cantidad', f: r => h('strong', { style: { color: r.cantidad < 0 ? 'var(--danger)' : 'var(--ok)' } }, (r.cantidad > 0 ? '+' : '') + num(r.cantidad)), num: true, exportar: r => Number(r.cantidad), ord: r => Number(r.cantidad) },
    { t: 'Saldo del lote', k: 'saldo_lote', num: true, exportar: r => Number(r.saldo_lote) },
    { t: 'Usuario', k: 'usuario' }, { t: 'Observación', k: 'observacion' },
  ];
  const cargar = async () => {
    if (!prod) return;
    zona.replaceChildren(h('p', { class: 'nota' }, 'Cargando…'));
    const filas = await todas(() => {
      let c = sb.from('v_kardex').select('*').eq('producto_id', prod.id).gte('fecha', desde.value).lte('fecha', hasta.value + 'T23:59:59').order('fecha', { ascending: false }).order('id', { ascending: false });
      if (selB.value) c = c.eq('bodega_id', Number(selB.value));
      return c;
    });
    const ent = filas.filter(r => r.cantidad > 0).reduce((s, r) => s + Number(r.cantidad), 0);
    const sal = filas.filter(r => r.cantidad < 0).reduce((s, r) => s - Number(r.cantidad), 0);
    zona.replaceChildren(
      h('div', { class: 'botones' }, h('span', {}, `${filas.length} movimientos · entradas ${num(ent)} · salidas ${num(sal)}`), h('span', { class: 'espacio' }),
        h('button', { class: 'btn btn-sec', onclick: () => exportarExcel(`SIGAM_kardex_${prod.codigo || prod.id}`, [{ titulo: 'Kardex', cols, filas }]) }, '⬇ Excel')),
      h('div', { style: { height: '8px' } }), tabla(cols, filas, { vacio: 'Sin movimientos en este período' }));
  };
  [selB, desde, hasta].forEach(c => c.addEventListener('change', cargar));
  return h('section', { class: 'tarjeta' },
    buscadorProducto({ alElegir: p => { prod = p; info.replaceChildren(h('h2', { style: { marginTop: '12px' } }, p.nombre_comercial, ' ', chipsProducto(p)),
      h('p', { class: 'nota' }, [p.codigo, p.principio_activo, p.presentacion].filter(Boolean).join(' · '))); cargar(); } }),
    info,
    h('div', { class: 'filtros' }, h('label', { class: 'fila-campo' }, h('span', {}, 'Bodega'), selB),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Desde'), desde), h('label', { class: 'fila-campo' }, h('span', {}, 'Hasta'), hasta)),
    zona);
}
