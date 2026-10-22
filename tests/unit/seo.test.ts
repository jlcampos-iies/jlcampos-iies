import { describe, expect, it } from 'vitest';
import { alternates, jsonLdOrganization } from '../../src/lib/seo';
import type { RouteEntry } from '../../src/lib/registry';

const entry: RouteEntry = {
  path: '/estudio/',
  lang: 'es',
  kind: 'page',
  key: 'studio',
  alternates: { es: '/estudio/', en: '/en/studio/', ca: '/ca/estudi/' },
  noindex: false,
};

describe('alternates', () => {
  it('con los 3 idiomas devuelve 4 entradas absolutas con x-default = ES', () => {
    const list = alternates(entry);
    expect(list).toHaveLength(4);
    expect(list.find((a) => a.hreflang === 'x-default')?.href).toBe('https://jlc-ingenieros.com/estudio/');
    expect(list.map((a) => a.hreflang)).toEqual(['es', 'en', 'ca', 'x-default']);
    expect(list.every((a) => a.href.startsWith('https://jlc-ingenieros.com/'))).toBe(true);
  });

  it('solo devuelve los idiomas existentes', () => {
    const list = alternates({ ...entry, alternates: { es: '/estudio/' } });
    expect(list.map((a) => a.hreflang)).toEqual(['es', 'x-default']);
  });

  it('sin versión ES no hay x-default', () => {
    const list = alternates({ ...entry, alternates: { en: '/en/studio/' } });
    expect(list.map((a) => a.hreflang)).toEqual(['en']);
  });
});

describe('jsonLdOrganization', () => {
  it('describe el estudio como ProfessionalService', () => {
    const ld = jsonLdOrganization('es') as any;
    expect(ld['@type']).toBe('ProfessionalService');
    expect(ld.address.postalCode).toBe('07800');
    expect(ld.areaServed).toBe('Illes Balears');
  });
});
