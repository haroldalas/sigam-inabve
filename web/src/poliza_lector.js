// Lectura de pólizas de concentración de facturas (CEFAFA) desde PDF escaneado o foto.
// 1) Cada página se convierte en imagen, se limpia (gris + umbral) y se lee con OCR (tesseract.js,
//    servido desde /ocr en el mismo sitio).  2) El texto se interpreta línea por línea.
// Cada línea se valida con la aritmética de la póliza: IVA retenido = 1 % de (monto ÷ 1.13) y
// líquido = monto − IVA. Basta con leer bien un monto para reconstruir los otros; si dos lecturas
// independientes coinciden, la línea queda "verificada"; si no, queda para revisar a mano.

export const TASA_RETENCION = 0.01 / 1.13;
const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
const casi = (a, b) => a !== null && b !== null && Math.abs(a - b) <= 0.011;

export function calcularDesdeMonto(monto) {
  const iva = r2(monto * TASA_RETENCION);
  return { monto: r2(monto), iva, liquido: r2(monto - iva) };
}

// "41,917.71" · "997:54" · "1.234,56" → número
export function aNumero(s) {
  if (s === null || s === undefined) return null;
  let t = String(s).replace(/[$\s]/g, '').replace(':', '.');
  if (/^\d{1,3}(\.\d{3})+,\d{2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d{2}$/.test(t)) t = t.replace(',', '.');
  else t = t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const RE_MONTO = /(?<![\d/])(\d{1,3}(?:,\d{3})+|\d{1,6})[.,:](\d{2})(?![\d/])/g;
const RE_FECHA = /(\d{1,2})\s*[/\-]\s*(\d{1,2})\s*[/\-]\s*(\d{4})/;

// Elige el monto facturado que mejor explica los importes leídos en la línea
export function resolverMontos(leidos) {
  const cands = new Set();
  leidos.forEach(a => {
    cands.add(r2(a));                              // el importe es el monto
    cands.add(r2(a / (1 - TASA_RETENCION)));       // el importe es el líquido
  });
  if (leidos.length >= 2) cands.add(r2(leidos[leidos.length - 1] + leidos[leidos.length - 2]));   // líquido + IVA
  let mejor = null;
  for (const m of cands) {
    if (!(m > 0)) continue;
    const c = calcularDesdeMonto(m);
    // monto y líquido son lecturas independientes; el IVA (1 %) casi no distingue montos parecidos
    let fuertes = 0, debil = 0;
    for (const a of leidos) {
      if (casi(a, c.monto) || casi(a, c.liquido)) fuertes++;
      else if (a < 100 && casi(a, c.iva)) debil++;
    }
    const directo = leidos.some(a => Math.abs(a - c.monto) < 0.001);
    const puntaje = fuertes * 10 + debil * 3 + (directo ? 1 : 0);
    if (!mejor || puntaje > mejor.puntaje) mejor = { ...c, puntos: fuertes, puntaje };
  }
  return mejor;
}

function fechaISO(m) {
  if (!m) return null;
  const d = Number(m[1]), mes = Number(m[2]), a = Number(m[3]);
  if (d < 1 || d > 31 || mes < 1 || mes > 12 || a < 2020 || a > 2100) return null;
  return `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const MESES = { ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, SETIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12 };

export function analizarTexto(texto) {
  const res = { numero: null, desde: null, hasta: null, total: null, filas: [] };
  const lineas = String(texto || '').split(/\r?\n/);
  const todo = lineas.join(' ').toUpperCase();

  const num = todo.match(/\bP\s?[O0]?\s?(\d{6})\b/);
  if (num) res.numero = 'P' + num[1].replace(/O/g, '0');
  const per = todo.match(/DEL\s+(\d{1,2})\s+AL\s+(\d{1,2})\s+DEL?\s+(?:MES\s+DE\s+)?([A-Z]+)\s+DE\s+(\d{4})/);
  if (per && MESES[per[3]]) {
    const mm = String(MESES[per[3]]).padStart(2, '0');
    res.desde = `${per[4]}-${mm}-${per[1].padStart(2, '0')}`;
    res.hasta = `${per[4]}-${mm}-${per[2].padStart(2, '0')}`;
  }

  for (const original of lineas) {
    const linea = original.replace(/[|\[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!linea) continue;
    const montos = [...linea.matchAll(RE_MONTO)];
    if (/\bTOTAL\b/i.test(linea) && montos.length) {
      const vals = montos.map(m => aNumero(m[0]));
      const r = resolverMontos(vals);
      res.total = { monto: vals[0] ?? null, iva: vals[1] ?? null, liquido: vals[2] ?? null, verificado: r?.puntos >= 2 };
      continue;
    }
    if (!montos.length) continue;
    const mf = linea.match(RE_FECHA);
    const corte = montos[0].index;
    // número de factura: último entero de 3 a 6 dígitos antes del primer importe y después de la fecha
    const inicio = mf ? mf.index + mf[0].length : 0;
    const tramo = linea.slice(inicio, corte);
    const enteros = [...tramo.matchAll(/(?<![\d.,/])(\d{3,6})(?![\d.,/])/g)].map(m => m[1]);
    if (!enteros.length) continue;
    const factura = enteros[enteros.length - 1];
    const leidos = montos.map(m => aNumero(m[0])).filter(v => v !== null && v > 0);
    const r = resolverMontos(leidos);
    if (!r) continue;
    res.filas.push({
      factura, fecha: fechaISO(mf), monto: r.monto, iva: r.iva, liquido: r.liquido,
      verificado: r.puntos >= 2, leidos, origen: 'ocr',
    });
  }

  // si una factura aparece dos veces (dos lecturas de la misma línea) se queda la más confiable
  const porFactura = new Map();
  for (const f of res.filas) {
    const prev = porFactura.get(f.factura);
    if (!prev || (f.verificado && !prev.verificado)) porFactura.set(f.factura, f);
  }
  res.filas = [...porFactura.values()];
  // los números de factura de una póliza tienen casi siempre la misma cantidad de dígitos:
  // un dígito de más al inicio suele ser una raya de la tabla leída como "1" o "7"
  const largos = {}; res.filas.forEach(f => { largos[f.factura.length] = (largos[f.factura.length] || 0) + 1; });
  const comun = Number(Object.entries(largos).sort((a, b) => b[1] - a[1])[0]?.[0] || 0);
  for (const f of res.filas) {
    if (f.factura.length === comun + 1 && /^[17]/.test(f.factura)) { f.factura = f.factura.slice(1); f.verificado = false; }
    else if (f.factura.length !== comun) f.verificado = false;
  }
  // completar fechas faltantes con la fecha de la línea anterior (las pólizas vienen ordenadas)
  let ultima = null;
  for (const f of res.filas) { if (f.fecha) ultima = f.fecha; else if (ultima) { f.fecha = ultima; f.fechaInferida = true; } }
  return res;
}

// ------------------------------------------------------------------ OCR en el navegador
async function paginasComoCanvas(file, alAvanzar) {
  const canvases = [];
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const pdfjs = await import('pdfjs-dist');
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
    for (let i = 1; i <= doc.numPages; i++) {
      alAvanzar?.(`Preparando página ${i} de ${doc.numPages}…`);
      const pag = await doc.getPage(i);
      const base = pag.getViewport({ scale: 1 });
      const vp = pag.getViewport({ scale: Math.min(4, 2600 / base.width) });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
      await pag.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      canvases.push(c);
    }
  } else {
    const bmp = await createImageBitmap(file);
    const esc = Math.min(3, 2600 / bmp.width);
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * esc); c.height = Math.round(bmp.height * esc);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    canvases.push(c);
  }
  return canvases.map(limpiar);
}

// Gris + umbral de Otsu: mejora mucho la lectura de escaneos y fotos
function limpiar(c) {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, c.width, c.height); const d = img.data;
  const hist = new Array(256).fill(0); const gris = new Uint8ClampedArray(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) { const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; gris[j] = g; hist[g]++; }
  const total = gris.length; let suma = 0; for (let t = 0; t < 256; t++) suma += t * hist[t];
  let sB = 0, wB = 0, max = 0, umbral = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue; const wF = total - wB; if (!wF) break;
    sB += t * hist[t]; const mB = sB / wB, mF = (suma - sB) / wF; const v = wB * wF * (mB - mF) ** 2;
    if (v > max) { max = v; umbral = t; }
  }
  for (let i = 0, j = 0; i < d.length; i += 4, j++) { const v = gris[j] > umbral ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; }
  ctx.putImageData(img, 0, 0);
  return c;
}

export async function leerDocumento(file, alAvanzar) {
  const paginas = await paginasComoCanvas(file, alAvanzar);
  alAvanzar?.('Cargando el lector (la primera vez tarda unos segundos)…');
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('spa', 1, {
    workerPath: '/ocr/worker.min.js', corePath: '/ocr', langPath: '/ocr/lang', gzip: true, workerBlobURL: false,
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
    let texto = '';
    for (const [i, c] of paginas.entries()) {
      alAvanzar?.(`Leyendo página ${i + 1} de ${paginas.length}…`);
      const { data } = await worker.recognize(c);
      texto += data.text + '\n';
    }
    return { texto, ...analizarTexto(texto) };
  } finally { await worker.terminate(); }
}
