import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://jlc-ingenieros.com',
  output: 'static',
  // El almacén de contenido va en .astro/ (ignorado por git): en Vitest (modo «dev») Astro lo lee de ahí.
  cacheDir: './.astro',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'never' },
});
