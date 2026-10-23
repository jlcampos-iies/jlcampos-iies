import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';
import { renderTo } from '../../infra/render.mjs';

// --- YAML con las etiquetas cortas de CloudFormation (!Ref, !Sub, ...) ---
type Tag = { tag: string; resolve: (v: any) => unknown; collection?: 'seq' | 'map' };
const fn = (name: string): Tag[] => [
  { tag: `!${name}`, resolve: (s: string) => ({ [`Fn::${name}`]: s }) },
  { tag: `!${name}`, collection: 'seq', resolve: (s: any) => ({ [`Fn::${name}`]: s.toJSON() }) },
  { tag: `!${name}`, collection: 'map', resolve: (m: any) => ({ [`Fn::${name}`]: m.toJSON() }) },
];
const CFN_TAGS: Tag[] = [
  { tag: '!Ref', resolve: (s: string) => ({ Ref: s }) },
  { tag: '!Condition', resolve: (s: string) => ({ Condition: s }) },
  { tag: '!GetAtt', resolve: (s: string) => ({ 'Fn::GetAtt': [s.slice(0, s.indexOf('.')), s.slice(s.indexOf('.') + 1)] }) },
  { tag: '!GetAtt', collection: 'seq', resolve: (s: any) => ({ 'Fn::GetAtt': s.toJSON() }) },
  ...['Sub', 'If', 'Equals', 'Not', 'And', 'Or', 'Select', 'Split', 'Join', 'GetAZs', 'Base64', 'FindInMap', 'ImportValue', 'Cidr'].flatMap(fn),
];
const loadCfn = (path: string): any => parse(readFileSync(path, 'utf8'), { customTags: CFN_TAGS as any });

