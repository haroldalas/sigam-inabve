// Administración: usuarios, catálogo, mínimos por sede, parámetros y bitácora de cambios
import { h, toast, error, num, fecha, fechaHora, tabla, estadoChip, modal, select, confirmar, chipsProducto, exportarExcel, debounce } from '../ui.js';
import { sb, q, rpc, todas, estado, productos, quitarTildes } from '../api.js';
import { refrescarInsignias } from '../main.js';
import { buscadorProducto } from '../componentes.js';

export default async function (params) {
  let pestana = params.get('ver') || 'usuarios';
  const raiz = h('div');
  const P = [['usuarios', '👥 Usuarios'], ['catalogo', '💊 Catálogo'], ['minimos', '📉 Mínimos por sede'], ['parametros', '⚙️ Parámetros'], ['bitacora', '🕘 Bitácora de cambios']];
  const pintar = async () => {
    raiz.replaceChildren(h('div', { class: 'pestanas' }, P.map(([k, t]) => h('button', { class: pestana === k ? 'activo' : '', onclick: () => { pestana = k; pintar(); } }, t))),
      await ({ usuarios, catalogo, minimos, parametros, bitacora })[pestana]());
  };
  await pintar();
  return raiz;
}

const ROLES = [['administrador', 'Administrador'], ['dependiente', 'Dependiente'], ['consulta', 'Consulta']];

