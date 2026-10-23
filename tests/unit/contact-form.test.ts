// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initContactForm, submitContact } from '../../src/scripts/contact-form';
import { t, type UiKey } from '../../src/i18n/ui';

const CODES = ['validation', 'captcha', 'send', 'network'] as const;

function mountForm(lang: 'es' | 'en' | 'ca' = 'ca') {
  document.documentElement.lang = lang;
  const alerts = CODES.map(
    (c) =>
      `<p id="form-error-${c}" class="form-error" role="alert" tabindex="-1">${t(lang, `error.${c}` as UiKey)}</p>`,
  ).join('');
  document.body.innerHTML = `
    <form method="post" action="/api/contact" data-contact-form data-thanks="/ca/contacte/gracies/">
      <input name="name" value="Ana" />
      <input name="email" value="ana@example.com" />
      <textarea name="message">Mensaje de prueba largo</textarea>
      <input type="hidden" name="lang" value="${lang}" />
      <input type="hidden" name="cf-turnstile-response" value="tok" />
      <button type="submit" data-sending="Enviando">Enviar</button>
      ${alerts}
    </form>`;
  return document.querySelector('form')!;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('submitContact', () => {
  let form: HTMLFormElement;
  beforeEach(() => {
    form = mountForm();
  });

  it('200 {"ok":true} -> ok, con POST urlencoded y Accept JSON', async () => {
    const fetchImpl = vi.fn(async () => json(200, { ok: true }));
    expect(await submitContact(form, fetchImpl as unknown as typeof fetch)).toBe('ok');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/contact');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Accept).toBe('application/json');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const body = new URLSearchParams(init.body as string);
    expect(body.get('name')).toBe('Ana');
    expect(body.get('cf-turnstile-response')).toBe('tok');
  });

  it.each([
    [400, { ok: false, error: 'captcha' }, 'captcha'],
    [400, { ok: false, error: 'validation' }, 'validation'],
    [502, { ok: false, error: 'send' }, 'send'],
  ])('%i %j -> %s', async (status, body, expected) => {
    const fetchImpl = async () => json(status, body);
    expect(await submitContact(form, fetchImpl as unknown as typeof fetch)).toBe(expected);
  });

  it('429 con cuerpo HTML -> network', async () => {
    const fetchImpl = async () => new Response('<html>Too many</html>', { status: 429 });
    expect(await submitContact(form, fetchImpl as unknown as typeof fetch)).toBe('network');
  });

  it('200 sin JSON o con error desconocido -> network', async () => {
    expect(await submitContact(form, (async () => new Response('ok')) as unknown as typeof fetch)).toBe('network');
    expect(
      await submitContact(form, (async () => json(400, { error: 'otra' })) as unknown as typeof fetch),
    ).toBe('network');
  });

  it('fetch que nunca responde -> network tras el timeout', async () => {
    const hang = (_u: string, init: RequestInit) =>
      new Promise<Response>((_res, rej) => init.signal!.addEventListener('abort', () => rej(init.signal!.reason)));
    expect(await submitContact(form, hang as unknown as typeof fetch, 20)).toBe('network');
  });

  it('fetch rechazado -> network', async () => {
    const fetchImpl = async () => {
      throw new TypeError('fail');
    };
    expect(await submitContact(form, fetchImpl as unknown as typeof fetch)).toBe('network');
  });
});

describe('initContactForm', () => {
  const visible = () => [...document.querySelectorAll<HTMLElement>('[role=alert].is-visible')];

  it.each([
    ['es', 'captcha', () => json(400, { ok: false, error: 'captcha' })],
    ['en', 'validation', () => json(400, { ok: false, error: 'validation' })],
    ['ca', 'send', () => json(502, { ok: false, error: 'send' })],
    ['es', 'network', () => new Response('<html></html>', { status: 429 })],
  ] as const)('%s / %s: reactiva el botón y muestra el error', async (lang, code, respond) => {
    const form = mountForm(lang);
    const fetchImpl = vi.fn(async () => respond());
    const reset = vi.fn();
    (window as unknown as { turnstile: { reset: () => void } }).turnstile = { reset };
    const done = initContactForm(form, fetchImpl as unknown as typeof fetch);
    const button = form.querySelector('button')!;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Enviando');
    expect(button.getAttribute('aria-busy')).toBe('true');
    await done.settled();
    expect(button.disabled).toBe(false);
    const shown = visible();
    expect(shown).toHaveLength(1);
    expect(shown[0].id).toBe(`form-error-${code}`);
    expect(shown[0].textContent).toBe(t(document.documentElement.lang as 'es', `error.${code}` as UiKey));
    expect(document.activeElement).toBe(shown[0]);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe('Enviar');
    expect(button.hasAttribute('aria-busy')).toBe(false);
  });

  it('ok: navega a data-thanks y no muestra errores', async () => {
    const form = mountForm('ca');
    const assign = vi.fn();
    const done = initContactForm(form, (async () => json(200, { ok: true })) as unknown as typeof fetch, assign);
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await done.settled();
    expect(assign).toHaveBeenCalledWith('/ca/contacte/gracies/');
    expect(visible()).toHaveLength(0);
  });

  it('un nuevo envío oculta el error anterior', async () => {
    const form = mountForm('es');
    let n = 0;
    const fetchImpl = async () => (n++ === 0 ? json(400, { error: 'captcha' }) : json(502, { error: 'send' }));
    const done = initContactForm(form, fetchImpl as unknown as typeof fetch);
    for (let i = 0; i < 2; i++) {
      form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      await done.settled();
    }
    expect(visible().map((e) => e.id)).toEqual(['form-error-send']);
  });
});

describe('estado visible y bfcache', () => {
  it('solo queda visible el nuevo error aunque otro estuviera marcado', async () => {
    const form = mountForm('es');
    form.querySelector('#form-error-captcha')!.classList.add('is-visible');
    const done = initContactForm(form, (async () => json(502, { error: 'send' })) as unknown as typeof fetch);
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await done.settled();
    const vis = (id: string) => form.querySelector(`#form-error-${id}`)!.classList;
    expect(vis('send').contains('is-visible')).toBe(true);
    expect(vis('send').contains('is-hidden')).toBe(false);
    for (const c of ['captcha', 'validation', 'network']) {
      expect(vis(c).contains('is-visible')).toBe(false);
      expect(vis(c).contains('is-hidden')).toBe(true);
    }
  });

  it('pageshow persistente reactiva el botón y reinicia Turnstile', () => {
    const form = mountForm('es');
    const reset = vi.fn();
    (window as unknown as { turnstile: { reset: () => void } }).turnstile = { reset };
    initContactForm(form, (async () => json(200, { ok: true })) as unknown as typeof fetch, vi.fn());
    const button = form.querySelector('button')!;
    button.disabled = true;
    button.textContent = 'Enviando';
    const ev = new Event('pageshow') as Event & { persisted: boolean };
    ev.persisted = true;
    window.dispatchEvent(ev);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Enviar');
    expect(reset).toHaveBeenCalled(); // (los initContactForm de tests previos también escuchan)
  });
});
