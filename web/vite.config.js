import { defineConfig } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';

// Marca el service worker con la versión de cada publicación para que los equipos reciban la actualización
const versionSw = () => ({
  name: 'version-sw',
  closeBundle() {
    const p = 'dist/sw.js';
    writeFileSync(p, readFileSync(p, 'utf8').replace('__BUILD__', Date.now().toString(36)));
  },
});

export default defineConfig({
  plugins: [versionSw()],
  build: { target: 'es2020', chunkSizeWarningLimit: 1500 },
});
