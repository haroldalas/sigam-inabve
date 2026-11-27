// Solicitudes (todos los roles): medicamentos, insumos, aparatos auditivos, lentes y cirugías oftálmicas.
// Un solo formato · autocompletar por DUI · ruteo DSEC/DSIN · validación · seguimiento telefónico · historial.
import { h, tabla, toast, error, modal, confirmar, pedirTexto, select, campo, fecha, fechaHora, num, ent, exportarExcel, debounce, chip } from '../ui.js';
import { sb, q, rpc, estado, esAdmin, dispararCorreos } from '../api.js';
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
const CLASE_ESTADO = { registrada: 'st-warn', contactado: 'st-info', evaluado: 'st-info', aprobada: 'st-info', en_gestion: 'st-info',
  sin_disponibilidad: 'st-danger', lista: 'st-ok', avisado: 'st-ok', programada: 'st-info', entregada: 'st-ok', operado: 'st-ok',
  no_procede: 'st-muted', cancelada: 'st-muted' };
const chipEstado = s => h('span', { class: 'estado ' + (CLASE_ESTADO[s.estado] || '') }, s.estado_texto || s.estado);
const dui4 = d => d ? '•••••' + String(d).slice(-4) : '';
const tel = t => t ? h('a', { class: 'tel', href: 'tel:' + t }, '📞 ' + t.replace(/^(\d{4})(\d{4})$/, '$1-$2')) : null;

let TIPOS = [], RESP = [];
const tipoDe = k => TIPOS.find(t => t.clave === k) || {};
const soyResp = (tipo, area) => RESP.some(r => r.email === estado.perfil.email && r.tipo === tipo && (!area || r.area === area));
const veoSeguimiento = () => esAdmin() || RESP.some(r => r.email === estado.perfil.email && ['DSIN', 'SEGUIMIENTO'].includes(r.area));
const veoTablero = () => ['administrador', 'jefatura'].includes(estado.perfil.rol);

