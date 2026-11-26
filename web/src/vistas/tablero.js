// Tableros (administración y jefatura) · basados en los dashboards de las solicitudes a TICS:
// prioritarias quincenales, medicamentos entregados, impacto presupuestario de medicamentos e insumos.
import { h, ent, dinero, tabla, exportarExcel, select } from '../ui.js';
import { sb, q, rpc, estado } from '../api.js';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const etMes = m => { const [y, mm] = m.split('-'); return `${MESES[Number(mm) - 1]} ${y.slice(2)}`; };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const corto = v => { const n = Number(v); return Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + ' mill.' : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(1) + ' mil' : ent(n); };
const COLORES = ['#233152', '#b08a3e', '#4f6fb0', '#8aa1cf', '#c9b27c', '#6b7a99'];

const PESTANAS = [
  ['quincenal', 'Prioritarias quincenales', null],
  ['medicamentos', 'Medicamentos entregados', 'medicamento'],
  ['presupuesto', 'Impacto presupuestario · medicamentos', 'medicamento'],
  ['insumos', 'Impacto presupuestario · insumos', 'insumo'],
];

// períodos: quincena actual o anterior, mes, año o rango libre
function periodos() {
  const hoy = new Date(); const y = hoy.getFullYear(), m = hoy.getMonth(), d = hoy.getDate();
  const q1 = d <= 15;
  const ini = q1 ? new Date(y, m, 1) : new Date(y, m, 16), fin = q1 ? new Date(y, m, 15) : new Date(y, m + 1, 0);
  const pIni = q1 ? new Date(y, m - 1, 16) : new Date(y, m, 1), pFin = q1 ? new Date(y, m, 0) : new Date(y, m, 15);
  return {
    h: [iso(hoy), iso(hoy), 'Hoy'], y: [iso(new Date(y, m, d - 1)), iso(new Date(y, m, d - 1)), 'Ayer'],
    q: [iso(ini), iso(fin), 'Quincena actual'], qa: [iso(pIni), iso(pFin), 'Quincena anterior'],
    m: [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0)), 'Este mes'], ma: [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0)), 'Mes anterior'],
    a: [iso(new Date(y, 0, 1)), iso(new Date(y, 11, 31)), `Año ${y}`],
  };
}

