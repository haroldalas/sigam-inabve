// Despacho (salidas): beneficiario con DUI o personal (pequeña cirugía). Funciona sin conexión.
import { h, toast, error, num, fecha, fechaHora, chipsProducto, tabla, estadoChip, confirmar, pedirTexto, select, TIPO_BODEGA } from '../ui.js';
import { sb, q, rpc, estado, bodegasOperables, registrarSalida, listarPendientes, descartarPendiente, sincronizar, productoPorCodigo, hoyISO } from '../api.js';
import { buscadorProducto, lotesDisponibles, resumenLotes, textoLote } from '../componentes.js';
import { escanearConCamara, camaraDisponible } from '../escaner.js';

const MODO_KEY = 'sigam:modo_escaneo';

export default async function () {
  const bodegas = bodegasOperables().filter(b => b.tipo !== 'descarte');
  if (!bodegas.length) return h('p', { class: 'aviso aviso-info' }, 'No tiene bodegas asignadas para despachar.');
  const st = {
    bodega: Number(localStorage.getItem('sigam:bodega_despacho')) || bodegas.find(b => b.tipo === 'despacho_medicamentos')?.id || bodegas[0].id,
    tipo: 'beneficiario', modo: localStorage.getItem(MODO_KEY) || 'A', lineas: [],
  };
  if (!bodegas.some(b => b.id === st.bodega)) st.bodega = bodegas[0].id;

  const raiz = h('div');
  const zonaLineas = h('div', { class: 'lineas' });
  const zonaPendientes = h('div');
  const zonaRecientes = h('div');
  const dui = h('input', { class: 'campo dui', inputmode: 'numeric', placeholder: '000000000', autocomplete: 'off', 'aria-label': 'DUI (9 dígitos, sin guion)' });
  dui.addEventListener('input', () => { dui.value = dui.value.replace(/\D/g, '').slice(0, 9); dui.classList.toggle('campo-ok', dui.value.length === 9); });
  const recibe = h('input', { class: 'campo', placeholder: 'Nombre de quien recibe' });
  const solicita = h('input', { class: 'campo', placeholder: 'Quien solicita (si es otra persona)' });
  const obs = h('input', { class: 'campo', placeholder: 'Observación (opcional)' });

  // ---------------------------------------------------------------- líneas
  const agregar = async (p, cantidad = null) => {
    let l = st.lineas.find(x => x.p.id === p.id);
    if (!l) {
      l = { p, cantidad: 0, disponible: null, lotes: [] };
      st.lineas.unshift(l);
      if (navigator.onLine) lotesDisponibles(st.bodega, p.id).then(ls => { const r = resumenLotes(ls); l.disponible = r.total; l.lotes = r.utiles; pintarLineas(); }).catch(() => {});
    }
    if (st.modo === 'B') l.cantidad += 1;            // cada escaneo suma una unidad de dispensación
    else if (cantidad !== null) l.cantidad = cantidad;
    pintarLineas();
    if (st.modo === 'A') setTimeout(() => zonaLineas.querySelector(`[data-p="${p.id}"] input`)?.select(), 30);
  };

  const pintarLineas = () => {
    zonaLineas.replaceChildren(...(st.lineas.length ? st.lineas.map(l => {
      const cant = h('input', { class: 'campo campo-num', type: 'number', min: 0, step: 'any', value: l.cantidad || '', 'aria-label': 'Cantidad' });
      cant.addEventListener('input', () => { l.cantidad = Number(cant.value) || 0; marcar(); });
      cant.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); raiz.querySelector('.campo-busqueda')?.focus(); } });
      const insuf = l.disponible !== null && l.cantidad > l.disponible;
      const fila = h('div', { class: 'linea' + (insuf ? ' error' : ''), 'data-p': l.p.id },
        h('div', { class: 'linea-nombre' }, h('strong', {}, l.p.nombre_comercial, ' ', chipsProducto(l.p)),
          h('small', {}, [l.p.codigo, l.p.presentacion].filter(Boolean).join(' · ')),
          h('small', { style: { display: 'block' } }, l.disponible === null ? (navigator.onLine ? 'Consultando existencia…' : 'Sin conexión: la existencia se valida al enviar')
            : `Disponible: ${num(l.disponible)}` + (l.lotes[0] ? ` · entregar primero lote ${l.lotes[0].numero_lote || 's/lote'} (vence ${fecha(l.lotes[0].fecha_vencimiento)})` : ''))),
        st.modo === 'B' ? h('div', { class: 'botones' },
          h('button', { class: 'btn btn-sec btn-peq', onclick: () => { l.cantidad = Math.max(0, l.cantidad - 1); pintarLineas(); } }, '−'),
          h('strong', { style: { minWidth: '40px', textAlign: 'center', fontSize: '1.2rem' } }, num(l.cantidad)),
          h('button', { class: 'btn btn-sec btn-peq', onclick: () => { l.cantidad += 1; pintarLineas(); } }, '+')) : cant,
        h('button', { class: 'btn-icono', title: 'Quitar', onclick: () => { st.lineas = st.lineas.filter(x => x !== l); pintarLineas(); } }, '🗑'));
      const marcar = () => fila.classList.toggle('error', l.disponible !== null && l.cantidad > l.disponible);
      return fila;
    }) : [h('p', { class: 'nota' }, 'Escanee los productos de la receta o búsquelos por nombre.')]));
  };

  // ---------------------------------------------------------------- guardar
  const guardar = async () => {
    const lineas = st.lineas.filter(l => l.cantidad > 0);
    if (!lineas.length) return toast('Agregue al menos un producto con cantidad', 'error');
    if (st.tipo === 'beneficiario' && !/^\d{9}$/.test(dui.value)) { dui.focus(); return toast('Escriba el DUI con 9 dígitos, sin guion', 'error'); }
    if (st.tipo === 'personal' && !recibe.value.trim()) { recibe.focus(); return toast('Indique quién recibe', 'error'); }
    const excede = lineas.find(l => l.disponible !== null && l.cantidad > l.disponible);
    if (excede) return toast(`${excede.p.nombre_comercial}: la cantidad supera la existencia (${num(excede.disponible)})`, 'error');
    const payload = {
      bodega_id: st.bodega, tipo: st.tipo, dui: st.tipo === 'beneficiario' ? dui.value : null,
      persona_recibe: st.tipo === 'personal' ? recibe.value.trim() : null,
      persona_solicita: st.tipo === 'personal' ? (solicita.value.trim() || null) : null,
      observaciones: obs.value.trim() || null,
      lineas: lineas.map(l => ({ producto_id: l.p.id, cantidad: l.cantidad })),
    };
    btnGuardar.disabled = true;
    try {
      const r = await registrarSalida(payload);
      if (r.enviado) toast(`Despacho ${r.numero} registrado`);
      else toast('Sin conexión: el despacho quedó guardado en este equipo y se enviará solo al volver la señal', 'info', 7000);
      st.lineas = []; dui.value = ''; dui.classList.remove('campo-ok'); recibe.value = ''; solicita.value = ''; obs.value = '';
      pintarLineas(); pintarPendientes(); pintarRecientes();
      (st.tipo === 'beneficiario' ? dui : recibe).focus();
    } catch (e) { error(e); } finally { btnGuardar.disabled = false; }
  };
  const btnGuardar = h('button', { class: 'btn btn-primario btn-grande', onclick: guardar }, '✔ Registrar despacho');

  // ---------------------------------------------------------------- pendientes sin conexión
  const pintarPendientes = async () => {
    const ps = await listarPendientes();
    if (!ps.length) return zonaPendientes.replaceChildren();
    zonaPendientes.replaceChildren(h('section', { class: 'tarjeta' },
      h('h2', {}, `Despachos guardados en este equipo (${ps.length})`),
      h('p', { class: 'nota' }, 'Se envían automáticamente cuando vuelve la conexión. Si alguno tiene error, revíselo y descártelo o corríjalo con un nuevo despacho.'),
      tabla([
        { t: 'Guardado', f: r => fechaHora(r.creado) }, { t: 'DUI / persona', f: r => r.payload.dui || r.payload.persona_recibe },
        { t: 'Líneas', f: r => r.payload.lineas.length, num: true },
        { t: 'Estado', f: r => r.error ? h('span', { class: 'estado st-danger' }, r.error) : h('span', { class: 'estado st-warn' }, 'Por enviar') },
        { t: '', f: r => r.error ? h('button', { class: 'btn btn-sec btn-peq', onclick: async () => {
          if (await confirmar('Descartar despacho', 'Se borrará este despacho del equipo. ¿Continuar?', 'Descartar', 'btn-peligro')) { await descartarPendiente(r.clave); pintarPendientes(); }
        } }, 'Descartar') : '' },
      ], ps),
      h('button', { class: 'btn btn-sec', onclick: async () => { const r = await sincronizar(); toast(`Enviados: ${r.enviados} · con error: ${r.errores}`); pintarPendientes(); pintarRecientes(); } }, '↻ Enviar ahora')));
  };

  // ---------------------------------------------------------------- despachos de hoy
  const pintarRecientes = async () => {
    if (!navigator.onLine) return zonaRecientes.replaceChildren();
    try {
      const filas = await q(sb.from('salidas').select('id,numero,fecha,tipo,dui,persona_recibe,estado,creado_at,creado_por,salida_detalle(cantidad,productos(nombre_comercial))')
        .eq('bodega_id', st.bodega).gte('fecha', hoyISO()).order('id', { ascending: false }).limit(100));
      zonaRecientes.replaceChildren(h('section', { class: 'tarjeta' }, h('h2', {}, `Despachos de hoy en esta bodega (${filas.length})`),
        tabla([
          { t: 'Número', k: 'numero' }, { t: 'Hora', f: r => fechaHora(r.creado_at) },
          { t: 'DUI / persona', f: r => r.dui || r.persona_recibe || '' },
          { t: 'Productos', f: r => r.salida_detalle.map(d => `${d.productos.nombre_comercial} (${num(d.cantidad)})`).join('; ') },
          { t: 'Estado', f: r => estadoChip(r.estado) },
          { t: '', f: r => r.estado === 'confirmada' ? h('button', { class: 'btn btn-sec btn-peq', onclick: async ev => {
            ev.stopPropagation();
            const m = await pedirTexto(`Anular ${r.numero}`, 'Motivo de la anulación'); if (!m) return;
            try { await rpc('anular_salida', { p_salida: r.id, p_motivo: m }); toast('Despacho anulado; las existencias regresaron al lote'); pintarRecientes(); } catch (e) { error(e); }
          } }, 'Anular') : '' },
        ], filas, { vacio: 'Todavía no hay despachos hoy' })));
    } catch { zonaRecientes.replaceChildren(); }
  };

  // ---------------------------------------------------------------- controles
  const selBodega = h('select', { class: 'campo' }, bodegas.map(b => h('option', { value: b.id, selected: b.id === st.bodega }, `${b.nombre}`)));
  selBodega.onchange = () => {
    st.bodega = Number(selBodega.value); localStorage.setItem('sigam:bodega_despacho', st.bodega);
    const b = bodegas.find(x => x.id === st.bodega);
    if (b?.tipo === 'pequena_cirugia') { st.tipo = 'personal'; pintarTipo(); }
    st.lineas.forEach(l => { l.disponible = null; });
    st.lineas.forEach(l => lotesDisponibles(st.bodega, l.p.id).then(ls => { const r = resumenLotes(ls); l.disponible = r.total; l.lotes = r.utiles; pintarLineas(); }).catch(() => {}));
    pintarLineas(); pintarRecientes();
  };
  const zonaTipo = h('div');
  const pintarTipo = () => {
    zonaTipo.replaceChildren(
      h('div', { class: 'segmentado', role: 'group', 'aria-label': 'Tipo de salida' },
        h('button', { class: st.tipo === 'beneficiario' ? 'activo' : '', onclick: () => { st.tipo = 'beneficiario'; pintarTipo(); } }, 'Beneficiario'),
        h('button', { class: st.tipo === 'personal' ? 'activo' : '', onclick: () => { st.tipo = 'personal'; pintarTipo(); } }, 'Personal (pequeña cirugía)')),
      st.tipo === 'beneficiario'
        ? h('label', { class: 'fila-campo', style: { marginTop: '10px' } }, h('span', {}, 'DUI del beneficiario (9 dígitos, sin guion)'), dui)
        : h('div', { class: 'fila', style: { marginTop: '10px' } },
          h('label', { class: 'fila-campo' }, h('span', {}, 'Recibe'), recibe),
          h('label', { class: 'fila-campo' }, h('span', {}, 'Solicita'), solicita)));
  };
  const zonaModo = h('div');
  const pintarModo = () => {
    zonaModo.replaceChildren(h('div', { class: 'segmentado', role: 'group', 'aria-label': 'Forma de escaneo' },
      h('button', { class: st.modo === 'A' ? 'activo' : '', title: 'Un escaneo por producto y se escribe la cantidad',
        onclick: () => { st.modo = 'A'; localStorage.setItem(MODO_KEY, 'A'); pintarModo(); pintarLineas(); } }, 'A · Escanear y escribir cantidad'),
      h('button', { class: st.modo === 'B' ? 'activo' : '', title: 'Cada escaneo suma una unidad de dispensación',
        onclick: () => { st.modo = 'B'; localStorage.setItem(MODO_KEY, 'B'); pintarModo(); pintarLineas(); } }, 'B · Cada escaneo suma 1')));
  };
  const camaraContinua = camaraDisponible() ? h('button', { class: 'btn btn-sec', onclick: () => escanearConCamara(async cod => {
    const p = await productoPorCodigo(cod);
    if (p) { await agregar(p); } else toast(`El código ${cod} no está en el catálogo`, 'error');
  }, { continuo: true, titulo: st.modo === 'B' ? 'Cada lectura suma 1' : 'Escanee cada producto' }) }, '📷 Escanear varios con la cámara') : null;

  pintarTipo(); pintarModo(); pintarLineas(); pintarPendientes(); pintarRecientes();
  raiz.append(
    zonaPendientes,
    h('section', { class: 'tarjeta' },
      h('div', { class: 'fila' },
        h('label', { class: 'fila-campo' }, h('span', {}, 'Despachar desde'), selBodega),
        h('div', { class: 'fila-campo', style: { flex: '0 0 auto' } }, h('span', {}, 'Forma de escaneo'), zonaModo)),
      h('div', { style: { height: '12px' } }),
      h('div', { class: 'paso' }, h('span', {}, '1'), 'Quién recibe'), zonaTipo,
      h('div', { style: { height: '16px' } }),
      h('div', { class: 'paso' }, h('span', {}, '2'), 'Productos'),
      h('div', { class: 'fila', style: { alignItems: 'flex-start' } },
        h('div', { style: { flex: '3 1 360px' } }, buscadorProducto({ alElegir: p => agregar(p) })), camaraContinua),
      zonaLineas,
      h('label', { class: 'fila-campo' }, h('span', {}, 'Observación'), obs),
      h('div', { class: 'botones', style: { marginTop: '14px' } }, btnGuardar,
        h('button', { class: 'btn btn-sec', onclick: () => { st.lineas = []; pintarLineas(); } }, 'Limpiar'),
        h('span', { class: 'nota' }, 'El sistema entrega primero el lote que vence antes (PVPS).'))),
    zonaRecientes);
  return raiz;
}
