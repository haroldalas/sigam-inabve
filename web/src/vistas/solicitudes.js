// Solicitudes (todos los roles): medicamentos, insumos, aparatos auditivos, lentes y cirugías oftálmicas.
// Un solo formato · autocompletar por DUI · ruteo DSEC/DSIN · validación · seguimiento telefónico · historial.
import { h, tabla, toast, error, modal, confirmar, pedirTexto, select, campo, fecha, fechaHora, num, ent, exportarExcel, debounce, chip } from '../ui.js';
import { sb, q, rpc, estado, esAdmin, dispararCorreos, productos } from '../api.js';
import { buscadorProducto } from '../componentes.js';

const DEPARTAMENTOS = ['Ahuachapán', 'Santa Ana', 'Sonsonate', 'Chalatenango', 'La Libertad', 'San Salvador', 'Cuscatlán', 'La Paz',
  'Cabañas', 'San Vicente', 'Usulután', 'San Miguel', 'Morazán', 'La Unión'];
const SECTORES = ['FAES', 'EXCOMBATIENTE', 'PERSONA CON DISCAPACIDAD', 'OTRO'];
const ORIGENES = [['llamada', 'Llamada telefónica'], ['consulta', 'Consulta médica'], ['jornada', 'Jornada'], ['referencia_hmc', 'Referencia del HMC'], ['otro', 'Otro']];
const JUSTIFICACIONES = ['No está en el cuadro básico', 'Sin existencia en la sede', 'Indicación de especialista', 'Continuidad de tratamiento', 'Otro'];
const DIAGNOSTICOS_OFTAL = ['Catarata bilateral', 'Catarata unilateral', 'Catarata + pterigión', 'Pterigión bilateral', 'Pterigión unilateral', 'Otro'];
const RESULTADOS = [
  ['contesto', '✅ Contestó', 'btn-sec'], ['no_contesto', '📵 No contestó', 'btn-sec'], ['avisado_retirar', '📦 Avisado: pasará a retirar', 'btn-primario'],
  ['ya_recibio', '✔ Ya lo recibió', 'btn-sec'], ['ya_no_necesita', '✖ Ya no lo necesita', 'btn-sec'], ['numero_equivocado', '☎ Número equivocado', 'btn-sec'],
];
const AREA_TXT = { DSEC: 'DSEC · Seguimiento y Control en Salud', DSIN: 'DSIN · Programas de Salud Integral' };
// color del estado según el tipo (rojo: solicitado, amarillo: ya gestionado, azul: sin disponibilidad, morado: JD, verde: disponible)
const colorEstado = (tipo, k) => ((TIPOS.find(t => t.clave === tipo)?.estados || []).find(e => e.k === k) || {}).c || 'gris';
const chipEstado = s => h('span', { class: 'estado c-' + (s.estado_color || colorEstado(s.tipo, s.estado)) }, s.estado_texto || s.estado);
const dui4 = d => d ? '•••••' + String(d).slice(-4) : '';
const tel = t => t ? h('a', { class: 'tel', href: 'tel:' + t }, '📞 ' + t.replace(/^(\d{4})(\d{4})$/, '$1-$2')) : null;

let TIPOS = [], RESP = [];
const tipoDe = k => TIPOS.find(t => t.clave === k) || {};
const soyResp = (tipo, area) => RESP.some(r => r.email === estado.perfil.email && r.tipo === tipo && (!area || r.area === area));
const veoSeguimiento = () => esAdmin() || estado.perfil.rol === 'dependiente' || RESP.some(r => r.email === estado.perfil.email && ['DSIN', 'SEGUIMIENTO'].includes(r.area));
// JPII: responsables de Seguimiento telefónico · regionales: dependientes de la sede (medicamentos e insumos)
// llama quien tiene el permiso de seguimiento (Administración → Usuarios), para su sede; DSIN en todas
const meToca = s => soyResp(s.tipo, 'DSIN') || (!!estado.perfil.seguimiento && estado.perfil.sede_id === s.sede_id && ['medicamento', 'insumo'].includes(s.tipo));
const enReserva = s => s.bodega_reserva_tipo && !['despacho_medicamentos', 'almacen_insumos'].includes(s.bodega_reserva_tipo);
const textoPlazo = s => s.dias_retiro == null ? '' : s.dias_retiro > 0 ? `retira a más tardar el ${fecha(s.retiro_limite)} · quedan ${s.dias_retiro} día(s) hábil(es)`
  : s.dias_retiro === 0 ? `hoy (${fecha(s.retiro_limite)}) es el último día para retirar` : `venció el ${fecha(s.retiro_limite)}`;
// quien llama: avisa a administración que el beneficiario llegó (solo administración pasa a Despacho)
async function avisarLlegada(s, alTerminar) {
  const nota = await pedirTexto('Llegó a retirar', `Se avisará a administración para que pase ${s.solicita} × ${num(s.cantidad)} de Reservas a Despacho y lo registre en SIVET. Comentario (opcional):`, { minimo: 0 });
  if (nota === null) return;
  try { await rpc('solicitar_pase_despacho', { p_id: s.id, p_nota: nota }); toast('Administración fue avisada por correo', 'ok', 6000); alTerminar && alTerminar(); }
  catch (e) { error(e); }
}
// ¿está el producto? (para el médico o quien atiende al beneficiario en la clínica)
function cajaDisponibilidad(s, dispo, alTerminar) {
  const res = dispo.filter(d => d.tipo === 'reservas').reduce((a, d) => a + Number(d.cantidad), 0);
  const des = dispo.filter(d => d.tipo !== 'reservas').reduce((a, d) => a + Number(d.cantidad), 0);
  if (s.estado === 'en_despacho' || (des > 0 && !res))
    return h('div', { class: 'aviso aviso-ok' }, `✔ Disponible en Despacho de ${s.sede} (${num(des)} u.): se puede despachar con su DUI.`);
  if (res > 0) return h('div', { class: 'aviso aviso-warn' },
    h('strong', {}, `📦 Sí está: reservado en ${s.sede} (${num(res)} u. en Reservas).`), ' ',
    s.estado === 'por_pasar' ? 'Administración ya fue avisada para trasladarlo a Despacho y registrarlo en SIVET.'
      : 'Aún no está en Despacho ni en SIVET: avise a un administrador para trasladarlo a SIVET.', ' ',
    !esAdmin() && ['lista', 'avisado'].includes(s.estado) ? h('button', { class: 'btn btn-primario btn-peq', onclick: () => avisarLlegada(s, alTerminar) }, 'Avisar a administración') : null,
    esAdmin() ? botonPase(s, alTerminar) : null);
  return h('div', { class: 'aviso aviso-info' }, `⏳ Todavía no hay existencia de este producto en ${s.sede} para esta solicitud.`);
}
// botón según quién: administración pasa a Despacho; quien llama avisa que llegó
function botonPase(s, alTerminar) {
  if (!enReserva(s)) return s.bodega_reserva ? h('span', { class: 'nota' }, 'Ya está en el Despacho: despáchele con su DUI.') : null;
  if (esAdmin() && ['avisado', 'por_pasar', 'retiro_vencido'].includes(s.estado))
    return h('button', { class: 'btn btn-primario btn-peq', onclick: () => pasarADespacho([s], s.estado === 'retiro_vencido', alTerminar) }, '🏥 Pasar a Despacho');
  if (['lista', 'avisado'].includes(s.estado))   // cualquiera (quien llama, el médico, Contact Center)
    return h('button', { class: 'btn btn-primario btn-peq', onclick: () => avisarLlegada(s, alTerminar) }, '🏥 Llegó a retirar: avisar a administración');
  return null;
}
async function pasarADespacho(sols, vencidas, alTerminar) {
  const lista = sols.map(s => `${s.numero} · ${s.solicita} × ${num(s.cantidad)}`).join('\n');
  const t = vencidas ? 'Pasar a Despacho (no retiró)' : 'Pasar a Despacho';
  const txt = (vencidas ? 'Lo reservado se trasladará al Despacho para otro paciente y la solicitud se cerrará como "No retiró".'
    : 'Se trasladará de la reserva al Despacho; luego despáchele con su DUI y la solicitud se cerrará sola.') +
    '\n\nRecuerde registrar el traslado también en SIVET (aparece en Traslados → Excel para SIVET).\n\n' + lista;
  if (!await confirmar(t, txt, 'Pasar a Despacho')) return;
  try {
    const r = await rpc('pasar_reserva_a_despacho', { p_ids: sols.map(s => s.id), p_nota: vencidas ? 'No retiró en 7 días hábiles' : null });
    toast(r.traslados.length ? `Traslado ${r.traslados.join(', ')} hecho · regístrelo en SIVET (le llegó un correo)` : 'Listo: ya estaba en el Despacho', 'ok', 8000);
    alTerminar && alTerminar();
  } catch (e) { error(e); }
}

export async function cargarContexto() {
  [TIPOS, RESP] = await Promise.all([
    q(sb.from('solicitud_tipos').select('*').order('orden')),
    q(sb.from('solicitud_responsables').select('*')),
  ]);
}
export default async function (params) {
  await cargarContexto();
  const pestanas = [
    ['bandeja', '📋 Bandeja'], ['nueva', '➕ Nueva solicitud'], ['dui', '🔎 Consultar por DUI'],
    esAdmin() || soyResp('medicamento', 'DSIN') ? ['cefafa', '📧 CEFAFA'] : null,
    esAdmin() ? ['responsables', '👥 Responsables'] : null,
    esAdmin() ? ['estados', '🎨 Estados'] : null,
  ].filter(Boolean);
  let actual = pestanas.some(p => p[0] === params.get('ver')) ? params.get('ver') : 'bandeja';
  const zona = h('div');
  const barra = h('div', { class: 'pestanas' });
  const ir = async k => {
    actual = k;
    history.replaceState(null, '', '#solicitudes?ver=' + k);
    barra.replaceChildren(...pestanas.map(([c, t]) => h('button', { class: c === actual ? 'activo' : '', onclick: () => ir(c) }, t)));
    zona.replaceChildren(h('p', { class: 'nota' }, 'Cargando…'));
    try {
      zona.replaceChildren(await ({ bandeja, nueva: () => nueva(ir), dui: consultaDui, responsables, cefafa, estados: editarEstados })[k]());
    } catch (e) { zona.replaceChildren(h('div', { class: 'aviso aviso-error' }, e.message)); }
  };
  await ir(actual);
  if (params.get('id')) abrir(Number(params.get('id')), () => ir(actual));
  return h('div', {}, h('section', { class: 'tarjeta tarjeta-pestanas' }, barra), zona);
}

