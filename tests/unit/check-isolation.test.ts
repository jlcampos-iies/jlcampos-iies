import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const D = 'jlc-ingenieros.com.';
const PRIVATE_IP = '3.12.236.157';
const TYPES: Record<string, number> = { A: 1, NS: 2, CNAME: 5, MX: 15, TXT: 16, AAAA: 28 };

type Rec = { name: string; type: string; data: string; ttl?: number };
/** Registros por "nombre|tipo consultado"; cada respuesta puede incluir registros encadenados de otra zona. */
type Zone = Record<string, Rec[]>;

function zone(): Zone {
  const ses = (t: string) => [{ name: `${t}._domainkey.${D}`, type: 'CNAME', data: `${t}.dkim.amazonses.com.` }];
  return {
    [`${D}|MX`]: [
      { name: D, type: 'MX', data: '10 mx01.mail.icloud.com.' },
      { name: D, type: 'MX', data: '20 mx02.mail.icloud.com.' },
    ],
    [`${D}|NS`]: [
      { name: D, type: 'NS', data: 'ns-520.awsdns-01.net.' },
      { name: D, type: 'NS', data: 'ns-1630.awsdns-11.co.uk.' },
    ],
    [`${D}|TXT`]: [
      { name: D, type: 'TXT', data: 'v=spf1 include:icloud.com include:_spf.firebasemail.com ~all' },
      { name: D, type: 'TXT', data: 'apple-domain=x1cUNRREqKDaDkHg' },
      // TXT con comillas escapadas en el JSON: se normalizan.
      { name: D, type: 'TXT', data: 'say "hola" \\ fin' },
    ],
    [`_dmarc.${D}|TXT`]: [{ name: `_dmarc.${D}`, type: 'TXT', data: 'v=DMARC1; p=none;' }],
    [`www.${D}|CNAME`]: [{ name: `www.${D}`, type: 'CNAME', data: D }],
    [`6wmkdnrfnxi3midc2doz4m5wc77qz7g3._domainkey.${D}|TXT`]: ses('6wmkdnrfnxi3midc2doz4m5wc77qz7g3'),
    [`h3glg2fy22z7qzzye6g6zhg3tcuingqn._domainkey.${D}|TXT`]: ses('h3glg2fy22z7qzzye6g6zhg3tcuingqn'),
    [`vdd56aijvyidt5xoo5g2lbdy73d7m2uh._domainkey.${D}|TXT`]: ses('vdd56aijvyidt5xoo5g2lbdy73d7m2uh'),
    [`firebase1._domainkey.${D}|TXT`]: [
      { name: `firebase1._domainkey.${D}`, type: 'CNAME', data: 'x.dkim1._domainkey.firebasemail.com.' },
      // Registro encadenado fuera de la zona (TTL variable): no forma parte de la foto.
      { name: 'x.dkim1._domainkey.firebasemail.com.', type: 'TXT', data: 'v=DKIM1; p=AAA', ttl: Math.floor(Math.random() * 300) },
    ],
    [`firebase2._domainkey.${D}|TXT`]: [
      { name: `firebase2._domainkey.${D}`, type: 'CNAME', data: 'x.dkim2._domainkey.firebasemail.com.' },
    ],
    [`sig1._domainkey.${D}|TXT`]: [
      { name: `sig1._domainkey.${D}`, type: 'CNAME', data: 'sig1.dkim.jlc-ingenieros.com.at.icloudmailadmin.com.' },
    ],
    [`areaprivada.${D}|A`]: [{ name: `areaprivada.${D}`, type: 'A', data: PRIVATE_IP }],
    [`areaprivada.${D}|TXT`]: [{ name: `areaprivada.${D}`, type: 'TXT', data: "'q1e3sufa64sob8p9thgav7nki4'" }],
    [`demo.${D}|A`]: [{ name: `demo.${D}`, type: 'A', data: PRIVATE_IP }],
    [`met.${D}|A`]: [{ name: `met.${D}`, type: 'A', data: PRIVATE_IP }],
  };
}

type Fake = { zone: Zone; homeStatus: number; apiStatus: number; dohStatus: number; dohFailures: number };

