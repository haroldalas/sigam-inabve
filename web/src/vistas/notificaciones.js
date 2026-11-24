// Notificaciones por sede: productos por vencer y productos agotándose
import { h, tabla, num, ent, fecha, dinero, estadoChip, exportarExcel, cargando, select, TIPO_BODEGA } from '../ui.js';
import { sb, q, todas, estado, esDependiente } from '../api.js';

export default async function () {
  let sedeSel = esDependiente() ? estado.perfil.sede_id : null;
  let pestana = 'vencimiento';
  let filtroNivel = '', filtroTipo = '';
  const tarjetas = h('div', { class: 'rejilla' });
  const zona = h('div');
  const [resumen, venc, abas] = await Promise.all([
    q(sb.from('v_notif_resumen').select('*')),
    todas(() => sb.from('v_notif_vencimiento').select('*').order('fecha_vencimiento')),
    todas(() => sb.from('v_notif_abastecimiento').select('*').order('dias_cobertura', { nullsFirst: true })),
  ]);

  const total = k => resumen.reduce((s, r) => s + Number(r[k]), 0);
  const pintarTarjetas = () => {
    const card = (r, titulo) => h('div', { class: 'kpi sede-card' + (sedeSel === (r?.sede_id ?? null) ? ' sel' : ''),
      onclick: () => { sedeSel = r?.sede_id ?? null; pintarTarjetas(); pintarZona(); } },
      h('h3', {}, titulo),
      h('div', { class: 'contadores' },
        cont('Vencidos', r ? r.vencidos : total('vencidos'), 'c-danger'),
        cont('Agotados', r ? r.agotados : total('agotados'), 'c-danger'),
        cont('Vencen ≤ 90 d', r ? r.vencen_90_dias : total('vencen_90_dias'), 'c-danger'),
        cont('Cobertura crítica', r ? r.cobertura_critica : total('cobertura_critica'), 'c-danger'),
        cont('Vencen ≤ 6 m', r ? r.vencen_180_dias : total('vencen_180_dias'), 'c-warn'),
        cont('Por agotarse', r ? r.por_agotarse : total('por_agotarse'), 'c-warn')));
    tarjetas.replaceChildren(card(null, 'Todas las sedes'), ...resumen.map(r => card(r, r.sede)));
  };
  const cont = (t, n, c) => h('div', { class: 'contador ' + (Number(n) ? c : '') }, h('span', {}, t), h('b', {}, ent(n)));

  const pintarZona = () => {
    const nombreSede = sedeSel ? estado.sedes.find(s => s.id === sedeSel)?.nombre : 'todas las sedes';
    const pest = h('div', { class: 'pestanas' },
      boton('vencimiento', `Por vencer o vencidos (${venc.filter(f => !sedeSel || f.sede_id === sedeSel).length})`),
      boton('abastecimiento', `Agotados o por agotarse (${abas.filter(f => !sedeSel || f.sede_id === sedeSel).length})`));
    const niveles = pestana === 'vencimiento'
      ? [['', 'Todos'], ['vencido', 'Vencidos'], ['critico', 'Vencen en 90 días o menos'], ['por_vencer', 'Vencen en 6 meses o menos']]
      : [['', 'Todos'], ['agotado', 'Agotados'], ['critico', 'Cobertura crítica (< 15 días)'], ['por_agotarse', 'Por agotarse (< 30 días)']];
    const selNivel = select(niveles, filtroNivel); selNivel.onchange = () => { filtroNivel = selNivel.value; pintarZona(); };
    const selTipo = select([['', 'Medicamentos e insumos'], ['medicamento', 'Medicamentos'], ['insumo', 'Insumos médicos']], filtroTipo);
    selTipo.onchange = () => { filtroTipo = selTipo.value; pintarZona(); };

    let filas, cols;
    if (pestana === 'vencimiento') {
      filas = venc.filter(f => (!sedeSel || f.sede_id === sedeSel) && (!filtroNivel || f.nivel === filtroNivel) && (!filtroTipo || f.tipo === filtroTipo));
      cols = [
        { t: 'Estado', f: r => estadoChip(r.nivel), exportar: r => r.nivel, ord: r => r.fecha_vencimiento },
        { t: 'Sede', k: 'sede' }, { t: 'Bodega', k: 'bodega', ancho_xl: 34 },
        { t: 'Código', k: 'codigo' }, { t: 'Producto', k: 'nombre_comercial', ancho_xl: 40 },
        { t: 'Lote', k: 'numero_lote' },
        { t: 'Vence', f: r => fecha(r.fecha_vencimiento), exportar: r => r.fecha_vencimiento, ord: r => r.fecha_vencimiento },
        { t: 'Días', k: 'dias_para_vencer', num: true },
        { t: 'Existencia', k: 'disponible', num: true }, { t: 'Valor', f: r => dinero(r.valor), num: true, exportar: r => Number(r.valor), ord: r => Number(r.valor) },
        { t: 'Proveedor', k: 'proveedor' },
      ];
    } else {
      filas = abas.filter(f => (!sedeSel || f.sede_id === sedeSel) && (!filtroNivel || f.nivel === filtroNivel) && (!filtroTipo || f.tipo === filtroTipo));
      cols = [
        { t: 'Estado', f: r => estadoChip(r.nivel, r.nivel === 'agotado' ? 'agotado_n' : null), exportar: r => r.nivel, ord: r => Number(r.dias_cobertura ?? -1) },
        { t: 'Sede', k: 'sede' }, { t: 'Código', k: 'codigo' }, { t: 'Producto', k: 'nombre_comercial', ancho_xl: 40 },
        { t: 'Existencia', k: 'disponible', num: true }, { t: 'En tránsito', k: 'en_transito', num: true },
        { t: 'Consumo 30 d', k: 'consumo_30d', num: true },
        { t: 'Alcanza (días)', f: r => r.dias_cobertura === null ? '—' : num(r.dias_cobertura), num: true, exportar: r => r.dias_cobertura, ord: r => Number(r.dias_cobertura ?? -1) },
        { t: 'Mínimo', k: 'minimo', num: true },
        { t: 'Sugerido (60 d)', k: 'sugerido_60_dias', num: true },
        { t: 'En bodega central', k: 'disponible_central', num: true },
      ];
    }
    zona.replaceChildren(h('section', { class: 'tarjeta' },
      pest,
      h('div', { class: 'filtros' },
        h('div', { class: 'fila-campo' }, h('span', {}, 'Mostrando'), h('strong', { style: { color: 'var(--azul)', padding: '9px 0' } }, nombreSede)),
        h('label', { class: 'fila-campo' }, h('span', {}, 'Nivel'), selNivel),
        h('label', { class: 'fila-campo' }, h('span', {}, 'Tipo'), selTipo),
        h('button', { class: 'btn btn-sec', style: { flex: '0 0 auto' }, onclick: () => exportarExcel(
          `SIGAM_notificaciones_${pestana}_${(nombreSede || '').replace(/\s/g, '')}`, [{ titulo: pestana, cols, filas }]) }, '⬇ Excel')),
      pestana === 'abastecimiento' ? h('p', { class: 'nota' },
        'Se calcula con el consumo de los últimos 30 días de cada sede (todas sus bodegas). Si se define un mínimo por producto y sede en Administración, se usa ese mínimo.') : null,
      tabla(cols, filas, { vacio: 'Sin alertas con estos filtros', claseFila: r => ['vencido', 'agotado'].includes(r.nivel) ? 'fila-peligro' : r.nivel === 'critico' ? 'fila-aviso' : '' })));
  };
  const boton = (k, t) => h('button', { class: pestana === k ? 'activo' : '', onclick: () => { pestana = k; filtroNivel = ''; pintarZona(); } }, t);

  pintarTarjetas(); pintarZona();
  return h('div', {}, tarjetas, h('div', { style: { height: '14px' } }), zona);
}
