import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeHandler } from '../../lambda/contact/index.mjs';
import { PATHS } from '../../lambda/contact/paths.mjs';

const ENV = {
  ORIGIN_VERIFY: 'secret-origin',
  TO: 'jlcampos@jlc-ingenieros.com',
  FROM: 'JLC Ingenieros web <web@jlc-ingenieros.com>',
};
const valid = {
  name: 'María Pérez',
  email: 'maria@example.com',
  phone: '600 111 222',
  message: 'Quisiera pedir presupuesto de una instalación.',
  privacy: 'on',
  lang: 'es',
  'cf-turnstile-response': 'tok',
};

function setup(over: { turnstile?: boolean; sendFails?: boolean } = {}) {
  const sendEmail = vi.fn(async (_m: unknown) => {
    if (over.sendFails) throw new Error('SES down');
  });
  const fetchImpl = vi.fn(async () => ({ json: async () => ({ success: over.turnstile ?? true }) }) as Response);
  const getTurnstileSecret = vi.fn(async () => 'ts-secret');
  const handler = makeHandler({
    sendEmail,
    getTurnstileSecret,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    env: ENV,
  });
  return { handler, sendEmail, fetchImpl, getTurnstileSecret };
}

function ev(
  fields: Record<string, string> | string,
  opts: {
    method?: string;
    accept?: string;
    origin?: string | null;
    contentType?: string;
    base64?: boolean;
  } = {},
) {
  const ct = opts.contentType ?? 'application/x-www-form-urlencoded';
  let body = typeof fields === 'string' ? fields : ct.includes('json') ? JSON.stringify(fields) : new URLSearchParams(fields).toString();
  if (opts.base64) body = Buffer.from(body).toString('base64');
  const headers: Record<string, string> = {
    'content-type': ct,
    accept: opts.accept ?? 'text/html',
    'cloudfront-viewer-address': '203.0.113.9:51234',
  };
  if (opts.origin !== null) headers['x-origin-verify'] = opts.origin ?? ENV.ORIGIN_VERIFY;
  return {
    body,
    isBase64Encoded: !!opts.base64,
    headers,
    requestContext: { http: { method: opts.method ?? 'POST' } },
  };
}

const JSON_ACCEPT = 'application/json';
const loc = (r: { headers?: Record<string, string> }) => r.headers?.location ?? r.headers?.Location;

