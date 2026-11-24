// Devoluciones de pacientes: el dependiente registra; el administrador valida en su bandeja
import { h, toast, error, num, fecha, fechaHora, tabla, estadoChip, select, chipsProducto } from '../ui.js';
import { sb, q, rpc, estado, bodegasOperables, esAdmin, hoyISO } from '../api.js';
import { buscadorProducto } from '../componentes.js';

export default async function () {
  const bodegas = bodegasOperables().filter(b => b.tipo !== 'descarte');
  let prod = null;
  const selB = select(bodegas.map(b => [b.id, `${b._sede} · ${b.nombre}`]), bodegas[0]?.id);
  const elegido = h('div', { class: 'nota' }, 'Busque o escanee el producto devuelto');
  const factura = h('input', { class: 'campo', placeholder: 'Número de factura del producto' });
  const dui = h('input', { class: 'campo', inputmode: 'numeric', placeholder: '9 dígitos, sin guion' });
  dui.oninput = () => { dui.value = dui.value.replace(/\D/g, '').slice(0, 9); };
  const fRec = h('input', { class: 'campo', type: 'date', max: hoyISO() });
  const cant = h('input', { class: 'campo', type: 'number', min: 0, step: 'any' });
  const motivo = h('input', { class: 'campo', placeholder: 'Ej.: cambio de tratamiento, reacción adversa' });
  const estFis = select([['completo_sellado', 'Completo y sellado'], ['abierto', 'Abierto'], ['danado', 'Dañado'], ['incompleto', 'Incompleto']], 'completo_sellado');
  const obs = h('input', { class: 'campo', placeholder: 'Observación' });
  const lista = h('div');

  const guardar = async ev => {
    if (!prod) return toast('Elija el producto', 'error');
    if (!factura.value.trim()) return toast('El número de factura es obligatorio', 'error');
    if (!/^\d{9}$/.test(dui.value)) return toast('Escriba el DUI con 9 dígitos, sin guion', 'error');
    if (!fRec.value) return toast('Indique la fecha de la receta', 'error');
    if (!(Number(cant.value) > 0)) return toast('Indique la cantidad devuelta', 'error');
    ev.target.disabled = true;
    try {
      await rpc('registrar_devolucion', { p: { bodega_id: Number(selB.value), producto_id: prod.id, numero_factura: factura.value.trim(), dui: dui.value,
        fecha_receta: fRec.value, cantidad: Number(cant.value), motivo: motivo.value.trim(), estado_fisico: estFis.value, observacion: obs.value.trim() || null } });
      toast('Devolución registrada; queda pendiente de validación por la coordinación');
      prod = null; elegido.textContent = 'Busque o escanee el producto devuelto';
      [factura, dui, fRec, cant, motivo, obs].forEach(c => { c.value = ''; }); cargar();
    } catch (e) { error(e); } finally { ev.target.disabled = false; }
  };

  const cargar = async () => {
    const filas = await q(sb.from('devoluciones').select('*,productos(nombre_comercial),lotes(numero_lote)').order('id', { ascending: false }).limit(100));
    lista.replaceChildren(h('section', { class: 'tarjeta' }, h('h2', {}, 'Devoluciones registradas'),
      esAdmin() ? h('p', { class: 'nota' }, 'Las pendientes se validan en la Bandeja de revisión.') : null,
      tabla([{ t: 'Fecha', f: r => fechaHora(r.creado_at) }, { t: 'Bodega', f: r => estado.bodegas.find(b => b.id === r.bodega_id)?.nombre },
        { t: 'Producto', f: r => r.productos?.nombre_comercial }, { t: 'Cantidad', k: 'cantidad', num: true }, { t: 'Factura', k: 'numero_factura' },
        { t: 'Lote', f: r => r.lotes?.numero_lote || 'No identificado' }, { t: 'DUI', k: 'dui' }, { t: 'Receta', f: r => fecha(r.fecha_receta) },
        { t: 'Estado físico', k: 'estado_fisico' }, { t: 'Estado', f: r => estadoChip(r.estado) }, { t: 'Validó', k: 'validado_por' }], filas)));
  };
  cargar();
  return h('div', {}, h('section', { class: 'tarjeta' },
    h('div', { class: 'fila' }, h('label', { class: 'fila-campo' }, h('span', {}, 'Bodega que recibe'), selB)),
    h('div', { style: { height: '10px' } }),
    buscadorProducto({ alElegir: p => { prod = p; elegido.replaceChildren(h('strong', {}, '✔ ', p.nombre_comercial), ' ', chipsProducto(p)); } }),
    h('div', { style: { margin: '8px 0' } }, elegido),
    h('div', { class: 'fila' }, h('label', { class: 'fila-campo' }, h('span', {}, 'Factura *'), factura), h('label', { class: 'fila-campo' }, h('span', {}, 'DUI *'), dui),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Fecha de la receta *'), fRec), h('label', { class: 'fila-campo' }, h('span', {}, 'Cantidad *'), cant)),
    h('div', { class: 'fila', style: { marginTop: '10px' } }, h('label', { class: 'fila-campo' }, h('span', {}, 'Motivo'), motivo),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Estado del producto'), estFis), h('label', { class: 'fila-campo' }, h('span', {}, 'Observación'), obs)),
    h('div', { class: 'botones', style: { marginTop: '12px' } }, h('button', { class: 'btn btn-primario', onclick: guardar }, '↩️ Registrar devolución'),
      h('span', { class: 'nota' }, 'El producto no vuelve al inventario hasta que la coordinación lo valide.'))), lista);
}