// ============================================================================ nueva solicitud
async function nueva(ir) {
  const st = { tipo: null, prod: null, fuera: false, abiertas: [] };
  const caja = h('section', { class: 'tarjeta' });
  const elegirTipo = h('div', { class: 'tipos-solicitud' }, TIPOS.map(t =>
    h('button', { type: 'button', class: 'tipo-sol', 'data-tipo': t.clave, onclick: () => { st.tipo = t.clave; st.prod = null; st.fuera = false; pintar(); } },
      h('span', { class: 'tipo-icono' }, t.icono), h('span', {}, t.nombre))));

  // --- beneficiario (autocompletar por DUI)
  const dui = h('input', { class: 'campo dui-grande', inputmode: 'numeric', maxlength: 9, placeholder: '000000000', autocomplete: 'off' });
  const nombre = h('input', { class: 'campo', placeholder: 'Nombre completo' });
  const t1 = h('input', { class: 'campo', inputmode: 'tel', placeholder: '7000 0000' });
  const t2 = h('input', { class: 'campo', inputmode: 'tel', placeholder: 'Opcional' });
  const sector = select([['', '—'], ...SECTORES.map(s => [s, s])], '');
  const depto = select([['', '—'], ...DEPARTAMENTOS.map(d => [d, d])], '');
  const sede = select([['', 'Sin sede / elija la sede'], ...estado.sedes.map(s => [s.id, s.nombre])], estado.perfil.contact_center ? '' : (estado.perfil.sede_id || ''));
  const infoDui = h('div', { class: 'info-dui' });
  dui.addEventListener('input', async () => {
    dui.value = dui.value.replace(/\D/g, '').slice(0, 9);
    infoDui.replaceChildren(); st.abiertas = [];
    if (dui.value.length !== 9) return;
    try {
      const b = await rpc('buscar_beneficiario', { p_dui: dui.value });
      if (!b) { infoDui.replaceChildren(h('span', { class: 'nota' }, '🆕 Beneficiario nuevo: complete sus datos.')); nombre.focus(); return; }
      nombre.value = b.nombre || ''; t1.value = b.telefono || ''; t2.value = b.telefono2 || '';
      sector.value = b.sector || ''; depto.value = b.departamento || ''; if (b.sede_id) sede.value = b.sede_id;
      st.abiertas = b.abiertas || [];
      infoDui.replaceChildren(h('span', { class: 'ok' }, '✔ Datos cargados. Si el teléfono cambió, corríjalo aquí: se actualiza al registrar.'),
        st.abiertas.length ? h('div', { class: 'aviso aviso-warn' }, `Tiene ${st.abiertas.length} solicitud(es) abierta(s): `,
          ...st.abiertas.map(a => h('button', { type: 'button', class: 'btn-enlace', onclick: () => abrir(a.id) }, `${a.numero} · ${a.solicita} (${a.estado})`))) : null);
    } catch (e) { error(e); }
  });

  // --- origen y prioridad
  const origen = select(ORIGENES, 'llamada');
  const origenDet = h('input', { class: 'campo', placeholder: 'Lugar de la jornada, médico que refiere…' });
  const urgente = h('input', { type: 'checkbox' });

  // --- campos según tipo
  const zonaTipo = h('div');
  const destino = h('div', { class: 'destino-sol' });
  const respuesta = (nombreGrupo, opciones, alCambiar) => {
    const g = h('div', { class: 'segmentado' });
    opciones.forEach(([v, t]) => g.append(h('label', {}, h('input', { type: 'radio', name: nombreGrupo, value: v, onchange: () => { st[nombreGrupo] = v; alCambiar && alCambiar(); } }), h('span', {}, t))));
    return g;
  };
  const cantidad = h('input', { class: 'campo', type: 'number', min: 0, step: 'any', placeholder: 'Cantidad' });
  const unidad = h('input', { class: 'campo', placeholder: 'Unidad (tableta, frasco, par…)' });
  const just = select([['', 'Elija la justificación'], ...JUSTIFICACIONES.map(j => [j, j])], '');
  const justOtro = h('input', { class: 'campo oculto', placeholder: 'Explique' });
  just.onchange = () => justOtro.classList.toggle('oculto', just.value !== 'Otro');
  const pa = h('input', { class: 'campo', placeholder: 'Principio activo' });
  const conc = h('input', { class: 'campo', placeholder: 'Concentración (500 mg, 2 %…)' });
  const forma = h('input', { class: 'campo', placeholder: 'Forma (tableta, crema, frasco…)' });
  const desc = h('input', { class: 'campo', placeholder: 'Descripción del insumo (p. ej. medias compresivas talla M)' });
  const nomManual = h('input', { class: 'campo', placeholder: 'Nombre comercial (si lo sabe)' });
  // principios activos del catálogo para elegir (el producto final lo valida DSIN según lo que ofrezca CEFAFA)
  const catalogo = await productos().catch(() => []);
  const listaPA = h('datalist', { id: 'lista-pa' }, [...new Set(catalogo.filter(x => x.tipo === 'medicamento' && x.principio_activo).map(x => x.principio_activo.toUpperCase()))].sort().map(v => h('option', { value: v })));
  const paCat = h('input', { class: 'campo', list: 'lista-pa', placeholder: 'Principio activo (elija de la lista)' });
  const concCat = h('input', { class: 'campo', placeholder: 'Concentración (opcional)' });
  const lado = select([['', '—'], ['derecho', 'Derecho'], ['izquierdo', 'Izquierdo'], ['bilateral', 'Bilateral']], '');
  const diag = h('input', { class: 'campo', placeholder: 'Diagnóstico (si lo tiene)' });
  const diagOft = select([['', 'Elija el diagnóstico presuntivo'], ...DIAGNOSTICOS_OFTAL.map(d => [d, d])], '');
  const comentario = h('textarea', { class: 'campo', rows: 2, placeholder: 'Comentario (qué pidió, desde cuándo, indicaciones)' });

  const areaCalculada = () => {
    if (st.tipo === 'medicamento') return st.modalidad ? (st.modalidad === 'primera_vez' ? 'DSEC' : 'DSIN') : null;
    if (st.tipo === 'insumo') return st.tiene_evaluacion ? (st.tiene_evaluacion === 'si' ? 'DSIN' : 'DSEC') : null;
    return st.tipo ? 'DSEC' : null;
  };
  const pintarDestino = () => {
    const a = areaCalculada();
    destino.replaceChildren(a ? h('span', {}, '➡ Esta solicitud llegará a ', h('strong', {}, AREA_TXT[a]),
      a === 'DSEC' && st.tipo === 'medicamento' ? ': un médico debe validarla.' :
      a === 'DSEC' && st.tipo === 'insumo' ? ': primero necesita evaluación médica.' : '.') : '');
  };
  const prodSel = h('div', { class: 'prod-elegido' });
  const pintarProd = () => prodSel.replaceChildren(st.prod ? h('div', { class: 'aviso aviso-info' },
    h('strong', {}, st.prod.nombre_comercial), ' · ', [st.prod.codigo, st.prod.principio_activo, st.prod.presentacion].filter(Boolean).join(' · '), ' ',
    h('button', { type: 'button', class: 'btn-enlace', onclick: () => { st.prod = null; pintarProd(); } }, 'Cambiar')) : '');
  const bloqueProducto = tipo => {
    const fuera = h('input', { type: 'checkbox', checked: st.fuera, onchange: e => { st.fuera = e.target.checked; st.prod = null; pintar(false); } });
    const buscador = buscadorProducto({ autofocus: false, filtro: p => p.tipo === tipo, placeholder: tipo === 'medicamento' ? 'Producto (opcional): nombre comercial o código' : 'Busque el insumo en el catálogo',
      alElegir: p => { st.prod = p; unidad.value = unidad.value || p.presentacion || ''; if (p.principio_activo) paCat.value = p.principio_activo.toUpperCase(); pintarProd(); } });
    return h('div', { class: 'bloque-sol' },
      h('h3', {}, tipo === 'medicamento' ? 'Medicamento solicitado' : 'Insumo solicitado'),
      st.fuera ? (tipo === 'medicamento'
        ? h('div', {}, h('div', { class: 'rejilla-2' }, nomManual, pa), h('div', { class: 'rejilla-2' }, conc, forma))
        : desc)
        : tipo === 'medicamento'
          ? h('div', {}, h('p', { class: 'nota' }, 'Elija el producto, el principio activo o ambos. Si CEFAFA ofrece un alterno con el mismo principio activo, DSIN lo valida.'),
              buscador, prodSel, h('div', { class: 'rejilla-2' }, paCat, concCat), listaPA)
          : h('div', {}, buscador, prodSel),
      h('label', { class: 'casilla' }, fuera, tipo === 'medicamento' ? ' No está en el catálogo (escribir nombre y principio activo)' : ' No está en el catálogo'),
      h('div', { class: 'rejilla-3' }, cantidad, unidad, h('div', {}, just, justOtro)));
  };
  const pintarTipo = () => {
    const t = st.tipo;
    if (!t) return zonaTipo.replaceChildren();
    const piezas = [];
    if (t === 'medicamento') piezas.push(h('div', { class: 'bloque-sol pregunta' },
      h('h3', {}, '¿Es medicamento pendiente de entrega o lo solicita por primera vez?'),
      respuesta('modalidad', [['pendiente_entrega', 'Pendiente de entrega (ya se le recetó y no se le ha entregado)'], ['primera_vez', 'Primera vez que lo solicita']], pintarDestino)),
      bloqueProducto('medicamento'));
    if (t === 'insumo') piezas.push(h('div', { class: 'bloque-sol pregunta' },
      h('h3', {}, 'Antes de continuar, pregunte:'),
      h('p', {}, '1. ¿Es la primera vez que se le entregará este insumo?'), respuesta('primera_entrega', [['si', 'Sí, primera vez'], ['no', 'No, ya se le había entregado']], pintarDestino),
      h('p', {}, '2. ¿Cuenta con evaluación médica?'), respuesta('tiene_evaluacion', [['si', 'Sí'], ['no', 'No']], pintarDestino)),
      bloqueProducto('insumo'));
    if (t === 'auditivo') piezas.push(h('div', { class: 'bloque-sol rejilla-2' }, campo('Oído', lado), campo('Diagnóstico', diag)));
    if (t === 'lentes') piezas.push(h('div', { class: 'bloque-sol' }, h('p', { class: 'nota' }, 'Se registra la solicitud de un par de lentes.'), campo('Diagnóstico', diag)));
    if (t === 'cirugia_oftalmica') piezas.push(h('div', { class: 'bloque-sol rejilla-2' }, campo('Diagnóstico presuntivo', diagOft), campo('Ojo', lado)));
    zonaTipo.replaceChildren(...piezas);
  };
  const enviar = async (forzar = false) => {
    const t = st.tipo;
    if (!t) throw new Error('Elija el tipo de solicitud');
    if (dui.value.length !== 9) throw new Error('El DUI debe tener 9 dígitos, sin guion');
    if (!sede.value && ['medicamento', 'insumo'].includes(t)) throw new Error('Elija la sede de entrega: es obligatoria en medicamentos e insumos');
    if (t === 'medicamento' && !st.modalidad) throw new Error('Indique si es pendiente de entrega o primera vez');
    if (t === 'insumo' && (!st.primera_entrega || !st.tiene_evaluacion)) throw new Error('Responda las dos preguntas del insumo');
    if (t === 'insumo' && !st.prod && !st.fuera) throw new Error('Elija el insumo del catálogo o marque "No está en el catálogo"');
    if (t === 'medicamento' && !st.fuera && !st.prod && !paCat.value.trim()) throw new Error('Elija el producto o el principio activo (o marque "No está en el catálogo")');
    if (['medicamento', 'insumo'].includes(t) && !just.value) throw new Error('Elija la justificación');
    const p = {
      tipo: t, dui: dui.value, nombre: nombre.value, telefono: t1.value, telefono2: t2.value, sector: sector.value, departamento: depto.value,
      sede_id: sede.value || null, origen: origen.value, origen_detalle: origenDet.value, prioridad: urgente.checked ? 'urgente' : 'normal',
      modalidad: st.modalidad || null,
      primera_entrega: t === 'insumo' ? st.primera_entrega === 'si' : undefined, tiene_evaluacion: t === 'insumo' ? st.tiene_evaluacion === 'si' : undefined,
      producto_id: st.prod?.id || null,
      producto_texto: st.fuera ? (t === 'medicamento' ? (nomManual.value.trim() || [pa.value, conc.value, forma.value].filter(x => x.trim()).join(' ')) : desc.value) : null,
      principio_activo: t !== 'medicamento' ? (st.prod?.principio_activo || null) : st.fuera ? pa.value : (paCat.value.trim() || st.prod?.principio_activo || null),
      concentracion: st.fuera ? conc.value : (t === 'medicamento' && !st.prod ? concCat.value : null), forma: st.fuera ? forma.value : null,
      cantidad: cantidad.value, unidad: unidad.value,
      justificacion: just.value === 'Otro' ? 'Otro: ' + justOtro.value : just.value,
      lado: lado.value || null, diagnostico: t === 'cirugia_oftalmica' ? diagOft.value : diag.value,
      comentario: comentario.value, forzar,
    };
    if (st.fuera && t === 'medicamento' && !pa.value.trim()) throw new Error('Escriba el principio activo (y el nombre comercial si lo sabe)');
    if (st.fuera && t === 'insumo' && !desc.value.trim()) throw new Error('Describa el insumo');
    try {
      const r = await rpc('crear_solicitud', { p });
      dispararCorreos();
      toast(`Solicitud ${r.numero} registrada · enviada a ${r.area}`);
      ir('bandeja');
      abrir(r.id);
    } catch (e) {
      const m = /DUPLICADA:(\S+)/.exec(e.message);
      if (!m) throw e;
      if (await confirmar('Ya tiene una solicitud abierta', `Este beneficiario ya tiene la solicitud ${m[1]} abierta por lo mismo. ¿Registrar otra de todos modos?`, 'Registrar de todos modos'))
        return enviar(true);
    }
  };
  const btn = h('button', { class: 'btn btn-primario btn-grande', onclick: async () => {
    btn.disabled = true; try { await enviar(); } catch (e) { error(e); } finally { btn.disabled = false; }
  } }, '✔ Registrar solicitud');

  const pintar = (reset = true) => {
    elegirTipo.querySelectorAll('.tipo-sol').forEach(b => b.classList.toggle('activo', b.dataset.tipo === st.tipo));
    if (reset) { st.modalidad = st.primera_entrega = st.tiene_evaluacion = null; }
    pintarTipo(); pintarDestino(); pintarProd();
  };
  caja.append(
    h('h2', {}, '1 · Tipo de solicitud'), elegirTipo,
    h('h2', {}, '2 · Beneficiario'),
    h('div', { class: 'rejilla-2' }, campo('DUI (9 dígitos, sin guion)', dui, 'Al completarlo se cargan los datos que ya tenemos'), infoDui),
    h('div', { class: 'rejilla-3' }, campo('Nombre completo', nombre), campo('Teléfono', t1), campo('Teléfono 2', t2)),
    h('div', { class: 'rejilla-3' }, campo('Sector', sector), campo('Departamento', depto), campo('Sede de entrega', sede, 'Obligatoria en medicamentos e insumos')),
    h('div', { class: 'rejilla-3' }, campo('Origen', origen), campo('Detalle del origen', origenDet),
      h('label', { class: 'casilla urgente' }, urgente, ' 🔴 Urgente (p. ej. paciente ingresado)')),
    h('h2', {}, '3 · Lo que solicita'), zonaTipo, campo('Comentario', comentario), destino,
    h('div', { class: 'botones' }, btn));
  pintar();
  setTimeout(() => dui.focus(), 50);
  return caja;
}

