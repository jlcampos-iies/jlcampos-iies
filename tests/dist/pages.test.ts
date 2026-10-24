import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
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

  it.each(['/contacto/', '/en/contact/', '/ca/contacte/'])(
    '%s: sin mapa ni enlaces a mapas; con correo, teléfono y formulario',
    (path) => {
      const page = readPage(path);
      const main = page.querySelector('main')!;
      expect(main.querySelector('.map, figure')).toBeNull();
      expect(main.querySelector('img[src*="mapa-contacto"]')).toBeNull();
      expect(main.text).not.toMatch(/Tur Tur|Carlos\b/);
      const hrefs = main.querySelectorAll('a').map((a) => a.getAttribute('href') ?? '');
      expect(hrefs.filter((h) => /google\.[a-z.]+\/maps|openstreetmap|maps\.app/.test(h))).toEqual([]);
      expect(hrefs).toContain('mailto:jlcampos@jlc-ingenieros.com');
      expect(hrefs).toContain('tel:+34616992440');
      expect(main.querySelector('form[data-contact-form]')).not.toBeNull();
      expect(page.querySelector('iframe')).toBeNull();
    },
  );

  it.each([
    ['/', '/aviso-legal/'],
    ['/en/', '/en/legal-notice/'],
    ['/ca/', '/ca/avis-legal/'],
  ])('%s: domicilio fiscal nuevo en el pie y en %s, y copyright con la marca', (home, legal) => {
    const footer = readPage(home).querySelector('footer')!.text;
    expect(footer).toContain('C/. Des Periodista Marià Tur Tur, 14, 07800 Eivissa');
    expect(footer).toContain(`© ${new Date().getFullYear()} JLC Ingenieros`);
    expect(footer).not.toContain('Campos');
    expect(readPage(legal).querySelector('main')!.text).toContain('C/. Des Periodista Marià Tur Tur, 14, 07800 Eivissa');
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

describe('cuadrícula de clientes', () => {
  const clients = parse(readFileSync(join(process.cwd(), 'src/content/clients.yaml'), 'utf8')) as { name: string }[];
  it.each(['/clientes/', '/en/clients/', '/ca/clients/'])('%s: 14 logos con alt = nombre dentro de la cuadrícula', (path) => {
    const imgs = readPage(path).querySelectorAll('main ul.client-grid li img');
    expect(imgs).toHaveLength(14);
    expect(imgs.map((i) => i.getAttribute('alt'))).toEqual(clients.map((c) => c.name));
    for (const img of imgs) {
      expect(img.getAttribute('alt')!.trim()).not.toBe('');
      expect(img.getAttribute('src')).toMatch(/\.(webp|jpg)$/);
    }
  });
});

describe('publicidad de la financiación europea (Kit Digital)', () => {
  const ALTS: Record<string, string[]> = {
    es: ['Financiado por la Unión Europea – NextGenerationEU', 'Plan de Recuperación, Transformación y Resiliencia'],
    en: ['Funded by the European Union – NextGenerationEU', 'Recovery, Transformation and Resilience Plan'],
    ca: ['Finançat per la Unió Europea – NextGenerationEU', 'Pla de Recuperació, Transformació i Resiliència'],
  };
  it('todas las páginas (404 incluida) muestran los dos logos en el pie con el alt de su idioma', () => {
    const files = distFiles();
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const doc = readPage('/' + file.replace(/index\.html$/, '').replace(/^\//, ''));
      const lang = doc.querySelector('html')!.getAttribute('lang')!;
      const alts = doc.querySelectorAll('footer .eu-funding img').map((i) => i.getAttribute('alt'));
      expect(alts, file).toEqual(ALTS[lang]);
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
