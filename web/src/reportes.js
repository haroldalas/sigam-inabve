// SIGAM-INABVE · reportes de traslado: PDF por categoría y Excel para TICS (hoja MIGRAR)
import { descargar } from './ui.js';
import { sb, q, todas } from './api.js';

const SISTEMA = 'SIGAM-INABVE';
const SISTEMA_LARGO = 'Sistema Integrado de Gestión de Abastecimiento Médico';
const INSTITUCION = 'Instituto Administrador de los Beneficios de los Veteranos y Excombatientes';
const DEPTO = 'Departamento de Programas de Salud Integral';
const AZUL = [35, 49, 82], DORADO = [180, 125, 37];
const ORDEN = ['MEDICAMENTO', 'INSUMO MÉDICO', 'PEQUEÑA CIRUGÍA'];

export async function datosTraslado(ids) {
  const enc = await q(sb.from('v_bitacora_traslados').select('*').in('id', ids));
  const lineas = await todas(() => sb.from('v_sivet_traslado').select('*').in('traslado_id', ids).order('traslado_id').order('correlativo'));
  return { enc, lineas };
}

const f2 = v => v ? String(v).slice(0, 10).split('-').reverse().join('/') : '';
const money = v => '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = v => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });

async function imagen(url) {
  const blob = await (await fetch(url)).blob();
  return new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
}