// ============================================================================ bandeja con filtros
async function bandeja() {
  const f = { tipo: '', estado: 'abiertas', sede: '', area: '', prioridad: '', mias: '', texto: '' };
  const raiz = h('div'); const zona = h('div');
  const filtros = h('section', { class: 'tarjeta' });
  let filas = [];
  const cargar = async () => {
    let qy = sb.from('v_solicitudes').select('*').order('creado_at', { ascending: false }).limit(1000);
    if (f.tipo) qy = qy.eq('tipo', f.tipo);
    if (f.estado === 'abiertas') qy = qy.is('cerrada_at', null);
    else if (f.estado === 'cerradas') qy = qy.not('cerrada_at', 'is', null);
    else if (f.estado) qy = qy.eq('estado', f.estado);
    if (f.sede) qy = qy.eq('sede_id', f.sede);
    if (f.area) qy = qy.eq('area', f.area);
    if (f.prioridad) qy = qy.eq('prioridad', f.prioridad);
    if (f.mias === 'creadas') qy = qy.eq('creado_por', estado.perfil.email);
    filas = await q(qy);
    pintar();
  };
  const pintar = () => {
    const t = f.texto.trim().toLowerCase();
    let fs = filas;
    if (f.mias === 'validar') fs = fs.filter(s => ['registrada', 'contactado', 'evaluado'].includes(s.estado) && !s.es_final && (soyResp(s.tipo, s.area) || esAdmin()));
    if (t) fs = fs.filter(s => [s.numero, s.beneficiario, s.dui, s.solicita, s.creado_nombre].some(x => String(x || '').toLowerCase().includes(t)));
    fs = [...fs].sort((a, b) => (b.prioridad === 'urgente') - (a.prioridad === 'urgente') || (a.es_final - b.es_final) || String(b.creado_at).localeCompare(a.creado_at));
    zona.replaceChildren(h('section', { class: 'tarjeta' },
      h('div', { class: 'botones' }, h('h2', {}, `Solicitudes (${fs.length})`), h('span', { class: 'espacio' }),
        h('button', { class: 'btn btn-sec btn-peq', onclick: () => exportarExcel('SIGAM_Solicitudes', [{ titulo: 'Solicitudes', cols: colsExcel, filas: fs }]) }, '⬇ Excel')),
      tabla([
        { t: '', f: s => semaforo(s), ancho: '18px' },
        { t: 'Número', f: s => h('div', {}, h('strong', {}, s.numero), s.prioridad === 'urgente' ? h('div', {}, chip('URGENTE', 'chip-urgente')) : null,
            s.captado_cc ? h('div', { class: 'nota' }, 'Captado por CC') : null), ord: s => s.numero },
        { t: 'Tipo', f: s => `${s.icono} ${s.tipo_nombre}`, ord: s => s.tipo },
        { t: 'Beneficiario', f: s => h('div', {}, s.beneficiario, h('div', { class: 'nota' }, dui4(s.dui))), ord: s => s.beneficiario },
        { t: 'Solicita', f: s => h('div', {}, s.solicita, s.cantidad ? h('div', { class: 'nota' }, `${num(s.cantidad)} ${s.unidad || ''}`) : null), ord: s => s.solicita },
        { t: 'Sede', f: s => s.sede || '—', ord: s => s.sede || '' },
        { t: 'Área', k: 'area' },
        { t: 'Estado', f: s => h('div', {}, chipEstado(s), s.posicion ? h('div', { class: 'nota' }, `Lista de espera: #${s.posicion}`) : null,
          s.dias_retiro != null ? h('div', { class: 'nota' }, textoPlazo(s)) : null), ord: s => s.estado_texto },
        { t: 'Días', f: s => ent(s.dias), num: true, ord: s => s.dias },
      ], fs, { alClic: s => abrir(s.id, cargar, f.mias === 'validar' ? [...fs.slice(fs.indexOf(s)), ...fs.slice(0, fs.indexOf(s))].map(x => x.id) : []), vacio: 'No hay solicitudes con estos filtros' })));
  };
  const sel = (k, opciones, recarga = true) => { const s = select(opciones, f[k]); s.onchange = () => { f[k] = s.value; recarga ? cargar() : pintar(); }; return s; };
  const estados = [...new Map(TIPOS.flatMap(t => t.estados).map(e => [e.k, e.t])).entries()];
  const buscar = h('input', { class: 'campo', type: 'search', placeholder: 'Buscar número, nombre, DUI o producto' });
  buscar.addEventListener('input', debounce(() => { f.texto = buscar.value; pintar(); }, 200));
  filtros.append(
    h('div', { class: 'chips-filtro' }, [['', 'Todos'], ...TIPOS.map(t => [t.clave, `${t.icono} ${t.nombre}`])].map(([k, t]) =>
      h('button', { class: 'chip-filtro' + (f.tipo === k ? ' activo' : ''), onclick: e => {
        f.tipo = k; filtros.querySelectorAll('.chip-filtro').forEach(b => b.classList.remove('activo')); e.target.classList.add('activo'); cargar();
      } }, t))),
    h('div', { class: 'filtros' },
      campo('Ver', sel('mias', [['', 'Todas las que puedo ver'], ['validar', 'Me toca validar'], ['creadas', 'Registradas por mí']])),
      campo('Estado', sel('estado', [['abiertas', 'Abiertas'], ['cerradas', 'Cerradas'], ['', 'Todas'], ...estados])),
      campo('Sede', sel('sede', [['', 'Todas'], ...estado.sedes.map(s => [s.id, s.nombre])])),
      campo('Área', sel('area', [['', 'DSEC y DSIN'], ['DSEC', 'DSEC'], ['DSIN', 'DSIN']])),
      campo('Prioridad', sel('prioridad', [['', 'Todas'], ['urgente', 'Urgentes'], ['normal', 'Normales']])),
      campo('Buscar', buscar)),
    h('p', { class: 'nota' }, '🟢 a tiempo · 🟡 vence hoy · 🔴 atrasada (días para validar según el tipo). Las urgentes salen primero.'));
  raiz.append(filtros, zona);
  await cargar();
  return raiz;
}

