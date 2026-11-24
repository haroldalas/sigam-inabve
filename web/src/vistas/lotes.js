// Bloqueo, cuarentena y liberación de lotes (retiro sanitario, daño) en todas las sedes
import { h, toast, error, num, fecha, fechaHora, tabla, estadoChip, modal, select, chipsProducto } from '../ui.js';
import { sb, q, rpc, estado } from '../api.js';
import { buscadorProducto } from '../componentes.js';

export default async function () {
  const zona = h('div');
  const historial = h('div');
  let prod = null;

  const pintar = async () => {
    if (!prod) return;
    const lotes = await q(sb.from('lotes').select('id,numero_lote,fecha_vencimiento,disponible,estado,bodega_id').eq('producto_id', prod.id)
      .or('disponible.gt.0,estado.in.(bloqueado,cuarentena)').order('fecha_vencimiento'));
    // agrupa las copias del mismo lote en las distintas bodegas
    const grupos = new Map();
    lotes.forEach(l => { const k = `${l.numero_lote}|${l.fecha_vencimiento}`; (grupos.get(k) || grupos.set(k, []).get(k)).push(l); });
    zona.replaceChildren(h('h2', { style: { marginTop: '12px' } }, prod.nombre_comercial, ' ', chipsProducto(prod)),
      tabla([
        { t: 'Lote', f: g => g[0].numero_lote || 's/lote' }, { t: 'Vence', f: g => fecha(g[0].fecha_vencimiento) },
        { t: 'Bodegas', f: g => g.map(l => `${nomB(l.bodega_id)} (${num(l.disponible)})`).join(' · ') },
        { t: 'Total', f: g => num(g.reduce((s, l) => s + Number(l.disponible), 0)), num: true },
        { t: 'Estado', f: g => estadoChip(g.some(l => l.estado === 'bloqueado') ? 'bloqueado' : g.some(l => l.estado === 'cuarentena') ? 'cuarentena' : 'activo') },
        { t: '', f: g => h('button', { class: 'btn btn-sec btn-peq' }, 'Cambiar') },
      ], [...grupos.values()], { alClic: accion, vacio: 'Sin lotes con existencia' }));
  };

  const accion = g => {
    const bloqueado = g.some(l => ['bloqueado', 'cuarentena'].includes(l.estado));
    const tipo = select(bloqueado ? [['liberar', 'Liberar (vuelve a estar disponible)']] : [['bloqueado', 'Bloquear (no se despacha ni se traslada)'], ['cuarentena', 'Cuarentena (en revisión)']], bloqueado ? 'liberar' : 'bloqueado');
    const todas = h('input', { type: 'checkbox', checked: true });
    const motivo = h('textarea', { class: 'campo', rows: 2, placeholder: 'Ej.: alerta sanitaria de la SRS, empaque dañado' });
    modal(`Lote ${g[0].numero_lote || 's/lote'} · vence ${fecha(g[0].fecha_vencimiento)}`, h('div', {},
      h('label', { class: 'fila-campo' }, h('span', {}, 'Acción'), tipo),
      h('label', { class: 'check' }, todas, `Aplicar en todas las sedes donde está este lote (${g.length} bodega/s)`),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Motivo (obligatorio)'), motivo)), {
      acciones: [{ texto: 'Aplicar', clase: 'btn-primario', accion: async () => {
        if (motivo.value.trim().length < 5) { toast('Escriba el motivo', 'error'); return false; }
        const n = tipo.value === 'liberar'
          ? await rpc('liberar_lote', { p_lote: g[0].id, p_motivo: motivo.value.trim(), p_todas_sedes: todas.checked })
          : await rpc('bloquear_lote', { p_lote: g[0].id, p_estado: tipo.value, p_motivo: motivo.value.trim(), p_todas_sedes: todas.checked });
        toast(`${n} lote(s) actualizados`); pintar(); cargarHistorial();
      } }] });
  };

  const cargarHistorial = async () => {
    const filas = await q(sb.from('bloqueos_lote').select('*,lotes(numero_lote,fecha_vencimiento,bodega_id,productos(nombre_comercial))').order('id', { ascending: false }).limit(100));
    historial.replaceChildren(h('section', { class: 'tarjeta' }, h('h2', {}, 'Historial de bloqueos'), tabla([
      { t: 'Fecha', f: r => fechaHora(r.fecha) }, { t: 'Producto', f: r => r.lotes?.productos?.nombre_comercial }, { t: 'Lote', f: r => r.lotes?.numero_lote },
      { t: 'Bodega', f: r => nomB(r.lotes?.bodega_id) }, { t: 'Acción', f: r => estadoChip(r.accion === 'liberado' ? 'activo' : r.accion) },
      { t: 'Motivo', k: 'motivo' }, { t: 'Usuario', k: 'usuario' }], filas, { vacio: 'Sin bloqueos registrados' })));
  };
  const nomB = id => { const b = estado.bodegas.find(x => x.id === id); return b ? `${b.nombre}` : ''; };

  cargarHistorial();
  return h('div', {}, h('section', { class: 'tarjeta' },
    h('p', { class: 'nota' }, 'Un lote bloqueado o en cuarentena no se puede despachar ni trasladar en ninguna bodega hasta que se libere.'),
    buscadorProducto({ alElegir: p => { prod = p; pintar(); } }), zona), historial);
}
