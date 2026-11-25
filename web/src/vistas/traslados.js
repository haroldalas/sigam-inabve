// Traslados: nuevo traslado y bitácora de todos los traslados (detalle, PDF y Excel para SIVET cuando ya se recibieron)
import { h, toast, error, num, fecha, fechaHora, dinero, chipsProducto, tabla, estadoChip, modal, confirmar, pedirTexto, select } from '../ui.js';
import { sb, q, rpc, todas, estado, esAdmin, bodegasOperables, hoyISO } from '../api.js';
import { buscadorProducto, lotesDisponibles, resumenLotes, textoLote, selectorBodega } from '../componentes.js';
import { pdfTraslado, excelSivet } from '../reportes.js';

export default async function (params) {
  let pestana = params.get('ver') || 'bitacora';
  const raiz = h('div');
  const pintar = async () => {
    raiz.replaceChildren(
      h('div', { class: 'pestanas' },
        h('button', { class: pestana === 'nuevo' ? 'activo' : '', onclick: () => { pestana = 'nuevo'; pintar(); } }, '➕ Nuevo traslado'),
        h('button', { class: pestana === 'bitacora' ? 'activo' : '', onclick: () => { pestana = 'bitacora'; pintar(); } }, '📚 Bitácora de traslados')),
      pestana === 'nuevo' ? await nuevo(() => { pestana = 'bitacora'; pintar(); }) : await bitacora());
  };
  await pintar();
  return raiz;
}

// Existencia actual por sede (sin Descarte) para decidir cuánto enviar y cuánto reservar
function porSede(otras, origenId, destinoId) {
  const bod = id => estado.bodegas.find(b => b.id === id);
  const sedeDe = id => bod(id)?.sede_id;
  const filas = estado.sedes.map(s => {
    const xs = otras.filter(o => sedeDe(o.bodega_id) === s.id && bod(o.bodega_id)?.tipo !== 'descarte');
    const sum = k => xs.reduce((a, o) => a + Number(o[k] || 0), 0);
    const central = xs.filter(o => bod(o.bodega_id)?.tipo === 'central').reduce((a, o) => a + Number(o.disponible || 0), 0);
    const disp = sum('disponible'), cons = sum('consumo_30d');
    return { sede: s.nombre, id: s.id, disp, central, transito: sum('en_transito'), cons, dias: cons > 0 ? Math.floor((disp - central) / (cons / 30)) : null };
  });
  const tot = filas.reduce((a, f) => a + f.disp, 0);
  const marca = f => { const o = f.id === sedeDe(origenId), d = f.id === sedeDe(destinoId); return o && d ? ' (origen y destino)' : o ? ' (origen)' : d ? ' (destino)' : ''; };
  return h('table', { class: 'mini-sedes' },
    h('thead', {}, h('tr', {}, ['Sede', 'Disponible', 'En tránsito', 'Consumo 30 d', 'Alcanza'].map(t => h('th', {}, t)))),
    h('tbody', {}, filas.map(f => h('tr', { class: (f.id === sedeDe(destinoId) ? 'destino' : f.id === sedeDe(origenId) ? 'origen' : '') + (f.disp <= 0 ? ' agotado' : '') },
      h('td', {}, f.sede + marca(f)),
      h('td', { class: 'num' }, num(f.disp), f.central ? h('small', {}, ` (central ${num(f.central)})`) : null),
      h('td', { class: 'num' }, f.transito ? num(f.transito) : '—'),
      h('td', { class: 'num' }, f.cons ? num(f.cons) : '—'),
      h('td', { class: 'num' }, f.dias === null ? '—' : f.dias < 15 ? h('strong', { style: { color: 'var(--danger)' } }, `${num(f.dias)} días`) : `${num(f.dias)} días`)))),
    h('tfoot', {}, h('tr', {}, h('td', {}, 'Total'), h('td', { class: 'num' }, num(tot)), h('td', { colspan: 3 }))));
}

