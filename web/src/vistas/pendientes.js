// Bandeja del administrador: diferencias de traslados, devoluciones y conteos por aprobar
import { h, toast, error, num, fecha, fechaHora, tabla, estadoChip, modal, select } from '../ui.js';
import { sb, q, rpc, estado } from '../api.js';
import { refrescarInsignias } from '../main.js';

export default async function () {
  const raiz = h('div');
  const pintar = async () => {
    const [difs, devs, conteos, sols] = await Promise.all([
      q(sb.from('traslado_diferencias').select('*,productos(codigo,nombre_comercial),traslados(numero,fecha,bodega_origen_id,bodega_destino_id,recibido_por),traslado_detalle(lote_origen_id,lote_destino_id)').eq('estado', 'pendiente').order('id')),
      q(sb.from('devoluciones').select('*,productos(codigo,nombre_comercial),lotes(numero_lote,fecha_vencimiento)').eq('estado', 'pendiente').order('id')),
      q(sb.from('conteos').select('*').eq('estado', 'pendiente_aprobacion').order('id')),
      q(sb.from('perfiles').select('email,nombre,cargo,sede_solicitada,rol_solicitado,solicitado_at').eq('estado_solicitud', 'pendiente').order('solicitado_at')).catch(() => []),
    ]);
    const nom = id => estado.bodegas.find(b => b.id === id)?.nombre || '';
    raiz.replaceChildren(
      sols.length ? h('section', { class: 'tarjeta' }, h('h2', {}, `Solicitudes de acceso (${sols.length})`),
        tabla([{ t: 'Enviada', f: r => fechaHora(r.solicitado_at) }, { t: 'Nombre', k: 'nombre' }, { t: 'Correo', k: 'email' }, { t: 'Cargo', k: 'cargo' },
          { t: 'Sede', f: r => estado.sedes.find(s => s.id === r.sede_solicitada)?.nombre || '' }, { t: 'Solicita', k: 'rol_solicitado' }],
          sols, { alClic: () => { location.hash = '#admin'; } }),
        h('p', { class: 'nota' }, 'Se aprueban en Administración → Usuarios, asignando rol y sede.')) : null,
      h('section', { class: 'tarjeta' }, h('h2', {}, `Diferencias en traslados (${difs.length})`),
        h('p', { class: 'nota' }, 'La sede ya aceptó lo que coincidía. Decida qué hacer con cada diferencia.'),
        tabla([
          { t: 'Traslado', f: r => r.traslados?.numero }, { t: 'Destino', f: r => nom(r.traslados?.bodega_destino_id) },
          { t: 'Producto', f: r => `${r.productos?.nombre_comercial}` }, { t: 'Tipo', f: r => ({ faltante: 'Llegó de menos', sobrante: 'Llegó de más', producto_no_enviado: 'Producto equivocado / no enviado' })[r.tipo] },
          { t: 'Enviado', k: 'cantidad_enviada', num: true }, { t: 'Recibido', k: 'cantidad_recibida', num: true },
          { t: 'Observación de la sede', k: 'observacion_sede' }, { t: 'Recibió', f: r => r.traslados?.recibido_por },
        ], difs, { alClic: resolver, vacio: 'Sin diferencias pendientes' })),
      h('section', { class: 'tarjeta' }, h('h2', {}, `Devoluciones por validar (${devs.length})`),
        tabla([
          { t: 'Fecha', f: r => fechaHora(r.creado_at) }, { t: 'Bodega', f: r => nom(r.bodega_id) }, { t: 'Producto', f: r => r.productos?.nombre_comercial },
          { t: 'Cantidad', k: 'cantidad', num: true }, { t: 'Factura', k: 'numero_factura' }, { t: 'Lote', f: r => r.lotes?.numero_lote || 'No identificado' },
          { t: 'DUI', k: 'dui' }, { t: 'Receta', f: r => fecha(r.fecha_receta) }, { t: 'Estado físico', k: 'estado_fisico' }, { t: 'Motivo', k: 'motivo' },
          { t: 'Registró', k: 'registrado_por' },
        ], devs, { alClic: validar, vacio: 'Sin devoluciones pendientes' })),
      h('section', { class: 'tarjeta' }, h('h2', {}, `Conteos físicos por aprobar (${conteos.length})`),
        tabla([{ t: 'Número', k: 'numero' }, { t: 'Bodega', f: r => nom(r.bodega_id) }, { t: 'Finalizó', f: r => `${r.finalizado_por || ''} ${fechaHora(r.finalizado_at)}` }],
          conteos, { alClic: () => { location.hash = '#conteo'; }, vacio: 'Sin conteos pendientes' })));
    refrescarInsignias();
  };

  const resolver = async d => {
    const opciones = d.tipo === 'faltante'
      ? [['devolver_origen', 'No llegó: regresar la cantidad a la bodega de origen'], ['acreditar_destino', 'Sí llegó (recuento): sumarla en el destino'], ['perdida', 'Se perdió en el traslado (no regresa a ninguna bodega)']]
      : d.tipo === 'sobrante'
        ? [['acreditar_destino', 'Confirmar: descontar el excedente del origen y sumarlo en el destino'], ['rechazar', 'Rechazar: la sede devolverá el excedente']]
        : [['acreditar_destino', 'Confirmar: indicar de qué lote salió y sumarlo en el destino'], ['rechazar', 'Rechazar: la sede lo devolverá']];
    const accion = select(opciones, opciones[0][0]);
    const obs = h('input', { class: 'campo', placeholder: 'Observación de la resolución' });
    const zonaLote = h('div');
    let loteSel = null;
    const pintarLote = async () => {
      zonaLote.replaceChildren();
      if (d.tipo !== 'producto_no_enviado' || accion.value !== 'acreditar_destino') return;
      const ls = await q(sb.from('lotes').select('id,numero_lote,fecha_vencimiento,disponible').eq('bodega_id', d.traslados.bodega_origen_id).eq('producto_id', d.producto_id).gt('disponible', 0));
      loteSel = select(ls.map(l => [l.id, `${l.numero_lote || 's/lote'} · vence ${fecha(l.fecha_vencimiento)} · ${num(l.disponible)} disp.`]), ls[0]?.id);
      zonaLote.replaceChildren(ls.length ? h('label', { class: 'fila-campo' }, h('span', {}, 'Lote de origen'), loteSel)
        : h('p', { class: 'aviso aviso-warn' }, 'La bodega de origen no tiene existencia de este producto.'));
    };
    accion.onchange = pintarLote; pintarLote();
    modal(`${d.traslados.numero} · ${d.productos.nombre_comercial}`, h('div', {},
      h('p', {}, `Enviado ${num(d.cantidad_enviada)} · recibido ${num(d.cantidad_recibida)}${d.observacion_sede ? ' · "' + d.observacion_sede + '"' : ''}`),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Decisión'), accion), zonaLote, h('label', { class: 'fila-campo' }, h('span', {}, 'Observación'), obs)), {
      acciones: [{ texto: 'Resolver', clase: 'btn-primario', accion: async () => {
        await rpc('resolver_diferencia', { p_dif: d.id, p_accion: accion.value, p_obs: obs.value || null, p_lote_origen: loteSel ? Number(loteSel.value) : null });
        toast('Diferencia resuelta'); pintar();
      } }] });
  };

  const validar = async dv => {
    const decision = select([['reingresar', 'Procede: reingresar al inventario (mismo lote y factura)'], ['averia', 'Procede como avería: enviar a la bodega de Descarte'], ['rechazar', 'No procede']],
      dv.estado_fisico === 'completo_sellado' ? 'reingresar' : 'averia');
    const obs = h('input', { class: 'campo', placeholder: 'Observación' });
    let loteSel = null;
    const zonaLote = h('div');
    if (!dv.lote_id) {
      const ls = await q(sb.from('lotes').select('id,numero_lote,fecha_vencimiento,bodega_id').eq('producto_id', dv.producto_id).order('fecha_vencimiento', { ascending: false }).limit(30));
      loteSel = select(ls.map(l => [l.id, `${l.numero_lote || 's/lote'} · vence ${fecha(l.fecha_vencimiento)} · ${nomB(l.bodega_id)}`]), ls[0]?.id);
      zonaLote.append(h('p', { class: 'aviso aviso-warn' }, 'No se identificó el lote con el número de factura. Elija el lote.'), h('label', { class: 'fila-campo' }, h('span', {}, 'Lote'), loteSel));
    }
    modal(`Devolución · ${dv.productos.nombre_comercial}`, h('div', {},
      h('p', {}, `${num(dv.cantidad)} unidad(es) · factura ${dv.numero_factura} · DUI ${dv.dui} · receta ${fecha(dv.fecha_receta)} · ${dv.estado_fisico.replace('_', ' ')}`),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Decisión'), decision), zonaLote, h('label', { class: 'fila-campo' }, h('span', {}, 'Observación'), obs)), {
      acciones: [{ texto: 'Guardar decisión', clase: 'btn-primario', accion: async () => {
        await rpc('validar_devolucion', { p_id: dv.id, p_decision: decision.value, p_obs: obs.value || null, p_lote: loteSel ? Number(loteSel.value) : null });
        toast('Devolución validada'); pintar();
      } }] });
  };
  const nomB = id => estado.bodegas.find(b => b.id === id)?.nombre || '';

  await pintar();
  return raiz;
}
