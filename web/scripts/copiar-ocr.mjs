// Copia a public/ocr los archivos del lector de documentos (tesseract.js), para servirlos
// desde el mismo sitio: no depende de servidores externos y cumple la política de seguridad.
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const req = createRequire(import.meta.url);
const destino = join(process.cwd(), 'public', 'ocr');
mkdirSync(join(destino, 'lang'), { recursive: true });
const tjs = dirname(req.resolve('tesseract.js/package.json'));
const core = dirname(req.resolve('tesseract.js-core/package.json'));
const spa = dirname(req.resolve('@tesseract.js-data/spa/package.json'));
const archivos = [
  [join(tjs, 'dist', 'worker.min.js'), 'worker.min.js'],
  ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.js', 'tesseract-core-simd-lstm.js',
      'tesseract-core-lstm.wasm', 'tesseract-core-simd-lstm.wasm'].map(f => [join(core, f), f]),
  [join(spa, '4.0.0_best_int', 'spa.traineddata.gz'), join('lang', 'spa.traineddata.gz')],
];
for (const [o, d] of archivos) if (existsSync(o)) copyFileSync(o, join(destino, d));
console.log('Lector OCR copiado a public/ocr');
