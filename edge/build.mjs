// Genera edge/dist/viewer-request.js inyectando REDIRECTS (redirects/map.json)
// y KNOWN (rutas de directorio de dist/, en minusculas). Ejecutar tras `astro build`.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_BYTES = 10 * 1024;

export function knownRoutes(distDir) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'index.html') {
        const rel = relative(distDir, dirname(p)).split(sep).join('/');
        out.push(rel ? `/${rel}/`.toLowerCase() : '/');
      }
    }
  };
  walk(distDir);
  return out.sort();
}

export function generate({ mapFile, distDir }) {
  const redirects = JSON.parse(readFileSync(mapFile, 'utf8'));
  const known = ` ${knownRoutes(distDir).join(' ')} `;
  const template = readFileSync(join(root, 'edge/viewer-request.template.js'), 'utf8');
  return template
    .replace(/^\/\/.*\n/gm, '')
    .replace('/*REDIRECTS*/{}', JSON.stringify(redirects))
    .replace("/*KNOWN*/''", JSON.stringify(known));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const distDir = join(root, 'dist');
  if (!existsSync(distDir)) {
    console.error('edge/build: falta dist/; ejecuta antes `astro build`.');
    process.exit(1);
  }
  const code = generate({ mapFile: join(root, 'redirects/map.json'), distDir });
  const size = Buffer.byteLength(code);
  if (size > MAX_BYTES) {
    console.error(`edge/build: ${size} bytes supera el limite de ${MAX_BYTES} bytes de CloudFront Functions.`);
    process.exit(1);
  }
  const out = join(root, 'edge/dist/viewer-request.js');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, code);
  console.log(`edge/dist/viewer-request.js generado (${size} bytes de ${MAX_BYTES}).`);
}
