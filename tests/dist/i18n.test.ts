import { describe, expect, it } from 'vitest';
import { getCollection } from 'astro:content';
import { site } from '../../src/config/site';
import { LANGS, PAGE_ROUTES, type Lang, type PageKey } from '../../src/i18n/routes';
import { distFiles, readPage } from './helpers';

const ORIGIN = 'https://jlc-ingenieros.com';

/** Slugs de proyecto de la spec §4 (clave = slug ES = translationKey). */
const PROJECT_SLUGS: Record<string, Record<Exclude<Lang, 'es'>, string>> = {
  'instalacion-solar-fotovoltaica-en-modalidad-de-autoconsumo': {
    en: 'solar-pv-self-consumption-installation',
    ca: 'installacio-solar-fotovoltaica-en-modalitat-dautoconsum',
  },
  'instalacion-solar-fotovoltaica': { en: 'solar-pv-installation', ca: 'installacio-solar-fotovoltaica' },
  'fabrica-de-hielo': { en: 'ice-factory', ca: 'fabrica-de-gel' },
  'instalacion-de-captacion-de-energia-solar-termica-en-edificio-de-viviendas': {
    en: 'solar-thermal-installation-in-residential-building',
    ca: 'installacio-de-captacio-denergia-solar-termica-en-edifici-dhabitatges',
  },
  'nave-industrial': { en: 'industrial-building', ca: 'nau-industrial' },
  'apartamentos-turisticos': { en: 'tourist-apartments', ca: 'apartaments-turistics' },
};

const pages = await getCollection('pages');
const projects = await getCollection('projects');

const urlPathOf = (file: string) => '/' + file.replace(/index\.html$/, '');
const langOfPath = (path: string): Lang =>
  path.startsWith('/en/') ? 'en' : path.startsWith('/ca/') ? 'ca' : 'es';
const htmlPages = distFiles()
  .filter((f) => f !== '404.html')
  .map(urlPathOf);
const isNoindex = (path: string) =>
  (readPage(path).querySelector('meta[name=robots]')?.getAttribute('content') ?? '').includes('noindex');
const indexable = htmlPages.filter((p) => !isNoindex(p));

/** hreflang → href de una página ya generada. */
function hreflangs(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const link of readPage(path).querySelectorAll('link[rel=alternate][hreflang]')) {
    out[link.getAttribute('hreflang')!] = link.getAttribute('href')!;
  }
  return out;
}

const mainImgSrcs = (path: string) =>
  readPage(path)
    .querySelectorAll('main img')
    .map((img) => img.getAttribute('src'));

describe('contenido en los 3 idiomas', () => {
  it.each(Object.keys(PAGE_ROUTES) as PageKey[])('la página %s existe en es, en y ca', (key) => {
    for (const lang of LANGS) {
      expect(pages.some((p) => p.data.key === key && p.data.lang === lang), `${key}/${lang}`).toBe(true);
      expect(htmlPages, `${key}/${lang}`).toContain(PAGE_ROUTES[key][lang]);
    }
  });

  it.each(Object.entries(PROJECT_SLUGS))('el proyecto %s existe en en y ca con los slugs de la spec', (key, slugs) => {
    expect(projects.some((p) => p.data.translationKey === key && p.data.lang === 'es' && p.data.slug === key)).toBe(true);
    for (const lang of ['en', 'ca'] as const) {
      const entry = projects.find((p) => p.data.translationKey === key && p.data.lang === lang);
      expect(entry?.data.slug, `${key}/${lang}`).toBe(slugs[lang]);
      expect(htmlPages).toContain(`${PAGE_ROUTES.projects[lang]}${slugs[lang]}/`);
    }
  });

  it('no hay proyectos sin translationKey del castellano', () => {
    expect(projects.every((p) => p.data.translationKey in PROJECT_SLUGS)).toBe(true);
    expect(projects).toHaveLength(Object.keys(PROJECT_SLUGS).length * LANGS.length);
  });

  it('las fichas EN/CA muestran las mismas imágenes que la ficha ES', () => {
    for (const [key, slugs] of Object.entries(PROJECT_SLUGS)) {
      const es = mainImgSrcs(`/proyectos/${key}/`);
      expect(es.length).toBeGreaterThan(1);
      expect(mainImgSrcs(`/en/projects/${slugs.en}/`), `${key}/en`).toEqual(es);
      expect(mainImgSrcs(`/ca/projectes/${slugs.ca}/`), `${key}/ca`).toEqual(es);
    }
  });

  it('las tarjetas de /en/projects/ y /ca/projectes/ llevan las portadas del ES', () => {
    const es = mainImgSrcs('/proyectos/');
    expect(es).toHaveLength(6);
    expect(mainImgSrcs('/en/projects/')).toEqual(es);
    expect(mainImgSrcs('/ca/projectes/')).toEqual(es);
  });
});