// ----------------------------------------------------------------------------- usuarios
async function usuarios() {
  const filas = await q(sb.from('perfiles').select('*').order('activo', { ascending: false }).order('nombre'));
  const caja = h('section', { class: 'tarjeta' });
  const editar = async (u, nuevo = false) => {
    const email = h('input', { class: 'campo', value: u.email || '', disabled: !nuevo, placeholder: 'usuario@inabve.gob.sv' });
    const nombre = h('input', { class: 'campo', value: u.nombre || '' });
    const rol = select(ROLES, u.rol || 'consulta');
    const sede = select([['', '— ninguna —'], ...estado.sedes.map(s => [s.id, s.nombre])], u.sede_id || '');
    const activo = h('input', { type: 'checkbox', checked: nuevo ? true : u.activo });
    modal(nuevo ? 'Nuevo usuario' : u.email, h('div', {},
      h('label', { class: 'fila-campo' }, h('span', {}, 'Correo institucional'), email),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Nombre completo'), nombre),
      h('div', { class: 'fila' }, h('label', { class: 'fila-campo' }, h('span', {}, 'Rol'), rol), h('label', { class: 'fila-campo' }, h('span', {}, 'Sede'), sede)),
      h('label', { class: 'check' }, activo, 'Acceso habilitado'),
      h('p', { class: 'nota' }, 'Dependiente: opera las bodegas de su sede. Consulta: ve existencias y dónde están (médicos, Contact Center). Administrador: todo.')), {
      acciones: [{ texto: 'Guardar', clase: 'btn-primario', accion: async () => {
        if (rol.value === 'dependiente' && !sede.value) { toast('Un dependiente debe tener sede', 'error'); return false; }
        const datos = { nombre: nombre.value.trim(), rol: rol.value, sede_id: sede.value ? Number(sede.value) : null, activo: activo.checked, ...(activo.checked ? { estado_solicitud: 'aprobada' } : {}) };
        if (nuevo) {
          const e = email.value.trim().toLowerCase();
          if (!/^[^@]+@inabve\.gob\.sv$/.test(e)) { toast('Debe ser un correo @inabve.gob.sv', 'error'); return false; }
          await q(sb.from('perfiles').insert({ email: e, ...datos }));
        } else await q(sb.from('perfiles').update(datos).eq('email', u.email));
        toast('Usuario guardado'); caja.replaceWith(await usuarios());
      } }] });
  };
  const nomSede = id => estado.sedes.find(s => s.id === id)?.nombre || '';
  const buscar = h('input', { class: 'campo', type: 'search', placeholder: 'Buscar por nombre o correo' });
  const zona = h('div');
  const pintar = () => {
    const t = quitarTildes(buscar.value.toLowerCase());
    zona.replaceChildren(tabla([
      { t: 'Nombre', k: 'nombre' }, { t: 'Correo', k: 'email' }, { t: 'Rol', f: r => ROLES.find(x => x[0] === r.rol)?.[1] },
      { t: 'Sede', f: r => nomSede(r.sede_id) }, { t: 'Acceso', f: r => r.activo ? h('span', { class: 'estado st-ok' }, 'Habilitado')
        : r.estado_solicitud === 'pendiente' ? h('span', { class: 'estado st-warn' }, 'Solicitud por revisar')
        : r.estado_solicitud === 'rechazada' ? h('span', { class: 'estado st-danger' }, 'Rechazada')
        : h('span', { class: 'estado st-muted' }, r.id ? 'Ingresó, sin solicitud' : 'Sin acceso') },
      { t: 'Ya ingresó', f: r => r.id ? '✔' : '' }, { t: 'Último acceso', f: r => fechaHora(r.ultimo_acceso) },
    ], filas.filter(r => !t || quitarTildes(`${r.nombre} ${r.email}`.toLowerCase()).includes(t)), { alClic: r => editar(r) }));
  };
  buscar.oninput = debounce(pintar, 200);
  pintar();
  // ---------------------------------------------------------------- solicitudes de acceso
  const solicitudes = filas.filter(r => r.estado_solicitud === 'pendiente').sort((a, b) => String(a.solicitado_at).localeCompare(String(b.solicitado_at)));
  const NOM_ROL = Object.fromEntries(ROLES);
  const resolverSolicitud = u => {
    const rol = select(ROLES, u.rol_solicitado || u.rol_sugerido || 'dependiente');
    const sede = select([['', '— ninguna —'], ...estado.sedes.map(s => [s.id, s.nombre])], u.sede_solicitada || u.sede_id || '');
    modal(`Solicitud de ${u.nombre}`, h('div', {},
      h('div', { class: 'rejilla' },
        kv('Correo', u.email), kv('Cargo', u.cargo || '—'), kv('Teléfono', u.telefono || '—'),
        kv('Sede solicitada', nomSede(u.sede_solicitada) || '—'), kv('Acceso solicitado', NOM_ROL[u.rol_solicitado] || '—'),
        kv('Rol que tenía en SIFAR', NOM_ROL[u.rol_sugerido] || 'No estaba en SIFAR'), kv('Enviada', fechaHora(u.solicitado_at))),
      u.comentario ? h('p', {}, h('strong', {}, 'Comentario: '), u.comentario) : null,
      h('div', { class: 'fila', style: { marginTop: '12px' } }, h('label', { class: 'fila-campo' }, h('span', {}, 'Rol que se asigna'), rol), h('label', { class: 'fila-campo' }, h('span', {}, 'Sede'), sede)),
      h('p', { class: 'nota' }, 'Dependiente: opera las bodegas de su sede. Consulta: ve existencias y dónde están. Administrador: todo.')), {
      acciones: [
        { texto: 'Rechazar', clase: 'btn-peligro', accion: async () => {
          const m = await pedirMotivo(); if (!m) return false;
          await rpc('resolver_solicitud_acceso', { p_email: u.email, p_aprobar: false, p_motivo: m });
          toast('Solicitud rechazada'); refrescarInsignias(); caja.replaceWith(await usuarios());
        } },
        { texto: '✔ Aprobar acceso', clase: 'btn-primario', accion: async () => {
          if (rol.value === 'dependiente' && !sede.value) { toast('Un dependiente debe tener sede', 'error'); return false; }
          await rpc('resolver_solicitud_acceso', { p_email: u.email, p_aprobar: true, p_rol: rol.value, p_sede: sede.value ? Number(sede.value) : null });
          toast(`Acceso aprobado como ${NOM_ROL[rol.value]}`); refrescarInsignias(); caja.replaceWith(await usuarios());
        } }] });
  };
  const zonaSolicitudes = solicitudes.length ? h('div', { class: 'aviso aviso-warn' },
    h('strong', {}, `${solicitudes.length} solicitud(es) de acceso por revisar`),
    tabla([
      { t: 'Enviada', f: r => fechaHora(r.solicitado_at) }, { t: 'Nombre', k: 'nombre' }, { t: 'Correo', k: 'email' }, { t: 'Cargo', k: 'cargo' },
      { t: 'Sede', f: r => nomSede(r.sede_solicitada) }, { t: 'Solicita', f: r => NOM_ROL[r.rol_solicitado] || '' },
      { t: 'En SIFAR', f: r => NOM_ROL[r.rol_sugerido] || '—' },
      { t: '', f: () => h('span', { class: 'btn btn-primario btn-peq' }, 'Revisar') },
    ], solicitudes, { alClic: resolverSolicitud })) : null;

  caja.replaceChildren(zonaSolicitudes, h('div', { class: 'filtros' }, buscar, h('button', { class: 'btn btn-primario', style: { flex: '0 0 auto' }, onclick: () => editar({}, true) }, '➕ Nuevo usuario')),
    h('p', { class: 'nota' }, 'Cada persona entra con su cuenta Microsoft institucional y envía su solicitud (cargo, sede y acceso que necesita). Usted aprueba asignando el rol y la sede, o la rechaza. Clic en un usuario para cambiar su rol, sede o quitarle el acceso.'), zona);
  return caja;
}

