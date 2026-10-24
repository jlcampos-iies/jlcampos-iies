import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { distFiles, readPage } from './helpers';

describe('layout de /estudio/', () => {
  const page = readPage('/estudio/');

  it('canonical absoluto', () => {
    expect(page.querySelector('link[rel=canonical]')?.getAttribute('href')).toBe(
      'https://jlc-ingenieros.com/estudio/',
    );
  });

  it('hreflang con x-default', () => {
    const hl = page.querySelectorAll('link[rel=alternate][hreflang]').map((l) => l.getAttribute('hreflang'));
    expect(hl).toContain('x-default');
    expect(hl).toContain('es');
  });

  it('no filtra la IP ni atomic4dev', () => {
    const html = page.toString();
    expect(html).not.toContain('3.133.180.219');
    expect(html).not.toContain('atomic4dev');
  });

  it('enlaza al área privada', () => {
    expect(page.querySelector('a[href="https://areaprivada.jlc-ingenieros.com"]')).not.toBeNull();
  });

  it('el menú dice Estudio y no STUDIO', () => {
    const nav = page.querySelector('nav')!.text;
    expect(nav).toContain('Estudio');
    expect(nav).not.toContain('STUDIO');
  });

  it('sin <script> en línea (salvo JSON-LD) ni <style>', () => {
    for (const file of distFiles()) {
      const doc = readPage('/' + file.replace(/index\.html$/, '').replace(/^\//, ''));
      for (const s of doc.querySelectorAll('script')) {
        if (s.getAttribute('type') === 'application/ld+json') continue;
        expect(s.getAttribute('src'), `${file}: script en línea`).toBeTruthy();
      }
      expect(doc.querySelectorAll('style'), `${file}: <style>`).toHaveLength(0);
      expect(doc.querySelectorAll('[style]'), `${file}: atributo style`).toHaveLength(0);
    }
  });

  it('sin Google Fonts', () => {
    expect(page.toString()).not.toContain('fonts.googleapis.com');
  });

  it('Open Graph, Twitter y robots', () => {
    expect(page.querySelector('meta[property="og:image"]')?.getAttribute('content')).toMatch(/^https:\/\/jlc-ingenieros\.com\//);
    expect(page.querySelector('meta[name="twitter:card"]')).not.toBeNull();
    expect(page.querySelector('meta[name=robots]')).toBeNull();
  });

  it('páginas noindex llevan robots noindex', () => {
    const thanks = readPage('/contacto/gracias/');
    expect(thanks.querySelector('meta[name=robots]')?.getAttribute('content')).toBe('noindex');
  });
});

describe('tipografías autoalojadas', () => {
  const css = () => {
    const link = readPage('/estudio/').querySelector('link[rel=stylesheet]')!.getAttribute('href')!;
    return readFileSync(join(process.cwd(), 'dist', link), 'utf8');
  };

  it('el CSS referencia Roboto e Inter desde /_astro/ y nada externo', () => {
    const c = css();
    expect(c).toMatch(/font-family:\s*Roboto/i);
    expect(c).toMatch(/font-family:\s*Inter/i);
    expect(c).toMatch(/url\(\/_astro\/roboto-latin-400-normal[^)]*\.woff2\)/);
    expect(c).toMatch(/url\(\/_astro\/roboto-latin-500-normal[^)]*\.woff2\)/);
    expect(c).toMatch(/url\(\/_astro\/inter-latin-600-normal[^)]*\.woff2\)/);
    expect(c).not.toMatch(/open sans/i);
    expect(c).not.toContain('fonts.googleapis.com');
    expect(c).not.toMatch(/url\(\s*["']?https?:/);
  });
});

describe('menú móvil sin JS', () => {
  const css = () => {
    const link = readPage('/estudio/').querySelector('link[rel=stylesheet]')!.getAttribute('href')!;
    return readFileSync(join(process.cwd(), 'dist', link), 'utf8');
  };

  it('el colapso del panel y el botón solo aplican con la clase .js', () => {
    const c = css();
    // Toda regla que oculte el panel debe llevar el prefijo .js
    expect(c).toMatch(/\.js \.site-header__panel:not\(\.is-open\)\{display:none/);
    expect(c).toMatch(/\.js \.menu-toggle\{display:inline-flex/);
    expect(c).not.toMatch(/(^|\})\.site-header__panel\{[^}]*display:none/);
    expect(c).toMatch(/\.menu-toggle\{[^}]*display:none/);
  });

  it('menu.ts activa la clase js y existe el skip link', () => {
    const page = readPage('/estudio/');
    const src = page.querySelector('script[src]')!.getAttribute('src')!;
    expect(readFileSync(join(process.cwd(), 'dist', src), 'utf8')).toContain('js');
    expect(page.querySelector('a.skip-link')?.getAttribute('href')).toBe('#main');
    expect(page.querySelector('main#main')).not.toBeNull();
  });
});

describe('<title>', () => {
  const titles = distFiles().map((file) => {
    const doc = readPage(file === '404.html' ? '/404.html' : '/' + file.replace(/index\.html$/, ''));
    return [file, doc.querySelector('title')!.text] as const;
  });

  it.each(titles)('%s: ≤ 70 caracteres, completo y con la marca', (_file, title) => {
    expect(title.length).toBeLessThanOrEqual(70);
    expect(title).not.toContain('…');
    expect(title).toContain('JLC Ingenieros');
  });

  it('las fichas de títulos largos usan su seoTitle', () => {
    const title = (p: string) => readPage(p).querySelector('title')!.text;
    expect(
      title('/proyectos/instalacion-de-captacion-de-energia-solar-termica-en-edificio-de-viviendas/'),
    ).toBe('Energía solar térmica en edificio de viviendas | JLC Ingenieros');
  });
});