function semaforo(s) {
  if (s.es_final) return h('span', { class: 'semaforo gris', title: 'Cerrada' });
  if (s.estado === 'retiro_vencido') return h('span', { class: 'semaforo rojo', title: 'No retiró: pasar a Despacho' });
  if (s.dias_retiro != null) return h('span', { class: 'semaforo ' + (s.dias_retiro <= 0 ? 'rojo' : s.dias_retiro <= 2 ? 'amarillo' : 'verde'), title: textoPlazo(s) });
  const limite = ['registrada', 'contactado'].includes(s.estado) ? s.dias_validar : 15;
  const d = ['registrada', 'contactado'].includes(s.estado) ? s.dias : s.dias_estado;
  const c = d > limite ? 'rojo' : d === limite ? 'amarillo' : 'verde';
  return h('span', { class: 'semaforo ' + c, title: `${d} día(s) en este paso · límite ${limite}` });
}
const colsExcel = [{ t: 'Número', k: 'numero' }, { t: 'Tipo', k: 'tipo_nombre' }, { t: 'Prioridad', k: 'prioridad' }, { t: 'Beneficiario', k: 'beneficiario' },
  { t: 'DUI', k: 'dui' }, { t: 'Teléfono', k: 'telefono' }, { t: 'Sede', k: 'sede' }, { t: 'Solicita', k: 'solicita' }, { t: 'Cantidad', k: 'cantidad' },
  { t: 'Área', k: 'area' }, { t: 'Estado', k: 'estado_texto' }, { t: 'Creada', exportar: s => fecha(s.creado_at) }, { t: 'Registrada por', k: 'creado_nombre' },
  { t: 'Validada por', k: 'validado_nombre' }, { t: 'Días', k: 'dias' }];

// ============================================================================ detalle
export async function abrir(id, alCambiar, cola = []) {
  const [s] = await q(sb.from('v_solicitudes').select('*').eq('id', id));
  if (!s) return toast('No tiene acceso a esa solicitud o no existe', 'error');
  const eventos = await q(sb.from('v_solicitud_eventos').select('*').eq('solicitud_id', id).order('at'));
  const esperaDsec = s.area === 'DSEC' && !s.validado_at;   // aún no la valida el médico de DSEC
  const dispo = ['medicamento', 'insumo'].includes(s.tipo) && s.producto_id && !s.es_final ? await rpc('disponibilidad_solicitud', { p_id: id }).catch(() => []) : null;
  const gestiona = esAdmin() || (esperaDsec ? soyResp(s.tipo, 'DSEC') : soyResp(s.tipo) || meToca(s));
  const valida = !s.es_final && ['registrada', 'contactado', 'evaluado'].includes(s.estado) && (esAdmin() || soyResp(s.tipo, s.area));
  let m;
  const hecho = async (msg, siguiente = false) => {
    dispararCorreos(); toast(msg); m.cerrar(); alCambiar && alCambiar();
    const resto = cola.filter(x => x !== id);
    if (siguiente && resto.length) abrir(resto[0], alCambiar, resto);   // quien valida va solicitud por solicitud
  };
  const fila = (t, v) => v || v === 0 ? h('tr', {}, h('th', {}, t), h('td', {}, v)) : null;
  const t = tipoDe(s.tipo);
  const historial = h('ol', { class: 'historial' }, eventos.map(e => h('li', {},
    h('div', { class: 'hist-cab' }, h('strong', {}, ({ creada: 'Registrada', validacion: 'Validación', estado: 'Cambio de estado', comentario: 'Comentario',
      llamada: '📞 Llamada', llegada: '📦 Llegó el producto', entrega: '✔ Entrega', area: 'Cambio de área', asignacion: 'Asignación' })[e.tipo] || e.tipo),
      e.estado_nuevo ? h('span', {}, ' → ', h('em', {}, (t.estados || []).find(x => x.k === e.estado_nuevo)?.t || e.estado_nuevo)) : null,
      e.datos?.resultado ? h('span', {}, ' · ', RESULTADOS.find(r => r[0] === e.datos.resultado)?.[1] || e.datos.resultado) : null),
    h('div', { class: 'nota' }, `${fechaHora(e.at)} · ${e.por_nombre || e.por || ''}`),
    e.nota ? h('div', {}, e.nota) : null)));

  const acciones = [];
  if (valida) {
    const medIns = ['medicamento', 'insumo'].includes(s.tipo);
    const txtOk = s.area === 'DSEC' ? '✔ Aprobar (finaliza)' : medIns ? '✔ Validar · Ya gestionado' : '✔ Validar';
    const sig = cola.filter(x => x !== id).length;
    acciones.push({ texto: '✖ No aplica', clase: 'btn-peligro', accion: async () => {
      const motivo = await pedirTexto('No aplica', 'Motivo (le llegará por correo a quien la registró)'); if (!motivo) return false;
      await rpc('validar_solicitud', { p_id: id, p_aprobar: false, p_nota: motivo }); hecho('Solicitud marcada como no aplica', true);
    } });
    if (s.tipo === 'medicamento' && s.area === 'DSIN') acciones.push({ texto: '📧 Ir a CEFAFA', clase: 'btn-primario', accion: async () => {
      m.cerrar(); location.hash = '#solicitudes?ver=cefafa'; return false;
    } });
    else acciones.push({ texto: txtOk + (sig ? ' y siguiente' : ''), clase: 'btn-primario', accion: async () => {
      const nota = await pedirTexto('Validar solicitud', s.area === 'DSEC' ? 'Comentario (con la aprobación de DSEC finaliza la gestión)' : 'Comentario (opcional)', { minimo: 0 });
      if (nota === null) return false;
      await rpc('validar_solicitud', { p_id: id, p_aprobar: true, p_nota: nota }); hecho('Solicitud validada · se avisó por correo', true);
    } });
  }
  const cuerpo = h('div', { class: 'detalle-sol' },
    h('div', { class: 'sol-cab' }, h('span', { class: 'tipo-icono' }, s.icono), h('div', {},
      h('div', { class: 'sol-num' }, s.numero, ' ', s.prioridad === 'urgente' ? chip('URGENTE', 'chip-urgente') : null),
      h('div', {}, chipEstado(s), ' · ', AREA_TXT[s.area], s.posicion ? ` · Lista de espera #${s.posicion}` : ''))),
    h('div', { class: 'rejilla-2' },
      h('table', { class: 'tabla-ficha' }, h('tbody', {},
        fila('Beneficiario', s.beneficiario), fila('DUI', s.dui),
        fila('Teléfonos', h('span', {}, tel(s.telefono), ' ', tel(s.telefono2))),
        fila('Sector', s.sector), fila('Departamento', s.departamento), fila('Sede de entrega', s.sede),
        fila('Origen', [ORIGENES.find(o => o[0] === s.origen)?.[1], s.origen_detalle].filter(Boolean).join(' · ')))),
      h('table', { class: 'tabla-ficha' }, h('tbody', {},
        fila('Solicita', s.solicita), fila('Cantidad', s.cantidad ? `${num(s.cantidad)} ${s.unidad || ''}` : null),
        fila('Modalidad', s.modalidad === 'primera_vez' ? 'Primera vez' : s.modalidad === 'pendiente_entrega' ? 'Pendiente de entrega' : null),
        fila('Primera entrega', s.primera_entrega === null ? null : s.primera_entrega ? 'Sí' : 'No'),
        fila('Evaluación médica', s.tiene_evaluacion === null ? null : s.tiene_evaluacion ? 'Sí' : 'No'),
        fila('Ojo / oído', s.lado), fila('Diagnóstico', s.diagnostico), fila('Justificación', s.justificacion),
        fila('Registrada', `${fechaHora(s.creado_at)} · ${s.creado_nombre || s.creado_por}`),
        fila('Captado por', s.captado),
        fila('Validada', s.validado_at ? `${fechaHora(s.validado_at)} · ${s.validado_nombre}` : null),
        fila('Seguimiento', s.asignado_nombre),
        fila('Puede retirar hasta', s.retiro_limite ? fecha(s.retiro_limite) : null)))),
    dispo ? cajaDisponibilidad(s, dispo, () => { m.cerrar(); alCambiar && alCambiar(); }) : null,
    s.estado === 'lista' ? h('div', { class: 'aviso aviso-ok' }, `📦 El producto llegó (${s.bodega_reserva || s.sede}) el ${fechaHora(s.producto_disponible_at)}. Llame al beneficiario: desde la llamada tiene 7 días hábiles para retirar.`) : null,
    ['avisado', 'retiro_vencido'].includes(s.estado) ? h('div', { class: 'aviso ' + (s.estado === 'avisado' ? 'aviso-info' : 'aviso-error') },
      s.estado === 'avisado' ? `📞 Llamado el ${fechaHora(s.avisado_at)}: ${textoPlazo(s)}.` : `⏳ No retiró en 7 días hábiles (límite ${fecha(s.retiro_limite)}).`,
      s.bodega_reserva ? ` Está en: ${s.bodega_reserva}.` : '', ' ',
      botonPase(s, () => { m.cerrar(); alCambiar && alCambiar(); })) : null,
    s.estado === 'por_pasar' ? h('div', { class: 'aviso aviso-warn' }, '🏥 Llegó a retirar: esperando que administración lo pase a Despacho y lo registre en SIVET. ',
      esAdmin() ? botonPase(s, () => { m.cerrar(); alCambiar && alCambiar(); }) : null) : null,
    s.estado === 'en_despacho' ? h('div', { class: 'aviso aviso-ok' }, `✔ En Despacho${s.traslado_numero ? ' (traslado ' + s.traslado_numero + ', registrar en SIVET)' : ''}: despáchele con su DUI y la solicitud se cierra sola.`) : null,
    gestiona && !s.es_final ? gestion(s, hecho) : null,
    h('h3', {}, 'Historial'), historial,
    h('div', { class: 'fila-comentario' }, (() => {
      const c = h('input', { class: 'campo', placeholder: 'Agregar comentario al historial' });
      return [c, h('button', { class: 'btn btn-sec', onclick: async () => {
        try { await rpc('comentar_solicitud', { p_id: id, p_nota: c.value }); hecho('Comentario agregado'); } catch (e) { error(e); }
      } }, 'Comentar')];
    })()));
  m = modal(`${s.icono} ${s.tipo_nombre} · ${s.beneficiario}`, cuerpo, { acciones, ancho: '920px' });
}

