import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'node-html-parser';
import { FileSystemConfigLoader, HtmlValidate } from 'html-validate/node';
import { distFiles } from './helpers';

const ROOT = process.cwd();
const DIST = resolve(ROOT, 'dist');
const MAP: Record<string, string> = JSON.parse(
  readFileSync(resolve(ROOT, 'redirects/map.json'), 'utf8'),
);

const ES_ROUTES = [
  '/',
  '/estudio/',
  '/clientes/',
  '/proyectos/',
  '/publicaciones/',
  '/contacto/',
  '/proyectos/apartamentos-turisticos/',
  '/proyectos/fabrica-de-hielo/',
  '/proyectos/instalacion-de-captacion-de-energia-solar-termica-en-edificio-de-viviendas/',
  '/proyectos/instalacion-solar-fotovoltaica-en-modalidad-de-autoconsumo/',
  '/proyectos/instalacion-solar-fotovoltaica/',
  '/proyectos/nave-industrial/',
  '/politica-de-cookies-ue/',
  '/terminos-y-condiciones/',
];

function allFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...allFiles(full));
    else out.push(full);
  }
  return out;
}

/** Resuelve una URL interna a un fichero de dist/ (o undefined). */
function resolveInDist(url: string): string | undefined {
  const path = decodeURIComponent(url.split('#')[0].split('?')[0]);
  const rel = path.replace(/^\/+/, '');
  const candidates = [join(DIST, rel)];
  if (path.endsWith('/') || rel === '') candidates.unshift(join(DIST, rel, 'index.html'));
  else candidates.push(join(DIST, rel, 'index.html'));
  return candidates.find((c) => existsSync(c) && !readDirSafe(c));
}
function readDirSafe(p: string): boolean {
  try {
    readdirSync(p);
    return true;
  } catch {
    return false;
  }
}

function srcsetUrls(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim().split(/\s+/)[0])
    .filter(Boolean);
}

describe('conservación de URLs', () => {
  it.each(ES_ROUTES)('existe dist para %s', (route) => {
    expect(resolveInDist(route), route).toBeDefined();
  });
});

describe('enlaces internos', () => {
  it('cada href/src/srcset interno resuelve a un fichero de dist/', () => {
    const broken: string[] = [];
    for (const file of distFiles()) {
      const root = parse(readFileSync(join(DIST, file), 'utf8'));
      const urls: string[] = [];
      for (const el of root.querySelectorAll('[href], [src], [srcset]')) {
        for (const attr of ['href', 'src']) {
          const v = el.getAttribute(attr);
          if (v) urls.push(v);
        }
        const ss = el.getAttribute('srcset');
        if (ss) urls.push(...srcsetUrls(ss));
      }
      for (const u of urls) {
        if (!u.startsWith('/') || u.startsWith('//')) continue;
        if (!resolveInDist(u)) broken.push(`${file}: ${u}`);
      }
    }
    expect(broken).toEqual([]);
  });
});

describe('redirecciones 301', () => {
  const keys = Object.keys(MAP);
  it('cada destino existe en dist/', () => {
    const missing = Object.values(MAP).filter((d) => !resolveInDist(d));
    expect(missing).toEqual([]);
  });
  it('ningún destino es a su vez una clave (sin cadenas)', () => {
    expect(Object.values(MAP).filter((d) => keys.includes(d))).toEqual([]);
  });
  it('ninguna clave es una ruta servida en dist/', () => {
    expect(keys.filter((k) => resolveInDist(k))).toEqual([]);
  });
});

describe('lambda de contacto', () => {
  it.skipIf(!existsSync(resolve(ROOT, 'lambda/contact/paths.mjs')))(
    'contact y thanks de cada idioma existen en dist/',
    async () => {
      const { PATHS } = await import(resolve(ROOT, 'lambda/contact/paths.mjs'));
      const langs = Object.keys(PATHS);
      expect(langs.length).toBeGreaterThan(0);
      for (const lang of langs) {
        for (const key of ['contact', 'thanks']) {
          expect(resolveInDist(PATHS[lang][key]), `${lang}.${key}`).toBeDefined();
        }
      }
    },
  );
});

describe('restos del WordPress anterior', () => {
  const forbidden = ['3.133.180.219', '18.191.198.48', 'atomic4dev', 'wp-content'];
  it('ni el HTML construido ni src/content los contienen', () => {
    const files = [
      ...allFiles(DIST).filter((f) => f.endsWith('.html')),
      ...allFiles(resolve(ROOT, 'src/content')),
    ];
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const w of forbidden) if (text.includes(w)) hits.push(`${relative(ROOT, f)}: ${w}`);
    }
    expect(hits).toEqual([]);
  });
});

describe('html-validate', () => {
  it('todos los HTML sin errores', async () => {
    const validator = new HtmlValidate(new FileSystemConfigLoader());
    const problems: string[] = [];
    for (const file of distFiles()) {
      const report = await validator.validateFile(join(DIST, file));
      for (const r of report.results) {
        for (const m of r.messages) {
          if (m.severity === 2) problems.push(`${file}:${m.line}:${m.column} ${m.ruleId} ${m.message}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('verificación de Google Search Console', () => {
  it('public/googlebaf2e61fdcb21162.html se publica tal cual', () => {
    const text = readFileSync(resolve(DIST, 'googlebaf2e61fdcb21162.html'), 'utf8');
    expect(text.trim()).toBe('google-site-verification: googlebaf2e61fdcb21162.html');
  });
});