export default async function (params) {
  [TIPOS, RESP] = await Promise.all([
    q(sb.from('solicitud_tipos').select('*').order('orden')),
    q(sb.from('solicitud_responsables').select('*')),
  ]);
  const pestanas = [
    ['bandeja', '📋 Bandeja'], ['nueva', '➕ Nueva solicitud'], ['dui', '🔎 Consultar por DUI'],
    veoSeguimiento() ? ['seguimiento', '📞 Seguimiento telefónico'] : null,
    veoTablero() ? ['tablero', '📊 Tablero'] : null,
    esAdmin() ? ['responsables', '👥 Responsables'] : null,
  ].filter(Boolean);
  let actual = params.get('ver') || (params.get('id') ? 'bandeja' : 'bandeja');
  const zona = h('div');
  const barra = h('div', { class: 'pestanas' });
  const ir = async k => {
    actual = k;
    history.replaceState(null, '', '#solicitudes?ver=' + k);
    barra.replaceChildren(...pestanas.map(([c, t]) => h('button', { class: c === actual ? 'activo' : '', onclick: () => ir(c) }, t)));
    zona.replaceChildren(h('p', { class: 'nota' }, 'Cargando…'));
    try {
      zona.replaceChildren(await ({ bandeja, nueva: () => nueva(ir), dui: consultaDui, seguimiento, tablero, responsables })[k]());
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
  const sede = select([['', 'Elija la sede'], ...estado.sedes.map(s => [s.id, s.nombre])], estado.perfil.sede_id || '');
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
      infoDui.replaceChildren(h('span', { class: 'ok' }, '✔ Datos cargados. Corrija el teléfono si cambió.'),
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
    const buscador = buscadorProducto({ autofocus: false, filtro: p => p.tipo === tipo, placeholder: tipo === 'medicamento' ? 'Busque el medicamento en el catálogo (nombre, principio activo o código)' : 'Busque el insumo en el catálogo',
      alElegir: p => { st.prod = p; unidad.value = unidad.value || p.presentacion || ''; pintarProd(); } });
    return h('div', { class: 'bloque-sol' },
      h('h3', {}, tipo === 'medicamento' ? 'Medicamento solicitado' : 'Insumo solicitado'),
      st.fuera ? (tipo === 'medicamento'
        ? h('div', { class: 'rejilla-3' }, pa, conc, forma)
        : desc) : h('div', {}, buscador, prodSel),
      h('label', { class: 'casilla' }, fuera, ' No está en el catálogo'),
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
    if (!sede.value) throw new Error('Elija la sede de entrega');
    if (t === 'medicamento' && !st.modalidad) throw new Error('Indique si es pendiente de entrega o primera vez');
    if (t === 'insumo' && (!st.primera_entrega || !st.tiene_evaluacion)) throw new Error('Responda las dos preguntas del insumo');
    if (['medicamento', 'insumo'].includes(t) && !st.prod && !st.fuera) throw new Error('Elija el producto del catálogo o marque "No está en el catálogo"');
    if (['medicamento', 'insumo'].includes(t) && !just.value) throw new Error('Elija la justificación');
    const p = {
      tipo: t, dui: dui.value, nombre: nombre.value, telefono: t1.value, telefono2: t2.value, sector: sector.value, departamento: depto.value,
      sede_id: sede.value, origen: origen.value, origen_detalle: origenDet.value, prioridad: urgente.checked ? 'urgente' : 'normal',
      modalidad: st.modalidad || null,
      primera_entrega: t === 'insumo' ? st.primera_entrega === 'si' : undefined, tiene_evaluacion: t === 'insumo' ? st.tiene_evaluacion === 'si' : undefined,
      producto_id: st.prod?.id || null,
      producto_texto: st.fuera ? (t === 'medicamento' ? [pa.value, conc.value, forma.value].filter(x => x.trim()).join(' ') : desc.value) : null,
      principio_activo: st.fuera && t === 'medicamento' ? pa.value : (st.prod?.principio_activo || null),
      concentracion: st.fuera ? conc.value : null, forma: st.fuera ? forma.value : null,
      cantidad: cantidad.value, unidad: unidad.value,
      justificacion: just.value === 'Otro' ? 'Otro: ' + justOtro.value : just.value,
      lado: lado.value || null, diagnostico: t === 'cirugia_oftalmica' ? diagOft.value : diag.value,
      comentario: comentario.value, forzar,
    };
    if (st.fuera && t === 'medicamento' && !pa.value.trim()) throw new Error('Escriba el principio activo');
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
    h('div', { class: 'rejilla-3' }, campo('Sector', sector), campo('Departamento', depto), campo('Sede de entrega', sede)),
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
        { t: 'Número', f: s => h('div', {}, h('strong', {}, s.numero), s.prioridad === 'urgente' ? h('div', {}, chip('URGENTE', 'chip-urgente')) : null), ord: s => s.numero },
        { t: 'Tipo', f: s => `${s.icono} ${s.tipo_nombre}`, ord: s => s.tipo },
        { t: 'Beneficiario', f: s => h('div', {}, s.beneficiario, h('div', { class: 'nota' }, dui4(s.dui))), ord: s => s.beneficiario },
        { t: 'Solicita', f: s => h('div', {}, s.solicita, s.cantidad ? h('div', { class: 'nota' }, `${num(s.cantidad)} ${s.unidad || ''}`) : null), ord: s => s.solicita },
        { t: 'Sede', k: 'sede' },
        { t: 'Área', k: 'area' },
        { t: 'Estado', f: s => h('div', {}, chipEstado(s), s.posicion ? h('div', { class: 'nota' }, `Lista de espera: #${s.posicion}`) : null), ord: s => s.estado_texto },
        { t: 'Días', f: s => ent(s.dias), num: true, ord: s => s.dias },
      ], fs, { alClic: s => abrir(s.id, cargar), vacio: 'No hay solicitudes con estos filtros' })));
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
export async function abrir(id, alCambiar) {
  const [s] = await q(sb.from('v_solicitudes').select('*').eq('id', id));
  if (!s) return toast('No tiene acceso a esa solicitud o no existe', 'error');
  const eventos = await q(sb.from('v_solicitud_eventos').select('*').eq('solicitud_id', id).order('at'));
  const esperaDsec = s.area === 'DSEC' && !s.validado_at;   // aún no la valida el médico de DSEC
  const gestiona = esAdmin() || (esperaDsec ? soyResp(s.tipo, 'DSEC') : soyResp(s.tipo));
  const valida = !s.es_final && ['registrada', 'contactado', 'evaluado'].includes(s.estado) && (esAdmin() || soyResp(s.tipo, s.area));
  let m;
  const hecho = async (msg) => { dispararCorreos(); toast(msg); m.cerrar(); alCambiar && alCambiar(); };
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
    acciones.push({ texto: '✖ No procede', clase: 'btn-peligro', accion: async () => {
      const motivo = await pedirTexto('No procede', 'Motivo (le llegará por correo a quien la registró)'); if (!motivo) return false;
      await rpc('validar_solicitud', { p_id: id, p_aprobar: false, p_nota: motivo }); hecho('Solicitud marcada como no procede');
    } });
    acciones.push({ texto: '✔ Validar', clase: 'btn-primario', accion: async () => {
      const nota = await pedirTexto('Validar solicitud', s.area === 'DSEC' && ['medicamento', 'insumo'].includes(s.tipo) ? 'Comentario (al validarla pasa a DSIN para gestión y entrega)' : 'Comentario (opcional)', { minimo: 0 });
      if (nota === null) return false;
      await rpc('validar_solicitud', { p_id: id, p_aprobar: true, p_nota: nota }); hecho('Solicitud validada · se avisó por correo');
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
        fila('Validada', s.validado_at ? `${fechaHora(s.validado_at)} · ${s.validado_nombre}` : null),
        fila('Seguimiento', s.asignado_nombre)))),
    s.producto_disponible_at && !s.es_final ? h('div', { class: 'aviso aviso-ok' }, `📦 El producto llegó a ${s.sede} el ${fechaHora(s.producto_disponible_at)}. Avise al beneficiario.`) : null,
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
  const est = select(t.estados.map(e => [e.k, e.t]), s.estado);
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
  if (['medicamento', 'insumo'].includes(s.tipo) && !s.producto_id) {
    piezas.push(h('div', { class: 'aviso aviso-warn' }, 'Producto fuera del catálogo. Cuando lo agreguen al catálogo, vincúlelo aquí para que SIGAM avise al llegar a la sede.',
      buscadorProducto({ autofocus: false, filtro: p => p.tipo === s.tipo, placeholder: 'Buscar el producto ya agregado al catálogo', alElegir: async p => {
        try { await rpc('vincular_producto_solicitud', { p_id: s.id, p_producto: p.id }); hecho('Producto vinculado'); } catch (e) { error(e); }
      } })));
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
            h('div', {}, h('span', { class: 'estado ' + (x.final ? 'st-muted' : 'st-info') }, x.estado), ` · ${x.sede} · ${x.numero}`),
            h('div', { class: 'nota' }, `Registrada el ${fecha(x.creado_at)} (hace ${x.dias} días)` + (x.posicion ? ` · Lista de espera: posición ${x.posicion}` : '')),
            x.ultimo ? h('div', { class: 'nota' }, 'Último comentario: ' + x.ultimo) : null),
          h('button', { class: 'btn-enlace', onclick: () => abrir(x.id) }, 'Ver')))));
    } catch (e) { error(e); }
  });
  setTimeout(() => inp.focus(), 50);
  return h('section', { class: 'tarjeta' }, h('h2', {}, 'Consultar el estado por DUI'),
    h('p', { class: 'nota' }, 'Para responder cuando un beneficiario llama: muestra todas sus solicitudes, su estado y desde cuándo. Cada consulta queda registrada.'),
    campo('DUI (9 dígitos)', inp), res);
}