// panel de gestión para responsables: estado, llamada, asignación y producto del catálogo
function gestion(s, hecho) {
  const t = tipoDe(s.tipo);
  const est = select(t.estados.filter(e => !e.oculto || e.k === s.estado).map(e => [e.k, e.t]), s.estado);
  const nota = h('input', { class: 'campo', placeholder: 'Comentario' });
  const responsables = [...new Set(RESP.filter(r => r.tipo === s.tipo && ['DSIN', 'SEGUIMIENTO', 'DSEC'].includes(r.area)).map(r => r.email))];
  const asig = select([['', 'Sin asignar'], ...responsables.map(e => [e, e])], s.asignado_a || '');
  const proximo = h('input', { class: 'campo', type: 'date' });
  const notaLl = h('input', { class: 'campo', placeholder: 'Nota de la llamada' });
  const piezas = [
    h('h3', {}, 'Gestión'),
    h('div', { class: 'filtros' },
      campo('Cambiar estado', est), campo('Comentario', nota),
      h('div', { class: 'fila-campo' }, h('span', {}, ' '), h('button', { class: 'btn btn-sec', onclick: async () => {
        try { await rpc('cambiar_estado_solicitud', { p_id: s.id, p_estado: est.value, p_nota: nota.value }); hecho('Estado actualizado'); } catch (e) { error(e); }
      } }, 'Guardar estado'))),
    h('div', { class: 'llamada' }, h('strong', {}, '📞 Registrar llamada '), s.intentos ? h('span', { class: 'nota' }, `(${s.intentos} intento(s); último: ${RESULTADOS.find(r => r[0] === s.ultimo_resultado)?.[1] || '—'})`) : null,
      h('div', { class: 'filtros' }, campo('Nota', notaLl), campo('Volver a llamar', proximo)),
      h('div', { class: 'botones botones-llamada' }, RESULTADOS.map(([k, txt, cls]) => h('button', { class: 'btn btn-peq ' + cls, onclick: async () => {
        try { await rpc('registrar_llamada', { p_id: s.id, p_resultado: k, p_nota: notaLl.value, p_proximo: proximo.value || null }); hecho('Llamada registrada'); } catch (e) { error(e); }
      } }, txt)))),
    h('div', { class: 'filtros' }, campo('Seguimiento a cargo de', asig),
      h('div', { class: 'fila-campo' }, h('span', {}, ' '), h('button', { class: 'btn btn-sec', onclick: async () => {
        try { await rpc('asignar_solicitud', { p_id: s.id, p_email: asig.value }); hecho('Asignación guardada'); } catch (e) { error(e); }
      } }, 'Asignar'))),
  ];
  if (['medicamento', 'insumo'].includes(s.tipo) && !['lista', 'avisado', 'por_pasar', 'en_despacho', 'retiro_vencido'].includes(s.estado)) {
    // DSIN valida el producto que entregará (lo que ofrece CEFAFA; puede ser un alterno con el mismo principio activo)
    const zonaAlt = h('div', { class: 'botones', style: { flexWrap: 'wrap', gap: '6px' } });
    const vincular = async p => { try { await rpc('vincular_producto_solicitud', { p_id: s.id, p_producto: p.id }); hecho('Producto definido: ' + p.nombre_comercial); } catch (e) { error(e); } };
    if (s.principio_activo) productos().then(cat => {
      const pa = s.principio_activo.toUpperCase();
      const alts = cat.filter(x => x.tipo === s.tipo && x.activo !== false && (x.principio_activo || '').toUpperCase() === pa && x.id !== s.producto_id).slice(0, 8);
      zonaAlt.replaceChildren(...(alts.length ? [h('span', { class: 'nota' }, 'Mismo principio activo:'), ...alts.map(x => h('button', { class: 'btn btn-sec btn-peq', onclick: () => vincular(x) }, x.nombre_comercial))]
        : [h('span', { class: 'nota' }, 'No hay otros productos con ese principio activo en el catálogo.')]));
    }).catch(() => {});
    if (!s.producto_id && s.producto_texto) {   // fuera de catálogo: quien valida lo agrega (sin código de barras)
      const nc = h('input', { class: 'campo', value: s.producto_texto || '', placeholder: 'Nombre comercial' });
      const npa = h('input', { class: 'campo', value: s.principio_activo || '', placeholder: 'Principio activo' });
      const nco = h('input', { class: 'campo', value: s.concentracion || '', placeholder: 'Concentración' });
      const npr = h('input', { class: 'campo', value: s.forma || '', placeholder: 'Presentación (p. ej. caja x 30 tabletas)' });
      piezas.push(h('div', { class: 'bloque-sol' }, h('h3', {}, '➕ Agregar al catálogo'),
        h('p', { class: 'nota' }, 'Fuera de catálogo: complete los datos con lo que ofrecerá el proveedor. Se agrega sin código de barras y queda vinculado a esta solicitud.'),
        h('div', { class: 'rejilla-2' }, nc, s.tipo === 'medicamento' ? npa : null), h('div', { class: 'rejilla-2' }, s.tipo === 'medicamento' ? nco : null, npr),
        h('div', { class: 'botones' }, h('button', { class: 'btn btn-primario btn-peq', onclick: async () => {
          try {
            await rpc('agregar_producto_solicitud', { p_id: s.id, p: { nombre_comercial: nc.value, principio_activo: npa.value, concentracion: nco.value, presentacion: npr.value } });
            await productos(true); hecho('Agregado al catálogo y vinculado');
          } catch (e) { error(e); }
        } }, 'Agregar al catálogo y vincular'))));
    }
    piezas.push(h('div', { class: s.producto_id ? 'bloque-sol' : 'aviso aviso-warn' },
      h('strong', {}, s.producto_id ? '💊 Producto que se entregará: ' + s.solicita : '⚠ Falta definir el producto del catálogo.'), ' ',
      h('span', { class: 'nota' }, s.producto_id ? 'Si CEFAFA ofrece otro con el mismo principio activo, cámbielo aquí.' : 'Elija lo que ofrece CEFAFA para que SIGAM avise cuando llegue.'),
      zonaAlt,
      buscadorProducto({ autofocus: false, filtro: p => p.tipo === s.tipo, placeholder: 'Buscar el producto en el catálogo', alElegir: vincular })));
  }
  return h('div', { class: 'gestion-sol' }, ...piezas);
}

// ============================================================================ consulta por DUI (Contact Center)
async function consultaDui() {
  const inp = h('input', { class: 'campo dui-grande', inputmode: 'numeric', maxlength: 9, placeholder: '000000000' });
  const res = h('div');
  inp.addEventListener('input', async () => {
    inp.value = inp.value.replace(/\D/g, '').slice(0, 9);
    if (inp.value.length !== 9) return res.replaceChildren();
    try {
      const r = await rpc('consultar_solicitudes_dui', { p_dui: inp.value });
      if (!r.solicitudes.length) return res.replaceChildren(h('p', { class: 'nota' }, r.beneficiario ? `${r.beneficiario} no tiene solicitudes registradas.` : 'No hay solicitudes con ese DUI.'));
      res.replaceChildren(h('h2', {}, r.beneficiario || ''), h('div', { class: 'lista-consulta' }, r.solicitudes.map(x =>
        h('div', { class: 'consulta-sol' + (x.final ? ' cerrada' : '') },
          h('div', { class: 'tipo-icono' }, x.icono),
          h('div', {}, h('strong', {}, `${x.tipo}: ${x.solicita}`),
            h('div', {}, h('span', { class: 'estado c-' + colorEstado(TIPOS.find(t => t.nombre === x.tipo)?.clave, x.estado_k) }, x.estado), ` · ${x.sede || 'sin sede'} · ${x.numero}`),
            h('div', { class: 'nota' }, `Registrada el ${fecha(x.creado_at)} (hace ${x.dias} días)` + (x.posicion ? ` · Lista de espera: posición ${x.posicion}` : '')),
            x.ultimo ? h('div', { class: 'nota' }, 'Último comentario: ' + x.ultimo) : null,
            ['lista', 'avisado'].includes(x.estado_k) ? h('div', { class: 'plazo amarillo' }, '📦 Ya está reservado en la sede. Si el beneficiario está aquí, avise a un administrador para trasladarlo a Despacho (SIVET): pulse "Ver".') : null,
            x.estado_k === 'por_pasar' ? h('div', { class: 'plazo amarillo' }, '🏥 Administración ya fue avisada para pasarlo a Despacho.') : null,
            x.estado_k === 'en_despacho' ? h('div', { class: 'plazo' }, '✔ Ya está en Despacho: se le puede despachar con su DUI.') : null),
          h('button', { class: 'btn-enlace', onclick: () => abrir(x.id) }, 'Ver')))));
    } catch (e) { error(e); }
  });
  setTimeout(() => inp.focus(), 50);
  return h('section', { class: 'tarjeta' }, h('h2', {}, 'Consultar el estado por DUI'),
    h('p', { class: 'nota' }, 'Para responder cuando un beneficiario llama: muestra todas sus solicitudes, su estado y desde cuándo. Cada consulta queda registrada.'),
    campo('DUI (9 dígitos)', inp), res);
}