// ----------------------------------------------------------------------------- nuevo traslado
async function nuevo(alTerminar) {
  const origenes = bodegasOperables().filter(b => b.tipo !== 'descarte' || esAdmin());
  if (!origenes.length) return h('p', { class: 'aviso aviso-info' }, 'No tiene bodegas para trasladar.');
  const st = { origen: origenes.find(b => b.tipo === 'central')?.id || origenes[0].id, destino: null, lineas: [] };
  const zonaLineas = h('div', { class: 'lineas' });
  const obs = h('input', { class: 'campo', placeholder: 'Observaciones (opcional)' });
  const destinos = () => estado.bodegas.filter(b => b.id !== st.origen && (!b.solo_admin || esAdmin()));

  const agregar = async p => {
    if (st.lineas.some(l => l.p.id === p.id)) return toast('El producto ya está en la lista', 'info');
    const l = { p, cantidad: 0, lote: '', lotes: [], disponible: null, otras: [] };
    st.lineas.unshift(l); pintarLineas();
    try {
      const [ls, otras] = await Promise.all([
        lotesDisponibles(st.origen, p.id),
        q(sb.from('v_existencias_resumen').select('sede,bodega,bodega_id,disponible,en_transito,consumo_30d,dias_cobertura').eq('producto_id', p.id)),
      ]);
      const r = resumenLotes(ls); l.lotes = r.utiles; l.disponible = r.total; l.bloqueados = r.bloqueados; l.otras = otras;
    } catch (e) { error(e); }
    pintarLineas();
  };

  const pintarLineas = () => {
    const destino = estado.bodegas.find(b => b.id === st.destino);
    zonaLineas.replaceChildren(...(st.lineas.length ? st.lineas.map(l => {
      const cant = h('input', { class: 'campo campo-num', type: 'number', min: 0, step: 'any', value: l.cantidad || '', 'aria-label': 'Cantidad a enviar' });
      cant.oninput = () => { l.cantidad = Number(cant.value) || 0; fila.classList.toggle('error', l.disponible !== null && l.cantidad > l.disponible); };
      const selLote = h('select', { class: 'campo', style: { maxWidth: '300px' } },
        h('option', { value: '' }, 'Automático: primero el que vence antes'), l.lotes.map(x => h('option', { value: x.id, selected: String(x.id) === l.lote }, textoLote(x))));
      selLote.onchange = () => { l.lote = selLote.value; };
      const enDestino = destino ? l.otras.find(o => o.bodega_id === destino.id) : null;
      const vence6m = l.lotes[0]?.fecha_vencimiento && (new Date(l.lotes[0].fecha_vencimiento) - new Date()) / 864e5 <= 180;
      const fila = h('div', { class: 'linea' + (l.disponible !== null && l.cantidad > l.disponible ? ' error' : '') },
        h('div', { class: 'linea-nombre' },
          h('strong', {}, l.p.nombre_comercial, ' ', chipsProducto(l.p)),
          h('small', {}, [l.p.codigo, l.p.presentacion].filter(Boolean).join(' · ')),
          h('small', { style: { display: 'block' } }, l.disponible === null ? 'Consultando…' : `Disponible en origen: ${num(l.disponible)}`
            + (enDestino ? ` · en destino: ${num(enDestino.disponible)}${enDestino.consumo_30d > 0 ? ` (consume ${num(enDestino.consumo_30d)} en 30 días, alcanza ${num(enDestino.dias_cobertura)} días)` : ''}` : '')),
          vence6m ? h('small', { style: { display: 'block', color: 'var(--warn)' } }, `⚠ El primer lote vence el ${fecha(l.lotes[0].fecha_vencimiento)} (6 meses o menos)`) : null,
          l.bloqueados?.length ? h('small', { style: { display: 'block', color: 'var(--danger)' } }, `${l.bloqueados.length} lote(s) bloqueado(s) o en cuarentena no se trasladan`) : null,
          l.p.cadena_frio ? h('small', { style: { display: 'block', color: '#0b5c86' } }, '❄ Requiere cadena de frío durante el envío') : null,
          l.otras.length ? porSede(l.otras, st.origen, st.destino) : null,
          l.otras.length ? h('details', {}, h('summary', { class: 'nota' }, 'Detalle por bodega'),
            tabla([{ t: 'Sede', k: 'sede' }, { t: 'Bodega', k: 'bodega' }, { t: 'Disponible', k: 'disponible', num: true },
              { t: 'En tránsito', k: 'en_transito', num: true }, { t: 'Consumo 30 d', k: 'consumo_30d', num: true }, { t: 'Alcanza (días)', k: 'dias_cobertura', num: true }], l.otras)) : null),
        h('div', { class: 'fila-campo' }, h('span', {}, 'Lote'), selLote),
        h('div', { class: 'fila-campo' }, h('span', {}, 'Cantidad'), cant),
        h('button', { class: 'btn-icono', title: 'Quitar', onclick: () => { st.lineas = st.lineas.filter(x => x !== l); pintarLineas(); } }, '🗑'));
      return fila;
    }) : [h('p', { class: 'nota' }, 'Escanee o busque los productos a trasladar.')]));
  };

  const selOrigen = selectorBodega(origenes, st.origen, { alCambiar: v => { st.origen = v; st.lineas = []; pintarLineas(); rehacerDestino(); } });
  const zonaDestino = h('div', { class: 'fila-campo' });
  const rehacerDestino = () => {
    const s = selectorBodega(destinos(), st.destino, { vacio: 'Elija el destino', alCambiar: v => { st.destino = v; pintarLineas(); } });
    zonaDestino.replaceChildren(h('span', {}, 'Destino'), s);
  };
  rehacerDestino();

  const enviar = async ev => {
    if (!st.destino) return toast('Elija la bodega de destino', 'error');
    const lineas = st.lineas.filter(l => l.cantidad > 0);
    if (!lineas.length) return toast('Indique las cantidades a enviar', 'error');
    const mal = lineas.find(l => l.disponible !== null && l.cantidad > l.disponible);
    if (mal) return toast(`${mal.p.nombre_comercial}: la cantidad supera lo disponible (${num(mal.disponible)})`, 'error');
    const dest = estado.bodegas.find(b => b.id === st.destino);
    if (!await confirmar('Enviar traslado', `Se enviarán ${lineas.length} producto(s) a ${dest.nombre}. Quedarán en tránsito hasta que la sede confirme la recepción.`, 'Enviar')) return;
    ev.target.disabled = true;
    try {
      const r = await rpc('crear_traslado', { p: { bodega_origen_id: st.origen, bodega_destino_id: st.destino, observaciones: obs.value || null,
        lineas: lineas.map(l => ({ producto_id: l.p.id, cantidad: l.cantidad, lote_id: l.lote ? Number(l.lote) : null })) } });
      toast(`Traslado ${r.numero} enviado`);
      modal(`Traslado ${r.numero} enviado`, h('p', {}, 'Puede descargar el reporte para imprimir y firmar. El Excel para SIVET se genera cuando la sede lo reciba y todo coincida.'), {
        acciones: [
          { texto: '⬇ PDF', clase: 'btn-sec', accion: async () => { await pdfTraslado(r.traslado_id); return false; } },
          { texto: 'Listo', clase: 'btn-primario', accion: () => alTerminar() }] });
    } catch (e) { error(e); } finally { ev.target.disabled = false; }
  };

  pintarLineas();
  return h('section', { class: 'tarjeta' },
    h('div', { class: 'fila' }, h('label', { class: 'fila-campo' }, h('span', {}, 'Origen'), selOrigen), zonaDestino),
    h('div', { style: { height: '14px' } }),
    buscadorProducto({ alElegir: agregar }),
    zonaLineas,
    h('label', { class: 'fila-campo' }, h('span', {}, 'Observaciones'), obs),
    h('div', { class: 'botones', style: { marginTop: '14px' } }, h('button', { class: 'btn btn-primario btn-grande', onclick: enviar }, '🚚 Enviar traslado'),
      h('span', { class: 'nota' }, 'Los lotes vencidos, bloqueados o en cuarentena no se trasladan. Cada producto conserva su lote, vencimiento, factura y proveedor.')));
}

