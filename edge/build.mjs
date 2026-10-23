// Genera edge/dist/viewer-request.js inyectando REDIRECTS/UPLOADS (redirects/map.json)
// y KNOWN (rutas de directorio de dist/, en minusculas). Ejecutar tras `astro build`.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MAX_BYTES = 10 * 1024;
const UP = '/wp-content/uploads/';

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

/** Pura: redirects = contenido de map.json, known = rutas "/x/" en minusculas. */
export function generate({ redirects, known, template, maxBytes = MAX_BYTES }) {
  const keys = new Set(Object.keys(redirects));
  const knownSet = new Set(known);
  for (const [from, to] of Object.entries(redirects)) {
    if (keys.has(to)) throw new Error(`redirect encadenado: ${from} -> ${to} (el destino tambien es origen)`);
    if (knownSet.has(from.toLowerCase())) throw new Error(`el origen ${from} es una ruta existente de dist/`);
  }
  const plain = {};
  const uploads = {};
  for (const [from, to] of Object.entries(redirects)) {
    const cut = from.lastIndexOf('/');
    const name = to.startsWith('/img/') ? to.slice(5) : null;
    if (from.startsWith(UP) && cut >= UP.length && name !== null && !name.includes('/')) {
      const dir = from.slice(UP.length, cut);
      const file = from.slice(cut + 1);
      (uploads[dir] ??= {})[file] = name === file ? 1 : name;
    } else plain[from] = to;
  }
  const code = template
    .replace('/*REDIRECTS*/{}', JSON.stringify(plain))
    .replace('/*UPLOADS*/{}', JSON.stringify(uploads))
    .replace("/*KNOWN*/''", JSON.stringify(` ${known.join(' ')} `))
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'))
    .join('\n') + '\n';
  const size = Buffer.byteLength(code);
  if (size > maxBytes) {
    throw new Error(`${size} bytes supera el limite de ${maxBytes} bytes de CloudFront Functions`);
  }
  return code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const distDir = join(root, 'dist');
  if (!existsSync(distDir)) {
    console.error('edge/build: falta dist/; ejecuta antes `astro build`.');
    process.exit(1);
  }
  try {
    const code = generate({
      redirects: JSON.parse(readFileSync(join(root, 'redirects/map.json'), 'utf8')),
      known: knownRoutes(distDir),
      template: readFileSync(join(root, 'edge/viewer-request.template.js'), 'utf8'),
    });
    const out = join(root, 'edge/dist/viewer-request.js');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, code);
    console.log(`edge/dist/viewer-request.js generado (${Buffer.byteLength(code)} bytes de ${MAX_BYTES}).`);
  } catch (e) {
    console.error(`edge/build: ${e.message}`);
    process.exit(1);
  }
}
