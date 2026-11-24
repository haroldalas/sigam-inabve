// Pólizas de concentración de facturas (CEFAFA): se sube el PDF escaneado, el sistema lee las facturas
// y montos, y las cruza con las entradas registradas en SIGAM (¿vino en físico? ¿coincide el monto?).
import { h, toast, error, num, dinero, fecha, fechaHora, tabla, estadoChip, modal, select, confirmar, pedirTexto, exportarExcel } from '../ui.js';
import { sb, q, rpc, todas, hoyISO } from '../api.js';
import { calcularDesdeMonto, aNumero } from '../poliza_lector.js';

const BUCKET = 'polizas';

export default async function () {
  let pestana = 'lista';
  const raiz = h('div');
  const pintar = async (abrirId) => {
    raiz.replaceChildren(
      h('div', { class: 'pestanas' }, [['lista', 'Pólizas'], ['nueva', 'Subir póliza']].map(([k, t]) =>
        h('button', { class: pestana === k ? 'activo' : '', onclick: () => { pestana = k; pintar(); } }, t))),
      pestana === 'lista' ? await lista() : nueva(id => { pestana = 'lista'; pintar(id); }));
    if (abrirId) detalle(abrirId, () => pintar());
  };
  await pintar();
  return raiz;
}

// ----------------------------------------------------------------------------- lista
async function lista() {
  const filas = await q(sb.from('v_polizas').select('*').order('periodo_hasta', { ascending: false, nullsFirst: false }).order('id', { ascending: false }));
  const zona = h('section', { class: 'tarjeta' });
  const pintar = () => zona.replaceChildren(
    h('p', { class: 'nota' }, 'Cada póliza se compara con las facturas ingresadas en SIGAM. Clic en una póliza para ver el detalle.'),
    tabla([
      { t: 'Póliza', f: r => h('strong', {}, r.numero), ord: r => r.numero, exportar: r => r.numero },
      { t: 'Proveedor', k: 'proveedor' },
      { t: 'Período', f: r => `${fecha(r.periodo_desde)} – ${fecha(r.periodo_hasta)}`, ord: r => r.periodo_hasta },
      { t: 'Facturas', k: 'facturas', num: true },
      { t: 'Monto', f: r => dinero(r.suma_monto), num: true, ord: r => Number(r.suma_monto) },
      { t: 'Coinciden', f: r => h('span', { class: 'estado st-ok' }, r.coinciden), ord: r => r.coinciden },
      { t: 'Monto distinto', f: r => r.monto_distinto ? h('span', { class: 'estado st-danger' }, r.monto_distinto) : '0', ord: r => r.monto_distinto },
      { t: 'No ingresadas', f: r => r.no_ingresadas ? h('span', { class: 'estado st-danger' }, r.no_ingresadas) : '0', ord: r => r.no_ingresadas },
      { t: 'Repetidas', f: r => r.repetidas ? h('span', { class: 'estado st-warn' }, r.repetidas) : '0', ord: r => r.repetidas },
      { t: 'Monto observado', f: r => dinero(r.monto_observado), num: true, ord: r => Number(r.monto_observado) },
      { t: 'Estado', f: r => estadoChip(r.estado), ord: r => r.estado },
    ], filas, { vacio: 'Todavía no se ha subido ninguna póliza', alClic: r => detalle(r.id, async () => zona.replaceWith(await lista())) }));
  pintar();
  return zona;
}

