// Recepción de traslados en la sede de destino: se cuenta lo que llega; lo que coincide entra,
// las diferencias se reportan a la coordinación y el resto del traslado se acepta.
import { h, toast, error, num, fecha, fechaHora, chipsProducto, tabla, estadoChip, confirmar, modal } from '../ui.js';
import { sb, q, rpc, estado, esAdmin, productoPorCodigo } from '../api.js';
import { buscadorProducto } from '../componentes.js';
import { escanearConCamara, camaraDisponible } from '../escaner.js';
import { pdfTraslado } from '../reportes.js';

export default async function () {
  const raiz = h('div');
  const lista = async () => {
    let filas = await q(sb.from('v_bitacora_traslados').select('*').eq('estado', 'enviado').order('fecha'));
    if (!esAdmin()) filas = filas.filter(t => estado.bodegas.find(b => b.id === t.bodega_destino_id)?.sede_id === estado.perfil.sede_id);
    raiz.replaceChildren(h('section', { class: 'tarjeta' },
      h('h2', {}, `Traslados por recibir (${filas.length})`),
      h('p', { class: 'nota' }, 'Abra el traslado cuando llegue la mercadería. Escanee o escriba lo que recibe; al final se acepta lo que coincide y las diferencias se informan a la coordinación.'),
      tabla([
        { t: 'Número', k: 'numero' }, { t: 'Enviado', f: r => fechaHora(r.enviado_at) },
        { t: 'Desde', f: r => `${r.bodega_origen} · ${r.sede_origen}` }, { t: 'Para', k: 'bodega_destino' },
        { t: 'Líneas', k: 'lineas', num: true }, { t: 'Unidades', k: 'unidades_enviadas', num: true },
        { t: '', f: r => h('button', { class: 'btn btn-primario btn-peq' }, 'Recibir') },
      ], filas, { alClic: r => recibir(r), vacio: 'No hay traslados pendientes de recibir 🎉' })));
  };

  const recibir = async t => {
    const det = await q(sb.from('traslado_detalle').select('id,producto_id,cantidad_enviada,lote_origen_id,lotes:lote_origen_id(numero_lote,fecha_vencimiento),productos(id,codigo,nombre_comercial,presentacion,aware,cadena_frio,controlado)')
      .eq('traslado_id', t.id).order('id'));
    const lineas = det.map(d => ({ ...d, recibido: null, obs: '' }));
    const extras = [];
    const zona = h('div', { class: 'lineas' });
    const progreso = h('div', { class: 'progreso' }, h('div'));
    const resumen = h('p', { class: 'nota' });

    const pintar = () => {
      zona.replaceChildren(...lineas.map(l => {
        const inp = h('input', { class: 'campo campo-num', type: 'number', min: 0, step: 'any', value: l.recibido ?? '', placeholder: '0', 'aria-label': 'Cantidad recibida' });
        inp.oninput = () => { l.recibido = inp.value === '' ? null : Number(inp.value); estadoFila(); actualizar(); };
        const obs = h('input', { class: 'campo', placeholder: 'Observación si no coincide', value: l.obs, style: { maxWidth: '240px' } });
        obs.oninput = () => { l.obs = obs.value; };
        const fila = h('div', { class: 'linea' },
          h('div', { class: 'linea-nombre' }, h('strong', {}, l.productos.nombre_comercial, ' ', chipsProducto(l.productos)),
            h('small', {}, [l.productos.codigo, l.productos.presentacion, `lote ${l.lotes?.numero_lote || 's/lote'}`, `vence ${fecha(l.lotes?.fecha_vencimiento)}`].filter(Boolean).join(' · ')),
            h('small', { style: { display: 'block', fontWeight: 700 } }, `Enviado: ${num(l.cantidad_enviada)}`)),
          obs, inp,
          h('button', { class: 'btn btn-sec btn-peq', title: 'Recibí lo enviado', onclick: () => { l.recibido = Number(l.cantidad_enviada); pintar(); actualizar(); } }, '✔'));
        const estadoFila = () => {
          fila.classList.toggle('completa', l.recibido !== null && l.recibido === Number(l.cantidad_enviada));
          fila.classList.toggle('error', l.recibido !== null && l.recibido !== Number(l.cantidad_enviada));
        };
        estadoFila();
        return fila;
      }), ...extras.map((x, i) => h('div', { class: 'linea error' },
        h('div', { class: 'linea-nombre' }, h('strong', {}, '➕ ', x.p.nombre_comercial), h('small', {}, 'Llegó pero no venía en el traslado')),
        h('input', { class: 'campo', placeholder: 'Observación', value: x.obs, oninput: e => { x.obs = e.target.value; } }),
        h('input', { class: 'campo campo-num', type: 'number', min: 0, value: x.cantidad, oninput: e => { x.cantidad = Number(e.target.value) || 0; } }),
        h('button', { class: 'btn-icono', onclick: () => { extras.splice(i, 1); pintar(); } }, '🗑'))));
      actualizar();
    };
    const actualizar = () => {
      const listos = lineas.filter(l => l.recibido !== null).length;
      const ok = lineas.filter(l => l.recibido === Number(l.cantidad_enviada)).length;
      progreso.firstChild.style.width = `${(100 * listos / lineas.length).toFixed(0)}%`;
      resumen.textContent = `${listos} de ${lineas.length} líneas revisadas · ${ok} coinciden · ${listos - ok} con diferencia · ${extras.length} producto(s) extra`;
    };

    // Cada escaneo suma 1 a la primera línea de ese producto que aún no está completa
    const escaneado = async p => {
      const ls = lineas.filter(l => l.producto_id === p.id);
      if (!ls.length) {
        const x = extras.find(e => e.p.id === p.id);
        if (x) x.cantidad += 1; else extras.push({ p, cantidad: 1, obs: '' });
        toast(`${p.nombre_comercial} no venía en este traslado: se anotó como producto extra`, 'error');
      } else {
        const l = ls.find(x => (x.recibido ?? 0) < Number(x.cantidad_enviada)) || ls[ls.length - 1];
        l.recibido = (l.recibido ?? 0) + 1;
      }
      pintar();
    };

    const confirmarRecepcion = async ev => {
      const sinRevisar = lineas.filter(l => l.recibido === null);
      if (sinRevisar.length && !await confirmar('Líneas sin revisar', `${sinRevisar.length} línea(s) no tienen cantidad. Se tomarán como NO recibidas (0) y se reportarán como faltantes. ¿Continuar?`, 'Continuar', 'btn-peligro')) return;
      const difs = lineas.filter(l => (l.recibido ?? 0) !== Number(l.cantidad_enviada)).length + extras.length;
      if (!await confirmar('Confirmar recepción', difs
        ? `Se aceptará lo que coincide y se reportarán ${difs} diferencia(s) a la coordinación para su corrección.`
        : 'Todo coincide. Los productos se sumarán a la existencia de su bodega.', 'Confirmar recepción')) return;
      ev.target.disabled = true;
      try {
        const r = await rpc('recibir_traslado', {
          p_traslado: t.id,
          p_lineas: lineas.map(l => ({ detalle_id: l.id, cantidad_recibida: l.recibido ?? 0, observacion: l.obs || null })),
          p_extras: extras.filter(x => x.cantidad > 0).map(x => ({ producto_id: x.p.id, cantidad: x.cantidad, observacion: x.obs || null })),
        });
        toast(r.diferencias ? `Recibido con ${r.diferencias} diferencia(s); la coordinación fue notificada en su bandeja` : 'Traslado recibido completo');
        lista();
      } catch (e) { error(e); ev.target.disabled = false; }
    };

    pintar();
    raiz.replaceChildren(h('section', { class: 'tarjeta' },
      h('div', { class: 'botones' }, h('button', { class: 'btn btn-sec', onclick: lista }, '← Volver'), h('span', { class: 'espacio' }),
        h('button', { class: 'btn btn-sec', onclick: () => pdfTraslado(t.id) }, '⬇ PDF del traslado')),
      h('h2', { style: { marginTop: '12px' } }, `Recibir ${t.numero}`),
      h('p', {}, `De ${t.bodega_origen} (${t.sede_origen}) para ${t.bodega_destino} · enviado ${fechaHora(t.enviado_at)} por ${t.enviado_por || ''}`),
      h('div', { class: 'fila', style: { alignItems: 'flex-start' } },
        h('div', { style: { flex: '3 1 340px' } }, buscadorProducto({ alElegir: escaneado, placeholder: 'Escanee cada empaque que recibe (cada lectura suma 1)' })),
        camaraDisponible() ? h('button', { class: 'btn btn-sec', onclick: () => escanearConCamara(async cod => {
          const p = await productoPorCodigo(cod); if (p) escaneado(p); else toast(`Código ${cod} no está en el catálogo`, 'error');
        }, { continuo: true, titulo: 'Cada lectura suma 1' }) }, '📷 Contar con la cámara') : null,
        h('button', { class: 'btn btn-sec', onclick: () => { lineas.forEach(l => { if (l.recibido === null) l.recibido = Number(l.cantidad_enviada); }); pintar(); } }, 'Marcar lo pendiente como completo')),
      h('div', { style: { margin: '12px 0 4px' } }, progreso), resumen,
      zona,
      h('div', { class: 'botones' }, h('button', { class: 'btn btn-primario btn-grande', onclick: confirmarRecepcion }, '📥 Confirmar recepción'))));
  };

  await lista();
  return raiz;
}