const kv = (k, v) => h('div', {}, h('div', { class: 'kpi-titulo' }, k), h('div', {}, v));
function pedirMotivo() {
  return new Promise(res => {
    const t = h('textarea', { class: 'campo', rows: 3 });
    modal('Motivo del rechazo', h('label', { class: 'fila-campo' }, h('span', {}, 'La persona verá este motivo al entrar'), t), {
      acciones: [{ texto: 'Cancelar', clase: 'btn-sec', accion: () => res(null) },
        { texto: 'Rechazar', clase: 'btn-peligro', accion: () => { if (t.value.trim().length < 5) { toast('Escriba el motivo', 'error'); return false; } res(t.value.trim()); } }],
      alCerrar: () => res(null) });
  });
}

// ----------------------------------------------------------------------------- catálogo
async function catalogo() {
  const [familias, ps] = await Promise.all([q(sb.from('familias').select('*').order('nombre')), productos(true)]);
  const caja = h('section', { class: 'tarjeta' });
  const f = { texto: '', filtro: '' };
  const zona = h('div');
  const famNom = id => familias.find(x => x.id === id)?.nombre || '';
  const AW = [['', '— sin clasificar —'], ['acceso', 'Acceso'], ['precaucion', 'Precaución'], ['reserva', 'Reserva'], ['no_recomendado', 'No recomendado'], ['otros', 'Otros']];

  const editar = (p, nuevo = false) => {
    const c = (v, attrs = {}) => h('input', { class: 'campo', value: v ?? '', ...attrs });
    const codigo = c(p.codigo, { disabled: !nuevo && !!p.codigo, placeholder: 'Código de barras / SIVET' });
    const nombre = c(p.nombre_comercial), pa = c(p.principio_activo), conc = c(p.concentracion), pres = c(p.presentacion);
    const fam = select([['', '— sin familia —'], ...familias.map(x => [x.id, x.nombre])], p.familia_id || '');
    const tipo = select([['medicamento', 'Medicamento'], ['insumo', 'Insumo médico']], p.tipo || 'medicamento');
    const aw = select(AW, p.aware || '');
    const frio = h('input', { type: 'checkbox', checked: !!p.cadena_frio }), ctrl = h('input', { type: 'checkbox', checked: !!p.controlado }), act = h('input', { type: 'checkbox', checked: nuevo ? true : p.activo });
    const awZona = h('label', { class: 'fila-campo' }, h('span', {}, 'Clasificación AWaRe (OMS)'), aw);
    const verAw = () => { const esAb = /ANTIBIOTICO/.test(fam.selectedOptions[0]?.text || ''); awZona.style.display = esAb ? '' : 'none'; awZona.firstChild.textContent = famNom(Number(fam.value)) === 'ANTIBIOTICO' ? 'Clasificación AWaRe (OMS) *' : 'Clasificación AWaRe (OMS)'; };
    fam.onchange = verAw; verAw();
    modal(nuevo ? 'Nuevo producto' : p.nombre_comercial, h('div', {},
      h('div', { class: 'fila' }, h('label', { class: 'fila-campo' }, h('span', {}, 'Código'), codigo), h('label', { class: 'fila-campo' }, h('span', {}, 'Tipo'), tipo)),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Nombre comercial'), nombre),
      h('div', { class: 'fila' }, h('label', { class: 'fila-campo' }, h('span', {}, 'Principio activo'), pa), h('label', { class: 'fila-campo' }, h('span', {}, 'Concentración'), conc)),
      h('div', { class: 'fila' }, h('label', { class: 'fila-campo' }, h('span', {}, 'Presentación'), pres), h('label', { class: 'fila-campo' }, h('span', {}, 'Familia'), fam)),
      awZona,
      h('div', { class: 'botones' }, h('label', { class: 'check' }, frio, '❄ Cadena de frío'), h('label', { class: 'check' }, ctrl, 'Controlado'), h('label', { class: 'check' }, act, 'Activo')),
      !nuevo ? h('p', { class: 'nota' }, 'El código no se modifica: es el mismo de SIVET.') : null), {
      acciones: [{ texto: 'Guardar', clase: 'btn-primario', accion: async () => {
        if (!nombre.value.trim()) { toast('El nombre es obligatorio', 'error'); return false; }
        if (famNom(Number(fam.value)) === 'ANTIBIOTICO' && !aw.value) { toast('Elija la clasificación AWaRe del antibiótico', 'error'); return false; }
        const datos = { nombre_comercial: nombre.value.trim(), principio_activo: pa.value.trim() || null, concentracion: conc.value.trim() || null,
          presentacion: pres.value.trim() || null, familia_id: fam.value ? Number(fam.value) : null, tipo: tipo.value, aware: aw.value || null,
          cadena_frio: frio.checked, controlado: ctrl.checked, activo: act.checked, modificado_por: estado.perfil.email, modificado_at: new Date().toISOString() };
        if (nuevo) await q(sb.from('productos').insert({ codigo: codigo.value.trim() || null, ...datos, creado_por: estado.perfil.email }));
        else await q(sb.from('productos').update(datos).eq('id', p.id));
        toast('Producto guardado'); caja.replaceWith(await catalogo());
      } }] });
  };

  const pintar = () => {
    const t = quitarTildes(f.texto.toLowerCase()).split(/\s+/).filter(Boolean);
    const filas = ps.filter(p => (!t.length || t.every(x => quitarTildes(`${p.codigo || ''} ${p.nombre_comercial} ${p.principio_activo || ''}`.toLowerCase()).includes(x)))
      && (f.filtro !== 'awpend' || (/ANTIBIOTICO/.test(famNom(p.familia_id)) && !p.aware)) && (f.filtro !== 'sincod' || !p.codigo)
      && (f.filtro !== 'frio' || p.cadena_frio) && (f.filtro !== 'ctrl' || p.controlado) && (f.filtro !== 'inact' || !p.activo));
    zona.replaceChildren(h('p', { class: 'nota' }, `${filas.length} productos`), tabla([
      { t: 'Código', k: 'codigo' }, { t: 'Producto', f: r => h('div', {}, h('strong', {}, r.nombre_comercial), ' ', chipsProducto(r)), ord: r => r.nombre_comercial },
      { t: 'Principio activo', k: 'principio_activo' }, { t: 'Presentación', k: 'presentacion' }, { t: 'Familia', f: r => famNom(r.familia_id) },
      { t: 'Tipo', f: r => r.tipo === 'insumo' ? 'Insumo' : 'Medicamento' }, { t: 'Estado', f: r => r.activo ? '' : h('span', { class: 'estado st-muted' }, 'Inactivo') },
    ], filas, { alClic: p => editar(p), max: 300 }));
  };
  const buscar = h('input', { class: 'campo', type: 'search', placeholder: 'Buscar' }); buscar.oninput = debounce(() => { f.texto = buscar.value; pintar(); }, 200);
  const fil = select([['', 'Todos'], ['awpend', 'Antibióticos sin AWaRe'], ['sincod', 'Sin código'], ['frio', 'Cadena de frío'], ['ctrl', 'Controlados'], ['inact', 'Inactivos']], '');
  fil.onchange = () => { f.filtro = fil.value; pintar(); };
  pintar();
  caja.replaceChildren(h('div', { class: 'filtros' }, buscar, fil, h('button', { class: 'btn btn-primario', style: { flex: '0 0 auto' }, onclick: () => editar({}, true) }, '➕ Nuevo producto')), zona);
  return caja;
}