// ----------------------------------------------------------------------------- bitácora
async function bitacora() {
  const desde = h('input', { type: 'date', class: 'campo', value: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10) });
  const hasta = h('input', { type: 'date', class: 'campo', value: hoyISO() });
  const selEstado = select([['', 'Todos'], ['enviado', 'En tránsito'], ['recibido', 'Recibido'], ['con_diferencias', 'Con diferencias'], ['cerrado', 'Cerrado'], ['anulado', 'Anulado']], '');
  const selSede = select([['', 'Todas'], ...estado.sedes.map(s => [s.nombre, s.nombre])], '');
  const selSivet = select([['', 'Todos'], ['listo', 'Listos para migrar a SIVET'], ['migrado', 'Ya migrados a SIVET'], ['no_listo', 'Por recibir o con diferencias']], '');
  const avisoSivet = h('div');
  const zona = h('div');
  const marcados = new Set();
  let vistos = [];

  const cargar = async () => {
    zona.replaceChildren(h('p', { class: 'nota' }, 'Cargando…'));
    let c = () => sb.from('v_bitacora_traslados').select('*').gte('fecha', desde.value).lte('fecha', hasta.value).order('fecha', { ascending: false }).order('id', { ascending: false });
    const filas = (await todas(c)).filter(r => (!selEstado.value || r.estado === selEstado.value)
      && (!selSede.value || r.sede_destino === selSede.value || r.sede_origen === selSede.value)
      && (!selSivet.value || (selSivet.value === 'listo' ? (r.listo_sivet && !r.sivet_efectivo)
        : selSivet.value === 'migrado' ? r.sivet_efectivo : (!r.listo_sivet && r.estado !== 'anulado'))));
    vistos = filas;
    pintarAvisoSivet();
    marcados.clear();
    zona.replaceChildren(
      h('p', { class: 'nota' }, `${filas.length} traslados · ${dinero(filas.reduce((s, r) => s + Number(r.monto || 0), 0))} · ya migrados a SIVET: ${filas.filter(r => r.sivet_efectivo).length} · listos para migrar: ${filas.filter(r => r.listo_sivet && !r.sivet_efectivo).length} · por recibir o con diferencias: ${filas.filter(r => !r.listo_sivet && r.estado !== 'anulado').length}`),
      tabla([
        { t: '', f: r => { const c = h('input', { type: 'checkbox', 'aria-label': 'Marcar ' + r.numero, onclick: e => e.stopPropagation() }); c.onchange = () => c.checked ? marcados.add(r.id) : marcados.delete(r.id); return c; } },
        { t: 'Número', k: 'numero' }, { t: 'Fecha', f: r => fecha(r.fecha), ord: r => r.fecha },
        { t: 'Origen', f: r => h('div', {}, r.bodega_origen, h('div', { class: 'nota' }, r.sede_origen)) },
        { t: 'Destino', f: r => h('div', {}, r.bodega_destino, h('div', { class: 'nota' }, r.sede_destino)) },
        { t: 'Líneas', k: 'lineas', num: true }, { t: 'Unidades', k: 'unidades_enviadas', num: true },
        { t: 'Monto', f: r => dinero(r.monto), num: true, ord: r => Number(r.monto) },
        { t: 'Estado', f: r => h('div', {}, estadoChip(r.estado), r.diferencias_pendientes > 0 ? h('div', { class: 'nota' }, `${r.diferencias_pendientes} diferencia(s) por resolver`) : null) },
        { t: 'SIVET', f: r => chipSivet(r), ord: r => r.estado === 'anulado' ? 4 : r.sivet_efectivo ? 3 : r.listo_sivet ? 0 : 1 },
        { t: 'Envió', k: 'enviado_por' }, { t: 'Recibió', k: 'recibido_por' },
      ], filas, { alClic: r => detalle(r, cargar), vacio: 'No hay traslados en este período' }));
  };

  // Excel para SIVET: solo traslados recibidos y sin diferencias pendientes; al generarlo quedan "Ya migrado a SIVET"
  const accionesLote = esAdmin() ? h('div', { class: 'botones' },
    h('button', { class: 'btn btn-primario', onclick: async () => {
      let ids = marcados.size ? [...marcados] : vistos.filter(r => r.listo_sivet && !r.sivet_efectivo).map(r => r.id);
      if (!ids.length) return toast('No hay traslados listos para migrar a SIVET en esta lista', 'error');
      const sel = vistos.filter(r => ids.includes(r.id));
      const noListos = sel.filter(r => !r.listo_sivet), yaMigrados = sel.filter(r => r.sivet_efectivo);
      if (noListos.length || yaMigrados.length) {
        toast([noListos.length ? `${noListos.length} aún no recibido(s) o con diferencias` : '', yaMigrados.length ? `${yaMigrados.length} ya migrado(s)` : ''].filter(Boolean).join(' · ') + ': no se incluyen', 'info', 7000);
        ids = sel.filter(r => r.listo_sivet && !r.sivet_efectivo).map(r => r.id);
        if (!ids.length) return;
      }
      await generarExcelSivet(ids, cargar);
    } }, '⬇ Generar Excel para SIVET'),
    h('span', { class: 'nota' }, 'Usa los traslados marcados; si no marca ninguno, todos los listos de la lista.')) : h('div');

  const pintarAvisoSivet = async () => {
    try {
      const { count } = await q(sb.from('v_bitacora_traslados').select('id', { count: 'exact', head: true }).eq('listo_sivet', true).eq('sivet_efectivo', false));
      avisoSivet.replaceChildren(count ? h('div', { class: 'aviso aviso-warn' }, `${count} traslado(s) recibido(s) listos para migrar a SIVET. `,
        h('button', { class: 'btn btn-sec btn-peq', onclick: () => { desde.value = '2020-01-01'; hasta.value = hoyISO(); selSivet.value = 'listo'; cargar(); } }, 'Ver todos'))
        : h('div', { class: 'aviso aviso-ok' }, '✔ No hay traslados recibidos pendientes de migrar a SIVET.'));
    } catch { avisoSivet.replaceChildren(); }
  };

  [desde, hasta, selEstado, selSede, selSivet].forEach(c => c.addEventListener('change', cargar));
  cargar();
  return h('section', { class: 'tarjeta' },
    h('div', { class: 'filtros' },
      h('label', { class: 'fila-campo' }, h('span', {}, 'Desde'), desde), h('label', { class: 'fila-campo' }, h('span', {}, 'Hasta'), hasta),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Estado'), selEstado), h('label', { class: 'fila-campo' }, h('span', {}, 'Sede'), selSede),
      h('label', { class: 'fila-campo' }, h('span', {}, 'SIVET'), selSivet)),
    avisoSivet, accionesLote, h('div', { style: { height: '10px' } }), zona);
}