const SPEC = 'docs/superpowers/specs/2026-10-22-web-estatica-design.md';
const SPEC_CSP = /CSP `([^`]+)`/.exec(readFileSync(SPEC, 'utf8'))![1];
const EDGE = 'edge/dist/viewer-request.js';
const TAG = { Key: 'project', Value: 'jlc-web-publica' };

// Tipos que admiten etiquetas (y la propiedad en la que van) y tipos que no las admiten.
const TAGGABLE: Record<string, string> = {
  'AWS::S3::Bucket': 'Tags',
  'AWS::CloudFront::Distribution': 'Tags',
  'AWS::IAM::Role': 'Tags',
  'AWS::IAM::OIDCProvider': 'Tags',
  'AWS::Logs::LogGroup': 'Tags',
  'AWS::Serverless::Function': 'Tags',
  'AWS::Budgets::Budget': 'ResourceTags',
  'AWS::SES::EmailIdentity': 'Tags',
  'AWS::CertificateManager::Certificate': 'Tags',
  'AWS::CloudFront::Function': 'Tags',
};
const UNTAGGABLE = new Set([
  'AWS::S3::BucketPolicy',
  'AWS::CloudFront::OriginAccessControl',
  'AWS::CloudFront::ResponseHeadersPolicy',
  'AWS::Lambda::Permission',
]);

let tpl: any;
let cert: any;
let outFile: string;
const R = (id: string) => {
  const r = tpl.Resources[id];
  if (!r) throw new Error(`falta el recurso ${id}`);
  return r;
};
const ofType = (doc: any, type: string) =>
  Object.entries<any>(doc.Resources).filter(([, r]) => r.Type === type);
const statements = (role: any) => role.Properties.Policies.flatMap((p: any) => p.PolicyDocument.Statement);
const asList = (v: unknown) => (Array.isArray(v) ? v : [v]);

beforeAll(() => {
  execFileSync('node', ['edge/build.mjs'], { stdio: 'pipe' });
  outFile = join(mkdtempSync(join(tmpdir(), 'jlc-infra-')), 'template.yaml');
  renderTo({ edgeFile: EDGE, outFile });
  tpl = loadCfn(outFile);
  cert = loadCfn('infra/cert.yaml');
});

describe('render.mjs', () => {
  it('inserta el código de edge/dist en FunctionCode, tal cual', () => {
    expect(R('EdgeFunction').Properties.FunctionCode).toBe(readFileSync(EDGE, 'utf8'));
  });

  it('CodeUri de la Lambda resuelve a lambda/contact desde la plantilla generada', () => {
    const uri = R('ContactFunction').Properties.CodeUri;
    expect(resolve(dirname(outFile), uri)).toBe(resolve('lambda/contact'));
  });

  it('falla con un mensaje claro si falta el build de la Function', () => {
    expect(() => renderTo({ edgeFile: 'edge/dist/no-existe.js', outFile })).toThrow(/build:edge|npm run build/);
  });
});

describe('aislamiento del área privada (requisito nº 1)', () => {
  it('no hay recursos de Route 53 ni de EC2 en ninguna plantilla', () => {
    for (const doc of [tpl, cert]) {
      for (const r of Object.values<any>(doc.Resources)) {
        expect(r.Type).not.toMatch(/^AWS::(Route53|EC2)::/);
      }
    }
  });

  it('cert.yaml: solo el certificado, DNS, apex + www, sin HostedZoneId', () => {
    const certs = ofType(cert, 'AWS::CertificateManager::Certificate');
    expect(Object.keys(cert.Resources)).toHaveLength(1);
    expect(certs).toHaveLength(1);
    const p = certs[0][1].Properties;
    expect(p.DomainName).toBe('jlc-ingenieros.com');
    expect(p.SubjectAlternativeNames).toEqual(['www.jlc-ingenieros.com']);
    expect(p.ValidationMethod).toBe('DNS');
    expect(JSON.stringify(cert)).not.toContain('HostedZoneId');
    expect(cert.Outputs.CertificateArn.Value).toEqual({ Ref: certs[0][0] });
  });

  it('la identidad SES no crea registros DNS y solo existe con CreateSesIdentity', () => {
    const ids = ofType(tpl, 'AWS::SES::EmailIdentity');
    expect(ids).toHaveLength(1);
    const [, id] = ids[0];
    expect(id.Condition).toBe('CreateSesIdentity');
    expect(id.Properties.EmailIdentity).toBe('jlc-ingenieros.com');
    expect(id.Properties.MailFromAttributes).toBeUndefined();
    for (const n of [1, 2, 3]) {
      expect(tpl.Outputs[`DkimRecord${n}Name`].Condition).toBe('CreateSesIdentity');
    }
  });
});

describe('etiquetas', () => {
  it('todo recurso está clasificado y los que admiten etiquetas llevan project=jlc-web-publica', () => {
    for (const doc of [tpl, cert]) {
      for (const [id, r] of Object.entries<any>(doc.Resources)) {
        const prop = TAGGABLE[r.Type];
        expect(prop !== undefined || UNTAGGABLE.has(r.Type), `${id}: ${r.Type} sin clasificar`).toBe(true);
        if (!prop) continue;
        const tags = r.Properties[prop];
        if (r.Type.startsWith('AWS::Serverless::')) expect(tags, id).toMatchObject({ project: TAG.Value });
        else expect(tags, id).toContainEqual(TAG);
      }
    }
  });
});

describe('S3', () => {
  it('bucket privado, versionado y con ciclo de vida de 30 días', () => {
    const p = R('SiteBucket').Properties;
    expect(p.BucketName).toEqual({ 'Fn::Sub': 'jlc-web-publica-site-${AWS::AccountId}' });
    expect(p.PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
    expect(p.VersioningConfiguration.Status).toBe('Enabled');
    expect(p.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm).toBe(
      'AES256',
    );
    expect(p.LifecycleConfiguration.Rules).toContainEqual(
      expect.objectContaining({ Status: 'Enabled', NoncurrentVersionExpiration: { NoncurrentDays: 30 } }),
    );
  });

  it('la política del bucket solo permite a esta distribución (OAC)', () => {
    const st = R('SiteBucketPolicy').Properties.PolicyDocument.Statement;
    expect(st).toHaveLength(1);
    expect(st[0].Effect).toBe('Allow');
    expect(st[0].Principal).toEqual({ Service: 'cloudfront.amazonaws.com' });
    expect(st[0].Action).toBe('s3:GetObject');
    expect(JSON.stringify(st[0].Condition.StringEquals['AWS:SourceArn'])).toContain('${Distribution}');
    const oac = R('SiteOriginAccessControl').Properties.OriginAccessControlConfig;
    expect(oac).toMatchObject({ OriginAccessControlOriginType: 's3', SigningBehavior: 'always', SigningProtocol: 'sigv4' });
  });
});

describe('CloudFront', () => {
  const dist = () => R('Distribution').Properties.DistributionConfig;
  const s3Origin = () => dist().Origins.find((o: any) => o.S3OriginConfig);
  const apiOrigin = () => dist().Origins.find((o: any) => o.CustomOriginConfig);

  it('cabeceras de seguridad: HSTS sin subdominios ni preload y la CSP de la spec §7', () => {
    const c = R('SecurityHeadersPolicy').Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig;
    expect(c.StrictTransportSecurity.AccessControlMaxAgeSec).toBe(63072000);
    expect(c.StrictTransportSecurity.IncludeSubdomains).toBeUndefined();
    expect(c.StrictTransportSecurity.Preload).toBeUndefined();
    expect(c.ContentSecurityPolicy.ContentSecurityPolicy).toBe(SPEC_CSP);
    expect(SPEC_CSP).toMatch(/^default-src 'self';.*frame-ancestors 'none'$/);
    expect(c.ContentTypeOptions.Override).toBe(true);
    expect(c.ReferrerPolicy.ReferrerPolicy).toBe('strict-origin-when-cross-origin');
    expect(c.FrameOptions.FrameOption).toBe('DENY');
    const custom = R('SecurityHeadersPolicy').Properties.ResponseHeadersPolicyConfig.CustomHeadersConfig.Items;
    expect(custom.find((h: any) => h.Header === 'Permissions-Policy').Value).toMatch(/camera=\(\)/);
  });

  it('errores personalizados: solo 403 y 404 → /404.html con 404', () => {
    const errs = dist().CustomErrorResponses;
    expect(errs.map((e: any) => e.ErrorCode).sort()).toEqual([403, 404]);
    for (const e of errs) expect(e).toMatchObject({ ResponseCode: 404, ResponsePagePath: '/404.html' });
  });

  it('comportamiento por defecto: S3, caché optimizada, Function viewer-request y cabeceras', () => {
    const d = dist().DefaultCacheBehavior;
    expect(d.TargetOriginId).toBe(s3Origin().Id);
    expect(d.CachePolicyId).toBe('658327ea-f89d-4fab-a63d-7e88639e58f6');
    expect(d.ViewerProtocolPolicy).toBe('redirect-to-https');
    expect(d.ResponseHeadersPolicyId).toEqual({ Ref: 'SecurityHeadersPolicy' });
    expect(d.FunctionAssociations).toEqual([
      { EventType: 'viewer-request', FunctionARN: { 'Fn::GetAtt': ['EdgeFunction', 'FunctionMetadata.FunctionARN'] } },
    ]);
    expect(s3Origin().OriginAccessControlId).toEqual({ 'Fn::GetAtt': ['SiteOriginAccessControl', 'Id'] });
    expect(dist().DefaultRootObject).toBe('index.html');
  });

  it('/api/*: sin caché, AllViewerExceptHostHeader, todos los métodos y X-Origin-Verify', () => {
    const b = dist().CacheBehaviors.find((x: any) => x.PathPattern === '/api/*');
    expect(b.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
    expect(b.OriginRequestPolicyId).toBe('b689b0a8-53d0-40ab-baf2-68738e2966ac');
    expect([...b.AllowedMethods].sort()).toEqual(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT']);
    expect(b.ViewerProtocolPolicy).toBe('redirect-to-https');
    expect(b.ResponseHeadersPolicyId).toEqual({ Ref: 'SecurityHeadersPolicy' });
    expect(b.FunctionAssociations).toBeUndefined();
    expect(b.TargetOriginId).toBe(apiOrigin().Id);
    expect(apiOrigin().CustomOriginConfig.OriginProtocolPolicy).toBe('https-only');
    expect(apiOrigin().OriginCustomHeaders).toEqual([
      { HeaderName: 'X-Origin-Verify', HeaderValue: '{{resolve:ssm:/jlc-web-publica/origin-verify}}' },
    ]);
  });

  it('price class 100, HTTP/2+3, TLS 1.2_2021 y alias solo con EnableAliases', () => {
    const d = dist();
    expect(d.PriceClass).toBe('PriceClass_100');
    expect(d.HttpVersion).toBe('http2and3');
    expect(d.Aliases).toEqual({
      'Fn::If': ['UseAliases', ['jlc-ingenieros.com', 'www.jlc-ingenieros.com'], { Ref: 'AWS::NoValue' }],
    });
    const [cond, withCert, noCert] = d.ViewerCertificate['Fn::If'];
    expect(cond).toBe('UseAliases');
    expect(withCert).toEqual({
      AcmCertificateArn: { Ref: 'CertificateArn' },
      MinimumProtocolVersion: 'TLSv1.2_2021',
      SslSupportMethod: 'sni-only',
    });
    expect(noCert).toEqual({ CloudFrontDefaultCertificate: true });
    expect(tpl.Parameters.EnableAliases.Default).toBe('false');
    expect(tpl.Conditions.UseAliases).toEqual({ 'Fn::Equals': [{ Ref: 'EnableAliases' }, 'true'] });
  });

  it('la Function es cloudfront-js-2.0 y se publica sola', () => {
    const p = R('EdgeFunction').Properties;
    expect(p.AutoPublish).toBe(true);
    expect(p.FunctionConfig.Runtime).toBe('cloudfront-js-2.0');
  });
});

describe('Lambda de contacto', () => {
  it('configuración de la función y de la Function URL', () => {
    const p = R('ContactFunction').Properties;
    expect(R('ContactFunction').Type).toBe('AWS::Serverless::Function');
    expect(p).toMatchObject({
      FunctionName: 'jlc-web-contact',
      Runtime: 'nodejs22.x',
      Handler: 'index.handler',
      MemorySize: 128,
      Timeout: 10,
      ReservedConcurrentExecutions: 2,
      FunctionUrlConfig: { AuthType: 'NONE' },
    });
    expect(p.LoggingConfig.LogGroup).toEqual({ Ref: 'ContactLogGroup' });
    expect(R('ContactLogGroup').Properties).toMatchObject({
      LogGroupName: '/aws/lambda/jlc-web-contact',
      RetentionInDays: 30,
    });
  });

  it('variables de entorno', () => {
    const env = R('ContactFunction').Properties.Environment.Variables;
    expect(env).toEqual({
      ORIGIN_VERIFY: '{{resolve:ssm:/jlc-web-publica/origin-verify}}',
      TO: 'jlcampos@jlc-ingenieros.com',
      FROM: 'JLC Ingenieros web <web@jlc-ingenieros.com>',
      TURNSTILE_SECRET_PARAM: '/jlc-web-publica/turnstile-secret',
      TURNSTILE_HOSTNAMES: { Ref: 'TurnstileHostnames' },
    });
    expect(tpl.Parameters.TurnstileHostnames.Default).toBe('jlc-ingenieros.com');
  });

  it('permisos públicos de la Function URL: InvokeFunctionUrl e InvokeFunction para *', () => {
    const perms = ofType(tpl, 'AWS::Lambda::Permission').map(([, r]) => r.Properties);
    const url = perms.find((p) => p.Action === 'lambda:InvokeFunctionUrl');
    const inv = perms.find((p) => p.Action === 'lambda:InvokeFunction');
    expect(url).toMatchObject({ Principal: '*', FunctionUrlAuthType: 'NONE', FunctionName: { Ref: 'ContactFunction' } });
    expect(inv).toMatchObject({ Principal: '*', InvokedViaFunctionUrl: true, FunctionName: { Ref: 'ContactFunction' } });
  });

  it('IAM: solo logs del propio grupo, ses:SendEmail en las identidades y ssm:GetParameter en /jlc-web-publica/*', () => {
    const role = R(R('ContactFunction').Properties.Role['Fn::GetAtt'][0]);
    expect(R('ContactFunction').Properties.Policies).toBeUndefined();
    expect(role.Properties.ManagedPolicyArns).toBeUndefined();
    const st = statements(role);
    const byAction = (a: string) => st.filter((s: any) => asList(s.Action).includes(a));
    const actions = st.flatMap((s: any) => asList(s.Action)).sort();
    expect(actions).toEqual(['logs:CreateLogStream', 'logs:PutLogEvents', 'ses:SendEmail', 'ssm:GetParameter']);
    for (const s of st) {
      expect(s.Effect).toBe('Allow');
      for (const r of asList(s.Resource)) expect(r).not.toBe('*');
    }
    expect(byAction('ses:SendEmail')[0].Resource.map((r: any) => r['Fn::Sub'])).toEqual([
      'arn:aws:ses:${AWS::Region}:${AWS::AccountId}:identity/jlc-ingenieros.com',
      'arn:aws:ses:${AWS::Region}:${AWS::AccountId}:identity/jlcampos@jlc-ingenieros.com',
    ]);
    expect(byAction('ssm:GetParameter')[0].Resource).toEqual({
      'Fn::Sub': 'arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/jlc-web-publica/*',
    });
    expect(JSON.stringify(byAction('logs:PutLogEvents')[0].Resource)).toContain('ContactLogGroup');
  });
});

describe('despliegue desde GitHub (OIDC)', () => {
  it('condiciones CreateOidcProvider y CreateSesIdentity', () => {
    expect(tpl.Parameters.ExistingGitHubOidcProviderArn.Default).toBe('');
    expect(tpl.Conditions.CreateOidcProvider).toEqual({
      'Fn::Equals': [{ Ref: 'ExistingGitHubOidcProviderArn' }, ''],
    });
    expect(tpl.Conditions.CreateSesIdentity).toEqual({ 'Fn::Equals': [{ Ref: 'CreateSesIdentity' }, 'true'] });
    const oidc = R('GitHubOidcProvider');
    expect(oidc.Condition).toBe('CreateOidcProvider');
    expect(oidc.Properties.Url).toBe('https://token.actions.githubusercontent.com');
    expect(oidc.Properties.ClientIdList).toEqual(['sts.amazonaws.com']);
  });

  it('confianza del rol limitada a main de jlcampos-iies/jlcampos-iies', () => {
    const [st] = R('DeployRole').Properties.AssumeRolePolicyDocument.Statement;
    expect(st.Action).toBe('sts:AssumeRoleWithWebIdentity');
    expect(st.Principal.Federated).toEqual({
      'Fn::If': ['CreateOidcProvider', { Ref: 'GitHubOidcProvider' }, { Ref: 'ExistingGitHubOidcProviderArn' }],
    });
    expect(st.Condition.StringEquals).toEqual({
      'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
      'token.actions.githubusercontent.com:sub': 'repo:jlcampos-iies/jlcampos-iies:ref:refs/heads/main',
    });
  });

  it('permisos del rol limitados al bucket, la distribución, la Function y la Lambda', () => {
    const st = statements(R('DeployRole'));
    const expected: Record<string, string> = {
      's3:ListBucket': 'SiteBucket',
      's3:PutObject': 'SiteBucket',
      's3:DeleteObject': 'SiteBucket',
      'cloudfront:CreateInvalidation': '${Distribution}',
      'cloudfront:DescribeFunction': 'EdgeFunction',
      'cloudfront:UpdateFunction': 'EdgeFunction',
      'cloudfront:PublishFunction': 'EdgeFunction',
      'lambda:UpdateFunctionCode': 'ContactFunction',
      'lambda:GetFunction': 'ContactFunction',
    };
    const seen = st.flatMap((s: any) => asList(s.Action));
    expect([...seen].sort()).toEqual(Object.keys(expected).sort());
    for (const s of st) {
      expect(s.Effect).toBe('Allow');
      for (const a of asList(s.Action)) {
        for (const r of asList(s.Resource)) {
          expect(r).not.toBe('*');
          expect(JSON.stringify(r), a).toContain(expected[a]);
        }
      }
    }
  });
});

describe('presupuesto', () => {
  it('5 USD al mes con avisos al 80 % y al 100 % a jlcampos@jlc-ingenieros.com', () => {
    const budgets = ofType(tpl, 'AWS::Budgets::Budget');
    expect(budgets).toHaveLength(1);
    const p = budgets[0][1].Properties;
    expect(p.Budget).toMatchObject({ BudgetType: 'COST', TimeUnit: 'MONTHLY', BudgetLimit: { Amount: 5, Unit: 'USD' } });
    const ns = p.NotificationsWithSubscribers;
    expect(ns.map((n: any) => n.Notification.Threshold).sort()).toEqual([100, 80]);
    for (const n of ns) {
      expect(n.Notification).toMatchObject({ NotificationType: 'ACTUAL', ThresholdType: 'PERCENTAGE' });
      expect(n.Subscribers).toEqual([{ SubscriptionType: 'EMAIL', Address: 'jlcampos@jlc-ingenieros.com' }]);
    }
  });
});

describe('salidas', () => {
  it('expone los valores que usan el README y GitHub Actions', () => {
    for (const k of ['BucketName', 'DistributionId', 'DistributionDomain', 'DeployRoleArn', 'ContactFunctionName', 'EdgeFunctionName']) {
      expect(tpl.Outputs[k], k).toBeDefined();
    }
  });
});
