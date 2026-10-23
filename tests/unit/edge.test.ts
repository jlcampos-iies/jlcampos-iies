import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
});