// ----------------------------------------------------------------------------- nueva póliza
function nueva(alGuardar) {
  const st = { archivo: null, filas: [], texto: '' };
  const archivo = h('input', { type: 'file', accept: '.pdf,image/jpeg,image/png', class: 'campo' });
  const avance = h('p', { class: 'nota' });
  const numero = h('input', { class: 'campo', placeholder: 'P050526', style: { maxWidth: '180px', textTransform: 'uppercase' } });
  const desde = h('input', { class: 'campo', type: 'date' });
  const hasta = h('input', { class: 'campo', type: 'date' });
  const tMonto = h('input', { class: 'campo campo-num', placeholder: '0.00' });
  const tIva = h('input', { class: 'campo campo-num', placeholder: '0.00' });
  const tLiq = h('input', { class: 'campo campo-num', placeholder: '0.00' });
  const obs = h('input', { class: 'campo', placeholder: 'Observación (opcional)' });
  const zonaFilas = h('div');
  const resumen = h('div');

  const fila = (f = {}) => ({ factura: '', fecha: '', monto: null, iva: null, liquido: null, verificado: false, origen: 'manual', ...f });

  const pintarResumen = () => {
    const suma = st.filas.reduce((a, f) => a + (Number(f.monto) || 0), 0);
    const sumaL = st.filas.reduce((a, f) => a + (Number(f.liquido) || 0), 0);
    const tm = aNumero(tMonto.value), tl = aNumero(tLiq.value);
    const revisar = st.filas.filter(f => !f.verificado).length;
    const okMonto = tm === null || Math.abs(tm - suma) < 0.015;
    resumen.replaceChildren(h('div', { class: 'aviso ' + (okMonto && !revisar ? 'aviso-ok' : 'aviso-warn') },
      `${st.filas.length} facturas · suma monto ${dinero(suma)} · suma líquido ${dinero(sumaL)}`,
      tm !== null ? (okMonto ? ' · ✔ coincide con el total impreso' : ` · ✘ el total impreso es ${dinero(tm)} (diferencia ${dinero(tm - suma)}): falta o sobra alguna línea`) : '',
      tl !== null && Math.abs(tl - sumaL) >= 0.015 ? ` · líquido impreso ${dinero(tl)}` : '',
      revisar ? ` · ${revisar} línea(s) marcadas para revisar contra el papel` : ''));
  };

  const pintarFilas = () => {
    const cuerpo = st.filas.map((f, i) => {
      const inp = (k, attrs = {}) => {
        const e = h('input', { class: 'campo', value: f[k] ?? '', ...attrs });
        e.addEventListener('change', () => {
          if (k === 'monto') {
            const m = aNumero(e.value);
            if (m) Object.assign(f, calcularDesdeMonto(m));
            f.verificado = true; f.origen = 'manual';
            pintarFilas(); return;
          }
          f[k] = k === 'iva' || k === 'liquido' ? aNumero(e.value) : e.value.trim();
          if (k === 'factura') f.verificado = f.verificado && !!f.factura;
          pintarResumen();
        });
        return e;
      };
      const aritOk = f.monto && f.iva !== null && f.liquido !== null && Math.abs(f.monto - f.iva - f.liquido) < 0.015;
      return h('tr', { class: f.verificado ? '' : 'fila-aviso' },
        h('td', {}, String(i + 1)),
        h('td', {}, inp('factura', { style: { width: '110px' }, inputmode: 'numeric' })),
        h('td', {}, inp('fecha', { type: 'date', style: { width: '150px' } })),
        h('td', {}, inp('monto', { class: 'campo campo-num', style: { width: '120px' }, inputmode: 'decimal' })),
        h('td', { class: 'num' }, num(f.iva)), h('td', { class: 'num' }, num(f.liquido)),
        h('td', {}, f.verificado ? h('span', { class: 'estado st-ok', title: 'Dos lecturas coinciden o se escribió a mano' }, '✔') :
          h('button', { class: 'btn btn-sec btn-peq', title: 'Confirmé esta línea contra el papel', onclick: () => { f.verificado = true; pintarFilas(); } }, 'Revisar ✔'),
          aritOk ? '' : h('small', { class: 'nota' }, ' cálculo incompleto')),
        h('td', {}, h('button', { class: 'btn-icono', title: 'Quitar línea', onclick: () => { st.filas.splice(i, 1); pintarFilas(); } }, '🗑')));
    });
    zonaFilas.replaceChildren(
      h('div', { class: 'tabla-cont' }, h('table', { class: 'tabla' },
        h('thead', {}, h('tr', {}, ['#', 'Factura', 'Fecha', 'Monto facturado', 'IVA retenido', 'Líquido', 'Lectura', ''].map(t => h('th', {}, t)))),
        h('tbody', {}, cuerpo.length ? cuerpo : h('tr', {}, h('td', { colspan: 8, class: 'vacio' }, 'Suba el PDF o agregue las facturas a mano'))))),
      h('div', { class: 'botones', style: { marginTop: '8px' } },
        h('button', { class: 'btn btn-sec', onclick: () => { st.filas.push(fila({ fecha: st.filas.at(-1)?.fecha || '', verificado: true })); pintarFilas(); setTimeout(() => zonaFilas.querySelectorAll('tbody tr:last-child input')[0]?.focus(), 30); } }, '+ Agregar factura'),
        h('small', { class: 'nota' }, 'Al escribir el monto facturado se calculan solos el IVA retenido (1 % sin IVA) y el líquido.')));
    pintarResumen();
  };

  archivo.onchange = async () => {
    const file = archivo.files[0]; if (!file) return;
    if (file.size > 20 * 1024 * 1024) { archivo.value = ''; return toast('El archivo pasa de 20 MB', 'error'); }
    st.archivo = file;
    avance.textContent = 'Leyendo el documento…';
    try {
      const { leerDocumento } = await import('../poliza_lector.js');
      const r = await leerDocumento(file, t => { avance.textContent = t; });
      st.texto = r.texto;
      if (r.numero && !numero.value) numero.value = r.numero;
      if (r.desde && !desde.value) desde.value = r.desde;
      if (r.hasta && !hasta.value) hasta.value = r.hasta;
      if (r.total) { if (r.total.monto) tMonto.value = r.total.monto.toFixed(2); if (r.total.iva) tIva.value = r.total.iva.toFixed(2); if (r.total.liquido) tLiq.value = r.total.liquido.toFixed(2); }
      st.filas = r.filas.map(f => fila(f));
      const ver = st.filas.filter(f => f.verificado).length;
      avance.textContent = st.filas.length
        ? `Se leyeron ${st.filas.length} facturas (${ver} verificadas por cálculo). Compare las líneas amarillas con el papel y agregue las que falten.`
        : 'No se pudieron leer facturas del documento (¿foto torcida o borrosa?). Agréguelas a mano; el PDF igual se guarda como respaldo.';
      pintarFilas();
    } catch (e) { error(e); avance.textContent = 'No se pudo leer el documento; puede agregar las facturas a mano.'; }
  };
  [tMonto, tIva, tLiq].forEach(e => e.addEventListener('input', pintarResumen));

  const guardar = async ev => {
    const filas = st.filas.filter(f => f.factura || f.monto);
    if (!numero.value.trim()) { numero.focus(); return toast('Escriba el número de la póliza', 'error'); }
    if (!filas.length) return toast('La póliza no tiene facturas', 'error');
    const malas = filas.filter(f => !f.factura || !(f.monto > 0));
    if (malas.length) return toast(`Hay ${malas.length} línea(s) sin factura o sin monto`, 'error');
    const pend = filas.filter(f => !f.verificado).length;
    if (pend && !await confirmar('Líneas sin revisar', `${pend} línea(s) no se han confirmado contra el papel. ¿Guardar de todos modos?`, 'Guardar')) return;
    ev.target.disabled = true;
    let ruta = null;
    try {
      if (st.archivo) {
        const ext = (st.archivo.name.split('.').pop() || 'pdf').toLowerCase();
        ruta = `${(hasta.value || hoyISO()).slice(0, 4)}/${numero.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '')}_${Date.now()}.${ext}`;
        const { error: e } = await sb.storage.from(BUCKET).upload(ruta, st.archivo, { contentType: st.archivo.type || 'application/pdf', upsert: false });
        if (e) throw new Error('No se pudo subir el documento: ' + e.message);
      }
      const r = await rpc('guardar_poliza', { p: {
        numero: numero.value, periodo_desde: desde.value || null, periodo_hasta: hasta.value || null,
        total_monto: aNumero(tMonto.value), total_iva: aNumero(tIva.value), total_liquido: aNumero(tLiq.value),
        archivo_ruta: ruta, archivo_nombre: st.archivo?.name || null, observaciones: obs.value.trim() || null,
        filas: filas.map(f => ({ factura: f.factura, fecha: f.fecha || null, monto: f.monto, iva: f.iva, liquido: f.liquido, origen: f.origen })),
      } });
      toast(`Póliza guardada con ${r.lineas} facturas`);
      alGuardar(r.poliza_id);
    } catch (e) {
      if (ruta) await sb.storage.from(BUCKET).remove([ruta]).catch(() => {});
      error(e);
    } finally { ev.target.disabled = false; }
  };

  pintarFilas();
  return h('section', { class: 'tarjeta' },
    h('h2', {}, 'Subir póliza de concentración de facturas'),
    h('p', {}, 'Suba la póliza escaneada en PDF (o una foto). El sistema lee las facturas y montos; usted confirma las líneas dudosas y al guardar se compara cada factura con las entradas de SIGAM.'),
    h('p', { class: 'nota' }, 'Para mejor lectura, escanee la hoja derecha y completa (300 ppp). Con fotos torcidas se leen menos líneas y hay que completarlas a mano.'),
    h('label', { class: 'fila-campo' }, h('span', {}, 'Documento (PDF, JPG o PNG)'), archivo), avance,
    h('div', { class: 'filtros' },
      h('label', { class: 'fila-campo' }, h('span', {}, 'N.º de póliza'), numero),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Del'), desde),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Al'), hasta),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Total facturado'), tMonto),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Total IVA retenido'), tIva),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Total líquido'), tLiq)),
    zonaFilas, resumen,
    h('label', { class: 'fila-campo' }, h('span', {}, 'Observación'), obs),
    h('div', { class: 'botones', style: { marginTop: '12px' } },
      h('button', { class: 'btn btn-primario btn-grande', onclick: guardar }, '✔ Guardar y comparar con SIGAM')));
}

