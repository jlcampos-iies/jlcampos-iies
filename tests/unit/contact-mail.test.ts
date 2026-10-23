import { describe, expect, it, vi } from 'vitest';
import { buildEmail } from '../../lambda/contact/mail.mjs';
import { verifyTurnstile } from '../../lambda/contact/turnstile.mjs';

const data = {
  name: 'Eve',
  email: 'eve@example.com',
  phone: '+34 600 000 000',
  message: 'Hola,\nquiero información.',
  lang: 'en',
};
const now = new Date('2026-10-23T10:20:30.000Z');

describe('buildEmail', () => {
  it('asunto con nombre', () => {
    expect(buildEmail(data, now).subject).toBe('[Web] Contacto de Eve');
  });
  it('el asunto no contiene CR ni LF aunque el nombre los traiga', () => {
    const { subject } = buildEmail({ ...data, name: 'Eve\r\nBcc: x' }, now);
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject.startsWith('[Web] Contacto de Eve')).toBe(true);
  });
  it('el nombre del asunto se limita a 100 caracteres', () => {
    const { subject } = buildEmail({ ...data, name: 'x'.repeat(300) }, now);
    expect(subject).toBe(`[Web] Contacto de ${'x'.repeat(100)}`);
  });
  it('el cuerpo contiene todos los campos y la fecha ISO', () => {
    const { text } = buildEmail(data, now);
    for (const s of [data.name, data.email, data.phone, data.message, 'en', '2026-10-23T10:20:30.000Z']) {
      expect(text).toContain(s);
    }
  });
  it('replyTo es el email', () => {
    expect(buildEmail(data, now).replyTo).toBe('eve@example.com');
  });
});

describe('verifyTurnstile', () => {
  const ok = (body: unknown) => vi.fn(async () => ({ json: async () => body }) as Response);
  it('POST urlencoded a siteverify con secret, response y remoteip', async () => {
    const f = ok({ success: true });
    expect(await verifyTurnstile('tok', 'sec', '1.2.3.4', f as unknown as typeof fetch)).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/x-www-form-urlencoded');
    const p = new URLSearchParams(String(init.body));
    expect(p.get('secret')).toBe('sec');
    expect(p.get('response')).toBe('tok');
    expect(p.get('remoteip')).toBe('1.2.3.4');
  });
  it('omite remoteip si no hay', async () => {
    const f = ok({ success: true });
    await verifyTurnstile('tok', 'sec', undefined, f as unknown as typeof fetch);
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new URLSearchParams(String(init.body)).has('remoteip')).toBe(false);
  });
  it('false si success no es exactamente true', async () => {
    expect(await verifyTurnstile('t', 's', undefined, ok({ success: 'true' }) as unknown as typeof fetch)).toBe(false);
    expect(await verifyTurnstile('t', 's', undefined, ok({ success: false }) as unknown as typeof fetch)).toBe(false);
  });
  it('false con token vacío sin llamar a la red', async () => {
    const f = ok({ success: true });
    expect(await verifyTurnstile('', 's', undefined, f as unknown as typeof fetch)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it('false ante error de red o JSON inválido', async () => {
    const boom = vi.fn(async () => {
      throw new Error('net');
    });
    expect(await verifyTurnstile('t', 's', undefined, boom as unknown as typeof fetch)).toBe(false);
    const bad = vi.fn(async () => ({ json: async () => { throw new Error('x'); } }) as unknown as Response);
    expect(await verifyTurnstile('t', 's', undefined, bad as unknown as typeof fetch)).toBe(false);
  });
});