// ============================================================================ seguimiento telefónico (DSIN)
export async function seguimiento() {
  await cargarContexto();
  const hoy = new Date().toISOString().slice(0, 10);
  const raiz = h('div');
  const cargar = async () => {
    let [filas, sivet] = await Promise.all([
      q(sb.from('v_solicitudes').select('*').is('cerrada_at', null)
        .in('estado', ['lista', 'avisado', 'por_pasar', 'en_despacho', 'retiro_vencido', 'en_gestion', 'sin_disponibilidad', 'registrada', 'contactado', 'evaluado', 'programada']).limit(1000)),
      esAdmin() ? rpc('traslados_pendientes_sivet') : [],
    ]);
    const reservar = esAdmin() ? await rpc('por_reservar') : [];
    if (!esAdmin()) filas = filas.filter(s => s.asignado_a === estado.perfil.email || (!s.asignado_a && meToca(s)));
    const orden = (a, b) => (b.prioridad === 'urgente') - (a.prioridad === 'urgente') || String(a.creado_at).localeCompare(b.creado_at);
    const grupo = (titulo, ayuda, fs, extra) => fs.length ? h('section', { class: 'tarjeta' }, h('div', { class: 'botones' }, h('h2', {}, `${titulo} (${fs.length})`), h('span', { class: 'espacio' }), extra || null),
      h('p', { class: 'nota' }, ayuda), h('div', { class: 'tarjetas-llamada' }, fs.map(tarjetaLlamada))) : null;
    const LLAMADAS = ['lista', 'avisado', 'por_pasar', 'en_despacho', 'retiro_vencido'];
    const porPasar = filas.filter(s => ['por_pasar', 'retiro_vencido'].includes(s.estado)).sort((a, b) => (a.estado === 'retiro_vencido') - (b.estado === 'retiro_vencido') || orden(a, b));
    const yaLlego = filas.filter(s => s.estado === 'lista').sort(orden);
    const avisados = filas.filter(s => s.estado === 'avisado').sort((a, b) => (a.dias_retiro ?? 99) - (b.dias_retiro ?? 99));
    const enDespacho = filas.filter(s => s.estado === 'en_despacho').sort(orden);
    const hoyToca = filas.filter(s => !LLAMADAS.includes(s.estado) && s.proximo_contacto && s.proximo_contacto <= hoy).sort(orden);
    const sinContacto = filas.filter(s => !LLAMADAS.includes(s.estado) && !s.proximo_contacto && !s.ultimo_contacto_at && ['en_gestion', 'sin_disponibilidad', 'registrada'].includes(s.estado)).sort(orden);
    const pasables = porPasar.filter(enReserva);
    raiz.replaceChildren(
      h('section', { class: 'tarjeta' }, h('div', { class: 'rejilla' },
        kpi('📦 Ya llegó: llamar', yaLlego.length), kpi('⏳ Esperando retiro', avisados.length),
        kpi('🏥 Por pasar a Despacho', porPasar.length), esAdmin() ? kpi('🔁 Por registrar en SIVET', sivet.length) : kpi('📅 Llamar hoy', hoyToca.length))),
      grupo('🏥 Por pasar a Despacho', esAdmin()
          ? 'Llegaron a retirar o no retiraron en 7 días hábiles. Al pasarlos se crea el traslado de Reservas a Despacho y le llega un correo para registrarlo en SIVET.'
          : 'Administración los pasará a Despacho y los registrará en SIVET; después podrá despacharles con su DUI.', porPasar,
        esAdmin() && pasables.length > 1 ? h('button', { class: 'btn btn-primario btn-peq', onclick: () => pasarADespacho(pasables, false, cargar) }, `Pasar las ${pasables.length} a Despacho`) : null),
      esAdmin() && sivet.length ? tarjetaSivet(sivet, cargar) : null,
      reservar.length ? h('section', { class: 'tarjeta' },
        h('div', { class: 'botones' }, h('h2', {}, `📥 Por reservar: está en Bodega Central y hay personas esperando (${reservar.length})`), h('span', { class: 'espacio' }),
          h('a', { class: 'btn btn-sec btn-peq', href: '#traslados' }, '🚚 Ir a Traslados')),
        h('p', { class: 'nota' }, 'Trasládelo a la bodega "Reservas de solicitudes" de cada sede. Al recibirlo, la solicitud queda lista y quien hace seguimiento les llama.'),
        tabla([{ t: 'Producto', f: r => h('div', {}, h('strong', {}, r.producto), h('div', { class: 'nota' }, r.codigo || '')) }, { t: 'Sede', k: 'sede' },
          { t: 'Personas', k: 'personas', num: true }, { t: 'Cantidad pedida', f: r => num(r.cantidad), num: true },
          { t: 'En Bodega Central', f: r => num(r.en_central), num: true }, { t: 'Solicitudes', f: r => h('span', { class: 'nota' }, r.numeros) }], reservar)) : null,
      grupo('📦 El producto ya llegó: llame al beneficiario', 'Al registrar "Avisado" o "Contestó" empiezan a contar 7 días hábiles para retirar. Primero las urgentes y las más antiguas.', yaLlego),
      grupo('⏳ Llamados: esperando que retiren', 'Cuando llegue a retirar, pulse "Llegó a retirar" para que administración lo pase a Despacho.', avisados),
      grupo('✔ En Despacho: despachar con su DUI', 'Al despacharle con su DUI la solicitud se cierra sola.', enDespacho),
      grupo('📅 Toca llamar hoy', 'Llamadas programadas para hoy o atrasadas (incluye "no contestó").', hoyToca),
      grupo('🆕 Aún no se les ha llamado', 'Solicitudes en gestión sin ningún contacto registrado.', sinContacto),
      !filas.length && !sivet.length ? h('section', { class: 'tarjeta' }, h('p', { class: 'nota' }, 'No hay llamadas pendientes. 🎉')) : null);
  };
  const tarjetaLlamada = s => {
    const nota = h('input', { class: 'campo', placeholder: 'Nota' });
    const prox = h('input', { class: 'campo', type: 'date', title: 'Volver a llamar el…' });
    const llamar = !['por_pasar', 'en_despacho', 'retiro_vencido'].includes(s.estado);
    return h('div', { class: 'tarjeta-llamada' + (s.prioridad === 'urgente' ? ' urgente' : '') + (s.estado === 'retiro_vencido' ? ' vencida' : '') },
      h('div', { class: 'tl-cab' }, h('strong', {}, s.beneficiario), s.prioridad === 'urgente' ? chip('URGENTE', 'chip-urgente') : null),
      h('div', { class: 'tl-tels' }, tel(s.telefono), tel(s.telefono2)),
      h('div', {}, `${s.icono} ${s.solicita}`, s.cantidad ? ` · ${num(s.cantidad)} ${s.unidad || ''}` : ''),
      h('div', { class: 'nota' }, `${s.sede} · ${s.numero}` + (s.bodega_reserva ? ` · en ${s.bodega_reserva}` : '') + (s.intentos ? ` · ${s.intentos} llamada(s)` : '') +
        (s.ultimo_resultado ? ` · último: ${RESULTADOS.find(r => r[0] === s.ultimo_resultado)?.[1] || ''}` : '')),
      s.dias_retiro != null ? h('div', { class: 'plazo ' + (s.dias_retiro <= 0 ? 'rojo' : s.dias_retiro <= 2 ? 'amarillo' : '') }, '⏳ ' + textoPlazo(s)) : null,
      s.estado === 'retiro_vencido' ? h('div', { class: 'plazo rojo' }, `🚫 No retiró · venció el ${fecha(s.retiro_limite)}`) : null,
      s.estado === 'por_pasar' ? h('div', { class: 'plazo amarillo' }, '🏥 Llegó a retirar: por pasar a Despacho') : null,
      llamar ? h('div', { class: 'tl-form' }, nota, prox) : null,
      llamar ? h('div', { class: 'botones botones-llamada' }, RESULTADOS.map(([k, txt, cls]) => h('button', { class: 'btn btn-peq ' + cls, onclick: async e => {
        e.target.disabled = true;
        try { await rpc('registrar_llamada', { p_id: s.id, p_resultado: k, p_nota: nota.value, p_proximo: prox.value || null }); toast('Llamada registrada'); cargar(); }
        catch (err) { error(err); e.target.disabled = false; }
      } }, txt))) : null,
      ['avisado', 'por_pasar', 'retiro_vencido'].includes(s.estado) ? botonPase(s, cargar) : null,
      h('button', { class: 'btn-enlace', onclick: () => abrir(s.id, cargar) }, 'Ver detalle e historial'));
  };
  await cargar();
  return raiz;
}

// administración: traslados a Despacho que faltan registrar en SIVET
function tarjetaSivet(lista, alCambiar) {
  return h('section', { class: 'tarjeta tarjeta-sivet' },
    h('div', { class: 'botones' }, h('h2', {}, `🔁 Pendiente de registrar en SIVET (${lista.length})`), h('span', { class: 'espacio' }),
      h('button', { class: 'btn btn-sec btn-peq', onclick: () => exportarExcel('SIGAM_traslados_para_SIVET', [{ titulo: 'Para SIVET',
        cols: [{ t: 'Traslado', k: 'numero' }, { t: 'Sede', k: 'sede' }, { t: 'De', k: 'origen' }, { t: 'A', k: 'destino' }, { t: 'Código', k: 'codigo' },
               { t: 'Producto', k: 'producto' }, { t: 'Lote', k: 'lote' }, { t: 'Cantidad', k: 'cantidad' }],
        filas: lista.flatMap(t => (t.lineas || []).map(l => ({ ...t, ...l }))) }]) }, '⬇ Excel')),
    h('p', { class: 'nota' }, 'Entraron a Despacho o Almacén de insumos desde una bodega que no está en SIVET. Regístrelos en SIVET y márquelos aquí.'),
    tabla([
      { t: 'Traslado', f: t => h('div', {}, h('strong', {}, t.numero), h('div', { class: 'nota' }, fechaHora(t.recibido_at))) },
      { t: 'Sede', k: 'sede' }, { t: 'De → A', f: t => `${t.origen} → ${t.destino}` },
      { t: 'Productos', f: t => h('div', {}, (t.lineas || []).map(l => h('div', {}, `${l.codigo || ''} ${l.producto} × ${num(l.cantidad)}` + (l.lote ? ` (lote ${l.lote})` : '')))) },
      { t: '', f: t => h('button', { class: 'btn btn-sec btn-peq', onclick: async e => {
        e.stopPropagation();
        try { await rpc('marcar_registrado_sivet', { p_traslado: t.id }); toast(`${t.numero} marcado como registrado en SIVET`); alCambiar(); } catch (err) { error(err); }
      } }, '✔ Ya lo registré en SIVET') },
    ], lista));
}
const kpi = (t, v) => h('div', { class: 'kpi' }, h('div', { class: 'kpi-titulo' }, t), h('div', { class: 'kpi-valor' }, ent(v)));

// ============================================================================ estados (administración)
const COLORES = [['rojo', 'Rojo'], ['amarillo', 'Amarillo'], ['azul', 'Azul'], ['morado', 'Morado'], ['verde', 'Verde'],
  ['naranja', 'Naranja'], ['rosa', 'Rosa'], ['celeste', 'Celeste'], ['cafe', 'Café'], ['gris', 'Gris']];
