// Traslados: nuevo traslado y bitácora de todos los traslados (con detalle, PDF y Excel para TICS)
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
          l.otras.length ? h('details', {}, h('summary', { class: 'nota' }, 'Existencia en todas las sedes'),
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
      modal(`Traslado ${r.numero} enviado`, h('p', {}, 'Puede descargar el reporte para imprimir y firmar, y el Excel para TICS.'), {
        acciones: [
          { texto: '⬇ PDF', clase: 'btn-sec', accion: async () => { await pdfTraslado(r.traslado_id); return false; } },
          { texto: '⬇ Excel para TICS', clase: 'btn-sec', accion: async () => { await excelSivet([r.traslado_id], `SIGAM_${r.numero}_SIVET.xlsx`); return false; } },
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
  const selSivet = select([['', 'Todos'], ['falta_efectivo', 'Falta hacerse efectivo en SIVET'], ['efectivo', 'Ya efectivos en SIVET'], ['no', 'Pendientes de enviar a TICS'], ['si', 'Ya enviados a TICS']], '');
  const avisoSivet = h('div');
  const zona = h('div');
  const marcados = new Set();

  const cargar = async () => {
    zona.replaceChildren(h('p', { class: 'nota' }, 'Cargando…'));
    let c = () => sb.from('v_bitacora_traslados').select('*').gte('fecha', desde.value).lte('fecha', hasta.value).order('fecha', { ascending: false }).order('id', { ascending: false });
    const filas = (await todas(c)).filter(r => (!selEstado.value || r.estado === selEstado.value)
      && (!selSede.value || r.sede_destino === selSede.value || r.sede_origen === selSede.value)
      && (!selSivet.value || (selSivet.value === 'falta_efectivo' ? (!r.sivet_efectivo && r.estado !== 'anulado')
        : selSivet.value === 'efectivo' ? r.sivet_efectivo : (selSivet.value === 'si') === r.enviado_sivet)));
    pintarAvisoSivet();
    marcados.clear();
    zona.replaceChildren(
      h('p', { class: 'nota' }, `${filas.length} traslados · ${dinero(filas.reduce((s, r) => s + Number(r.monto || 0), 0))} · efectivos en SIVET: ${filas.filter(r => r.sivet_efectivo).length} · faltan: ${filas.filter(r => !r.sivet_efectivo && r.estado !== 'anulado').length}`),
      tabla([
        { t: '', f: r => { const c = h('input', { type: 'checkbox', 'aria-label': 'Marcar ' + r.numero, onclick: e => e.stopPropagation() }); c.onchange = () => c.checked ? marcados.add(r.id) : marcados.delete(r.id); return c; } },
        { t: 'Número', k: 'numero' }, { t: 'Fecha', f: r => fecha(r.fecha), ord: r => r.fecha },
        { t: 'Origen', f: r => h('div', {}, r.bodega_origen, h('div', { class: 'nota' }, r.sede_origen)) },
        { t: 'Destino', f: r => h('div', {}, r.bodega_destino, h('div', { class: 'nota' }, r.sede_destino)) },
        { t: 'Líneas', k: 'lineas', num: true }, { t: 'Unidades', k: 'unidades_enviadas', num: true },
        { t: 'Monto', f: r => dinero(r.monto), num: true, ord: r => Number(r.monto) },
        { t: 'Estado', f: r => h('div', {}, estadoChip(r.estado), r.diferencias_pendientes > 0 ? h('div', { class: 'nota' }, `${r.diferencias_pendientes} diferencia(s) por resolver`) : null) },
        { t: 'SIVET', f: r => chipSivet(r), ord: r => r.estado === 'anulado' ? 3 : r.sivet_efectivo ? 2 : r.enviado_sivet ? 1 : 0 },
        { t: 'Envió', k: 'enviado_por' }, { t: 'Recibió', k: 'recibido_por' },
      ], filas, { alClic: r => detalle(r, cargar), vacio: 'No hay traslados en este período' }));
  };

  const accionesLote = h('div', { class: 'botones' },
    h('button', { class: 'btn btn-sec', onclick: async () => {
      if (!marcados.size) return toast('Marque uno o más traslados', 'error');
      const n = await excelSivet([...marcados], `SIGAM_traslados_SIVET_${hoyISO()}.xlsx`);
      toast(`Excel generado con ${n} líneas`);
      if (esAdmin() && await confirmar('Enviado a TICS', '¿Marcar estos traslados como enviados a TICS para migrar a SIVET?', 'Marcar')) {
        await rpc('marcar_enviado_sivet', { p_traslados: [...marcados] }); cargar();
      }
    } }, '⬇ Excel para TICS de los marcados'),
    esAdmin() ? h('button', { class: 'btn btn-primario', onclick: async () => {
      if (!marcados.size) return toast('Marque uno o más traslados', 'error');
      if (await marcarEfectivo([...marcados])) cargar();
    } }, '✔ Marcar efectivos en SIVET') : null);

  const pintarAvisoSivet = async () => {
    try {
      const { count } = await q(sb.from('traslados').select('id', { count: 'exact', head: true }).eq('sivet_efectivo', false).neq('estado', 'anulado'));
      avisoSivet.replaceChildren(count ? h('div', { class: 'aviso aviso-warn' }, `${count} traslado(s) en total aún no se han hecho efectivos en SIVET. `,
        h('button', { class: 'btn btn-sec btn-peq', onclick: () => { desde.value = '2020-01-01'; hasta.value = hoyISO(); selSivet.value = 'falta_efectivo'; cargar(); } }, 'Ver todos'))
        : h('div', { class: 'aviso aviso-ok' }, '✔ Todos los traslados ya están efectivos en SIVET.'));
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
    { texto: '⬇ Excel para TICS', clase: 'btn-sec', accion: async () => { await excelSivet([t.id], `SIGAM_${t.numero}_SIVET.xlsx`); return false; } },
  ];
  if (t.estado === 'enviado') acciones.push({ texto: 'Anular', clase: 'btn-peligro', accion: async () => {
    const m = await pedirTexto(`Anular ${t.numero}`, 'Motivo (la existencia regresa a la bodega de origen)'); if (!m) return false;
    await rpc('anular_traslado', { p_traslado: t.id, p_motivo: m }); toast('Traslado anulado'); recargar();
  } });
  if (esAdmin() && !t.enviado_sivet) acciones.push({ texto: 'Marcar enviado a TICS', clase: 'btn-primario', accion: async () => {
    await rpc('marcar_enviado_sivet', { p_traslados: [t.id] }); toast('Marcado como enviado a TICS'); recargar();
  } });
  if (esAdmin() && t.estado !== 'anulado') acciones.push(t.sivet_efectivo
    ? { texto: 'Quitar marca de SIVET', clase: 'btn-sec', accion: async () => {
        if (!await confirmar('Quitar marca', `${t.numero} volverá a quedar como pendiente de hacerse efectivo en SIVET.`, 'Quitar')) return false;
        await rpc('marcar_efectivo_sivet', { p_traslados: [t.id], p_efectivo: false }); toast('Marca quitada'); recargar();
      } }
    : { texto: '✔ Efectivo en SIVET', clase: 'btn-primario', accion: async () => { if (!await marcarEfectivo([t.id])) return false; recargar(); } });
  modal(`Traslado ${t.numero} · ${fecha(t.fecha)}`, cont, { ancho: '1100px', acciones });
}

function chipSivet(r) {
  if (r.estado === 'anulado') return h('span', { class: 'estado st-muted' }, '—');
  if (r.sivet_efectivo) return h('span', { class: 'estado st-ok', title: r.sivet_referencia ? 'Referencia SIVET: ' + r.sivet_referencia : '' }, 'Efectivo');
  if (r.enviado_sivet) return h('span', { class: 'estado st-info' }, 'Enviado a TICS');
  return h('span', { class: 'estado st-warn' }, 'Pendiente');
}

// Pide (opcional) la referencia de SIVET y marca los traslados como efectivos
function marcarEfectivo(ids) {
  return new Promise(res => {
    const ref = h('input', { class: 'campo', placeholder: 'Número o referencia en SIVET (opcional)' });
    modal(ids.length === 1 ? 'Traslado efectivo en SIVET' : `${ids.length} traslados efectivos en SIVET`,
      h('div', {}, h('p', {}, 'Confirme que el traslado ya quedó registrado (efectivo) en SIVET.'), h('label', { class: 'fila-campo' }, h('span', {}, 'Referencia SIVET'), ref)), {
        acciones: [{ texto: 'Cancelar', clase: 'btn-sec', accion: () => res(false) },
          { texto: '✔ Marcar efectivo', clase: 'btn-primario', accion: async () => {
            const n = await rpc('marcar_efectivo_sivet', { p_traslados: ids, p_efectivo: true, p_referencia: ref.value.trim() || null });
            toast(`${n} traslado(s) marcados como efectivos en SIVET`); res(true);
          } }],
        alCerrar: () => res(false),
      });
  });
}

const kv = (k, v) => h('div', {}, h('div', { class: 'kpi-titulo' }, k), h('div', {}, v));