function fakeServer(state: Fake): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/resolve') {
      if (state.dohFailures > 0) {
        state.dohFailures--;
        res.writeHead(503).end('busy');
        return;
      }
      if (state.dohStatus !== 200) {
        res.writeHead(state.dohStatus).end('error');
        return;
      }
      const name = url.searchParams.get('name')!;
      const qtype = url.searchParams.get('type')!;
      const qname = name.endsWith('.') ? name : `${name}.`;
      const recs = state.zone[`${qname}|${qtype}`] ?? [];
      // Orden aleatorio, como un resolvedor real: la foto debe ordenarse.
      const shuffled = [...recs].sort(() => Math.random() - 0.5);
      const body: Record<string, unknown> = {
        Status: 0,
        TC: false,
        Question: [{ name: qname, type: TYPES[qtype] }],
      };
      if (shuffled.length) {
        body.Answer = shuffled.map((r) => ({ name: r.name, type: TYPES[r.type], TTL: r.ttl ?? 300, data: r.data }));
      } else {
        body.Authority = [{ name: D, type: 6, TTL: 900, data: 'ns-520.awsdns-01.net. awsdns-hostmaster.amazon.com. 1 7200 900 1209600 86400' }];
      }
      body.Comment = 'Response from 205.251.193.244.';
      res.writeHead(200, { 'content-type': 'application/x-javascript' }).end(JSON.stringify(body));
      return;
    }
    if (url.pathname === '/home/') {
      res.writeHead(state.homeStatus).end('<html></html>');
      return;
    }
    if (url.pathname === '/api/gesnorm') {
      res.writeHead(state.apiStatus).end('{}');
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

async function setup(overrides: Partial<Fake> = {}) {
  const state: Fake = { zone: zone(), homeStatus: 200, apiStatus: 401, dohStatus: 200, dohFailures: 0, ...overrides };
  const server = await fakeServer(state);
  const dir = mkdtempSync(join(tmpdir(), 'isolation-'));
  cleanup.push(() => server.close(), () => rmSync(dir, { recursive: true, force: true }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const baseline = join(dir, 'baseline.txt');
  const env = {
    ...process.env,
    ISOLATION_DOH: `${base}/resolve`,
    ISOLATION_BASELINE: baseline,
    ISOLATION_HOME_URL: `${base}/home/`,
    ISOLATION_API_URL: `${base}/api/gesnorm`,
    ISOLATION_RETRIES: '2',
    ISOLATION_DELAY: '0',
  };
  const run = (...args: string[]) =>
    new Promise<{ code: number | null; out: string }>((resolve) => {
      const child = spawn('bash', ['scripts/check-isolation.sh', ...args], { env });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('close', (code) => resolve({ code, out }));
    });
  return { state, run, baseline };
}

describe('scripts/check-isolation.sh', () => {
  it('--snapshot escribe una foto ordenada, sin TTL ni registros de otras zonas', async () => {
    const { run, baseline } = await setup();
    const { code, out } = await run('--snapshot');
    expect(out).not.toContain('FAIL');
    expect(code).toBe(0);
    const lines = readFileSync(baseline, 'utf8').trimEnd().split('\n');
    expect(lines).toEqual([...lines].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    expect(lines).toContain(`${D} MX 10 mx01.mail.icloud.com.`);
    expect(lines).toContain(`${D} TXT say "hola" \\ fin`);
    expect(lines).toContain(`www.${D} CNAME ${D}`);
    expect(lines).toContain(`firebase1._domainkey.${D} CNAME x.dkim1._domainkey.firebasemail.com.`);
    expect(lines).toContain(`areaprivada.${D} A ${PRIVATE_IP}`);
    expect(lines.join('\n')).not.toContain('firebasemail.com. TXT');
    expect(lines.join('\n')).not.toContain('300');
    // 15 consultas: todas presentes en la foto.
    for (const q of ['areaprivada', 'demo', 'met', '_dmarc', 'sig1._domainkey']) {
      expect(lines.some((l) => l.startsWith(`${q}.${D} `))).toBe(true);
    }
  });

  it('--compare sale con 0 si nada ha cambiado (aunque cambie el orden y los TTL)', async () => {
    const { run } = await setup();
    expect((await run('--snapshot')).code).toBe(0);
    const { code, out } = await run('--compare');
    expect(out).not.toContain('FAIL');
    expect(out).toContain('OK');
    expect(code).toBe(0);
  });

  it('--compare sale con 1 si cambia un MX', async () => {
    const { state, run } = await setup();
    expect((await run('--snapshot')).code).toBe(0);
    state.zone[`${D}|MX`][1].data = '20 mx.evil.example.';
    const { code, out } = await run('--compare');
    expect(code).toBe(1);
    expect(out).toContain('FAIL');
    expect(out).toContain('mx.evil.example.');
  });

  it('--compare detecta un registro protegido que desaparece', async () => {
    const { state, run } = await setup();
    expect((await run('--snapshot')).code).toBe(0);
    delete state.zone[`_dmarc.${D}|TXT`];
    const { code } = await run('--compare');
    expect(code).toBe(1);
  });

  it('--compare sale con 1 si areaprivada no apunta a 3.12.236.157', async () => {
    const { state, run } = await setup();
    expect((await run('--snapshot')).code).toBe(0);
    state.zone[`areaprivada.${D}|A`][0].data = '3.133.180.219';
    const { code, out } = await run('--compare');
    expect(code).toBe(1);
    expect(out).toMatch(/FAIL .*areaprivada/);
  });

  it('--compare sale con 1 si areaprivada responde 500', async () => {
    const { state, run } = await setup();
    expect((await run('--snapshot')).code).toBe(0);
    state.homeStatus = 500;
    const { code, out } = await run('--compare');
    expect(code).toBe(1);
    expect(out).toMatch(/FAIL area privada: GET .* -> 200 \(ahora: 500\)/);
  });

  it('--compare sale con 1 si /api/gesnorm responde 5xx', async () => {
    const { state, run } = await setup();
    expect((await run('--snapshot')).code).toBe(0);
    state.apiStatus = 502;
    const { code, out } = await run('--compare');
    expect(code).toBe(1);
    expect(out).toMatch(/FAIL .*api\/gesnorm/);
  });

  it('reintenta: tolera un fallo pasajero del DoH', async () => {
    const { state, run } = await setup();
    expect((await run('--snapshot')).code).toBe(0);
    state.dohFailures = 1;
    const { code, out } = await run('--compare');
    expect(out).not.toContain('FAIL');
    expect(code).toBe(0);
  });

  it('--snapshot no escribe la foto si el DoH falla', async () => {
    const { run, baseline } = await setup({ dohStatus: 500 });
    const { code } = await run('--snapshot');
    expect(code).toBe(1);
    expect(existsSync(baseline)).toBe(false);
  });

  it('--snapshot no escribe la foto si el area privada no responde bien', async () => {
    const { run, baseline } = await setup({ homeStatus: 503 });
    const { code } = await run('--snapshot');
    expect(code).toBe(1);
    expect(existsSync(baseline)).toBe(false);
  });

  it('--compare sin foto previa y uso incorrecto salen con 2', async () => {
    const { run } = await setup();
    expect((await run('--compare')).code).toBe(2);
    expect((await run()).code).toBe(2);
    expect((await run('--borrar')).code).toBe(2);
  });
});