async function editarEstados() {
  const raiz = h('div');
  const tarjeta = tipo => {
    let lista = tipoDe(tipo.clave).estados.map(e => ({ ...e }));
    const caja = h('section', { class: 'tarjeta' });
    const pintar = () => {
      const filas = lista.map((e, i) => {
        const chipV = h('span', { class: `estado c-${e.c}` }, e.t || '…');
        const col = select(COLORES, e.c); col.onchange = () => { e.c = col.value; chipV.className = `estado c-${e.c}`; };
        const nom = h('input', { class: 'campo', value: e.t, maxlength: 60, oninput: ev => { e.t = ev.target.value; chipV.textContent = e.t || '…'; } });
        const fin = h('input', { type: 'checkbox', checked: !!e.final, disabled: !!e.s, title: e.s ? 'Estado de SIGAM: no se puede cambiar' : '', onchange: ev => { e.final = ev.target.checked; } });
        const ocu = h('input', { type: 'checkbox', checked: !!e.oculto, onchange: ev => { e.oculto = ev.target.checked; } });
        const mover = d => { const j = i + d; if (j < 0 || j >= lista.length) return; [lista[i], lista[j]] = [lista[j], lista[i]]; pintar(); };
        return h('tr', {},
          h('td', {}, h('button', { class: 'btn-x', title: 'Subir', onclick: () => mover(-1) }, '▲'), h('button', { class: 'btn-x', title: 'Bajar', onclick: () => mover(1) }, '▼')),
          h('td', {}, nom), h('td', {}, col), h('td', {}, chipV),
          h('td', { class: 'centro' }, fin), h('td', { class: 'centro' }, ocu),
          h('td', {}, e.s ? h('span', { class: 'nota', title: 'Lo usa SIGAM en el flujo; puede cambiar nombre y color' }, '🔒 SIGAM')
            : h('button', { class: 'btn-x', title: 'Eliminar', onclick: () => { lista.splice(i, 1); pintar(); } }, '🗑')));
      });
      caja.replaceChildren(
        h('div', { class: 'botones' }, h('h2', {}, `${tipo.icono} ${tipo.nombre}`), h('span', { class: 'espacio' }),
          h('button', { class: 'btn btn-sec btn-peq', onclick: () => { lista.push({ t: 'Nuevo estado', c: 'gris', final: false }); pintar(); } }, '➕ Agregar estado'),
          h('button', { class: 'btn btn-primario btn-peq', onclick: async () => {
            try {
              await rpc('guardar_estados_tipo', { p_tipo: tipo.clave, p_estados: lista.map(({ k, t, c, final, oculto }) => ({ k, t: t.trim(), c, final, oculto })) });
              await cargarContexto(); lista = tipoDe(tipo.clave).estados.map(e => ({ ...e })); pintar(); toast('Estados guardados');
            } catch (err) { error(err); }
          } }, 'Guardar')),
        h('table', { class: 'tabla tabla-estados' },
          h('thead', {}, h('tr', {}, ...['Orden', 'Nombre', 'Color', 'Vista', 'Cierra el caso', 'Ocultar de la lista', ''].map(x => h('th', {}, x)))),
          h('tbody', {}, filas)));
    };
    pintar();
    return caja;
  };
  const zonaT = h('div');
  const selTipo = h('div', { class: 'tarjeta tarjeta-pestanas pestanas' });
  const pintarTipo = clave => {
    selTipo.replaceChildren(...TIPOS.map(x => h('button', { class: x.clave === clave ? 'activo' : '', onclick: () => pintarTipo(x.clave) }, `${x.icono} ${x.nombre}`)));
    zonaT.replaceChildren(tarjeta(TIPOS.find(x => x.clave === clave)));
  };
  raiz.replaceChildren(
    h('section', { class: 'tarjeta' }, h('h2', {}, 'Estados de las solicitudes'),
      h('p', { class: 'nota' }, 'Cambie el nombre, el color y el orden; agregue estados propios. Los marcados 🔒 los usa SIGAM en el flujo (CEFAFA, reservas, despacho): se puede cambiar su nombre y color, pero no eliminarlos ni cambiar si cierran el caso. "Cierra el caso" deja la solicitud finalizada (gris recomendado) y avisa a quien la registró. "Ocultar" lo quita de la lista "Cambiar estado" sin borrarlo. Un estado propio solo se puede eliminar si ninguna solicitud lo tiene.')),
    selTipo, zonaT);
  pintarTipo(TIPOS[0].clave);
  return raiz;
}

