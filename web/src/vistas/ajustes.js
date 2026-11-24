// Ajustes de inventario (administradores y dependientes de la sede), con motivo obligatorio
import { h, toast, error, num, fecha, fechaHora, tabla, confirmar, chipsProducto, select } from '../ui.js';
import { sb, q, rpc, estado, bodegasOperables } from '../api.js';
import { buscadorProducto } from '../componentes.js';

export default async function () {
  const bodegas = bodegasOperables();
  let bodegaSel = bodegas[0]?.id, prod = null;
  const zona = h('div');
  const historial = h('div');
  const selB = select(bodegas.map(b => [b.id, `${b._sede} · ${b.nombre}`]), bodegaSel);
  selB.onchange = () => { bodegaSel = Number(selB.value); pintar(); };

  const pintar = async () => {
    if (!prod) return zona.replaceChildren();
    const lotes = await q(sb.from('lotes').select('id,numero_lote,fecha_vencimiento,disponible,estado').eq('bodega_id', bodegaSel).eq('producto_id', prod.id).order('fecha_vencimiento'));
    const selL = select(lotes.map(l => [l.id, `${l.numero_lote || 's/lote'} · vence ${fecha(l.fecha_vencimiento)} · ${num(l.disponible)} disp.${l.estado !== 'activo' ? ' · ' + l.estado : ''}`]), lotes[0]?.id);
    const tipo = select([['negativo', 'Disminuir (−)'], ['positivo', 'Aumentar (+)']], 'negativo');
    const cant = h('input', { class: 'campo', type: 'number', min: 0, step: 'any' });
    const motivo = h('textarea', { class: 'campo', rows: 2, placeholder: 'Ej.: blíster dañado, error de conteo, producto encontrado…' });
    zona.replaceChildren(h('h2', { style: { marginTop: '12px' } }, prod.nombre_comercial, ' ', chipsProducto(prod)),
      lotes.length ? h('div', {},
        h('div', { class: 'fila' }, h('label', { class: 'fila-campo' }, h('span', {}, 'Lote'), selL), h('label', { class: 'fila-campo' }, h('span', {}, 'Tipo'), tipo),
          h('label', { class: 'fila-campo' }, h('span', {}, 'Cantidad'), cant)),
        h('label', { class: 'fila-campo', style: { marginTop: '10px' } }, h('span', {}, 'Motivo (obligatorio)'), motivo),
        h('div', { class: 'botones', style: { marginTop: '12px' } }, h('button', { class: 'btn btn-primario', onclick: async ev => {
          if (!(Number(cant.value) > 0)) return toast('Indique la cantidad', 'error');
          if (motivo.value.trim().length < 5) return toast('Escriba el motivo del ajuste', 'error');
          if (!await confirmar('Registrar ajuste', `${tipo.value === 'positivo' ? 'Aumentar' : 'Disminuir'} ${cant.value} unidades del lote seleccionado. Quedará registrado con su usuario.`, 'Registrar')) return;
          ev.target.disabled = true;
          try { await rpc('registrar_ajuste', { p_lote: Number(selL.value), p_tipo: tipo.value, p_cantidad: Number(cant.value), p_motivo: motivo.value.trim() });
            toast('Ajuste registrado'); pintar(); cargarHistorial(); } catch (e) { error(e); } finally { ev.target.disabled = false; }
        } }, '⚖️ Registrar ajuste')))
        : h('p', { class: 'aviso aviso-info' }, 'Este producto no tiene lotes en la bodega seleccionada.'));
  };

  const cargarHistorial = async () => {
    const filas = await q(sb.from('ajustes').select('id,fecha,tipo,cantidad,motivo,usuario,bodega_id,productos(nombre_comercial),lotes(numero_lote)').order('id', { ascending: false }).limit(100));
    historial.replaceChildren(h('section', { class: 'tarjeta' }, h('h2', {}, 'Últimos ajustes'), tabla([
      { t: 'Fecha', f: r => fechaHora(r.fecha) }, { t: 'Bodega', f: r => estado.bodegas.find(b => b.id === r.bodega_id)?.nombre },
      { t: 'Producto', f: r => r.productos?.nombre_comercial }, { t: 'Lote', f: r => r.lotes?.numero_lote },
      { t: 'Cantidad', f: r => (r.tipo === 'positivo' ? '+' : '−') + num(r.cantidad), num: true }, { t: 'Motivo', k: 'motivo' }, { t: 'Usuario', k: 'usuario' }], filas)));
  };
  cargarHistorial();
  return h('div', {}, h('section', { class: 'tarjeta' },
    h('div', { class: 'fila' }, h('label', { class: 'fila-campo' }, h('span', {}, 'Bodega'), selB)),
    h('div', { style: { height: '10px' } }), buscadorProducto({ alElegir: p => { prod = p; pintar(); } }), zona), historial);
}