async function detalle(t, recargar) {
  const [lineas, difs] = await Promise.all([
    todas(() => sb.from('v_sivet_traslado').select('*').eq('traslado_id', t.id).order('correlativo')),
    q(sb.from('traslado_diferencias').select('*,productos(nombre_comercial)').eq('traslado_id', t.id).order('id')),
  ]);
  const cont = h('div', {},
    h('div', { class: 'rejilla' },
      kv('Origen', `${t.bodega_origen} · ${t.sede_origen}`), kv('Destino', `${t.bodega_destino} · ${t.sede_destino}`),
      kv('Enviado', `${fechaHora(t.enviado_at)} · ${t.enviado_por || ''}`), kv('Recibido', t.recibido_at ? `${fechaHora(t.recibido_at)} · ${t.recibido_por || ''}` : 'Pendiente'),
      kv('Estado', estadoChip(t.estado)), kv('Monto', dinero(t.monto)),
      kv('SIVET', h('div', {}, chipSivet(t), t.sivet_efectivo ? h('div', { class: 'nota' }, `${fechaHora(t.sivet_efectivo_at)} · ${t.sivet_efectivo_por || ''}${t.sivet_referencia ? ' · ref. ' + t.sivet_referencia : ''}`) : null))),
    t.observaciones ? h('p', {}, h('strong', {}, 'Observaciones: '), t.observaciones) : null,
    t.motivo_anulacion ? h('p', { class: 'aviso aviso-warn' }, `Anulado por ${t.anulado_por}: ${t.motivo_anulacion}`) : null,
    tabla([
      { t: '#', k: 'correlativo' }, { t: 'Categoría', k: 'categoria' }, { t: 'Código', k: 'codigo' }, { t: 'Producto', k: 'nombre_comercial' },
      { t: 'Lote', k: 'lote' }, { t: 'Vence', f: r => fecha(r.fecha_vencimiento) },
      { t: 'Enviado', k: 'cantidad_enviada', num: true },
      { t: 'Recibido', f: r => r.cantidad_recibida === null ? '—' : num(r.cantidad_recibida), num: true },
      { t: 'P. unit.', f: r => dinero(r.precio), num: true }, { t: 'Factura', k: 'factura' }, { t: 'Contrato SIVET', k: 'nombre_contrato_sivetweb' },
    ], lineas),
    difs.length ? h('div', {}, h('h3', { style: { marginTop: '12px' } }, 'Diferencias reportadas por la sede'),
      tabla([{ t: 'Producto', f: r => r.productos?.nombre_comercial }, { t: 'Tipo', k: 'tipo' }, { t: 'Enviado', k: 'cantidad_enviada', num: true },
        { t: 'Recibido', k: 'cantidad_recibida', num: true }, { t: 'Observación', k: 'observacion_sede' }, { t: 'Estado', f: r => estadoChip(r.estado) },
        { t: 'Resolución', k: 'resolucion' }], difs)) : null);
  const acciones = [
    { texto: '⬇ PDF', clase: 'btn-sec', accion: async () => { await pdfTraslado(t.id); return false; } },
  ];
  if (t.estado === 'enviado') acciones.push({ texto: 'Anular', clase: 'btn-peligro', accion: async () => {
    const m = await pedirTexto(`Anular ${t.numero}`, 'Motivo (la existencia regresa a la bodega de origen)'); if (!m) return false;
    await rpc('anular_traslado', { p_traslado: t.id, p_motivo: m }); toast('Traslado anulado'); recargar();
  } });
  if (esAdmin() && t.sivet_efectivo) acciones.push({ texto: 'Quitar marca de SIVET', clase: 'btn-sec', accion: async () => {
    const m = await pedirTexto(`Quitar marca de ${t.numero}`, 'Motivo (p. ej.: el Excel no se cargó en SIVET)'); if (!m) return false;
    await rpc('marcar_efectivo_sivet', { p_traslados: [t.id], p_efectivo: false, p_referencia: m }); toast('El traslado vuelve a quedar listo para migrar'); recargar();
  } });
  if (esAdmin() && t.listo_sivet && !t.sivet_efectivo) acciones.push({ texto: '⬇ Generar Excel para SIVET', clase: 'btn-primario', accion: async () => {
    if (!await generarExcelSivet([t.id], recargar)) return false;
  } });
  modal(`Traslado ${t.numero} · ${fecha(t.fecha)}`, cont, { ancho: '1100px', acciones });
}