describe('<html lang> y <h1>', () => {
  it.each(htmlPages)('%s', (path) => {
    const lang = langOfPath(path);
    const page = readPage(path);
    expect(page.querySelector('html')?.getAttribute('lang')).toBe(lang);
    const h1 = page.querySelectorAll('h1');
    expect(h1).toHaveLength(1);
    expect(h1[0].text.trim()).not.toBe('');
  });

  it.each([
    ['home', 'main img.hero__img'],
    ['studio', 'main img.split__img'],
  ] as const)('el alt del hero de %s está en el idioma de la página', (key, selector) => {
    const alt = (lang: Lang) => readPage(PAGE_ROUTES[key][lang]).querySelector(selector)?.getAttribute('alt');
    for (const lang of LANGS) {
      const entry = pages.find((p) => p.data.key === key && p.data.lang === lang)!;
      expect(entry.data.heroAlt, `${key}/${lang}`).toBeTruthy();
      expect(alt(lang), `${key}/${lang}`).toBe(entry.data.heroAlt);
    }
    expect(new Set(LANGS.map(alt)).size).toBe(3);
  });
});

describe('hreflang', () => {
  it('hay páginas indexables en los tres idiomas', () => {
    for (const lang of LANGS) expect(indexable.some((p) => langOfPath(p) === lang), lang).toBe(true);
  });

  it.each(indexable)('%s: es, en, ca y x-default absolutos y recíprocos', (path) => {
    const own = hreflangs(path);
    expect(Object.keys(own).sort()).toEqual(['ca', 'en', 'es', 'x-default']);
    for (const href of Object.values(own)) expect(href).toMatch(/^https:\/\/jlc-ingenieros\.com\/(.*\/)?$/);
    // La página se incluye a sí misma y x-default apunta al castellano.
    expect(own[langOfPath(path)]).toBe(ORIGIN + path);
    expect(own['x-default']).toBe(own.es);
    expect(readPage(path).querySelector('link[rel=canonical]')?.getAttribute('href')).toBe(ORIGIN + path);
    // Recíprocos: cada alternativa B enlaza de vuelta a A con el idioma de A.
    for (const lang of LANGS) {
      const target = own[lang].slice(ORIGIN.length);
      expect(htmlPages, `${path} → ${target}`).toContain(target);
      const back = hreflangs(target);
      expect(back[langOfPath(path)], `${target} → ${path}`).toBe(ORIGIN + path);
      expect(back, `${target}`).toEqual(own);
    }
  });
});

describe('textos legales', () => {
  // Markdown convierte los apóstrofos rectos en tipográficos (smartypants).
  const text = (path: string) => readPage(path).querySelector('main')!.text.replace(/’/g, "'");

  it('/en/legal-notice/ contiene el NIF y el n.º de colegiado', () => {
    const t = text('/en/legal-notice/');
    expect(t).toContain('20151498W');
    expect(t).toContain('403');
  });

  it.each(LANGS)('el aviso legal (%s) identifica al titular con los datos de site', (lang) => {
    const t = text(PAGE_ROUTES.legalNotice[lang]);
    for (const value of [
      site.owner.name,
      site.owner.nif,
      site.owner.collegiateNumber,
      site.owner.college,
      site.address.street,
      site.address.postalCode,
      site.email,
      site.phone,
    ]) {
      expect(t).toContain(value);
    }
    expect(t).toContain('UPV');
  });

  it('/politica-de-privacidad/ contiene el contacto RGPD, la AEPD y Cloudflare', () => {
    const t = text('/politica-de-privacidad/');
    expect(t).toContain('info@jlc-ingenieros.com');
    expect(t).toContain('Agencia Española de Protección de Datos');
    expect(t).toContain('Cloudflare');
  });

  it.each(LANGS)('la política de privacidad (%s) nombra responsable, encargados y derechos', (lang) => {
    const t = text(PAGE_ROUTES.privacy[lang]);
    const consent = { es: '6.1.a', en: '6(1)(a)', ca: '6.1.a' }[lang];
    for (const value of [site.owner.name, site.owner.nif, site.rightsEmail, 'Amazon Web Services EMEA SARL', 'Cloudflare, Inc.', 'Apple Distribution International Ltd.', 'iCloud', consent, 'www.aepd.es']) {
      expect(t).toContain(value);
    }
  });

  it('/politica-de-cookies-ue/ no menciona Google Analytics', () => {
    const t = text('/politica-de-cookies-ue/');
    expect(t).not.toContain('Google Analytics');
    expect(t).toContain('Turnstile');
  });

  it.each(LANGS)('las políticas de cookies (%s) no conservan restos de WordPress', (lang) => {
    const t = text(PAGE_ROUTES.cookies[lang]);
    for (const s of ['Google Analytics', 'WordPress', 'Complianz', 'Google Fonts', 'cookiedatabase']) {
      expect(t).not.toContain(s);
    }
  });

  it.each(LANGS)('los textos legales (%s) indican la fecha de actualización', (lang) => {
    for (const key of ['legalNotice', 'privacy', 'cookies', 'terms'] as const) {
      expect(text(PAGE_ROUTES[key][lang]), `${key}/${lang}`).toContain('2026-10-23');
    }
  });
});