// ----------------------------------------------------------------------------- detalle
async function detalle(id, alCambiar) {
  const [[p], lineas, sinPoliza] = await Promise.all([
    q(sb.from('v_polizas').select('*').eq('id', id)),
    todas(() => sb.from('v_poliza_revision').select('*').eq('poliza_id', id).order('linea')),
    todas(() => sb.from('v_facturas_sin_poliza').select('*').eq('poliza_id', id).order('fecha_factura')),
  ]);
  let filtro = 'observadas';
  const zonaTabla = h('div');
  const cols = [
    { t: '#', k: 'linea', num: true },
    { t: 'Factura', f: r => h('strong', {}, r.factura), exportar: r => r.factura, ord: r => r.factura6 },
    { t: 'Fecha póliza', f: r => fecha(r.fecha), exportar: r => r.fecha, ord: r => r.fecha },
    { t: 'Monto póliza', f: r => dinero(r.monto), num: true, exportar: r => Number(r.monto), ord: r => Number(r.monto) },
    { t: 'Resultado', f: r => h('div', {}, estadoChip(r.resultado), r.veces_en_otras > 0 ? h('div', {}, h('span', { class: 'estado st-warn' }, `También en otra póliza (${r.veces_en_otras})`)) : null),
      exportar: r => r.resultado + (r.veces_en_otras > 0 ? ' · repetida en otra póliza' : ''), ord: r => r.resultado },
    { t: 'Factura en SIGAM', f: r => r.factura_id ? h('div', {}, r.factura_sigam, h('small', { class: 'nota', style: { display: 'block' } }, `${fecha(r.fecha_sigam)} · ${r.productos} producto(s) · ${r.bodega_entrada || ''}`)) : '—',
      exportar: r => r.factura_sigam || '' },
    { t: 'Monto SIGAM', f: r => r.factura_id ? dinero(r.monto_sigam) : '', num: true, exportar: r => r.monto_sigam === null ? '' : Number(r.monto_sigam) },
    { t: 'Diferencia', f: r => r.diferencia === null ? '' : h('strong', { style: { color: Math.abs(r.diferencia) > 0.05 ? 'var(--danger)' : '' } }, dinero(r.diferencia)),
      num: true, exportar: r => r.diferencia === null ? '' : Number(r.diferencia), ord: r => Math.abs(Number(r.diferencia ?? 1e9)) },
    { t: 'Observación', f: r => h('button', { class: 'btn-enlace', title: 'Escribir observación', onclick: async ev => {
      ev.stopPropagation();
      const t = await pedirTexto(`Factura ${r.factura}`, 'Observación (ej.: se recibió en físico, falta ingresarla)', { minimo: 0, valor: r.observacion || '' });
      if (t === null) return;
      try { await rpc('observar_linea_poliza', { p_detalle: r.id, p_obs: t }); r.observacion = t; pintarTabla(); } catch (e) { error(e); }
    } }, r.observacion || '✎'), exportar: r => r.observacion || '' },
  ];
  const visibles = () => filtro === 'todas' ? lineas : lineas.filter(r => r.resultado !== 'coincide' || r.veces_en_otras > 0);
  const pintarTabla = () => zonaTabla.replaceChildren(tabla(cols, visibles(), { vacio: '✔ Todas las facturas de la póliza están ingresadas y con el mismo monto' }));
  pintarTabla();

  const suma = lineas.reduce((a, r) => a + Number(r.monto), 0);
  const kpi = (t, v, color) => h('div', { class: 'kpi' }, h('div', { class: 'kpi-titulo' }, t), h('div', { class: 'kpi-valor', style: color ? { color } : null }, v));
  const selEstado = select([['en_revision', 'En revisión'], ['conforme', 'Conforme'], ['con_observaciones', 'Con observaciones']], p.estado);
  const verDoc = async () => {
    try {
      const { data, error: e } = await sb.storage.from(BUCKET).createSignedUrl(p.archivo_ruta, 600);
      if (e) throw e; window.open(data.signedUrl, '_blank', 'noopener');
    } catch (e) { error(e); }
  };

  const contenido = h('div', {},
    h('p', {}, `${p.proveedor} · período ${fecha(p.periodo_desde)} – ${fecha(p.periodo_hasta)} · subida por ${p.creado_por} el ${fechaHora(p.creado_at)}`),
    h('div', { class: 'rejilla' },
      kpi('Facturas en la póliza', num(p.facturas)), kpi('Coinciden', num(p.coinciden), 'var(--ok)'),
      kpi('Monto distinto', num(p.monto_distinto), p.monto_distinto ? 'var(--danger)' : null),
      kpi('No ingresadas en SIGAM', num(p.no_ingresadas), p.no_ingresadas ? 'var(--danger)' : null),
      kpi('Monto observado', dinero(p.monto_observado), Number(p.monto_observado) ? 'var(--danger)' : null),
      kpi('Suma de la póliza', dinero(suma))),
    p.total_monto !== null && Math.abs(Number(p.total_monto) - suma) >= 0.015
      ? h('p', { class: 'aviso aviso-warn' }, `El total impreso (${dinero(p.total_monto)}) no coincide con la suma de las líneas (${dinero(suma)}).`) : null,
    h('div', { class: 'filtros', style: { marginTop: '10px' } },
      select([['observadas', 'Solo con observaciones'], ['todas', 'Todas las facturas']], filtro, { onchange: e => { filtro = e.target.value; pintarTabla(); } }),
      p.archivo_ruta ? h('button', { class: 'btn btn-sec', onclick: verDoc }, '📄 Ver documento') : h('span', { class: 'nota' }, 'Sin documento adjunto'),
      h('button', { class: 'btn btn-sec', onclick: () => exportarExcel(`SIGAM_poliza_${p.numero}`, [
        { titulo: 'Revisión', cols, filas: lineas },
        { titulo: 'Ingresadas sin póliza', cols: [{ t: 'Factura', k: 'numero' }, { t: 'N.º SIVET', k: 'numero_sivet' }, { t: 'Fecha', k: 'fecha_factura' }, { t: 'Bodega', k: 'bodega' }, { t: 'Monto SIGAM', exportar: r => Number(r.monto_sigam) }], filas: sinPoliza }]) }, '⬇ Excel')),
    zonaTabla,
    sinPoliza.length ? h('details', { style: { marginTop: '12px' } },
      h('summary', {}, `${sinPoliza.length} factura(s) de CEFAFA ingresadas en SIGAM en este período que no aparecen en ninguna póliza`),
      tabla([{ t: 'Factura', k: 'numero' }, { t: 'N.º SIVET', k: 'numero_sivet' }, { t: 'Fecha', f: r => fecha(r.fecha_factura) }, { t: 'Bodega', k: 'bodega' }, { t: 'Monto SIGAM', f: r => dinero(r.monto_sigam), num: true }], sinPoliza)) : null,
    h('div', { class: 'filtros', style: { marginTop: '14px' } }, h('label', { class: 'fila-campo' }, h('span', {}, 'Estado de la revisión'), selEstado)));

  modal(`Póliza ${p.numero}`, contenido, { ancho: '1200px', acciones: [
    { texto: 'Eliminar póliza', clase: 'btn-peligro', accion: async () => {
      if (!await confirmar('Eliminar póliza', `Se eliminará la póliza ${p.numero} y su documento. ¿Continuar?`, 'Eliminar', 'btn-peligro')) return false;
      const ruta = await rpc('eliminar_poliza', { p_id: id });
      if (ruta) await sb.storage.from(BUCKET).remove([ruta]).catch(() => {});
      toast('Póliza eliminada'); alCambiar?.();
    } },
    { texto: 'Cerrar', clase: 'btn-sec', accion: () => {} },
    { texto: 'Guardar estado', clase: 'btn-primario', accion: async () => {
      let o = null;
      if (selEstado.value === 'con_observaciones') { o = await pedirTexto('Observaciones de la póliza', 'Resumen para el proveedor o para liquidación', { valor: p.observaciones || '' }); if (o === null) return false; }
      await rpc('revisar_poliza', { p_id: id, p_estado: selEstado.value, p_obs: o }); toast('Estado actualizado'); alCambiar?.();
    } },
  ] });
}
