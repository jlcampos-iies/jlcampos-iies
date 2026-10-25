import { describe, expect, it } from 'vitest';
import { getCollection } from 'astro:content';
import { allRoutes } from '../../src/lib/registry';

const PROJECT_SLUGS = [
  'instalacion-solar-fotovoltaica-en-modalidad-de-autoconsumo',
  'instalacion-solar-fotovoltaica',
  'fabrica-de-hielo',
  'instalacion-de-captacion-de-energia-solar-termica-en-edificio-de-viviendas',
  'nave-industrial',
  'apartamentos-turisticos',
];

describe('allRoutes', () => {
  it('incluye las páginas y los 6 proyectos actuales', async () => {
    const paths = (await allRoutes()).map((r) => r.path);
    for (const p of [
      '/',
      '/estudio/',
      '/clientes/',
      '/proyectos/',
      '/publicaciones/',
      '/contacto/',
      '/politica-de-cookies-ue/',
      '/terminos-y-condiciones/',
      ...PROJECT_SLUGS.map((s) => `/proyectos/${s}/`),
    ]) {
      expect(paths).toContain(p);
    }
  });

  it('contactThanks es noindex y el resto de páginas no', async () => {
    const routes = await allRoutes();
    expect(routes.find((r) => r.key === 'contactThanks')?.noindex).toBe(true);
    expect(routes.filter((r) => r.key !== 'contactThanks').every((r) => r.noindex === false)).toBe(true);
  });

  it('no repite ningún path', async () => {
    const paths = (await allRoutes()).map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('describe kind, key y alternates', async () => {
    const routes = await allRoutes();
    const studio = routes.find((r) => r.path === '/estudio/');
    expect(studio).toMatchObject({ lang: 'es', kind: 'page', key: 'studio', alternates: { es: '/estudio/' } });
    const ice = routes.find((r) => r.path === '/proyectos/fabrica-de-hielo/');
    expect(ice).toMatchObject({ kind: 'project', key: 'fabrica-de-hielo', alternates: { es: '/proyectos/fabrica-de-hielo/' } });
  });

  it('alternates multilingües de páginas y proyectos', async () => {
    const routes = await allRoutes();
    const studio = { es: '/estudio/', en: '/en/studio/', ca: '/ca/estudi/' };
    const ice = {
      es: '/proyectos/fabrica-de-hielo/',
      en: '/en/projects/ice-factory/',
      ca: '/ca/projectes/fabrica-de-gel/',
    };
    for (const path of Object.values(studio)) {
      expect(routes.find((r) => r.path === path)?.alternates, path).toEqual(studio);
    }
    for (const path of Object.values(ice)) {
      expect(routes.find((r) => r.path === path)?.alternates, path).toEqual(ice);
    }
    expect(routes.find((r) => r.path === '/en/projects/ice-factory/')).toMatchObject({
      lang: 'en',
      kind: 'project',
      key: 'fabrica-de-hielo',
    });
  });
});

describe('colecciones de datos', () => {
  it('clients tiene 14 entradas', async () => {
    expect(await getCollection('clients')).toHaveLength(14);
  });

  it('publications: ASIN impreso+Kindle (salvo inProgress) y enlace al complemento', async () => {
    const books = await getCollection('publications');
    expect(books).toHaveLength(8);
    for (const b of books) {
      if (b.data.inProgress) expect(b.data.amazon).toBeUndefined();
      else {
        expect(b.data.amazon?.print).toMatch(/^[A-Z0-9]{10}$/);
        expect(b.data.amazon?.kindle).toMatch(/^[A-Z0-9]{10}$/);
      }
      expect(b.data.companionUrl).toMatch(/^https:\/\/met\.jlc-ingenieros\.com\//);
      expect(b.data).not.toHaveProperty('amazonUrl');
      expect(b.data).not.toHaveProperty('infoUrl');
    }
  });

  it('los proyectos en castellano tienen portada y orden único', async () => {
    const es = (await getCollection('projects')).filter((p) => p.data.lang === 'es');
    expect(es).toHaveLength(6);
    expect(es.every((p) => p.data.cover)).toBe(true);
    expect(new Set(es.map((p) => p.data.order)).size).toBe(6);
  });

  it('las páginas con hero tienen heroAlt en su idioma', async () => {
    const withHero = (await getCollection('pages')).filter((p) => p.data.hero);
    expect(withHero.length).toBeGreaterThan(0);
    for (const p of withHero) expect(p.data.heroAlt, p.id).toBeTruthy();
  });
});