// ----------------------------------------------------------------------------- mínimos por sede
async function minimos() {
  const filas = await q(sb.from('stock_minimo').select('*,productos(codigo,nombre_comercial)').order('sede_id'));
  const caja = h('section', { class: 'tarjeta' });
  let prod = null;
  const elegido = h('span', { class: 'nota' }, 'Elija un producto');
  const sede = select(estado.sedes.map(s => [s.id, s.nombre]), estado.sedes[0]?.id);
  const minimo = h('input', { class: 'campo', type: 'number', min: 0 });
  caja.replaceChildren(
    h('p', { class: 'nota' }, 'Opcional. Si se define un mínimo para un producto en una sede, la notificación de «por agotarse» usa ese mínimo en lugar del consumo de 30 días.'),
    buscadorProducto({ alElegir: p => { prod = p; elegido.replaceChildren(h('strong', {}, p.nombre_comercial)); } }),
    h('div', { class: 'fila', style: { marginTop: '8px' } }, h('div', { class: 'fila-campo' }, h('span', {}, 'Producto'), elegido),
      h('label', { class: 'fila-campo' }, h('span', {}, 'Sede'), sede), h('label', { class: 'fila-campo' }, h('span', {}, 'Mínimo'), minimo),
      h('button', { class: 'btn btn-primario', style: { flex: '0 0 auto' }, onclick: async () => {
        if (!prod || minimo.value === '') return toast('Elija el producto y el mínimo', 'error');
        try { await q(sb.from('stock_minimo').upsert({ producto_id: prod.id, sede_id: Number(sede.value), minimo: Number(minimo.value), actualizado_por: estado.perfil.email, actualizado_at: new Date().toISOString() }));
          toast('Mínimo guardado'); caja.replaceWith(await minimos()); } catch (e) { error(e); }
      } }, 'Guardar')),
    h('div', { style: { height: '12px' } }),
    tabla([{ t: 'Sede', f: r => estado.sedes.find(s => s.id === r.sede_id)?.nombre }, { t: 'Código', f: r => r.productos?.codigo }, { t: 'Producto', f: r => r.productos?.nombre_comercial },
      { t: 'Mínimo', k: 'minimo', num: true }, { t: 'Actualizó', f: r => `${r.actualizado_por || ''} ${fecha(r.actualizado_at)}` },
      { t: '', f: r => h('button', { class: 'btn btn-sec btn-peq', onclick: async () => { await q(sb.from('stock_minimo').delete().eq('producto_id', r.producto_id).eq('sede_id', r.sede_id)); caja.replaceWith(await minimos()); } }, 'Quitar') }],
      filas, { vacio: 'No hay mínimos definidos: se usa el consumo de 30 días' }));
  return caja;
}