// ============================================================================ seguimiento telefónico (DSIN)
async function seguimiento() {
  const hoy = new Date().toISOString().slice(0, 10);
  const raiz = h('div');
  const cargar = async () => {
    let filas = await q(sb.from('v_solicitudes').select('*').is('cerrada_at', null)
      .in('estado', ['lista', 'avisado', 'aprobada', 'en_gestion', 'sin_disponibilidad', 'registrada', 'contactado', 'evaluado', 'programada']).limit(1000));
    if (!esAdmin()) filas = filas.filter(s => s.asignado_a === estado.perfil.email || (!s.asignado_a && soyResp(s.tipo)));
    const grupo = (titulo, ayuda, fs) => fs.length ? h('section', { class: 'tarjeta' }, h('h2', {}, `${titulo} (${fs.length})`), h('p', { class: 'nota' }, ayuda),
      h('div', { class: 'tarjetas-llamada' }, fs.map(tarjetaLlamada))) : null;
    const orden = (a, b) => (b.prioridad === 'urgente') - (a.prioridad === 'urgente') || String(a.creado_at).localeCompare(b.creado_at);
    const yaLlego = filas.filter(s => s.estado === 'lista').sort(orden);
    const hoyToca = filas.filter(s => s.estado !== 'lista' && s.proximo_contacto && s.proximo_contacto <= hoy).sort(orden);
    const sinContacto = filas.filter(s => s.estado !== 'lista' && !s.proximo_contacto && !s.ultimo_contacto_at && ['aprobada', 'en_gestion', 'sin_disponibilidad', 'registrada'].includes(s.estado)).sort(orden);
    const avisados = filas.filter(s => s.estado === 'avisado').sort(orden);
    raiz.replaceChildren(
      h('section', { class: 'tarjeta' }, h('div', { class: 'rejilla' },
        kpi('📦 Ya llegó: avisar', yaLlego.length), kpi('📅 Llamar hoy', hoyToca.length), kpi('🆕 Sin contacto aún', sinContacto.length), kpi('✔ Avisados, por retirar', avisados.length))),
      grupo('📦 El producto ya llegó: avise para que pase a retirar', 'Primero las urgentes y las más antiguas.', yaLlego),
      grupo('📅 Toca llamar hoy', 'Llamadas programadas para hoy o atrasadas (incluye “no contestó” de ayer).', hoyToca),
      grupo('🆕 Aún no se les ha llamado', 'Solicitudes en gestión sin ningún contacto registrado.', sinContacto),
      grupo('✔ Avisados, pendientes de retirar', 'Al despacharles con su DUI, la solicitud se cierra sola.', avisados),
      !filas.length ? h('section', { class: 'tarjeta' }, h('p', { class: 'nota' }, 'No hay llamadas pendientes. 🎉')) : null);
  };
  const tarjetaLlamada = s => {
    const nota = h('input', { class: 'campo', placeholder: 'Nota' });
    const prox = h('input', { class: 'campo', type: 'date', title: 'Volver a llamar el…' });
    return h('div', { class: 'tarjeta-llamada' + (s.prioridad === 'urgente' ? ' urgente' : '') },
      h('div', { class: 'tl-cab' }, h('strong', {}, s.beneficiario), s.prioridad === 'urgente' ? chip('URGENTE', 'chip-urgente') : null),
      h('div', { class: 'tl-tels' }, tel(s.telefono), tel(s.telefono2)),
      h('div', {}, `${s.icono} ${s.solicita}`, s.cantidad ? ` · ${num(s.cantidad)} ${s.unidad || ''}` : ''),
      h('div', { class: 'nota' }, `${s.sede} · ${s.numero} · esperando ${s.dias} día(s)` + (s.intentos ? ` · ${s.intentos} llamada(s)` : '') +
        (s.ultimo_resultado ? ` · último: ${RESULTADOS.find(r => r[0] === s.ultimo_resultado)?.[1] || ''}` : '')),
      h('div', { class: 'tl-form' }, nota, prox),
      h('div', { class: 'botones botones-llamada' }, RESULTADOS.map(([k, txt, cls]) => h('button', { class: 'btn btn-peq ' + cls, onclick: async e => {
        e.target.disabled = true;
        try { await rpc('registrar_llamada', { p_id: s.id, p_resultado: k, p_nota: nota.value, p_proximo: prox.value || null }); dispararCorreos(); toast('Llamada registrada'); cargar(); }
        catch (err) { error(err); e.target.disabled = false; }
      } }, txt))),
      h('button', { class: 'btn-enlace', onclick: () => abrir(s.id, cargar) }, 'Ver detalle e historial'));
  };
  await cargar();
  return raiz;
}
const kpi = (t, v) => h('div', { class: 'kpi' }, h('div', { class: 'kpi-titulo' }, t), h('div', { class: 'kpi-valor' }, ent(v)));

