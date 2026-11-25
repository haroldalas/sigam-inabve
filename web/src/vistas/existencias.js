// Consulta de existencias en todas las sedes (médicos, Contact Center, dependientes, administración)
import { h, tabla, num, fecha, dinero, chipsProducto, modal, exportarExcel, select, debounce, estadoChip, TIPO_BODEGA } from '../ui.js';
import { sb, todas, estado, quitarTildes } from '../api.js';

export default async function () {
  const lotes = await todas(() => sb.from('v_existencias').select('*').order('producto_id'));
  const familias = [...new Set(lotes.map(l => l.familia).filter(Boolean))].sort();
  const proveedores = [...new Set(lotes.map(l => l.proveedor).filter(Boolean))].sort();
  const f = { texto: '', sede: '', tipoBodega: '', tipo: '', familia: '', proveedor: '', venc: '' };
  const zona = h('div');

  const filtrar = () => {
    const t = quitarTildes(f.texto.toLowerCase()).split(/\s+/).filter(Boolean);
    return lotes.filter(l =>
      (!f.sede || String(l.sede_id) === f.sede) && (f.tipoBodega ? l.tipo_bodega === f.tipoBodega : l.tipo_bodega !== 'descarte') &&
      (!f.tipo || l.tipo === f.tipo) && (!f.familia || l.familia === f.familia) && (!f.proveedor || l.proveedor === f.proveedor) &&
      (!f.venc || (f.venc === '180' ? l.dias_para_vencer !== null && l.dias_para_vencer <= 180 : l.dias_para_vencer !== null && l.dias_para_vencer < 0)) &&
      (!t.length || t.every(x => quitarTildes(`${l.codigo || ''} ${l.nombre_comercial} ${l.principio_activo || ''}`.toLowerCase()).includes(x))));
  };

  const pintar = () => {
    const fs = filtrar();
    const porProd = new Map();
    for (const l of fs) {
      let p = porProd.get(l.producto_id);
      if (!p) porProd.set(l.producto_id, p = { ...l, total: 0, sedes: {}, lotes: [] });
      p.total += Number(l.disponible); p.sedes[l.sede_id] = (p.sedes[l.sede_id] || 0) + Number(l.disponible); p.lotes.push(l);
    }
    const filas = [...porProd.values()].sort((a, b) => a.nombre_comercial.localeCompare(b.nombre_comercial));
    const cols = [
      { t: 'Código', k: 'codigo' },
      { t: 'Producto', f: r => h('div', {}, h('strong', {}, r.nombre_comercial), ' ', chipsProducto({ aware: r.aware, cadena_frio: r.cadena_frio, controlado: r.controlado }),
        h('div', { class: 'nota' }, [r.principio_activo, r.presentacion].filter(Boolean).join(' · '))), ord: r => r.nombre_comercial },
      ...estado.sedes.map(s => ({ t: s.nombre, f: r => num(r.sedes[s.id] || 0), num: true, ord: r => r.sedes[s.id] || 0 })),
      { t: 'Total', f: r => h('strong', {}, num(r.total)), num: true, ord: r => r.total },
      { t: 'Próximo vencimiento', f: r => fecha(r.lotes.map(l => l.fecha_vencimiento).filter(Boolean).sort()[0]), ord: r => r.lotes.map(l => l.fecha_vencimiento).filter(Boolean).sort()[0] },
    ];
    zona.replaceChildren(
      h('p', { class: 'nota' }, `${filas.length} productos · ${fs.length} lotes · valor ${dinero(fs.reduce((s, l) => s + Number(l.valor), 0))}`),
      tabla(cols, filas, { alClic: detalle, vacio: 'No hay productos con existencia para estos filtros', max: 300 }));
  };

  const detalle = p => {
    const cols = [
      { t: 'Sede', k: 'sede' }, { t: 'Bodega', k: 'bodega' }, { t: 'Lote', k: 'numero_lote' },
      { t: 'Vence', f: r => fecha(r.fecha_vencimiento) }, { t: 'Días', k: 'dias_para_vencer', num: true },
      { t: 'Disponible', k: 'disponible', num: true }, { t: 'Proveedor', k: 'proveedor' }, { t: 'Factura', k: 'factura' },
      { t: 'Estado', f: r => estadoChip(r.estado) },
    ];
    modal(p.nombre_comercial, h('div', {},
      h('p', {}, [p.codigo, p.principio_activo, p.presentacion, p.familia].filter(Boolean).join(' · '), ' ', chipsProducto({ aware: p.aware, cadena_frio: p.cadena_frio, controlado: p.controlado })),
      tabla(cols, p.lotes.sort((a, b) => (a.sede_id - b.sede_id) || String(a.fecha_vencimiento).localeCompare(String(b.fecha_vencimiento))),
        { claseFila: r => r.alerta_vencimiento === 'VENCIDO' ? 'fila-peligro' : r.alerta_vencimiento ? 'fila-aviso' : '' })), { ancho: '1000px' });
  };

  const inp = h('input', { class: 'campo campo-busqueda', type: 'search', placeholder: 'Nombre, código o principio activo', autofocus: true });
  inp.addEventListener('input', debounce(() => { f.texto = inp.value; pintar(); }, 200));
  const sel = (k, opts) => { const s = select(opts, f[k]); s.onchange = () => { f[k] = s.value; pintar(); }; return s; };
  const exportar = () => {
    const cols = ['sede', 'bodega', 'codigo', 'nombre_comercial', 'principio_activo', 'presentacion', 'familia', 'tipo', 'aware',
      'proveedor', 'factura', 'numero_lote', 'fecha_vencimiento', 'dias_para_vencer', 'disponible', 'precio_unitario', 'valor']
      .map(k => ({ t: k, k }));
    exportarExcel('SIGAM_existencias', [{ titulo: 'Existencias', cols, filas: filtrar() }]);
  };

  pintar();
  return h('div', {},
    h('section', { class: 'tarjeta' },
      h('div', { class: 'filtros' },
        h('label', { class: 'fila-campo', style: { flex: '2 1 300px' } }, h('span', {}, 'Buscar producto'), inp),
        h('label', { class: 'fila-campo' }, h('span', {}, 'Sede'), sel('sede', [['', 'Todas'], ...estado.sedes.map(s => [s.id, s.nombre])])),
        h('label', { class: 'fila-campo' }, h('span', {}, 'Bodega'), sel('tipoBodega', [['', 'Todas (sin Descarte)'], ...Object.entries(TIPO_BODEGA).filter(([k]) => k !== 'descarte' || estado.perfil.rol === 'administrador')])),
        h('label', { class: 'fila-campo' }, h('span', {}, 'Tipo'), sel('tipo', [['', 'Todos'], ['medicamento', 'Medicamentos'], ['insumo', 'Insumos médicos']])),
        h('label', { class: 'fila-campo' }, h('span', {}, 'Familia'), sel('familia', [['', 'Todas'], ...familias.map(x => [x, x])])),
        h('label', { class: 'fila-campo' }, h('span', {}, 'Proveedor'), sel('proveedor', [['', 'Todos'], ...proveedores.map(x => [x, x])])),
        h('label', { class: 'fila-campo' }, h('span', {}, 'Vencimiento'), sel('venc', [['', 'Todos'], ['180', '6 meses o menos'], ['vencido', 'Vencidos']])),
        h('button', { class: 'btn btn-sec', style: { flex: '0 0 auto' }, onclick: exportar }, '⬇ Excel')),
      h('p', { class: 'nota' }, 'Solo se muestran productos con existencia. Toque un producto para ver sus lotes y vencimientos por bodega.'),
      zona));
}
