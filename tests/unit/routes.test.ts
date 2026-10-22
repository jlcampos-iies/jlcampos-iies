import { describe, expect, it } from 'vitest';
import { LANGS, PAGE_ROUTES, pagePath, projectPath } from '../../src/i18n/routes';
import { UI, t, type UiKey } from '../../src/i18n/ui';
import { site } from '../../src/config/site';

describe('rutas', () => {
  it('pagePath devuelve las rutas de la spec', () => {
    expect(pagePath('studio', 'ca')).toBe('/ca/estudi/');
    expect(pagePath('cookies', 'es')).toBe('/politica-de-cookies-ue/');
    expect(pagePath('home', 'es')).toBe('/');
    expect(pagePath('contactThanks', 'en')).toBe('/en/contact/thanks/');
  });

  it('projectPath compone la ruta de proyecto', () => {
    expect(projectPath('ice-factory', 'en')).toBe('/en/projects/ice-factory/');
    expect(projectPath('fabrica-de-hielo', 'es')).toBe('/proyectos/fabrica-de-hielo/');
  });

  const all = Object.values(PAGE_ROUTES).flatMap((r) => Object.values(r));

  it('todas las rutas empiezan y terminan en /', () => {
    for (const r of all) {
      expect(r.startsWith('/')).toBe(true);
      expect(r.endsWith('/')).toBe(true);
    }
  });

  it('ninguna ruta se repite', () => {
    expect(new Set(all).size).toBe(all.length);
  });

  it('cada página tiene ruta en los tres idiomas', () => {
    for (const r of Object.values(PAGE_ROUTES)) {
      expect(Object.keys(r).sort()).toEqual([...LANGS].sort());
    }
  });
});

describe('textos de interfaz', () => {
  it('los tres idiomas definen las mismas claves y no están vacías', () => {
    const keys = Object.keys(UI.es) as UiKey[];
    expect(keys.length).toBeGreaterThan(0);
    for (const lang of LANGS) {
      expect(Object.keys(UI[lang]).sort()).toEqual([...keys].sort());
      for (const k of keys) {
        expect(t(lang, k).trim()).not.toBe('');
      }
    }
  });

  it('incluye el botón de área privada traducido', () => {
    expect(t('es', 'nav.privateArea')).toBe('Área privada');
    expect(t('en', 'nav.privateArea')).toBe('Private area');
    expect(t('ca', 'nav.privateArea')).toBe('Àrea privada');
  });
});

describe('site', () => {
  it('contiene los datos fijos', () => {
    expect(site.url).toBe('https://jlc-ingenieros.com');
    expect(site.areaPrivadaUrl).toBe('https://areaprivada.jlc-ingenieros.com');
    expect(site.rightsEmail).toBe('info@jlc-ingenieros.com');
    expect(site.owner.collegiateNumber).toBe('403');
  });
});
