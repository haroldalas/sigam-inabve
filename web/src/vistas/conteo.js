// Conteo físico por escaneo, con aprobación del administrador
import { h, toast, error, num, fecha, fechaHora, tabla, estadoChip, confirmar, pedirTexto, modal, chipsProducto, exportarExcel } from '../ui.js';
import { sb, q, rpc, todas, estado, esAdmin, bodegasOperables, productoPorCodigo } from '../api.js';
import { buscadorProducto } from '../componentes.js';
import { escanearConCamara, camaraDisponible } from '../escaner.js';

export default async function () {
  const bodegas = bodegasOperables().filter(b => b.tipo !== 'descarte');
  const raiz = h('div');
  let bodegaSel = bodegas[0]?.id;

  const pintar = async () => {
    const abiertos = await q(sb.from('conteos').select('*').in('estado', ['en_proceso', 'pendiente_aprobacion']).order('id', { ascending: false }));
    const historial = await q(sb.from('conteos').select('*').in('estado', ['aplicado', 'anulado']).order('id', { ascending: false }).limit(30));
    const nom = id => estado.bodegas.find(b => b.id === id)?.nombre || id;
    const selB = h('select', { class: 'campo' }, bodegas.map(b => h('option', { value: b.id, selected: b.id === bodegaSel }, `${b._sede} · ${b.nombre}`)));
    selB.onchange = () => { bodegaSel = Number(selB.value); };
    raiz.replaceChildren(
      h('section', { class: 'tarjeta' }, h('h2', {}, 'Iniciar un conteo'),
        h('p', { class: 'nota' }, 'Se toma una foto de la existencia por lote. Luego se cuenta cada producto (escaneando o buscando) y se escribe lo que hay físicamente en cada lote. Al finalizar, un administrador aprueba y el sistema hace los ajustes.'),
        h('div', { class: 'fila' }, h('label', { class: 'fila-campo' }, h('span', {}, 'Bodega'), selB),
          h('button', { class: 'btn btn-primario', style: { flex: '0 0 auto' }, onclick: async () => {
            try { const r = await rpc('iniciar_conteo', { p_bodega: bodegaSel, p_observaciones: null }); toast(`Conteo ${r.numero} iniciado con ${r.lotes} lotes`); abrir(r.conteo_id); }
            catch (e) { error(e); }
          } }, '🔢 Iniciar conteo'))),
      h('section', { class: 'tarjeta' }, h('h2', {}, 'Conteos abiertos'),
        tabla([{ t: 'Número', k: 'numero' }, { t: 'Bodega', f: r => nom(r.bodega_id) }, { t: 'Inició', f: r => `${fechaHora(r.creado_at)} · ${r.creado_por || ''}` },
          { t: 'Estado', f: r => estadoChip(r.estado) }], abiertos, { alClic: r => abrir(r.id), vacio: 'No hay conteos abiertos' })),
      h('section', { class: 'tarjeta' }, h('h2', {}, 'Historial'),
        tabla([{ t: 'Número', k: 'numero' }, { t: 'Bodega', f: r => nom(r.bodega_id) }, { t: 'Inició', f: r => fechaHora(r.creado_at) },
          { t: 'Aprobó', f: r => `${r.aprobado_por || ''} ${fechaHora(r.aprobado_at)}` }, { t: 'Estado', f: r => estadoChip(r.estado) }],
          historial, { alClic: r => abrir(r.id), vacio: 'Sin conteos anteriores' })));
  };

  const abrir = async id => {
    const [c] = await q(sb.from('conteos').select('*').eq('id', id));
    const det = await todas(() => sb.from('conteo_detalle').select('id,lote_id,producto_id,cantidad_sistema,cantidad_fisica,diferencia,observacion,lotes(numero_lote,fecha_vencimiento),productos(codigo,nombre_comercial,presentacion,aware,cadena_frio,controlado)').eq('conteo_id', id).order('id'));
    const editable = c.estado === 'en_proceso';
    const zona = h('div');
    const filtro = { soloPendientes: false, soloDif: false };

    const tarjetaProducto = pid => {
      const ls = det.filter(d => d.producto_id === pid);
      if (!ls.length) return toast('Ese producto no tiene lotes con existencia en esta bodega según el sistema. Anótelo en observaciones del conteo.', 'error', 7000);
      const p = ls[0].productos;
      const inputs = ls.map(d => { const i = h('input', { class: 'campo campo-num', type: 'number', min: 0, step: 'any', value: d.cantidad_fisica ?? '' }); return [d, i]; });
      modal(p.nombre_comercial, h('div', {},
        h('p', { class: 'nota' }, [p.codigo, p.presentacion].join(' · ')),
        ...inputs.map(([d, i]) => h('div', { class: 'linea', style: { gridTemplateColumns: '1fr auto' } },
          h('div', {}, h('strong', {}, `Lote ${d.lotes?.numero_lote || 's/lote'}`), h('div', { class: 'nota' }, `vence ${fecha(d.lotes?.fecha_vencimiento)}`)),
          h('label', { class: 'fila-campo' }, h('span', {}, 'Cantidad física'), i)))), {
        acciones: [{ texto: 'Guardar', clase: 'btn-primario', accion: async () => {
          for (const [d, i] of inputs) {
            if (i.value === '') continue;
            await rpc('registrar_conteo', { p_conteo: id, p_lote: d.lote_id, p_cantidad: Number(i.value), p_observacion: null });
            d.cantidad_fisica = Number(i.value); d.diferencia = d.cantidad_fisica - Number(d.cantidad_sistema);
          }
          toast('Conteo guardado'); pintarDet();
        } }] });
    };

    const pintarDet = () => {
      const contados = det.filter(d => d.cantidad_fisica !== null).length;
      const filas = det.filter(d => (!filtro.soloPendientes || d.cantidad_fisica === null) && (!filtro.soloDif || (d.cantidad_fisica !== null && Number(d.diferencia) !== 0)));
      zona.replaceChildren(
        h('p', {}, `${contados} de ${det.length} lotes contados · ${det.filter(d => d.cantidad_fisica !== null && Number(d.diferencia) !== 0).length} con diferencia`),
        h('div', { class: 'botones' },
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: filtro.soloPendientes, onchange: e => { filtro.soloPendientes = e.target.checked; pintarDet(); } }), 'Solo sin contar'),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: filtro.soloDif, onchange: e => { filtro.soloDif = e.target.checked; pintarDet(); } }), 'Solo con diferencia'),
          h('button', { class: 'btn btn-sec btn-peq', onclick: () => exportarExcel(`SIGAM_${c.numero}`, [{ titulo: c.numero, filas: det, cols: [
            { t: 'Código', exportar: r => r.productos.codigo }, { t: 'Producto', exportar: r => r.productos.nombre_comercial },
            { t: 'Lote', exportar: r => r.lotes?.numero_lote }, { t: 'Vence', exportar: r => r.lotes?.fecha_vencimiento },
            { t: 'Sistema', exportar: r => Number(r.cantidad_sistema) }, { t: 'Físico', exportar: r => r.cantidad_fisica === null ? null : Number(r.cantidad_fisica) },
            { t: 'Diferencia', exportar: r => r.diferencia === null ? null : Number(r.diferencia) }] }]) }, '⬇ Excel')),
        tabla([
          { t: 'Código', f: r => r.productos.codigo }, { t: 'Producto', f: r => r.productos.nombre_comercial, ord: r => r.productos.nombre_comercial },
          { t: 'Lote', f: r => r.lotes?.numero_lote }, { t: 'Vence', f: r => fecha(r.lotes?.fecha_vencimiento) },
          { t: 'Sistema', k: 'cantidad_sistema', num: true },
          { t: 'Físico', f: r => r.cantidad_fisica === null ? '—' : num(r.cantidad_fisica), num: true },
          { t: 'Diferencia', f: r => r.diferencia === null ? '' : h('strong', { style: { color: Number(r.diferencia) < 0 ? 'var(--danger)' : Number(r.diferencia) > 0 ? 'var(--ok)' : '' } }, num(r.diferencia)), num: true },
        ], filas, { alClic: editable ? r => tarjetaProducto(r.producto_id) : null,
          claseFila: r => r.cantidad_fisica === null ? '' : Number(r.diferencia) !== 0 ? 'fila-aviso' : 'fila-ok' }));
    };

    const acciones = [];
    if (editable) acciones.push(
      h('button', { class: 'btn btn-primario', onclick: async () => {
        const sin = det.filter(d => d.cantidad_fisica === null).length;
        if (!await confirmar('Finalizar conteo', sin ? `Quedan ${sin} lotes sin contar. El administrador decidirá si se toman como cero. ¿Finalizar?` : '¿Enviar el conteo a aprobación?', 'Finalizar')) return;
        try { await rpc('finalizar_conteo', { p_conteo: id }); toast('Conteo enviado a aprobación'); pintar(); } catch (e) { error(e); }
      } }, 'Finalizar y enviar a aprobación'));
    if (esAdmin() && c.estado === 'pendiente_aprobacion') acciones.push(
      h('button', { class: 'btn btn-primario', onclick: async () => {
        const cero = h('input', { type: 'checkbox' });
        modal('Aprobar conteo', h('div', {}, h('p', {}, 'Las diferencias se aplicarán como ajustes de inventario.'),
          h('label', { class: 'check' }, cero, 'Tomar como cero los lotes que no se contaron')), {
          acciones: [{ texto: 'Aprobar y ajustar', clase: 'btn-primario', accion: async () => {
            const r = await rpc('aprobar_conteo', { p_conteo: id, p_obs: null, p_sin_contar_cero: cero.checked });
            toast(`Conteo aplicado: ${r.ajustes} ajuste(s)`); pintar();
          } }] });
      } }, 'Aprobar'));
    if (['en_proceso', 'pendiente_aprobacion'].includes(c.estado)) acciones.push(
      h('button', { class: 'btn btn-sec', onclick: async () => {
        const m = await pedirTexto('Anular conteo', 'Motivo'); if (!m) return;
        try { await rpc('anular_conteo', { p_conteo: id, p_motivo: m }); toast('Conteo anulado'); pintar(); } catch (e) { error(e); }
      } }, 'Anular'));

    pintarDet();
    raiz.replaceChildren(h('section', { class: 'tarjeta' },
      h('div', { class: 'botones' }, h('button', { class: 'btn btn-sec', onclick: pintar }, '← Volver'), h('span', { class: 'espacio' }), ...acciones),
      h('h2', { style: { marginTop: '12px' } }, `${c.numero} · ${estado.bodegas.find(b => b.id === c.bodega_id)?.nombre}`), estadoChip(c.estado),
      editable ? h('div', { class: 'fila', style: { marginTop: '12px', alignItems: 'flex-start' } },
        h('div', { style: { flex: '3 1 340px' } }, buscadorProducto({ alElegir: p => tarjetaProducto(p.id), placeholder: 'Escanee el producto a contar' })),
        camaraDisponible() ? h('button', { class: 'btn btn-sec', onclick: () => escanearConCamara(async cod => {
          const p = await productoPorCodigo(cod); if (p) tarjetaProducto(p.id); else toast(`Código ${cod} no está en el catálogo`, 'error');
        }) }, '📷 Cámara') : null) : null,
      h('div', { style: { height: '12px' } }), zona));
  };

  await pintar();
  return raiz;
}
