import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { generate, knownRoutes } from '../../edge/build.mjs';
import { loadHandler, type EdgeHandler } from '../../edge/load';

type Qs = Record<string, { value: string; multiValue?: { value: string }[] }>;
const ev = (uri: string, { host = 'jlc-ingenieros.com', qs = {} as Qs } = {}) => ({
  request: { uri, method: 'GET', querystring: qs, headers: { host: { value: host } } },
});

let handler: EdgeHandler;
beforeAll(() => {
  execFileSync('node', ['edge/build.mjs'], { stdio: 'pipe' });
  handler = loadHandler();
});

const loc = (r: any) => r.headers.location.value;

describe('CloudFront Function viewer-request', () => {
  it('el codigo generado es cloudfront-js-2.0 valido y cabe en 10 KB', () => {
    const code = readFileSync('edge/dist/viewer-request.js', 'utf8');
    expect(code).toMatch(/function handler\(event\)/);
    expect(code).not.toMatch(/^\s*(import|export)\s/m);
    expect(Buffer.byteLength(code)).toBeLessThanOrEqual(10 * 1024);
  });

  it('www -> apex conservando ruta y query', () => {
    const r = handler(ev('/estudio/', { host: 'www.jlc-ingenieros.com', qs: { a: { value: '1' } } }));
    expect(r.statusCode).toBe(301);
    expect(loc(r)).toBe('https://jlc-ingenieros.com/estudio/?a=1');
  });

  it('redirecciones del mapa, con y sin barra', () => {
    for (const u of ['/en/home/', '/en/home']) expect(loc(handler(ev(u)))).toBe('/en/');
    expect(loc(handler(ev('/feed/')))).toBe('/');
    const r = handler(ev('/wp-content/uploads/2024/03/establecimiento-1.jpg'));
    expect(r.statusCode).toBe(301);
    expect(loc(r)).toBe('/img/establecimiento-1.jpg');
  });

  it('sondas -> 404 con cache corto', () => {
    for (const u of ['/wp-login.php', '/xmlrpc.php', '/wp-admin/', '/wp-json/wp/v2/users', '/wp-includes/x.js', '/x.php']) {
      const r = handler(ev(u));
      expect(r.statusCode, u).toBe(404);
      expect(r.headers['cache-control'].value).toBe('public, max-age=300');
    }
  });

  it('/wp-content desconocido no se bloquea en la funcion', () => {
    const r = handler(ev('/wp-content/uploads/zzz.jpg'));
    expect(r.uri).toBe('/wp-content/uploads/zzz.jpg');
  });

  it('?p= y ?page_id= -> 301 sin esos parametros', () => {
    expect(loc(handler(ev('/', { qs: { p: { value: '12' } } })))).toBe('/');
    expect(loc(handler(ev('/', { qs: { page_id: { value: '7' } } })))).toBe('/');
    expect(loc(handler(ev('/', { qs: { p: { value: '1' }, a: { value: 'b' } } })))).toBe('/?a=b');
  });

  it('reescribe a index.html conservando la query', () => {
    const qs = { utm_source: { value: 'x' } };
    const r = handler(ev('/contacto/', { qs }));
    expect(r.uri).toBe('/contacto/index.html');
    expect(r.querystring).toEqual(qs);
    expect(handler(ev('/estudio/')).uri).toBe('/estudio/index.html');
    expect(handler(ev('/')).uri).toBe('/index.html');
  });

  it('serializa multiValue en redirects', () => {
    const qs = { a: { value: '1', multiValue: [{ value: '1' }, { value: '2' }] } };
    expect(loc(handler(ev('/feed/', { qs })))).toBe('/?a=1&a=2');
  });

  it('barra final y minusculas solo hacia rutas conocidas', () => {
    expect(loc(handler(ev('/proyectos/fabrica-de-hielo')))).toBe('/proyectos/fabrica-de-hielo/');
    expect(loc(handler(ev('/Contacto/')))).toBe('/contacto/');
    expect(loc(handler(ev('/Contacto')))).toBe('/contacto/');
    expect(handler(ev('/Inexistente/')).uri).toBe('/Inexistente/index.html');
  });

  it('ficheros y /api pasan sin cambios', () => {
    for (const u of ['/_astro/a.css', '/img/x.jpg', '/sitemap.xml', '/robots.txt', '/404.html', '/api/contact']) {
      expect(handler(ev(u)).uri).toBe(u);
    }
  });

  it.each(['/sitemap_index.xml', '/page-sitemap.xml', '/portfolio-sitemap.xml'])(
    'sitemap antiguo de Rank Math %s -> /sitemap.xml',
    (u) => {
      const r = handler(ev(u));
      expect(r.statusCode).toBe(301);
      expect(loc(r)).toBe('/sitemap.xml');
    },
  );

  it.each([
    '/wp-content/uploads/constructor/name',
    '/wp-content/uploads/constructor/x.jpg',
    '/wp-content/uploads/__proto__/toString',
    '/wp-content/uploads/2024/03/hasOwnProperty',
  ])('uploads: %s no se confunde con propiedades heredadas y pasa sin cambios', (u) => {
    const r = handler(ev(u));
    expect(r.statusCode).toBeUndefined();
    expect(r.uri).toBe(u);
  });

  it('serializa valores vacios y multiValue de 2 valores', () => {
    expect(loc(handler(ev('/feed/', { qs: { a: { value: '' } } })))).toBe('/?a=');
    const qs = { t: { value: 'x', multiValue: [{ value: 'x' }, { value: 'y' }] }, b: { value: '2' } };
    expect(loc(handler(ev('/feed/', { qs })))).toBe('/?t=x&t=y&b=2');
  });

  it('uploads con nombre distinto se redirigen al nuevo nombre', () => {
    const tpl = readFileSync('edge/viewer-request.template.js', 'utf8');
    const code = generate({ redirects: { '/wp-content/uploads/2020/01/a.jpg': '/img/b.jpg' }, known: ['/'], template: tpl });
    const h = new Function(code + '; return handler;')();
    expect(loc(h(ev('/wp-content/uploads/2020/01/a.jpg')))).toBe('/img/b.jpg');
  });
});

describe('generador edge', () => {
  const template = readFileSync('edge/viewer-request.template.js', 'utf8');
  const redirects = JSON.parse(readFileSync('redirects/map.json', 'utf8')) as Record<string, string>;

  it('ningun destino del mapa es tambien origen', () => {
    for (const to of Object.values(redirects)) expect(redirects[to], to).toBeUndefined();
    expect(() => generate({ redirects: { '/a/': '/b/', '/b/': '/c/' }, known: [], template })).toThrow(/encadenado/);
  });

  it('ningun origen del mapa es una ruta conocida', () => {
    const known = knownRoutes('dist');
    for (const from of Object.keys(redirects)) expect(known, from).not.toContain(from.toLowerCase());
    expect(() => generate({ redirects: { '/estudio/': '/' }, known: ['/estudio/'], template })).toThrow(/ruta existente/);
  });

  it('falla si el codigo supera 10 KB', () => {
    const big = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`/viejo-${i}/`, `/nuevo-${i}/`]));
    expect(() => generate({ redirects: big, known: [], template })).toThrow(/bytes supera el limite de 10240/);
  });

  it('el codigo generado no lleva comentarios ni indentacion', () => {
    const code = generate({ redirects, known: knownRoutes('dist'), template });
    expect(code).not.toMatch(/^\s*\/\//m);
    expect(code).not.toMatch(/^[ \t]+/m);
  });
});