// ----------------------------------------------------------------------------- parámetros
async function parametros() {
  const filas = await q(sb.from('parametros').select('*').order('clave'));
  const caja = h('section', { class: 'tarjeta' });
  caja.replaceChildren(...filas.map(p => {
    const i = h('input', { class: 'campo', value: p.valor });
    return h('div', { class: 'fila', style: { marginBottom: '10px' } },
      h('label', { class: 'fila-campo', style: { flex: '3 1 300px' } }, h('span', {}, p.descripcion || p.clave), i),
      h('button', { class: 'btn btn-sec', style: { flex: '0 0 auto' }, onclick: async () => {
        try { await q(sb.from('parametros').update({ valor: i.value.trim() }).eq('clave', p.clave)); toast('Parámetro guardado'); } catch (e) { error(e); }
      } }, 'Guardar'));
  }));
  return caja;
}

// ----------------------------------------------------------------------------- bitácora de cambios
async function bitacora() {
  const filas = await q(sb.from('auditoria').select('*').order('id', { ascending: false }).limit(1000));
  const tablas = [...new Set(filas.map(r => r.tabla))].sort();
  const selT = select([['', 'Todas'], ...tablas.map(t => [t, t])], '');
  const zona = h('div');
  const NOMBRES = { productos: 'Catálogo', perfiles: 'Usuarios', parametros: 'Parámetros', proveedores: 'Proveedores', contratos: 'Contratos', bodegas: 'Bodegas', sedes: 'Sedes', familias: 'Familias', stock_minimo: 'Mínimos', facturas: 'Facturas' };
  const pintar = () => {
    const fs = filas.filter(r => !selT.value || r.tabla === selT.value);
    zona.replaceChildren(tabla([
      { t: 'Fecha', f: r => fechaHora(r.fecha) }, { t: 'Usuario', k: 'usuario' }, { t: 'Módulo', f: r => NOMBRES[r.tabla] || r.tabla },
      { t: 'Acción', f: r => ({ INSERT: 'Creó', UPDATE: 'Modificó', DELETE: 'Eliminó' })[r.operacion] },
      { t: 'Registro', f: r => r.despues?.nombre_comercial || r.despues?.nombre || r.antes?.nombre_comercial || r.registro },
      { t: 'Campos', f: r => (r.campos || []).join(', ') },
    ], fs, { alClic: r => modal(`${NOMBRES[r.tabla] || r.tabla} · ${fechaHora(r.fecha)}`, tabla([{ t: 'Campo', k: 'c' }, { t: 'Antes', k: 'a' }, { t: 'Después', k: 'd' }],
      (r.campos || Object.keys(r.despues || r.antes || {})).map(c => ({ c, a: fmt(r.antes?.[c]), d: fmt(r.despues?.[c]) }))), { ancho: '800px' }), max: 300 }));
  };
  const fmt = v => v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  selT.onchange = pintar; pintar();
  return h('section', { class: 'tarjeta' }, h('div', { class: 'filtros' }, h('label', { class: 'fila-campo' }, h('span', {}, 'Módulo'), selT),
    h('button', { class: 'btn btn-sec', style: { flex: '0 0 auto' }, onclick: () => exportarExcel('SIGAM_bitacora_cambios', [{ titulo: 'Bitácora', filas, cols: [
      { t: 'fecha', k: 'fecha' }, { t: 'usuario', k: 'usuario' }, { t: 'tabla', k: 'tabla' }, { t: 'operacion', k: 'operacion' }, { t: 'registro', k: 'registro' },
      { t: 'campos', exportar: r => (r.campos || []).join(', ') }, { t: 'antes', exportar: r => JSON.stringify(r.antes) }, { t: 'despues', exportar: r => JSON.stringify(r.despues) }] }]) }, '⬇ Excel')), zona);
}
