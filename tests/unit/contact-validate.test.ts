import { describe, expect, it } from 'vitest';
import { validateForm, isHoneypot } from '../../lambda/contact/validate.mjs';

const base = {
  name: 'José Luis Giménez',
  email: 'jl@example.com',
  phone: '+34 616 992 440',
  message: 'Necesito un presupuesto para una instalación.',
  privacy: 'on',
  lang: 'ca',
};

describe('validateForm', () => {
  it('acepta un caso válido y conserva acentos y punto medio', () => {
    const r = validateForm({ ...base, name: 'José Luis Giménez', message: 'Col·legi oficial: consulta' });
    expect(r).toEqual({
      ok: true,
      data: {
        name: 'José Luis Giménez',
        email: 'jl@example.com',
        phone: '+34 616 992 440',
        message: 'Col·legi oficial: consulta',
        lang: 'ca',
      },
    });
  });
  it('recorta espacios', () => {
    const r = validateForm({ ...base, name: '  Ana  ', message: '  mensaje largo ok  ' });
    expect(r.ok && r.data.name).toBe('Ana');
    expect(r.ok && r.data.message).toBe('mensaje largo ok');
  });
  it('mensaje de 9 caracteres falla; de 10 pasa', () => {
    expect(validateForm({ ...base, message: '123456789' }).ok).toBe(false);
    expect(validateForm({ ...base, message: '1234567890' }).ok).toBe(true);
  });
  it('mensaje de más de 5000 falla', () => {
    expect(validateForm({ ...base, message: 'x'.repeat(5001) }).ok).toBe(false);
    expect(validateForm({ ...base, message: 'x'.repeat(5000) }).ok).toBe(true);
  });
  it('rechaza email con CR/LF (inyección de cabeceras)', () => {
    expect(validateForm({ ...base, email: 'a@b.com\r\nBcc: x@y.z' }).ok).toBe(false);
    expect(validateForm({ ...base, email: 'a@b.com\nBcc: x@y.z' }).ok).toBe(false);
  });
  it('rechaza emails mal formados o de más de 254', () => {
    for (const email of ['', 'sin-arroba', 'a@b', 'a b@c.com', `${'a'.repeat(250)}@b.com`]) {
      expect(validateForm({ ...base, email }).ok, email).toBe(false);
    }
  });
  it('sin privacy (o distinto de "on") falla', () => {
    const { privacy: _p, ...rest } = base;
    expect(validateForm(rest).ok).toBe(false);
    expect(validateForm({ ...base, privacy: 'yes' }).ok).toBe(false);
  });
  it('nombre vacío o de más de 100 falla', () => {
    expect(validateForm({ ...base, name: '   ' }).ok).toBe(false);
    expect(validateForm({ ...base, name: 'x'.repeat(101) }).ok).toBe(false);
    expect(validateForm({ ...base, name: 'x'.repeat(100) }).ok).toBe(true);
  });
  it('teléfono opcional, ≤ 30 y solo [0-9 +()-]', () => {
    const { phone: _ph, ...rest } = base;
    const r = validateForm(rest);
    expect(r.ok && r.data.phone).toBe('');
    expect(validateForm({ ...base, phone: '123abc' }).ok).toBe(false);
    expect(validateForm({ ...base, phone: '1'.repeat(31) }).ok).toBe(false);
    expect(validateForm({ ...base, phone: '(971) 12-34-56' }).ok).toBe(true);
  });
  it('lang desconocido cae a es', () => {
    const r = validateForm({ ...base, lang: 'fr' });
    expect(r.ok && r.data.lang).toBe('es');
    const r2 = validateForm({ ...base, lang: undefined as unknown as string });
    expect(r2.ok && r2.data.lang).toBe('es');
  });
  it('valores no string no rompen', () => {
    expect(validateForm({ ...base, name: 5 as unknown as string }).ok).toBe(false);
  });
});

describe('isHoneypot', () => {
  it('true solo si website tiene contenido', () => {
    expect(isHoneypot({ website: 'http://spam' })).toBe(true);
    expect(isHoneypot({ website: '' })).toBe(false);
    expect(isHoneypot({})).toBe(false);
  });
});