export default async function (params) {
  const P = periodos();
  const f = { pestana: params.get('ver') || 'quincenal', periodo: 'q', desde: P.q[0], hasta: P.q[1], sede: '', tipo: '', proveedor: '' };
  const proveedores = await q(sb.from('proveedores').select('id,nombre').eq('activo', true).order('nombre'));
  const raiz = h('div'); const zona = h('div');

  const pintar = async () => {
    const tipoFijo = PESTANAS.find(p => p[0] === f.pestana)[2];
    if (f.periodo !== 'r') [f.desde, f.hasta] = P[f.periodo];
    zona.replaceChildren(h('p', { class: 'nota' }, 'Calculando…'));
    try {
      const d = await rpc('tablero_consumo', { p_desde: f.desde, p_hasta: f.hasta, p_sede: f.sede ? Number(f.sede) : null,
        p_tipo: tipoFijo || f.tipo || null, p_proveedor: f.proveedor ? Number(f.proveedor) : null });
      zona.replaceChildren(({ quincenal, medicamentos, presupuesto, insumos })[f.pestana](d, f));
    } catch (e) { zona.replaceChildren(h('div', { class: 'aviso aviso-error' }, e.message)); }
    pintarFiltros();
  };

  const filtros = h('section', { class: 'tarjeta' });
  const pintarFiltros = () => {
    const tipoFijo = PESTANAS.find(p => p[0] === f.pestana)[2];
    const sel = (k, o) => { const s = select(o, f[k]); s.onchange = () => { f[k] = s.value; pintar(); }; return s; };
    const fechas = f.periodo === 'r' ? [
      h('label', { class: 'fila-campo' }, h('span', {}, 'Desde'), h('input', { class: 'campo', type: 'date', value: f.desde, onchange: e => { f.desde = e.target.value; pintar(); } })),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Hasta'), h('input', { class: 'campo', type: 'date', value: f.hasta, onchange: e => { f.hasta = e.target.value; pintar(); } }))] : [];
    filtros.replaceChildren(
      h('div', { class: 'pestanas' }, PESTANAS.map(([k, t]) => h('button', { class: f.pestana === k ? 'activo' : '', onclick: () => { f.pestana = k; pintar(); } }, t))),
      h('div', { class: 'filtros' },
        h('label', { class: 'fila-campo' }, h('span', {}, 'Período'), sel('periodo', [...Object.entries(P).map(([k, v]) => [k, v[2]]), ['r', 'Rango de fechas…']])),
        ...fechas,
        h('label', { class: 'fila-campo' }, h('span', {}, 'Sede'), sel('sede', [['', 'Todas'], ...estado.sedes.map(s => [s.id, s.nombre])])),
        h('label', { class: 'fila-campo' }, h('span', {}, 'Proveedor'), sel('proveedor', [['', 'Todos'], ...proveedores.map(p => [p.id, p.nombre])])),
        tipoFijo ? null : h('label', { class: 'fila-campo' }, h('span', {}, 'Tipo'), sel('tipo', [['', 'Medicamentos e insumos'], ['medicamento', 'Medicamentos'], ['insumo', 'Insumos médicos']]))),
      h('p', { class: 'nota' }, (f.periodo === 'h' ? `Hoy ${f.desde.split('-').reverse().join('/')} · se actualiza cada 2 minutos (última: ${new Date().toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: false })})` : `Del ${f.desde.split('-').reverse().join('/')} al ${f.hasta.split('-').reverse().join('/')}`) + ` · despachos confirmados en SIGAM (incluye el histórico migrado de SIFAR desde julio 2026) · montos a precio de compra del lote entregado.`));
  };

  await pintar();
  raiz.append(filtros, zona);
  // "Hoy": se actualiza solo cada 2 minutos mientras la pantalla está abierta y visible
  const reloj = setInterval(() => {
    if (!raiz.isConnected) return clearInterval(reloj);
    if (f.periodo === 'h' && !document.hidden) pintar();
  }, 120_000);
  return raiz;
}

// ----------------------------------------------------------------------------- piezas
// un solo día: la evolución se muestra por hora; si no, por mes
const unDia = f => f.desde === f.hasta;
const serie = (d, f) => {
  if (!unDia(f)) return d.mensual;
  if (!d.por_hora.length) return [];
  const hs = d.por_hora.map(r => r.hora), out = [];   // horas seguidas, con cero donde no hubo movimiento
  for (let x = Math.min(7, ...hs); x <= Math.max(16, ...hs); x++) {
    const r = d.por_hora.find(y => y.hora === x) || { hora: x, despachos: 0, unidades: 0, monto: 0, personas: 0 };
    out.push({ ...r, et: `${String(x).padStart(2, '0')}:00` });
  }
  return out;
};
const tituloSerie = (f, t) => unDia(f) ? `${t} por hora` : `${t} mensual`;

const kpi = (t, v, s) => h('div', { class: 'kpi' }, h('div', { class: 'kpi-titulo' }, t), h('div', { class: 'kpi-valor' }, v), s ? h('div', { class: 'kpi-sub' }, s) : null);
const tarjeta = (titulo, ...hijos) => h('section', { class: 'tarjeta' }, h('h2', {}, titulo), ...hijos);
const dos = (...hijos) => h('div', { class: 'rejilla rejilla-graficos' }, ...hijos);
const vacio = fs => !fs.length ? h('p', { class: 'nota' }, 'Sin despachos en este período.') : null;

function barras(fs, campo = 'monto', dorado = false, fmt = dinero) {
  if (!fs.length) return vacio(fs);
  const mx = Math.max(1, ...fs.map(x => Number(x[campo])));
  return h('div', { class: 'barras' }, fs.map(x => h('div', { class: 'barra' },
    h('span', { title: x.clave }, String(x.clave).slice(0, 30)),
    h('div', { class: 'barra-pista' }, h('div', { class: 'barra-relleno' + (dorado ? ' dorado' : ''), style: { width: `${100 * Number(x[campo]) / mx}%` } })),
    h('strong', { class: 'derecha' }, fmt(x[campo])))));
}

function svg(ancho, alto, cuerpo, etiqueta) {
  const d = h('div', { class: 'grafico', role: 'img', 'aria-label': etiqueta });
  d.innerHTML = `<svg viewBox="0 0 ${ancho} ${alto}" width="100%" preserveAspectRatio="xMidYMid meet">${cuerpo}</svg>`;
  return d;
}

// línea mensual con 1 o 2 series (la segunda en eje derecho)
function lineas(fs, series, etiqueta) {
  if (!fs.length) return vacio(fs);
  const W = 640, H = 230, L = 56, R = series.length > 1 ? 56 : 16, T = 16, B = 34;
  const x = i => L + (fs.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (fs.length - 1));
  let out = '';
  series.forEach((s, si) => {
    const mx = Math.max(1, ...fs.map(r => Number(r[s.k])));
    const y = v => T + (H - T - B) * (1 - Number(v) / mx);
    const pts = fs.map((r, i) => `${x(i)},${y(r[s.k])}`).join(' ');
    out += `<polyline fill="none" stroke="${s.c}" stroke-width="2.5" points="${pts}"/>`;
    fs.forEach((r, i) => { out += `<circle cx="${x(i)}" cy="${y(r[s.k])}" r="3.5" fill="${s.c}"><title>${esc(r.et || etMes(r.mes))}: ${esc(s.fmt(r[s.k]))}</title></circle>`; });
    const ex = si === 0 ? L - 6 : W - R + 6, an = si === 0 ? 'end' : 'start';
    out += `<text x="${ex}" y="${T + 4}" font-size="13" fill="${s.c}" text-anchor="${an}">${esc(corto(mx))}</text><text x="${ex}" y="${H - B}" font-size="13" fill="${s.c}" text-anchor="${an}">0</text>`;
  });
  fs.forEach((r, i) => { out += `<text x="${x(i)}" y="${H - 12}" font-size="13" fill="#5b6478" text-anchor="middle">${esc(r.et || etMes(r.mes))}</text>`; });
  out += `<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="#d6dbe6"/>`;
  return h('div', {}, svg(W, H, out, etiqueta),
    h('div', { class: 'leyenda' }, series.map(s => h('span', {}, h('i', { style: { background: s.c } }), s.t))));
}

function dona(fs, campo, etiqueta) {
  if (!fs.length) return vacio(fs);
  const tot = fs.reduce((s, r) => s + Number(r[campo]), 0) || 1;
  const R = 70, r = 42, cx = 90, cy = 90; let a = -Math.PI / 2, out = '';
  fs.forEach((x, i) => {
    const v = Number(x[campo]) / tot, b = a + v * 2 * Math.PI, g = v > .5 ? 1 : 0;
    const p = (rad, ang) => `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`;
    out += v >= .9999 ? `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${COLORES[i % 6]}" stroke-width="${R - r}"/>`
      : `<path d="M${p(R, a)} A${R},${R} 0 ${g} 1 ${p(R, b)} L${p(r, b)} A${r},${r} 0 ${g} 0 ${p(r, a)} Z" fill="${COLORES[i % 6]}"><title>${esc(x.clave)}: ${Math.round(v * 100)} %</title></path>`;
    a = b;
  });
  return h('div', { class: 'dona' }, svg(180, 180, out, etiqueta),
    h('div', { class: 'leyenda leyenda-col' }, fs.map((x, i) => h('span', {}, h('i', { style: { background: COLORES[i % 6] } }),
      `${x.clave} · ${Math.round(100 * Number(x[campo]) / tot)} % (${dinero(x[campo])})`))));
}

function dispersion(fs, etiqueta) {
  if (!fs.length) return vacio(fs);
  const W = 640, H = 260, L = 60, R = 16, T = 14, B = 34;
  const mxX = Math.max(1, ...fs.map(r => Number(r.unidades))), mxY = Math.max(1, ...fs.map(r => Number(r.monto)));
  const x = v => L + (W - L - R) * Number(v) / mxX, y = v => T + (H - T - B) * (1 - Number(v) / mxY);
  let out = `<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="#d6dbe6"/><line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" stroke="#d6dbe6"/>`;
  fs.forEach((r, i) => {
    out += `<circle cx="${x(r.unidades)}" cy="${y(r.monto)}" r="${i < 5 ? 7 : 5}" fill="${i < 5 ? '#b08a3e' : '#233152'}" fill-opacity=".75"><title>${esc(r.clave)}: ${esc(ent(r.unidades))} u. · ${esc(dinero(r.monto))}</title></circle>`;
    if (i < 5) out += `<text x="${x(r.unidades) + 9}" y="${y(r.monto) + 4}" font-size="12" fill="#233152">${esc(String(r.clave).slice(0, 22))}</text>`;
  });
  out += `<text x="${L - 6}" y="${T + 6}" font-size="13" fill="#5b6478" text-anchor="end">${esc(corto(mxY))}</text>`
       + `<text x="${W - R}" y="${H - 12}" font-size="13" fill="#5b6478" text-anchor="end">${esc(ent(mxX))} u.</text>`
       + `<text x="${L}" y="${H - 12}" font-size="13" fill="#5b6478">Unidades entregadas →</text>`;
  return h('div', {}, svg(W, H, out, etiqueta), h('p', { class: 'nota' }, 'Cada punto es un producto (los 40 de mayor costo). Arriba a la derecha: mucho volumen y mucho costo; arriba a la izquierda: pocas unidades pero caras.'));
}

const btnExcel = (nombre, hojas) => h('button', { class: 'btn btn-sec btn-peq', onclick: () => exportarExcel(nombre, hojas) }, '⬇ Excel');
const colsProd = [{ t: 'Producto', k: 'clave' }, { t: 'Unidades', k: 'unidades', num: true }, { t: 'Personas', k: 'personas', num: true },
  { t: 'Monto', f: r => dinero(r.monto), num: true, exportar: r => Number(r.monto), ord: r => Number(r.monto) }];
const colsPers = [{ t: 'Expediente / DUI', k: 'clave' }, { t: 'Despachos', k: 'despachos', num: true }, { t: 'Unidades', k: 'unidades', num: true },
  { t: 'Monto', f: r => dinero(r.monto), num: true, exportar: r => Number(r.monto), ord: r => Number(r.monto) }];
const nombreArchivo = (t, f) => `SIGAM_${t}_${f.desde}_${f.hasta}`;

// ----------------------------------------------------------------------------- 1. prioritarias quincenales
function quincenal(d, f) {
  const k = d.kpi;
  return h('div', {},
    h('div', { class: 'rejilla' },
      kpi('Monto del período', dinero(k.monto), 'a precio de compra'),
      kpi('Unidades', ent(k.unidades), 'entregadas'),
      kpi('Despachos', ent(k.despachos), 'recetas y entregas únicas'),
      kpi('Personas', ent(k.personas), 'atendidas (una vez cada una)')),
    dos(
      tarjeta('Monto por sede', barras(d.por_sede)),
      tarjeta('Medicamentos e insumos', dona([{ clave: 'Medicamentos', monto: k.monto_medicamentos }, { clave: 'Insumos médicos', monto: k.monto_insumos }].filter(x => Number(x.monto)), 'monto', 'Monto por tipo de producto'))),
    dos(
      h('section', { class: 'tarjeta' }, h('div', { class: 'botones' }, h('h2', {}, 'Productos del período (mayor monto)'), h('span', { class: 'espacio' }),
        btnExcel(nombreArchivo('prioritarias', f), [{ titulo: 'Productos', cols: colsProd, filas: d.top_monto }, { titulo: 'Por sede', cols: [{ t: 'Sede', k: 'clave' }, { t: 'Unidades', k: 'unidades' }, { t: 'Personas', k: 'personas' }, { t: 'Monto', k: 'monto' }], filas: d.por_sede }, { titulo: 'Por proveedor', cols: [{ t: 'Proveedor', k: 'clave' }, { t: 'Unidades', k: 'unidades' }, { t: 'Monto', k: 'monto' }], filas: d.por_proveedor }])),
        tabla(colsProd, d.top_monto)),
      tarjeta('Contratos, existencias y traslados',
        h('div', { class: 'rejilla' },
          kpi('Existencia valorada', dinero(d.existencias.valor), `${ent(d.existencias.productos)} productos con existencia`),
          kpi('Traslados del período', ent(d.traslados.enviados), `${ent(d.traslados.recibidos)} ya recibidos`)),
        h('h3', { style: { marginTop: '14px' } }, 'Monto por proveedor'), barras(d.por_proveedor.slice(0, 8), 'monto', true))),
    unDia(f)
      ? tarjeta('Movimiento del día por hora', lineas(serie(d, f), [{ k: 'despachos', t: 'Despachos', c: COLORES[0], fmt: ent }, { k: 'monto', t: 'Monto', c: COLORES[1], fmt: dinero }], 'Movimiento del día por hora'))
      : tarjeta('Monto por quincena', lineas(d.quincenal.map(r => ({ ...r, et: `${etMes(r.mes)} ${r.q === 1 ? '1ª' : '2ª'}` })), [{ k: 'monto', t: 'Monto', c: COLORES[0], fmt: dinero }], 'Monto por quincena')),
    h('p', { class: 'nota' }, 'El reparto por población (FAES, excombatientes, personas con discapacidad) y por sexo necesita esos datos en el expediente; SIGAM aún no los registra.'));
}

// ----------------------------------------------------------------------------- 2. medicamentos entregados
function medicamentos(d, f) {
  const k = d.kpi;
  return h('div', {},
    h('div', { class: 'rejilla' },
      kpi('Personas', ent(k.personas), 'recibieron medicamentos'),
      kpi('Medicamentos entregados', ent(k.unidades), 'unidades'),
      kpi('Costo total', dinero(k.monto), 'a precio de compra'),
      kpi('Promedio por persona', ent(k.personas ? k.unidades / k.personas : 0), 'unidades')),
    dos(
      tarjeta('10 medicamentos más entregados', barras(d.top_unidades, 'unidades', false, ent)),
      tarjeta('Personas por sede', barras(d.por_sede, 'personas', true, ent))),
    dos(
      tarjeta(unDia(f) ? 'Entregas por hora' : 'Evolución mensual', lineas(serie(d, f), [{ k: 'unidades', t: 'Unidades entregadas', c: COLORES[0], fmt: ent }, { k: 'personas', t: 'Personas', c: COLORES[1], fmt: ent }], 'Evolución de medicamentos entregados')),
      h('section', { class: 'tarjeta' }, h('div', { class: 'botones' }, h('h2', {}, 'Expedientes con mayor consumo'), h('span', { class: 'espacio' }),
        btnExcel(nombreArchivo('medicamentos', f), [{ titulo: 'Top medicamentos', cols: colsProd, filas: d.top_unidades }, { titulo: 'Mensual', cols: [{ t: 'Mes', k: 'mes' }, { t: 'Unidades', k: 'unidades' }, { t: 'Personas', k: 'personas' }, { t: 'Monto', k: 'monto' }], filas: d.mensual }])),
        tabla(colsPers, d.top_personas, { vacio: 'Sin despachos a beneficiarios' }),
        h('p', { class: 'nota' }, 'El DUI se muestra enmascarado.'))));
}

// ----------------------------------------------------------------------------- 3. impacto presupuestario · medicamentos
function presupuesto(d, f) {
  const k = d.kpi;
  return h('div', {},
    h('div', { class: 'rejilla' },
      kpi('Personas', ent(k.personas), 'con medicamentos'),
      kpi('Medicamentos entregados', ent(k.unidades), 'unidades'),
      kpi('Costo total', dinero(k.monto), 'a precio de compra'),
      kpi('Costo promedio por persona', dinero(k.personas ? k.monto / k.personas : 0), '')),
    dos(
      tarjeta('10 medicamentos con mayor impacto', barras(d.top_monto)),
      tarjeta('Costo y cantidad entregada', dispersion(d.dispersion, 'Relación entre costo y cantidad entregada'))),
    dos(
      tarjeta(tituloSerie(f, 'Costo'), lineas(serie(d, f), [{ k: 'monto', t: 'Costo', c: COLORES[0], fmt: dinero }], 'Evolución del costo de medicamentos')),
      h('section', { class: 'tarjeta' }, h('div', { class: 'botones' }, h('h2', {}, 'Expedientes con mayor costo'), h('span', { class: 'espacio' }),
        btnExcel(nombreArchivo('presupuesto_medicamentos', f), [{ titulo: 'Mayor costo', cols: colsProd, filas: d.top_monto }, { titulo: 'Por familia', cols: [{ t: 'Familia', k: 'clave' }, { t: 'Unidades', k: 'unidades' }, { t: 'Monto', k: 'monto' }], filas: d.por_familia }])),
        tabla(colsPers, d.top_personas, { vacio: 'Sin despachos a beneficiarios' }))),
    tarjeta('Costo por familia terapéutica', barras(d.por_familia, 'monto', true)));
}

// ----------------------------------------------------------------------------- 4. impacto presupuestario · insumos
function insumos(d, f) {
  const k = d.kpi;
  return h('div', {},
    h('div', { class: 'rejilla' },
      kpi('Insumos entregados', ent(k.unidades), 'unidades'),
      kpi('Costo total', dinero(k.monto), 'a precio de compra'),
      kpi('Costo promedio por persona', dinero(k.personas ? k.monto / k.personas : 0), `${ent(k.personas)} personas`),
      kpi('Insumos promedio por persona', ent(k.personas ? k.unidades / k.personas : 0), 'unidades')),
    dos(
      tarjeta('10 insumos más entregados', barras(d.top_unidades, 'unidades', false, ent)),
      tarjeta('10 insumos con mayor impacto', barras(d.top_monto, 'monto', true))),
    dos(
      tarjeta(unDia(f) ? 'Insumos por hora' : 'Evolución mensual', lineas(serie(d, f), [{ k: 'unidades', t: 'Unidades', c: COLORES[0], fmt: ent }, { k: 'monto', t: 'Costo', c: COLORES[1], fmt: dinero }], 'Evolución de insumos')),
      h('section', { class: 'tarjeta' }, h('div', { class: 'botones' }, h('h2', {}, 'Distribución del costo por sede'), h('span', { class: 'espacio' }),
        btnExcel(nombreArchivo('presupuesto_insumos', f), [{ titulo: 'Más entregados', cols: colsProd, filas: d.top_unidades }, { titulo: 'Mayor costo', cols: colsProd, filas: d.top_monto }])),
        dona(d.por_sede, 'monto', 'Distribución del costo de insumos por sede'))));
}
