import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getCollection } from 'astro:content';
import { allRoutes } from '../../src/lib/registry';
import { distFiles, readPage } from './helpers';

const dist = (f: string) => readFileSync(join(process.cwd(), 'dist', f), 'utf8');
const routes = await allRoutes();
const esRoutes = routes.filter((r) => r.lang === 'es');
const pages = await getCollection('pages');
const projects = await getCollection('projects');
const titleOf = (r: (typeof esRoutes)[number]) =>
  (r.kind === 'page'
    ? pages.find((p) => p.data.key === r.key && p.data.lang === 'es')
    : projects.find((p) => p.data.translationKey === r.key && p.data.lang === 'es')
  )!.data.title;

describe('vistas en castellano', () => {
  it.each(esRoutes.map((r) => [r.path, titleOf(r)]))('%s tiene un único <h1> = título', (path, title) => {
    const h1 = readPage(path).querySelectorAll('h1');
    expect(h1).toHaveLength(1);
    expect(h1[0].text.trim()).toBe(title);
  });

  it('/proyectos/ enlaza a las 6 fichas', () => {
    const hrefs = readPage('/proyectos/')
      .querySelectorAll('main a')
      .map((a) => a.getAttribute('href'))
      .filter((h) => h?.startsWith('/proyectos/') && h !== '/proyectos/');
    expect(new Set(hrefs).size).toBe(6);
  });

  it('las fichas llevan BreadcrumbList y galería', () => {
    const page = readPage('/proyectos/fabrica-de-hielo/');
    const ld = page.querySelectorAll('script[type="application/ld+json"]').map((s) => JSON.parse(s.text));
    expect(ld.some((o) => o['@type'] === 'BreadcrumbList')).toBe(true);
    expect(page.querySelectorAll('main picture').length).toBeGreaterThanOrEqual(4);
  });

  it('/clientes/ lista los clientes', () => {
    const text = readPage('/clientes/').querySelector('main')!.text;
    expect(text).toContain('Consell d’Eivissa');
    expect(text).toContain('Bridgestone');
  });

  it('/publicaciones/ tiene 7 enlaces limpios a Amazon', () => {
    const links = readPage('/publicaciones/')
      .querySelectorAll('a')
      .map((a) => a.getAttribute('href')!)
      .filter((h) => h.startsWith('https://www.amazon.es/') && !h.includes('?'));
    expect(links).toHaveLength(7);
  });

  it('/contacto/ tiene dirección, mapa, atribución y formulario', () => {
    const page = readPage('/contacto/');
    const main = page.querySelector('main')!;
    expect(main.text).toContain('C/. Carlos III, 28 Bajo');
    expect(main.text).toContain('© OpenStreetMap');
    expect(
      main.querySelector(
        'a[href="https://www.google.com/maps/search/?api=1&query=C.+Carlos+III+28+07800+Eivissa"]',
      ),
    ).not.toBeNull();
    expect(main.querySelector('form[data-contact-form]')).not.toBeNull();
    expect(page.querySelector('iframe')).toBeNull();
  });

  it('las imágenes de <main> tienen alt, width y height', () => {
    for (const file of distFiles()) {
      const doc = readPage('/' + file.replace(/index\.html$/, ''));
      for (const img of doc.querySelectorAll('main img')) {
        const src = img.getAttribute('src');
        expect(img.getAttribute('alt'), `${file} ${src}: alt`).not.toBeNull();
        expect(img.getAttribute('width'), `${file} ${src}: width`).toBeTruthy();
        expect(img.getAttribute('height'), `${file} ${src}: height`).toBeTruthy();
      }
    }
  });
});

describe('404 trilingüe', () => {
  it('contiene los textos en ES, EN y CA, noindex y enlaces a las portadas', () => {
    const page = readPage('/404.html');
    const text = page.querySelector('main')!.text;
    for (const s of ['Página no encontrada', 'Page not found', 'Pàgina no trobada']) expect(text).toContain(s);
    expect(page.querySelector('meta[name=robots]')?.getAttribute('content')).toBe('noindex');
    expect(page.querySelectorAll('link[rel=alternate][hreflang]')).toHaveLength(0);
    const hrefs = page.querySelectorAll('main a').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/', '/en/', '/ca/']));
  });
});

describe('sitemap.xml y robots.txt', () => {
  const indexable = routes.filter((r) => !r.noindex);

  it('contiene cada ruta indexable con alternos y x-default', () => {
    const xml = dist('sitemap.xml');
    for (const r of indexable) {
      expect(xml, r.path).toContain(`<loc>https://jlc-ingenieros.com${r.path}</loc>`);
    }
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(xml).toContain(
      '<xhtml:link rel="alternate" hreflang="x-default" href="https://jlc-ingenieros.com/estudio/"/>',
    );
    for (const [lang, path] of Object.entries(routes.find((r) => r.key === 'studio')!.alternates)) {
      expect(xml).toContain(
        `<xhtml:link rel="alternate" hreflang="${lang}" href="https://jlc-ingenieros.com${path}"/>`,
      );
    }
    expect((xml.match(/<url>/g) ?? []).length).toBe(indexable.length);
  });

  it('no contiene las páginas noindex', () => {
    const xml = dist('sitemap.xml');
    expect(xml).not.toContain('/contacto/gracias/');
    expect(xml).not.toContain('/en/contact/thanks/');
    expect(xml).not.toContain('404');
  });

  it('robots.txt', () => {
    const robots = dist('robots.txt');
    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Allow: /');
    expect(robots).toContain('Sitemap: https://jlc-ingenieros.com/sitemap.xml');
  });
});
