import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { distFiles, readPage } from './helpers';
import { pagePath, type Lang } from '../../src/i18n/routes';

const LANGS: Lang[] = ['es', 'en', 'ca'];
const TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

describe.each(LANGS)('formulario de contacto (%s)', (lang) => {
  const page = readPage(pagePath('contact', lang));
  const form = page.querySelector('form[method=post][action="/api/contact"]')!;

  it('existe el formulario y ya no queda el hueco reservado', () => {
    expect(form).toBeTruthy();
    expect(page.querySelector('#contact-form-slot')).toBeNull();
    expect(form.getAttribute('data-thanks')).toBe(pagePath('contactThanks', lang));
  });

  it('campos con los límites de la Lambda', () => {
    const f = (n: string) => form.querySelector(`[name=${n}]`)!;
    expect(f('lang').getAttribute('value')).toBe(lang);
    expect(f('name').getAttribute('maxlength')).toBe('100');
    expect(f('name').hasAttribute('required')).toBe(true);
    expect(f('email').getAttribute('type')).toBe('email');
    expect(f('email').getAttribute('maxlength')).toBe('254');
    expect(f('phone').getAttribute('maxlength')).toBe('30');
    expect(f('phone').getAttribute('pattern')).toBe('[0-9 +()\\-]*');
    expect(f('message').getAttribute('minlength')).toBe('10');
    expect(f('message').getAttribute('maxlength')).toBe('5000');
    for (const n of ['name', 'email', 'message', 'phone']) {
      expect(form.querySelector(`label[for=${f(n).id}]`), `label ${n}`).toBeTruthy();
    }
  });

  it('honeypot oculto por CSS, sin estilo en línea', () => {
    const hp = form.querySelector('[name=website]')!;
    expect(hp.getAttribute('tabindex')).toBe('-1');
    expect(hp.getAttribute('autocomplete')).toBe('off');
    const wrapper = hp.closest('[aria-hidden=true]')!;
    expect(wrapper).toBeTruthy();
    expect(wrapper.getAttribute('class')).toBeTruthy();
    expect(form.querySelectorAll('[style]')).toHaveLength(0);
    expect(wrapper.querySelector(`label[for=${hp.id}]`)).toBeTruthy();
  });

  it('casilla de privacidad obligatoria con enlace a la política', () => {
    const cb = form.querySelector('input[type=checkbox][name=privacy]')!;
    expect(cb.hasAttribute('required')).toBe(true);
    expect(cb.getAttribute('value')).toBe('on');
    const link = cb.closest('label')!.querySelector('a')!;
    expect(link.getAttribute('href')).toBe(pagePath('privacy', lang));
  });

  it('widget Turnstile dentro del formulario y script solo en esta página', () => {
    const w = form.querySelector('.cf-turnstile')!;
    expect(w.getAttribute('data-sitekey')).toBeTruthy();
    expect(w.getAttribute('data-language')).toBe(lang);
    const scripts = page.querySelectorAll(`script[src="${TURNSTILE}"]`);
    expect(scripts).toHaveLength(1);
  });

  it.each(['validation', 'captcha', 'send', 'network'])('#form-error-%s accesible', (code) => {
    const el = page.querySelector(`#form-error-${code}`)!;
    expect(el.getAttribute('role')).toBe('alert');
    expect(el.getAttribute('class')).toContain('form-error');
    expect(el.hasAttribute('style')).toBe(false);
  });
});

describe('Turnstile y CSS de errores', () => {
  it('el script de Turnstile solo aparece en las 3 páginas de contacto', () => {
    const contact = LANGS.map((l) => pagePath('contact', l));
    const found = distFiles().filter((f) => readFileSync(join('dist', f), 'utf8').includes('challenges.cloudflare.com'));
    expect(found.sort()).toEqual(contact.map((p) => p.replace(/^\//, '') + 'index.html').sort());
  });

  it('errores ocultos por defecto y visibles con :target', () => {
    const dir = join('dist', '_astro');
    const css = readdirSync(dir)
      .filter((f) => f.endsWith('.css'))
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n');
    expect(css).toMatch(/\.form-error\{[^}]*display:\s*none/);
    expect(css).toMatch(/\.form-error:target/);
  });
});
