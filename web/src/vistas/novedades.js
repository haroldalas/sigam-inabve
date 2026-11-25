// Novedades (usuarios de consulta): medicamentos que llegaron a una sede que no los tenía
import { h, tabla, num, fechaHora, select } from '../ui.js';
import { rpc, estado } from '../api.js';

export const DIAS_NOVEDAD = 30;

export default async function () {
  const filas = await rpc('novedades_medicamentos', { p_dias: DIAS_NOVEDAD });
  let sede = '';
  const zona = h('div');
  const selSede = select([['', 'Todas las sedes'], ...estado.sedes.map(s => [s.id, s.nombre])], sede);
  const pintar = () => {
    const fs = filas.filter(r => !sede || String(r.sede_id) === sede);
    zona.replaceChildren(tabla([
      { t: 'Llegó', f: r => fechaHora(r.fecha), ord: r => r.fecha },
      { t: 'Sede', k: 'sede' },
      { t: 'Producto', f: r => h('div', {}, h('strong', {}, r.producto),
          h('div', { class: 'nota' }, [r.principio_activo, r.presentacion].filter(Boolean).join(' · '))), ord: r => r.producto },
      { t: 'Código', k: 'codigo' },
      { t: 'Disponible hoy', f: r => num(r.existencia), num: true, ord: r => Number(r.existencia) },
      { t: 'Cómo llegó', k: 'origen' },
    ], fs, { vacio: `Ningún medicamento nuevo en los últimos ${DIAS_NOVEDAD} días.` }));
  };
  selSede.onchange = () => { sede = selSede.value; pintar(); };
  pintar();
  return h('section', { class: 'tarjeta' },
    h('p', { class: 'nota' }, `Medicamentos que llegaron en los últimos ${DIAS_NOVEDAD} días a una sede que no los tenía. Para ver dónde hay existencia de cualquier medicamento, use Existencias.`),
    h('div', { class: 'filtros' }, h('label', { class: 'fila-campo' }, h('span', {}, 'Sede'), selSede)),
    zona);
}