let logSpies: ReturnType<typeof vi.spyOn>[];
beforeEach(() => {
  logSpies = (['log', 'error', 'warn', 'info'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => vi.restoreAllMocks());

describe('acceso', () => {
  it('sin x-origin-verify -> 403 y nada enviado', async () => {
    const { handler, sendEmail } = setup();
    const r = await handler(ev(valid, { origin: null }));
    expect(r.statusCode).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it('x-origin-verify incorrecto (misma o distinta longitud) -> 403', async () => {
    const { handler, sendEmail } = setup();
    expect((await handler(ev(valid, { origin: 'secret-originX' }))).statusCode).toBe(403);
    expect((await handler(ev(valid, { origin: 'secret-origiz' }))).statusCode).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it('GET -> 405', async () => {
    const { handler } = setup();
    const r = await handler(ev('', { method: 'GET' }));
    expect(r.statusCode).toBe(405);
    expect(r.headers?.allow ?? r.headers?.Allow).toBe('POST');
  });
  it('403 tiene prioridad sobre 405', async () => {
    const { handler } = setup();
    expect((await handler(ev('', { method: 'GET', origin: null }))).statusCode).toBe(403);
  });
});

describe('cuerpo', () => {
  it('> 16 KB -> 400 validation (JSON)', async () => {
    const { handler, sendEmail } = setup();
    const r = await handler(ev({ ...valid, message: 'x'.repeat(17 * 1024) }, { accept: JSON_ACCEPT }));
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body!)).toEqual({ ok: false, error: 'validation' });
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it('> 16 KB se mide tras decodificar base64', async () => {
    const { handler } = setup();
    const r = await handler(ev({ ...valid, message: 'x'.repeat(17 * 1024) }, { accept: JSON_ACCEPT, base64: true }));
    expect(r.statusCode).toBe(400);
  });
  it('content-type no admitido -> validation', async () => {
    const { handler, sendEmail } = setup();
    const r = await handler(ev('hola', { contentType: 'text/plain', accept: JSON_ACCEPT }));
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body!).error).toBe('validation');
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it('JSON inválido -> validation', async () => {
    const { handler } = setup();
    const r = await handler(ev('{no', { contentType: 'application/json', accept: JSON_ACCEPT }));
    expect(JSON.parse(r.body!).error).toBe('validation');
  });
  it('acepta JSON y base64', async () => {
    const { handler, sendEmail } = setup();
    const r = await handler(ev(valid, { contentType: 'application/json; charset=utf-8', accept: JSON_ACCEPT, base64: true }));
    expect(r.statusCode).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
  it('sin body -> validation', async () => {
    const { handler } = setup();
    const e = ev(valid, { accept: JSON_ACCEPT });
    delete (e as { body?: string }).body;
    expect(JSON.parse((await handler(e)).body!).error).toBe('validation');
  });
});

describe('flujo', () => {
  it('campo trampa -> 303 a thanks, sin enviar ni verificar', async () => {
    const { handler, sendEmail, fetchImpl } = setup();
    const r = await handler(ev({ ...valid, lang: 'en', website: 'http://spam' }));
    expect(r.statusCode).toBe(303);
    expect(loc(r)).toBe(PATHS.en.thanks);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('campo trampa en modo JSON -> 200 ok sin enviar', async () => {
    const { handler, sendEmail } = setup();
    const r = await handler(ev({ ...valid, website: 'x' }, { accept: JSON_ACCEPT }));
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body!)).toEqual({ ok: true });
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it('validación fallida (HTML, lang=ca) -> 303 con ?error y fragmento', async () => {
    const { handler } = setup();
    const r = await handler(ev({ ...valid, lang: 'ca', message: 'corto' }));
    expect(r.statusCode).toBe(303);
    expect(loc(r)).toBe('/ca/contacte/?error=validation#form-error-validation');
  });
  it('validación fallida con lang desconocido -> redirige a es', async () => {
    const { handler } = setup();
    const r = await handler(ev({ ...valid, lang: 'fr', message: 'corto' }));
    expect(loc(r)).toBe('/contacto/?error=validation#form-error-validation');
  });
  it('validación fallida (JSON) -> 400', async () => {
    const { handler } = setup();
    const r = await handler(ev({ ...valid, message: 'corto' }, { accept: JSON_ACCEPT }));
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body!)).toEqual({ ok: false, error: 'validation' });
    expect(r.headers?.['content-type']).toMatch(/application\/json/);
  });
  it('Turnstile false -> 400 captcha (JSON) / 303 ?error=captcha (HTML)', async () => {
    const { handler, sendEmail } = setup({ turnstile: false });
    const j = await handler(ev(valid, { accept: JSON_ACCEPT }));
    expect(j.statusCode).toBe(400);
    expect(JSON.parse(j.body!)).toEqual({ ok: false, error: 'captcha' });
    const h = await handler(ev({ ...valid, lang: 'en' }));
    expect(loc(h)).toBe('/en/contact/?error=captcha#form-error-captcha');
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it('Turnstile recibe token, secreto e IP del viewer sin puerto', async () => {
    const { handler, fetchImpl } = setup();
    await handler(ev(valid, { accept: JSON_ACCEPT }));
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    const p = new URLSearchParams(String(init.body));
    expect(p.get('secret')).toBe('ts-secret');
    expect(p.get('response')).toBe('tok');
    expect(p.get('remoteip')).toBe('203.0.113.9');
  });
  it('IP IPv6 del viewer: se corta por el último ":"', async () => {
    const { handler, fetchImpl } = setup();
    const e = ev(valid, { accept: JSON_ACCEPT });
    e.headers['cloudfront-viewer-address'] = '2001:db8::1:443';
    await handler(e);
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new URLSearchParams(String(init.body)).get('remoteip')).toBe('2001:db8::1');
  });
  it('fallo al leer el secreto de Turnstile -> 502 send', async () => {
    const { handler, getTurnstileSecret, sendEmail } = setup();
    getTurnstileSecret.mockRejectedValueOnce(new Error('ssm'));
    const r = await handler(ev(valid, { accept: JSON_ACCEPT }));
    expect(r.statusCode).toBe(502);
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it('sendEmail lanza -> 502 send (JSON) / 303 ?error=send (HTML)', async () => {
    const { handler } = setup({ sendFails: true });
    const j = await handler(ev(valid, { accept: JSON_ACCEPT }));
    expect(j.statusCode).toBe(502);
    expect(JSON.parse(j.body!)).toEqual({ ok: false, error: 'send' });
    const h = await handler(ev(valid));
    expect(h.statusCode).toBe(303);
    expect(loc(h)).toBe('/contacto/?error=send#form-error-send');
  });
  it('éxito JSON -> 200 {ok:true} y un solo envío con To/From/ReplyTo', async () => {
    const { handler, sendEmail } = setup();
    const r = await handler(ev(valid, { accept: JSON_ACCEPT }));
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body!)).toEqual({ ok: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const msg = sendEmail.mock.calls[0][0] as Record<string, string>;
    expect(msg.to).toBe('jlcampos@jlc-ingenieros.com');
    expect(msg.from).toBe('JLC Ingenieros web <web@jlc-ingenieros.com>');
    expect(msg.replyTo).toBe('maria@example.com');
    expect(msg.subject).toBe('[Web] Contacto de María Pérez');
    expect(msg.text).toContain('Quisiera pedir presupuesto');
  });
  it('éxito HTML -> 303 a thanks del idioma', async () => {
    const { handler } = setup();
    const r = await handler(ev({ ...valid, lang: 'ca' }));
    expect(r.statusCode).toBe(303);
    expect(loc(r)).toBe('/ca/contacte/gracies/');
    const r2 = await handler(ev(valid));
    expect(loc(r2)).toBe('/contacto/gracias/');
  });
});

describe('logs sin datos personales', () => {
  it('ningún console.* recibe nombre, email, teléfono, mensaje ni IP; hay una línea con result', async () => {
    const cases = [
      setup(),
      setup({ turnstile: false }),
      setup({ sendFails: true }),
    ];
    for (const c of cases) await c.handler(ev(valid, { accept: JSON_ACCEPT }));
    await cases[0].handler(ev({ ...valid, message: 'corto' }));
    await cases[0].handler(ev({ ...valid, website: 'x' }));
    await cases[0].handler(ev(valid, { origin: null }));
    await cases[0].handler(ev('', { method: 'GET' }));

    const calls = logSpies.flatMap((s) => s.mock.calls);
    const dump = JSON.stringify(calls);
    for (const pii of ['María', 'Pérez', 'maria@example.com', '600 111 222', 'Quisiera', '203.0.113.9', 'tok', 'secret-origin']) {
      expect(dump, pii).not.toContain(pii);
    }
    const results = calls
      .map((c) => String(c[0]))
      .filter((s) => s.startsWith('{'))
      .map((s) => JSON.parse(s).result);
    expect(results).toEqual(
      expect.arrayContaining(['ok', 'captcha', 'send', 'validation', 'honeypot', 'forbidden', 'method']),
    );
  });
});
