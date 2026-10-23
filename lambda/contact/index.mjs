import { timingSafeEqual } from 'node:crypto';
import { PATHS } from './paths.mjs';
import { isHoneypot, normalizeLang, validateForm } from './validate.mjs';
import { verifyTurnstile } from './turnstile.mjs';
import { buildEmail } from './mail.mjs';

const MAX_BODY = 16 * 1024;
const DEFAULT_SECRET_PARAM = '/jlc-web-publica/turnstile-secret';

// Solo el resultado y, en los fallos de SES/SSM, la clase del error (nunca su mensaje: puede
// llevar direcciones u otros datos del envío). Un name con otra forma se registra como 'unknown'.
const log = (result, error) => console.log(JSON.stringify(error === undefined ? { result } : { result, error }));
const errorName = (e) => {
  const n = e?.name;
  return typeof n === 'string' && /^[A-Za-z][A-Za-z0-9_.]{0,63}$/.test(n) ? n : 'unknown';
};

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Devuelve los campos del formulario o null si el cuerpo no es admisible. */
function parseBody(event) {
  const ct = String(event.headers?.['content-type'] ?? '').toLowerCase();
  let raw = event.body ?? '';
  const buf = event.isBase64Encoded ? Buffer.from(raw, 'base64') : Buffer.from(raw, 'utf8');
  if (buf.length > MAX_BODY) return null;
  raw = buf.toString('utf8');
  try {
    if (ct.startsWith('application/x-www-form-urlencoded')) {
      return Object.fromEntries(new URLSearchParams(raw));
    }
    if (ct.startsWith('application/json')) {
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : null;
    }
  } catch {
    return null;
  }
  return null;
}

const viewerIp = (headers) => {
  const v = headers?.['cloudfront-viewer-address'];
  if (!v) return undefined;
  const i = v.lastIndexOf(':');
  const ip = i > 0 ? v.slice(0, i) : v;
  return ip.replace(/^\[(.*)\]$/, '$1');
};

/**
 * @typedef {{ statusCode: number, headers: Record<string, string>, body: string }} LambdaResponse
 * @param {{
 *   sendEmail: (msg: any) => Promise<void>,
 *   getTurnstileSecret: () => Promise<string>,
 *   fetchImpl?: typeof fetch,
 *   turnstileTimeoutMs?: number,
 *   env: { ORIGIN_VERIFY?: string, TO?: string, FROM?: string, TURNSTILE_HOSTNAMES?: string },
 * }} deps
 * @returns {(event: any) => Promise<LambdaResponse>}
 */
export function makeHandler({ sendEmail, getTurnstileSecret, fetchImpl = fetch, turnstileTimeoutMs, env }) {
  return async function handler(event) {
    const headers = event.headers ?? {};
    const json = String(headers.accept ?? '').toLowerCase().includes('application/json');

    const respond = (result, lang, error) => {
      log(result, error);
      const ok = result === 'ok' || result === 'honeypot';
      // 'secret' solo se distingue en los logs; el visitante ve 'send'.
      const code = result === 'secret' ? 'send' : result;
      if (json) {
        const status = ok ? 200 : code === 'send' ? 502 : 400;
        return {
          statusCode: status,
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
          body: JSON.stringify(ok ? { ok: true } : { ok: false, error: code }),
        };
      }
      const p = PATHS[lang] ?? PATHS.es;
      const location = ok ? p.thanks : `${p.contact}?error=${code}#form-error-${code}`;
      return { statusCode: 303, headers: { location, 'cache-control': 'no-store' }, body: '' };
    };

    if (!safeEqual(headers['x-origin-verify'], env.ORIGIN_VERIFY) || !env.ORIGIN_VERIFY) {
      log('forbidden');
      return { statusCode: 403, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: 'Forbidden' };
    }
    if (event.requestContext?.http?.method !== 'POST') {
      log('method');
      return {
        statusCode: 405,
        headers: { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' },
        body: 'Method Not Allowed',
      };
    }

    const input = parseBody(event);
    if (!input) return respond('validation', 'es');
    const lang = normalizeLang(input.lang);

    if (isHoneypot(input)) return respond('honeypot', lang);

    const v = validateForm(input);
    if (!v.ok) return respond('validation', lang);

    let secret;
    try {
      secret = await getTurnstileSecret();
    } catch (e) {
      return respond('secret', lang, errorName(e));
    }
    const hostnames = (env.TURNSTILE_HOSTNAMES ?? '')
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    const human = await verifyTurnstile(input['cf-turnstile-response'], secret, viewerIp(headers), fetchImpl, {
      hostnames,
      timeoutMs: turnstileTimeoutMs,
    });
    if (!human) return respond('captcha', lang);

    try {
      await sendEmail({ to: env.TO, from: env.FROM, ...buildEmail(v.data, new Date()) });
    } catch (e) {
      return respond('send', lang, errorName(e));
    }
    return respond('ok', lang);
  };
}

const CLIENT_CONFIG = {
  requestHandler: { requestTimeout: 3000, connectionTimeout: 1000 },
  maxAttempts: 2,
};

export function createAwsDeps({ SESv2Client, SendEmailCommand, SSMClient, GetParameterCommand, env }) {
  const ses = new SESv2Client({ ...CLIENT_CONFIG });
  const ssm = new SSMClient({ ...CLIENT_CONFIG });
  let cachedSecret;
  return {
    sendEmail: async ({ to, from, replyTo, subject, text }) => {
      if (!to || !from) throw new Error('mail env missing');
      await ses.send(
        new SendEmailCommand({
          FromEmailAddress: from,
          Destination: { ToAddresses: [to] },
          ReplyToAddresses: [replyTo],
          Content: {
            Simple: {
              Subject: { Data: subject, Charset: 'UTF-8' },
              Body: { Text: { Data: text, Charset: 'UTF-8' } },
            },
          },
        }),
      );
    },
    getTurnstileSecret: async () => {
      if (cachedSecret) return cachedSecret;
      const out = await ssm.send(
        new GetParameterCommand({
          Name: env.TURNSTILE_SECRET_PARAM || DEFAULT_SECRET_PARAM,
          WithDecryption: true,
        }),
      );
      const value = out?.Parameter?.Value;
      if (!value) throw new Error('secret missing');
      cachedSecret = value;
      return cachedSecret;
    },
  };
}

async function defaultDeps() {
  // El SDK v3 viene en el runtime de Node 22; import dinámico para que los tests no lo carguen.
  const { SESv2Client, SendEmailCommand } = await import('@aws-sdk/client-sesv2');
  const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm');
  return createAwsDeps({ SESv2Client, SendEmailCommand, SSMClient, GetParameterCommand, env: process.env });
}

let real;
export const handler = async (event) => {
  real ??= makeHandler({
    ...(await defaultDeps()),
    fetchImpl: fetch,
    env: process.env,
  });
  return real(event);
};