// ----------------------------------------------------------------------------- PDF
export async function pdfTraslado(id) {
  const { enc: [t], lineas } = await datosTraslado([id]);
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'letter' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const logo = await imagen('/img/inabve-blanco.png').catch(() => null);
  const generado = new Date().toLocaleString('es-SV', { timeZone: 'America/El_Salvador' });

  const marco = () => {
    doc.setFillColor(...AZUL); doc.rect(0, 0, W, 19, 'F');
    doc.setFillColor(...DORADO); doc.rect(0, 19, W, 1.2, 'F');
    if (logo) doc.addImage(logo, 'PNG', 10, 2, 15, 15);
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(SISTEMA, 29, 9);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.text(`${SISTEMA_LARGO} · ${DEPTO}`, 29, 14);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(`REPORTE DE TRASLADO ${t.numero}`, W - 10, 9, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.text(INSTITUCION, W - 10, 14, { align: 'right' });
    doc.setTextColor(90); doc.setFontSize(7);
    doc.text(`Generado por ${SISTEMA} el ${generado} · Pendiente de migración a SIVET por TICS`, 10, H - 6);
    doc.text(`Página ${doc.internal.getNumberOfPages()}`, W - 10, H - 6, { align: 'right' });
  };

  autoTable(doc, {
    startY: 25, theme: 'grid', styles: { fontSize: 8, cellPadding: 1.8 },
    columnStyles: { 0: { fillColor: [242, 245, 249], fontStyle: 'bold', cellWidth: 26 }, 2: { fillColor: [242, 245, 249], fontStyle: 'bold', cellWidth: 26 } },
    body: [
      ['Fecha', f2(t.fecha), 'Estado', String(t.estado).replace('_', ' ').toUpperCase()],
      ['Origen', `${t.bodega_origen} · ${t.sede_origen}`, 'Destino', `${t.bodega_destino} · ${t.sede_destino}`],
      ['Enviado por', t.enviado_por || '', 'Recibido por', t.recibido_por || ''],
    ],
    didDrawPage: marco, margin: { top: 25, left: 10, right: 10, bottom: 14 },
  });

  const resumen = [];
  for (const cat of ORDEN) {
    const ls = lineas.filter(l => l.categoria === cat);
    if (!ls.length) continue;
    let y = doc.lastAutoTable.finalY + 7;
    if (y > H - 40) { doc.addPage(); y = 25; }
    doc.setTextColor(...AZUL); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text(`${cat} · ${ls.length} línea(s)`, 10, y);
    const sub = ls.reduce((s, l) => s + Number(l.total), 0), und = ls.reduce((s, l) => s + Number(l.cantidad), 0);
    resumen.push([cat, ls.length, money(sub)]);
    autoTable(doc, {
      startY: y + 2, theme: 'grid', margin: { top: 25, left: 10, right: 10, bottom: 14 },
      headStyles: { fillColor: AZUL, textColor: 255, fontSize: 7.2 }, styles: { fontSize: 7.2, cellPadding: 1.4, overflow: 'linebreak' },
      alternateRowStyles: { fillColor: [247, 249, 252] },
      head: [['#', 'Código', 'Producto', 'Presentación', 'Lote', 'Vence', 'Cant.', 'P. unit.', 'Total', 'Fact.', 'AWaRe', 'Frío', 'Contrato SIVET']],
      body: [...ls.map((l, i) => [i + 1, l.codigo || 's/c', l.nombre_comercial, l.presentacion || '', l.lote || '', f2(l.fecha_vencimiento),
        n0(l.cantidad), money(l.precio), money(l.total), l.factura || '', l.clasificacion_aware || '', l.refrigerado === 'SÍ' ? 'Sí' : '',
        (l.nombre_contrato_sivetweb || '').replaceAll(' - ', ' · ')]),
        [{ content: '', colSpan: 6 }, { content: n0(und), styles: { fontStyle: 'bold' } }, '', { content: money(sub), styles: { fontStyle: 'bold' } }, { content: '', colSpan: 4 }]],
      columnStyles: { 0: { cellWidth: 7 }, 1: { cellWidth: 24 }, 2: { cellWidth: 46 }, 3: { cellWidth: 27 }, 4: { cellWidth: 20 }, 5: { cellWidth: 17 },
        6: { cellWidth: 11, halign: 'right' }, 7: { cellWidth: 15, halign: 'right' }, 8: { cellWidth: 17, halign: 'right' }, 9: { cellWidth: 13 },
        10: { cellWidth: 16 }, 11: { cellWidth: 9 }, 12: { cellWidth: 32 } },
      didDrawPage: marco,
    });
  }
  let y = doc.lastAutoTable.finalY + 8;
  if (y > H - 60) { doc.addPage(); marco(); y = 28; }
  autoTable(doc, {
    startY: y, theme: 'grid', margin: { left: (W - 100) / 2, top: 25, bottom: 14 }, tableWidth: 100,
    headStyles: { fillColor: AZUL }, styles: { fontSize: 8 }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    head: [['Categoría', 'Líneas', 'Monto']],
    body: [...resumen, [{ content: 'TOTAL', styles: { fontStyle: 'bold' } }, { content: String(lineas.length), styles: { fontStyle: 'bold' } },
      { content: money(lineas.reduce((s, l) => s + Number(l.total), 0)), styles: { fontStyle: 'bold' } }]],
    didDrawPage: marco,
  });
  y = doc.lastAutoTable.finalY + 22;
  if (y > H - 22) { doc.addPage(); marco(); y = 45; }
  doc.setDrawColor(0); doc.setTextColor(40); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
  const fw = 72, gap = (W - 20 - 3 * fw) / 2;
  ['Entrega (nombre, firma y sello)', 'Recibe (nombre, firma y sello)', 'Coordinación de Medicamentos e Insumos Médicos'].forEach((txt, i) => {
    const x = 10 + i * (fw + gap);
    doc.line(x, y, x + fw, y); doc.text(txt, x + fw / 2, y + 4, { align: 'center' });
  });
  doc.save(`SIGAM_Traslado_${t.numero}_${t.sede_destino.replace(/\s/g, '')}.pdf`);
}

// ----------------------------------------------------------------------------- Excel para TICS
export async function excelSivet(ids, nombre) {
  const { lineas } = await datosTraslado(ids);
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook(); wb.creator = SISTEMA;
  const ws = wb.addWorksheet('MIGRAR');
  const cols = [['Correlativo', 13], ['Codigo', 22], ['Cantidad', 9.2], ['Precio', 14.2], ['Total', 14.2], ['Factura', 11],
    ['Fecha de factura', 15.7], ['NombreContrato_SIVETWEB', 39.9], ['Lote', 14], ['Fecha de vencimiento', 15.7],
    ['Clasificacion AWaRe', 16], ['Refrigerado', 12], ['Controlado', 12], ['Categoria', 18], ['Traslado', 16]];
  ws.columns = cols.map(([header, width]) => ({ header, width }));
  ws.getRow(1).eachCell(c => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF154782' } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  lineas.forEach((l, i) => {
    const n = i + 2;
    const fila = ws.addRow([i + 1, l.codigo, Number(l.cantidad), Number(l.precio), { formula: `C${n}*D${n}` }, l.factura,
      l.fecha_factura ? new Date(l.fecha_factura + 'T00:00:00') : null, l.nombre_contrato_sivetweb, l.lote,
      l.fecha_vencimiento ? new Date(l.fecha_vencimiento + 'T00:00:00') : null, l.clasificacion_aware || '', l.refrigerado,
      l.controlado, l.categoria, l.numero_traslado]);
    fila.getCell(2).numFmt = '@'; fila.getCell(6).numFmt = '@'; fila.getCell(3).numFmt = '#,##0';
    fila.getCell(4).numFmt = fila.getCell(5).numFmt = '\\$#,##0.00';
    fila.getCell(7).numFmt = fila.getCell(10).numFmt = 'dd/mm/yyyy';
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: 'A1', to: `O${Math.max(lineas.length + 1, 2)}` };
  descargar(await wb.xlsx.writeBuffer(), nombre, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return lineas.length;
}