function chipSivet(r) {
  if (r.estado === 'anulado') return h('span', { class: 'estado st-muted' }, '—');
  if (r.sivet_efectivo) return h('span', { class: 'estado st-ok', title: r.sivet_referencia || '' }, 'Ya migrado a SIVET');
  if (r.listo_sivet) return h('span', { class: 'estado st-info' }, 'Listo para SIVET');
  if (r.estado === 'enviado') return h('span', { class: 'estado st-muted' }, 'Por recibir');
  return h('span', { class: 'estado st-warn' }, 'Con diferencias');
}

// Genera el Excel para SIVET y marca los traslados como "Ya migrado a SIVET"
async function generarExcelSivet(ids, alTerminar) {
  const nombre = ids.length === 1 ? null : `SIGAM_traslados_SIVET_${hoyISO()}.xlsx`;
  let archivo = nombre;
  if (!archivo) {
    const [t] = await q(sb.from('traslados').select('numero').eq('id', ids[0]));
    archivo = `SIGAM_${t.numero}_SIVET.xlsx`;
  }
  if (!await confirmar('Generar Excel para SIVET',
    `Se generará el Excel con ${ids.length} traslado(s) recibidos y quedarán marcados como "Ya migrado a SIVET". ¿Continuar?`, 'Generar')) return false;
  try {
    await rpc('traslado_listo_sivet', { p_traslado: ids[0] });          // comprueba conexión antes de descargar
    const lineas = await excelSivet(ids, archivo);
    const n = await rpc('migrar_traslados_sivet', { p_traslados: ids, p_archivo: archivo });
    toast(`Excel generado (${lineas} líneas) · ${n} traslado(s) marcados como "Ya migrado a SIVET"`, 'ok', 8000);
    alTerminar?.();
    return true;
  } catch (e) { error(e); return false; }
}

const kv = (k, v) => h('div', {}, h('div', { class: 'kpi-titulo' }, k), h('div', {}, v));
