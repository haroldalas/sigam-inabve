// SIGAM-INABVE · lectura de códigos de barras
//  · Lector USB/Bluetooth: escribe el código y presiona Enter en el campo activo (funciona solo)
//  · Cámara del celular o tablet: BarcodeDetector nativo y, si el navegador no lo tiene, ZXing
import { h, toast } from './ui.js';

const FORMATOS = ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'codabar', 'qr_code'];

export function camaraDisponible() {
  return !!navigator.mediaDevices?.getUserMedia;
}

// Abre la cámara en pantalla completa. alLeer(codigo) se llama por cada lectura.
// continuo = true: sigue leyendo (modo "cada escaneo suma uno"); false: se cierra al primer código.
export async function escanearConCamara(alLeer, { continuo = false, titulo = 'Apunte al código de barras' } = {}) {
  if (!camaraDisponible()) { toast('Este equipo no permite usar la cámara', 'error'); return; }
  const video = h('video', { playsinline: true, muted: true, autoplay: true });
  const contador = h('div', { class: 'escaner-contador' });
  let lecturas = 0, ultimo = '', ultimoT = 0, activo = true, stream, controlesZx, timer;
  const cerrar = () => {
    activo = false; clearInterval(timer);
    try { controlesZx?.stop(); } catch {}
    stream?.getTracks().forEach(t => t.stop());
    capa.remove();
  };
  const capa = h('div', { class: 'escaner' },
    h('div', { class: 'escaner-cab' }, h('span', {}, titulo),
      h('button', { class: 'btn btn-claro', onclick: cerrar }, continuo ? 'Terminar' : 'Cancelar')),
    h('div', { class: 'escaner-video' }, video, h('div', { class: 'escaner-mira' })), contador);
  document.body.append(capa);

  const recibir = codigo => {
    const ahora = Date.now();
    if (codigo === ultimo && ahora - ultimoT < 1200) return;   // evita leer dos veces el mismo empaque
    ultimo = codigo; ultimoT = ahora; lecturas++;
    navigator.vibrate?.(60);
    contador.textContent = continuo ? `Lecturas: ${lecturas} · último: ${codigo}` : codigo;
    alLeer(codigo);
    if (!continuo) cerrar();
  };

  try {
    if ('BarcodeDetector' in window) {
      const soportados = await window.BarcodeDetector.getSupportedFormats();
      const det = new window.BarcodeDetector({ formats: FORMATOS.filter(f => soportados.includes(f)) });
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } } });
      video.srcObject = stream; await video.play();
      timer = setInterval(async () => {
        if (!activo || video.readyState < 2) return;
        try { const r = await det.detect(video); if (r[0]) recibir(r[0].rawValue); } catch {}
      }, 250);
    } else {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const lector = new BrowserMultiFormatReader();
      controlesZx = await lector.decodeFromConstraints({ video: { facingMode: 'environment' } }, video,
        (res) => { if (res && activo) recibir(res.getText()); });
    }
  } catch (e) {
    cerrar();
    toast(/Permission|NotAllowed/i.test(e.name + e.message)
      ? 'Debe permitir el uso de la cámara en el navegador' : 'No se pudo abrir la cámara: ' + e.message, 'error', 7000);
  }
  return cerrar;
}
