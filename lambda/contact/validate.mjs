import { LANGS } from './paths.mjs';

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const PHONE_RE = /^[0-9 +()-]*$/;

const str = (v) => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : null);

/** Idioma normalizado: cualquier valor desconocido cae a 'es'. */
export function normalizeLang(v) {
  return typeof v === 'string' && LANGS.includes(v.trim()) ? v.trim() : 'es';
}

/** @param {Record<string, any>} input */
export function isHoneypot(input) {
  const w = input?.website;
  return typeof w === 'string' && w.trim() !== '';
}

/**
 * @typedef {{ name: string, email: string, phone: string, message: string, lang: string }} FormData
 * @param {Record<string, any>} input
 * @returns {{ ok: true, data: FormData } | { ok: false, data?: undefined }}
 */
export function validateForm(input) {
  const name = str(input.name);
  const email = str(input.email);
  const phone = str(input.phone);
  const message = str(input.message);
  if (name === null || email === null || phone === null || message === null) return { ok: false };

  if (name.length < 1 || name.length > 100) return { ok: false };
  if (email.length > 254 || !EMAIL_RE.test(email)) return { ok: false };
  if (phone.length > 30 || !PHONE_RE.test(phone)) return { ok: false };
  if (message.length < 10 || message.length > 5000) return { ok: false };
  if (input.privacy !== 'on') return { ok: false };

  return { ok: true, data: { name, email, phone, message, lang: normalizeLang(input.lang) } };
}
