import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

const APEX = 'jlc-ingenieros.com.';
const WORDPRESS_IP = '3.133.180.219';
const CLOUDFRONT_ZONE = 'Z2FDTNDATAQYW2';
const DOMAIN = 'd1abc2def3ghi4.cloudfront.net';

type RecordSet = {
  Name: string;
  Type: string;
  TTL?: number;
  ResourceRecords?: { Value: string }[];
  AliasTarget?: { HostedZoneId: string; DNSName: string; EvaluateTargetHealth: boolean };
};
type Batch = { Comment: string; Changes: { Action: string; ResourceRecordSet: RecordSet }[] };

function render(...args: string[]) {
  const r = spawnSync('bash', ['scripts/dns/render.sh', ...args], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

function batch(...args: string[]): Batch {
  const r = render(...args);
  expect(r.err).toBe('');
  expect(r.code).toBe(0);
  return JSON.parse(r.out) as Batch;
}

function find(b: Batch, action: string, type: string) {
  const c = b.Changes.find((x) => x.Action === action && x.ResourceRecordSet.Type === type);
  expect(c, `${action} ${type}`).toBeDefined();
  return c!.ResourceRecordSet;
}

const MODES: [string, string[]][] = [
  ['cutover', [DOMAIN]],
  ['rollback', [DOMAIN]],
  ['ttl60', []],
  ['ttl300', []],
];

describe('scripts/dns/render.sh', () => {
  it.each(MODES)('%s: solo toca el A/AAAA del apex y lleva Comment', (mode, rest) => {
    const b = batch(mode, ...rest);
    expect(typeof b.Comment).toBe('string');
    expect(b.Comment.length).toBeGreaterThan(0);
    expect(b.Changes.length).toBeGreaterThan(0);
    for (const c of b.Changes) {
      expect(c.ResourceRecordSet.Name).toBe(APEX);
      expect(['A', 'AAAA']).toContain(c.ResourceRecordSet.Type);
      expect(['UPSERT', 'CREATE', 'DELETE']).toContain(c.Action);
    }
  });

  it('cutover: UPSERT A ALIAS + CREATE AAAA ALIAS hacia CloudFront', () => {
    const b = batch('cutover', DOMAIN);
    expect(b.Changes).toHaveLength(2);
    for (const rs of [find(b, 'UPSERT', 'A'), find(b, 'CREATE', 'AAAA')]) {
      expect(rs.AliasTarget).toEqual({ HostedZoneId: CLOUDFRONT_ZONE, DNSName: DOMAIN, EvaluateTargetHealth: false });
      expect(rs.TTL).toBeUndefined();
      expect(rs.ResourceRecords).toBeUndefined();
    }
  });

  it('rollback: UPSERT A 3.133.180.219 (TTL 60) + DELETE AAAA ALIAS', () => {
    const b = batch('rollback', DOMAIN);
    expect(b.Changes).toHaveLength(2);
    const a = find(b, 'UPSERT', 'A');
    expect(a.TTL).toBe(60);
    expect(a.ResourceRecords).toEqual([{ Value: WORDPRESS_IP }]);
    expect(a.AliasTarget).toBeUndefined();
    const aaaa = find(b, 'DELETE', 'AAAA');
    expect(aaaa.AliasTarget).toEqual({ HostedZoneId: CLOUDFRONT_ZONE, DNSName: DOMAIN, EvaluateTargetHealth: false });
  });

  it.each([
    ['ttl60', 60],
    ['ttl300', 300],
  ])('%s: UPSERT A 3.133.180.219 con TTL %i', (mode, ttl) => {
    const b = batch(mode as string);
    expect(b.Changes).toHaveLength(1);
    const a = find(b, 'UPSERT', 'A');
    expect(a.TTL).toBe(ttl);
    expect(a.ResourceRecords).toEqual([{ Value: WORDPRESS_IP }]);
  });

  it.each([
    ['cutover sin dominio', ['cutover']],
    ['rollback sin dominio', ['rollback']],
    ['dominio que no es de CloudFront', ['cutover', 'evil.example.com']],
    ['dominio con punto final', ['cutover', `${DOMAIN}.`]],
    ['dominio con comillas (inyeccion JSON)', ['cutover', 'd1"x.cloudfront.net']],
    ['modo desconocido', ['delete-all']],
    ['sin argumentos', []],
    ['argumentos de mas', ['ttl60', DOMAIN]],
  ])('rechaza %s', (_name, args) => {
    const r = render(...args);
    expect(r.code).not.toBe(0);
    expect(r.out).toBe('');
  });
});
