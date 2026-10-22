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