// ============================================================================ tablero
async function tablero() {
  const hoy = new Date(); const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1);
  const iso = d => d.toISOString().slice(0, 10);
  const desde = h('input', { class: 'campo', type: 'date', value: iso(ini) }), hasta = h('input', { class: 'campo', type: 'date', value: iso(hoy) });
  const zona = h('div');
  const barras = (fs, k = 'n') => { const mx = Math.max(1, ...fs.map(x => Number(x[k]))); return h('div', { class: 'barras' }, fs.map(x => h('div', { class: 'barra' },
    h('span', { title: x.clave }, String(x.clave).slice(0, 34)), h('div', { class: 'barra-pista' }, h('div', { class: 'barra-relleno', style: { width: `${100 * x[k] / mx}%` } })),
    h('strong', { class: 'derecha' }, ent(x[k]))))); };
  const pintar = async () => {
    const d = await rpc('tablero_solicitudes', { p_desde: desde.value, p_hasta: hasta.value });
    zona.replaceChildren(
      h('div', { class: 'rejilla' }, kpi('Solicitudes', d.total), kpi('Abiertas', d.abiertas), kpi('Urgentes abiertas', d.urgentes),
        h('div', { class: 'kpi' }, h('div', { class: 'kpi-titulo' }, 'Días promedio'), h('div', { class: 'kpi-valor' }, `${d.dias_validar ?? '—'} / ${d.dias_cerrar ?? '—'}`),
          h('div', { class: 'kpi-sub' }, 'para validar / para entregar'))),
      h('div', { class: 'rejilla rejilla-graficos' },
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Por tipo'), tabla([{ t: 'Tipo', k: 'clave' }, { t: 'Total', k: 'total', num: true }, { t: 'Abiertas', k: 'abiertas', num: true }, { t: 'Atendidas', k: 'atendidas', num: true }], d.por_tipo)),
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Por estado'), barras(d.por_estado))),
      h('div', { class: 'rejilla rejilla-graficos' },
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Medicamentos más pedidos fuera del cuadro básico'),
          h('p', { class: 'nota' }, 'Evidencia para decidir qué agregar al catálogo.'),
          tabla([{ t: 'Principio activo / producto', k: 'clave' }, { t: 'Solicitudes', k: 'n', num: true }, { t: 'Personas', k: 'personas', num: true }], d.fuera_catalogo, { vacio: 'Ninguno en el período' })),
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Productos del catálogo más solicitados'),
          tabla([{ t: 'Producto', k: 'clave' }, { t: 'Tipo', k: 'tipo' }, { t: 'Solicitudes', k: 'n', num: true }, { t: 'Personas', k: 'personas', num: true }], d.mas_pedidos, { vacio: 'Ninguno en el período' }))),
      h('section', { class: 'tarjeta' }, h('h2', {}, 'Por sede'), barras(d.por_sede)));
  };
  desde.onchange = hasta.onchange = () => pintar().catch(error);
  await pintar();
  return h('div', {}, h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' }, campo('Desde', desde), campo('Hasta', hasta))), zona);
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
  return raiz;
}
const reglaTipo = k => ({
  medicamento: 'Primera vez → DSEC (valida un médico); pendiente de entrega → DSIN. Lo aprobado por DSEC pasa a DSIN.',
  insumo: 'Sin evaluación médica → DSEC; con evaluación → DSIN. Lo aprobado por DSEC pasa a DSIN.',
  auditivo: 'Va a DSEC.', lentes: 'Va a DSEC.', cirugia_oftalmica: 'Va a DSEC.' })[k] || '';
