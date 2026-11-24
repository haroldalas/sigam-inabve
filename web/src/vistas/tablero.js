// Tablero de consumo y gasto (base para las prioritarias quincenales)
import { h, num, ent, dinero, tabla, exportarExcel, select } from '../ui.js';
import { sb, todas, estado } from '../api.js';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const etMes = m => { const [y, mm] = m.split('-'); return `${MESES[Number(mm) - 1]} ${y.slice(2)}`; };

export default async function () {
  const datos = await todas(() => sb.from('v_consumo_diario').select('*').order('fecha'));
  const meses = [...new Set(datos.map(d => d.mes))].sort();
  const f = { mes: meses[meses.length - 1] || '', quincena: '', sede: '', tipo: '' };
  const zona = h('div');

  const pintar = async () => {
    const base = datos.filter(d => (!f.sede || String(d.sede_id) === f.sede) && (!f.tipo || d.tipo_producto === f.tipo));
    const per = base.filter(d => (!f.mes || d.mes === f.mes) && (!f.quincena || String(d.quincena) === f.quincena));
    const suma = (fs, k) => fs.reduce((s, r) => s + Number(r[k] || 0), 0);
    const agrupar = (fs, k) => { const m = new Map(); fs.forEach(r => { const x = m.get(r[k]) || { clave: r[k], monto: 0, unidades: 0, despachos: 0 }; x.monto += Number(r.monto); x.unidades += Number(r.unidades); x.despachos += Number(r.despachos); m.set(r[k], x); }); return [...m.values()].sort((a, b) => b.monto - a.monto); };

    // serie por quincena (todos los meses, con filtros de sede y tipo)
    const serie = [];
    meses.forEach(m => [1, 2].forEach(qn => { const fs = base.filter(d => d.mes === m && d.quincena === qn); serie.push({ et: `${etMes(m)} ${qn === 1 ? '1-15' : '16-fin'}`, q: qn, monto: suma(fs, 'monto') }); }));
    const maxS = Math.max(1, ...serie.map(s => s.monto));
    const barras = (fs, maxN = 10, dorado = false) => { const mx = Math.max(1, ...fs.map(x => x.monto)); return h('div', { class: 'barras' }, fs.slice(0, maxN).map(x =>
      h('div', { class: 'barra' }, h('span', { title: x.clave }, String(x.clave).slice(0, 28)), h('div', { class: 'barra-pista' }, h('div', { class: 'barra-relleno' + (dorado ? ' dorado' : ''), style: { width: `${100 * x.monto / mx}%` } })), h('strong', { class: 'derecha' }, dinero(x.monto))))); };

    // productos del período
    let top = [];
    if (f.mes) {
      let c = () => { let x = sb.from('v_consumo_producto').select('*').eq('mes', f.mes); if (f.tipo) x = x.eq('tipo', f.tipo); return x; };
      top = await todas(c);
      if (f.sede) top = top.filter(r => r.sede === estado.sedes.find(s => String(s.id) === f.sede)?.nombre);
      const m = new Map(); top.forEach(r => { const x = m.get(r.producto_id) || { ...r, unidades: 0, monto: 0, despachos: 0 }; x.unidades += Number(r.unidades); x.monto += Number(r.monto); x.despachos += Number(r.despachos); m.set(r.producto_id, x); });
      top = [...m.values()].sort((a, b) => b.monto - a.monto);
    }
    const colsTop = [{ t: 'Código', k: 'codigo' }, { t: 'Producto', k: 'nombre_comercial' }, { t: 'Tipo', k: 'tipo' },
      { t: 'Unidades', k: 'unidades', num: true }, { t: 'Despachos', k: 'despachos', num: true }, { t: 'Monto', f: r => dinero(r.monto), num: true, exportar: r => r.monto, ord: r => r.monto }];

    zona.replaceChildren(
      h('div', { class: 'rejilla' },
        kpi('Monto despachado', dinero(suma(per, 'monto')), 'a precio de compra'),
        kpi('Unidades', ent(suma(per, 'unidades')), 'unidades de dispensación'),
        kpi('Despachos', ent(suma(per, 'despachos')), 'recetas atendidas'),
        kpi('Beneficiarios', ent(suma(per, 'beneficiarios')), 'distintos por día y sede')),
      h('section', { class: 'tarjeta', style: { marginTop: '14px' } }, h('h2', {}, 'Monto por quincena'),
        h('div', { class: 'columnas', role: 'img', 'aria-label': 'Monto despachado por quincena' }, serie.map(s => h('div', { class: 'columna', title: `${s.et}: ${dinero(s.monto)}` },
          h('div', { class: 'columna-barra' + (s.q === 2 ? ' q2' : ''), style: { height: `${100 * s.monto / maxS}%` } }), h('span', { class: 'columna-et' }, s.et.split(' ').slice(0, 2).join(' '))))),
        h('div', { class: 'leyenda' }, h('span', {}, h('i', { style: { background: 'var(--azul)' } }), 'Días 1 a 15'), h('span', {}, h('i', { style: { background: 'var(--dorado)' } }), 'Días 16 a fin de mes'))),
      h('div', { class: 'rejilla', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))' } },
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Por sede'), barras(agrupar(per, 'sede'))),
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Por proveedor'), barras(agrupar(per, 'proveedor'), 10, true)),
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Por familia terapéutica'), barras(agrupar(per, 'familia'), 12)),
        h('section', { class: 'tarjeta' }, h('h2', {}, 'Por tipo de bodega'), barras(agrupar(per, 'tipo_bodega').map(x => ({ ...x, clave: String(x.clave).replace(/_/g, ' ') })), 6, true))),
      h('section', { class: 'tarjeta' }, h('div', { class: 'botones' }, h('h2', {}, `Productos más despachados · ${f.mes ? etMes(f.mes) : ''}`), h('span', { class: 'espacio' }),
        h('button', { class: 'btn btn-sec btn-peq', onclick: () => exportarExcel(`SIGAM_consumo_${f.mes}`, [
          { titulo: 'Productos', cols: colsTop, filas: top },
          { titulo: 'Detalle diario', filas: per, cols: ['fecha', 'quincena', 'sede', 'tipo_bodega', 'tipo_producto', 'familia', 'proveedor', 'despachos', 'beneficiarios', 'unidades', 'monto'].map(k => ({ t: k, k })) }]) }, '⬇ Excel')),
        tabla(colsTop, top.slice(0, 30))));
  };
  const kpi = (t, v, s) => h('div', { class: 'kpi' }, h('div', { class: 'kpi-titulo' }, t), h('div', { class: 'kpi-valor' }, v), h('div', { class: 'kpi-sub' }, s));
  const sel = (k, o) => { const s = select(o, f[k]); s.onchange = () => { f[k] = s.value; pintar(); }; return s; };

  await pintar();
  return h('div', {},
    h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' },
      h('label', { class: 'fila-campo' }, h('span', {}, 'Mes'), sel('mes', [['', 'Todos'], ...meses.map(m => [m, etMes(m)])])),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Quincena'), sel('quincena', [['', 'Mes completo'], ['1', 'Días 1 a 15'], ['2', 'Días 16 a fin']])),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Sede'), sel('sede', [['', 'Todas'], ...estado.sedes.map(s => [s.id, s.nombre])])),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Tipo'), sel('tipo', [['', 'Todos'], ['medicamento', 'Medicamentos'], ['insumo', 'Insumos médicos']]))),
      h('p', { class: 'nota' }, 'Incluye los despachos registrados en SIGAM (y los migrados de SIFAR). Montos a precio de compra del lote entregado.')),
    zona);
}
