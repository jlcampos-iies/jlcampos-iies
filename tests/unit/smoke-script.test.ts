import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const FICHAS = [
  '/proyectos/apartamentos-turisticos/',
  '/proyectos/fabrica-de-hielo/',
  '/proyectos/instalacion-de-captacion-de-energia-solar-termica-en-edificio-de-viviendas/',
  '/proyectos/instalacion-solar-fotovoltaica-en-modalidad-de-autoconsumo/',
  '/proyectos/instalacion-solar-fotovoltaica/',
  '/proyectos/nave-industrial/',
];
const OK_PAGES = ['/', '/en/', '/ca/', '/estudio/', ...FICHAS];
const REDIRECTS: Record<string, string> = { '/en/home/': '/en/', '/ca/inici/': '/ca/', '/feed/': '/' };
const SECURITY = {
  'strict-transport-security': 'max-age=63072000',
  'content-security-policy': "default-src 'self'",
  'x-content-type-options': 'nosniff',
};

type Overrides = {
  failPath?: string;
  contactStatus?: number;
  contactBody?: string;
  noHeaders?: boolean;
  /** Ruta que falla las primeras N peticiones y luego responde bien (propagacion de la invalidacion). */
  flaky?: { path: string; failures: number };
  /** Ruta (GET) o cabeceras/POST de contacto que nunca responden: curl tiene que cortar por --max-time. */
  hangPath?: string;
  hangContact?: boolean;
};

function fakeSite(o: Overrides = {}): Promise<Server> {
  const seen: Record<string, number> = {};
  const server = createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    seen[url] = (seen[url] ?? 0) + 1;
    if (url === o.hangPath || (o.hangContact && url === '/api/contact')) return; // no responde nunca
    if (req.method === 'POST' && url === '/api/contact') {
      res.writeHead(o.contactStatus ?? 400, { 'content-type': 'application/json' });
      res.end(o.contactBody ?? '{"ok":false,"error":"validation"}');
      return;
    }
    if (o.flaky && url === o.flaky.path && seen[url] <= o.flaky.failures) {
      res.writeHead(503).end();
      return;
    }
    if (url === o.failPath) {
      res.writeHead(500).end('boom');
      return;
    }
    if (url in REDIRECTS) {
      res.writeHead(301, { location: REDIRECTS[url] }).end();
      return;
    }
    if (url === '/wp-login.php') {
      res.writeHead(404).end('Not Found');
      return;
    }
    if (OK_PAGES.includes(url)) {
      res.writeHead(200, { 'content-type': 'text/html', ...(o.noHeaders ? {} : SECURITY) }).end('<html></html>');
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const servers: Server[] = [];
afterEach(() => {
  while (servers.length) servers.pop()!.close();
});

async function runSmoke(o: Overrides = {}, args: string[] = [], env: Record<string, string> = {}) {
  const server = await fakeSite(o);
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // spawn asincrono: con execFileSync el bucle de eventos se bloquearia y el servidor no responderia.
  return new Promise<{ code: number | null; out: string }>((resolve) => {
    const child = spawn('bash', ['scripts/smoke.sh', base, ...args], {
      env: { ...process.env, SMOKE_RETRIES: '2', SMOKE_DELAY: '0', ...env },
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
  });
}

describe('scripts/smoke.sh', () => {
  it('sale con 0 e imprime OK por cada comprobacion cuando todo responde bien', async () => {
    const { code, out } = await runSmoke();
    expect(out).not.toContain('FAIL');
    expect(code).toBe(0);
    const oks = out.split('\n').filter((l) => l.startsWith('OK '));
    expect(oks.length).toBeGreaterThanOrEqual(OK_PAGES.length + 3 + 1 + 3 + 1);
    expect(out).toContain('OK GET /estudio/ -> 200');
    expect(out).toContain('OK GET /en/home/ -> 301 /en/');
    expect(out).toContain('OK GET /wp-login.php -> 404');
    expect(out).toContain('OK POST /api/contact -> 400 validation');
  });

  it('sale con 1 y marca FAIL cuando una ruta devuelve 500', async () => {
    const { code, out } = await runSmoke({ failPath: '/estudio/' });
    expect(code).toBe(1);
    expect(out).toContain('FAIL GET /estudio/');
    expect(out).toContain('OK GET /en/ -> 200');
  });

  it('falla si faltan las cabeceras de seguridad', async () => {
    const { code, out } = await runSmoke({ noHeaders: true });
    expect(code).toBe(1);
    expect(out).toContain('FAIL header strict-transport-security');
  });

  it('falla si el formulario responde 403 (CloudFront no llega a la Lambda)', async () => {
    const { code, out } = await runSmoke({ contactStatus: 403, contactBody: '{"message":"Forbidden"}' });
    expect(code).toBe(1);
    expect(out).toContain('FAIL POST /api/contact');
  });

  it('falla si el 400 no es el error de validacion', async () => {
    const { code, out } = await runSmoke({ contactStatus: 400, contactBody: '{"ok":false,"error":"turnstile"}' });
    expect(code).toBe(1);
    expect(out).toContain('FAIL POST /api/contact');
  });

  it('reintenta: tolera un fallo transitorio por propagacion', async () => {
    const { code, out } = await runSmoke({ flaky: { path: '/ca/', failures: 1 } });
    expect(code).toBe(0);
    expect(out).toContain('OK GET /ca/ -> 200');
  });

  it('corta las peticiones que no responden (--max-time) y marca FAIL sin colgarse', async () => {
    const t0 = Date.now();
    const { code, out } = await runSmoke({ hangPath: '/', hangContact: true }, [], { SMOKE_MAX_TIME: '1' });
    expect(code).toBe(1);
    expect(out).toContain('FAIL GET / -> 200');
    expect(out).toContain('FAIL header strict-transport-security en /');
    expect(out).toContain('FAIL POST /api/contact');
    expect(out).toContain('OK GET /en/ -> 200');
    // 2 intentos x (1 GET + 3 cabeceras + 1 POST) x ~1 s
    expect(Date.now() - t0).toBeLessThan(15_000);
  }, 30_000);

  it('rechaza una ejecucion sin URL base', async () => {
    const code = await new Promise((resolve) =>
      spawn('bash', ['scripts/smoke.sh']).on('close', resolve),
    );
    expect(code).toBe(2);
  });
});