// ============================================================================ responsables (administración)
async function responsables() {
  const perfiles = await q(sb.from('perfiles').select('email,nombre,rol').eq('activo', true).order('nombre'));
  const raiz = h('section', { class: 'tarjeta' });
  const pintar = async () => {
    RESP = await q(sb.from('solicitud_responsables').select('*'));
    const nom = e => perfiles.find(p => p.email === e)?.nombre || e;
    raiz.replaceChildren(h('h2', {}, 'Responsables por tipo de solicitud'),
      h('p', { class: 'nota' }, 'DSEC y DSIN reciben el correo de validación según la regla de cada tipo. Seguimiento: la persona que llama a los beneficiarios (ve la pestaña Seguimiento telefónico y recibe el aviso cuando llega el producto).'),
      h('table', { class: 'tabla tabla-resp' }, h('thead', {}, h('tr', {}, h('th', {}, 'Tipo'), ...['DSEC', 'DSIN', 'SEGUIMIENTO'].map(a => h('th', {}, a === 'SEGUIMIENTO' ? 'Seguimiento telefónico' : a)))),
        h('tbody', {}, TIPOS.map(t => h('tr', {}, h('td', {}, `${t.icono} ${t.nombre}`, h('div', { class: 'nota' }, reglaTipo(t.clave))),
          ...['DSEC', 'DSIN', 'SEGUIMIENTO'].map(area => {
            const asignados = RESP.filter(r => r.tipo === t.clave && r.area === area);
            const sel = select([['', '+ Agregar…'], ...perfiles.filter(p => !asignados.some(a => a.email === p.email)).map(p => [p.email, p.nombre])], '');
            sel.onchange = async () => {
              if (!sel.value) return;
              try { await q(sb.from('solicitud_responsables').insert({ tipo: t.clave, area, email: sel.value })); toast('Responsable agregado'); pintar(); } catch (e) { error(e); }
            };
            return h('td', {}, ...asignados.map(a => h('span', { class: 'chip chip-resp' }, nom(a.email), ' ',
              h('button', { class: 'btn-x', title: 'Quitar', onclick: async () => {
                try { await q(sb.from('solicitud_responsables').delete().eq('id', a.id)); pintar(); } catch (e) { error(e); }
              } }, '×'))), sel);
          }))))));
  };
  await pintar();
  return h('div', {}, raiz, await feriados());
}
async function feriados() {
  const caja = h('section', { class: 'tarjeta' });
  const pintar = async () => {
    const fs = await q(sb.from('feriados').select('*').gte('fecha', new Date().toISOString().slice(0, 10)).order('fecha'));
    const f = h('input', { class: 'campo', type: 'date' }), n = h('input', { class: 'campo', placeholder: 'Nombre (p. ej. Vacación de fin de año)' });
    caja.replaceChildren(h('h2', {}, 'Feriados'),
      h('p', { class: 'nota' }, 'No cuentan para los 7 días hábiles de retiro (tampoco sábados ni domingos). Agregue vacaciones institucionales o asuetos locales.'),
      tabla([{ t: 'Fecha', f: x => fecha(x.fecha) }, { t: 'Feriado', k: 'nombre' },
        { t: '', f: x => h('button', { class: 'btn-x', title: 'Quitar', onclick: async e => { e.stopPropagation(); try { await q(sb.from('feriados').delete().eq('fecha', x.fecha)); pintar(); } catch (err) { error(err); } } }, '×') }],
        fs, { vacio: 'No hay feriados registrados' }),
      h('div', { class: 'filtros' }, campo('Fecha', f), campo('Nombre', n), h('div', { class: 'fila-campo' }, h('span', {}, '\u00a0'),
        h('button', { class: 'btn btn-sec', onclick: async () => {
          if (!f.value || !n.value.trim()) return toast('Indique fecha y nombre', 'error');
          try { await q(sb.from('feriados').insert({ fecha: f.value, nombre: n.value.trim() })); pintar(); } catch (e) { error(e); }
        } }, 'Agregar'))));
  };
  await pintar();
  return caja;
}
// ============================================================================ CEFAFA: redactar la solicitud y registrar la respuesta
// SIGAM no envía a CEFAFA: redacta el correo, la jefatura lo envía desde su cuenta, y lo incluido pasa a "Ya gestionado con CEFAFA".
const escHtml = x => String(x ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function correoCefafa(items) {
  const hoy = new Date().toLocaleDateString('es-SV', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const asunto = `INABVE · Solicitud de medicamentos · ${hoy}`;
  const intro = 'Estimados señores de CEFAFA:\n\nPor medio del presente les solicitamos los siguientes medicamentos, pendientes de entregar a beneficiarios del INABVE. ' +
    'Agradeceremos confirmar por cada uno si hay disponibilidad, si no hay, o si cuentan con un producto alterno con el mismo principio activo (indicar nombre comercial).';
  const cierre = 'Quedamos atentos a su respuesta.\n\nSaludos cordiales.';
  const cols = ['#', 'Código', 'Medicamento', 'Principio activo', 'Presentación', 'Cantidad', 'Sede(s)'];
  const filas = items.map((x, i) => [i + 1, x.codigo || '—', x.producto, x.principio_activo || '—', x.presentacion || '—', Number(x.cantidad).toLocaleString('es-SV'), x.sedes || '']);
  const texto = `Asunto: ${asunto}\n\n${intro}\n\n` + [cols, ...filas].map(f => f.join('\t')).join('\n') + `\n\n${cierre}`;
  const html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt"><p>${intro.split('\n\n').map(escHtml).join('</p><p>')}</p>` +
    `<table border="1" cellpadding="4" style="border-collapse:collapse;font-size:10pt"><tr style="background:#eef1f6">${cols.map(c => `<th>${c}</th>`).join('')}</tr>` +
    filas.map(f => `<tr>${f.map((c, k) => `<td${k === 5 ? ' style="text-align:right"' : ''}>${escHtml(c)}</td>`).join('')}</tr>`).join('') +
    `</table><p>${cierre.split('\n\n').map(escHtml).join('</p><p>')}</p></div>`;
  return { asunto, texto, html };
}
async function copiarCorreo(c) {
  try {
    if (window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([c.html], { type: 'text/html' }), 'text/plain': new Blob([c.texto], { type: 'text/plain' }) })]);
    else await navigator.clipboard.writeText(c.texto);
    return true;
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } }, c.texto); document.body.append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  }
}
async function cefafa() {
  const raiz = h('div');
  let incluirSinDisp = false;
  const pintar = async () => {
    const [[c], porSolicitar, gestionados] = await Promise.all([q(sb.from('cefafa_config').select('*')),
      rpc('resumen_cefafa', { p_grupo: 'solicitar', p_incluir_sin_disp: incluirSinDisp }), rpc('resumen_cefafa', { p_grupo: 'respuesta' })]);
    const sel = new Set(porSolicitar.map(x => x.clave));
    const contador = h('strong', {});
    const actualizar = () => { contador.textContent = `${sel.size} de ${porSolicitar.length} seleccionado(s)`; };
    const casilla = it => h('input', { type: 'checkbox', checked: sel.has(it.clave), onclick: e => e.stopPropagation(),
      onchange: e => { e.target.checked ? sel.add(it.clave) : sel.delete(it.clave); actualizar(); } });
    const redactar = () => {
      const elegidos = porSolicitar.filter(x => sel.has(x.clave));
      if (!elegidos.length) return toast('Seleccione al menos un medicamento', 'error');
      const correo = correoCefafa(elegidos);
      const ids = elegidos.flatMap(x => x.ids);
      const vista = h('div', { class: 'correo-vista' }); vista.innerHTML = correo.html;
      let mm;
      const marcar = async () => {
        const n = await rpc('marcar_gestionado_cefafa', { p_ids: ids });
        toast(`${n} solicitud(es) en "Ya gestionado con CEFAFA"`, 'ok', 6000); mm.cerrar(); pintar();
      };
      mm = modal('Correo para CEFAFA (lo envía la jefatura)', h('div', {},
        h('p', {}, h('strong', {}, 'Asunto: '), correo.asunto),
        h('p', { class: 'nota' }, 'Pulse "Copiar" y péguelo en un correo nuevo desde la cuenta de la jefatura. La tabla se pega con formato en Outlook o Gmail. No incluye datos de beneficiarios.'),
        vista), { ancho: '900px', acciones: [
          { texto: '📋 Solo copiar', clase: 'btn-sec', accion: async () => { toast(await copiarCorreo(correo) ? 'Correo copiado' : 'No se pudo copiar: selecciónelo y cópielo a mano', 'ok'); return false; } },
          { texto: `📋 Copiar y marcar ${ids.length} como "Ya gestionado con CEFAFA"`, clase: 'btn-primario', accion: async () => {
            if (!await copiarCorreo(correo)) toast('No se pudo copiar automáticamente: selecciónelo y cópielo a mano', 'error');
            try { await marcar(); } catch (e) { error(e); } return false;
          } }] });
    };
    const frec = select([['7', 'Cada semana'], ['15', 'Cada 15 días'], ['30', 'Cada mes']], String(c.frecuencia_dias));
    const prox = h('input', { class: 'campo', type: 'date', value: c.proximo_envio || '' });
    const activo = h('input', { type: 'checkbox', checked: c.activo });
    const chkSin = h('input', { type: 'checkbox', checked: incluirSinDisp, onchange: e => { incluirSinDisp = e.target.checked; pintar(); } });
    const responder = async (it, respuesta) => {
      let producto = null;
      if (respuesta === 'alterno') {
        producto = await new Promise(res => { const mm = modal('Producto alterno que ofrece CEFAFA', h('div', {},
          h('p', { class: 'nota' }, `Para: ${it.producto} (${it.principio_activo || 'sin principio activo'}). Si no está en el catálogo, agréguelo desde la solicitud.`),
          buscadorProducto({ filtro: p => p.tipo === 'medicamento', alElegir: p => { mm.cerrar(); res(p.id); } })), { alCerrar: () => res(null) }); });
        if (!producto) return;
      }
      const nota = await pedirTexto('Respuesta de CEFAFA', 'Comentario (opcional, queda en el historial de cada solicitud)', { minimo: 0 });
      if (nota === null) return;
      try { const n = await rpc('responder_cefafa', { p_ids: it.ids, p_respuesta: respuesta, p_producto: producto, p_nota: nota }); toast(`${n} solicitud(es) actualizada(s)`); pintar(); }
      catch (e) { error(e); }
    };
    raiz.replaceChildren(
      h('section', { class: 'tarjeta' },
        h('div', { class: 'botones' }, h('h2', {}, `1 · Por solicitar a CEFAFA (${porSolicitar.length})`), h('span', { class: 'espacio' }),
          h('button', { class: 'btn btn-sec btn-peq', onclick: () => { porSolicitar.forEach(x => sel.add(x.clave)); pintarCasillas(); } }, 'Todos'),
          h('button', { class: 'btn btn-sec btn-peq', onclick: () => { sel.clear(); pintarCasillas(); } }, 'Ninguno'),
          h('button', { class: 'btn btn-primario btn-peq', onclick: redactar }, '📝 Redactar correo')),
        h('p', { class: 'nota' }, 'Medicamentos en "Solicitado", agrupados por producto. Seleccione los que pedirá; SIGAM redacta el correo para que la jefatura lo envíe, y al copiarlo pasan a "Ya gestionado con CEFAFA".'),
        h('div', { class: 'botones' }, h('label', { class: 'casilla' }, chkSin, ' Incluir los que CEFAFA no tenía (volver a consultar)'), h('span', { class: 'espacio' }), contador),
        h('div', { class: 'tabla-sel' }),
      ),
      h('section', { class: 'tarjeta' },
        h('div', { class: 'botones' }, h('h2', {}, `2 · Respuesta de CEFAFA (${gestionados.length})`), h('span', { class: 'espacio' }),
          h('button', { class: 'btn btn-sec btn-peq', onclick: () => exportarExcel('SIGAM_gestionados_CEFAFA', [{ titulo: 'CEFAFA', cols: [{ t: 'Código', k: 'codigo' }, { t: 'Medicamento', k: 'producto' },
            { t: 'Principio activo', k: 'principio_activo' }, { t: 'Presentación', k: 'presentacion' }, { t: 'Cantidad', k: 'cantidad' }, { t: 'Personas', k: 'personas' }, { t: 'Sedes', k: 'sedes' }], filas: gestionados }]) }, '⬇ Excel')),
        h('p', { class: 'nota' }, 'Cuando CEFAFA responda, registre por producto: se actualizan todas las solicitudes del grupo.'),
        tabla([
          { t: 'Medicamento', f: it => h('div', {}, h('strong', {}, it.producto), h('div', { class: 'nota' }, [it.codigo, it.principio_activo, it.presentacion].filter(Boolean).join(' · '))) },
          { t: 'Cantidad', f: it => num(it.cantidad), num: true }, { t: 'Personas', k: 'personas', num: true }, { t: 'Sedes', k: 'sedes' },
          { t: 'Estado', f: it => it.sin_disponibilidad ? h('span', { class: 'estado c-azul' }, `${it.sin_disponibilidad} sin disponibilidad`)
              : it.espera_jd ? h('span', { class: 'estado c-morado' }, `${it.espera_jd} en espera de JD`) : h('span', { class: 'estado c-amarillo' }, 'Ya gestionado con CEFAFA') },
          { t: 'Respuesta de CEFAFA', f: it => h('div', { class: 'botones botones-llamada' },
            ...[['hay', '✔ Hay'], ['no_hay', '✖ No hay'], ['alterno', '↔ Alterno'], ['jd', '⏳ JD'], ['no_disponible', 'No disponible']].map(([k, tx]) =>
              h('button', { class: 'btn btn-sec btn-peq', onclick: e => { e.stopPropagation(); responder(it, k); } }, tx))) },
        ], gestionados, { vacio: 'No hay medicamentos gestionados esperando respuesta' })),
      h('section', { class: 'tarjeta' }, h('h2', {}, '🔔 Recordatorio'),
        h('p', { class: 'nota' }, 'En la fecha indicada, SIGAM avisa por correo a DSIN de medicamentos que toca redactar la solicitud a CEFAFA (si hay medicamentos en "Solicitado"). Al copiar el correo la fecha avanza sola según la frecuencia.'),
        h('div', { class: 'filtros' }, campo('Frecuencia', frec), campo('Próxima solicitud', prox, 'Puede cambiarla'),
          h('label', { class: 'casilla' }, activo, ' Recordatorio activo'),
          h('div', { class: 'fila-campo' }, h('span', {}, ' '), h('button', { class: 'btn btn-sec', onclick: async () => {
            try { await rpc('guardar_config_cefafa', { p: { frecuencia_dias: frec.value, proximo_envio: prox.value, activo: activo.checked } }); toast('Recordatorio guardado'); pintar(); }
            catch (e) { error(e); }
          } }, 'Guardar'))),
        h('p', { class: 'nota' }, c.ultimo_envio ? `Última solicitud redactada: ${fechaHora(c.ultimo_envio)}.` : 'Aún no se ha redactado ninguna solicitud.')));
    const pintarCasillas = () => {
      raiz.querySelector('.tabla-sel').replaceChildren(tabla([
        { t: '', f: casilla, ancho: '28px' },
        { t: 'Medicamento', f: it => h('div', {}, h('strong', {}, it.producto), h('div', { class: 'nota' }, [it.codigo, it.principio_activo, it.presentacion].filter(Boolean).join(' · '))) },
        { t: 'Cantidad', f: it => num(it.cantidad), num: true }, { t: 'Personas', k: 'personas', num: true }, { t: 'Sedes', k: 'sedes' },
        { t: 'Desde', f: it => fecha(it.desde) },
        { t: 'Estado', f: it => it.sin_disponibilidad ? h('span', { class: 'estado c-azul' }, 'CEFAFA no tenía') : h('span', { class: 'estado c-rojo' }, 'Solicitado') },
      ], porSolicitar, { vacio: 'No hay medicamentos en "Solicitado" por pedir a CEFAFA' }));
      actualizar();
    };
    pintarCasillas();
  };
  await pintar();
  return raiz;
}
const reglaTipo = k => ({
  medicamento: 'Primera vez → DSEC (la aprobación médica finaliza); pendiente de entrega → DSIN (queda "Ya gestionado").',
  insumo: 'Sin evaluación médica → DSEC (la aprobación finaliza); con evaluación → DSIN.',
  auditivo: 'Va a DSIN.', lentes: 'Va a DSIN.', cirugia_oftalmica: 'Va a DSIN.' })[k] || '';
