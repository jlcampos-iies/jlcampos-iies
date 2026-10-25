import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

const APEX = 'jlc-ingenieros.com.';
const CLOUDFRONT_ZONE = 'Z2FDTNDATAQYW2';
const DOMAIN = 'd1abc2def3ghi4.cloudfront.net';
// Route 53 guarda el DNSName del alias con punto final; el DELETE tiene que coincidir exactamente.
const ALIAS_DNS = `${DOMAIN}.`;

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

describe('scripts/dns/render.sh', () => {
  it('cutover: solo toca el A/AAAA del apex y lleva Comment', () => {
    const b = batch('cutover', DOMAIN);
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
      expect(rs.AliasTarget).toEqual({ HostedZoneId: CLOUDFRONT_ZONE, DNSName: ALIAS_DNS, EvaluateTargetHealth: false });
      expect(rs.TTL).toBeUndefined();
      expect(rs.ResourceRecords).toBeUndefined();
    }
  });

  it('cutover: acepta el dominio con punto final (copiado de Route 53) sin duplicarlo', () => {
    expect(batch('cutover', ALIAS_DNS)).toEqual(batch('cutover', DOMAIN));
  });

  it.each([
    ['cutover sin dominio', ['cutover']],
    ['dominio que no es de CloudFront', ['cutover', 'evil.example.com']],
    ['dominio con dos puntos finales', ['cutover', `${DOMAIN}..`]],
    ['dominio con comillas (inyeccion JSON)', ['cutover', 'd1"x.cloudfront.net']],
    ['modo desconocido', ['delete-all']],
    ['sin argumentos', []],
    ['argumentos de mas', ['cutover', DOMAIN, 'x']],
    // WordPress retirado (25-10-2026): ningún lote puede volver a apuntar el apex a su IP liberada.
    ['rollback (WordPress retirado)', ['rollback', DOMAIN]],
    ['rollback-a (WordPress retirado)', ['rollback-a']],
    ['ttl60 (WordPress retirado)', ['ttl60']],
    ['ttl300 (WordPress retirado)', ['ttl300']],
  ])('rechaza %s', (_name, args) => {
    const r = render(...args);
    expect(r.code).not.toBe(0);
    expect(r.out).toBe('');
  });
});
