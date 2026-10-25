// Migración única del contenido en castellano de la WordPress actual (Salient + WPBakery).
// Se conserva en el repo como registro de cómo se migró. Es idempotente: borra y regenera
// todo lo que escribe (páginas ES, proyectos ES, YAML, imágenes y redirects/map.json).
//
// Uso (desde la raíz del repo):  node scripts/migrate/extract.mjs
// El HTML descargado se guarda solo fuera del repo: MIGRATE_RAW (por defecto, directorio temporal).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'node-html-parser';
import TurndownService from 'turndown';
import sharp from 'sharp';

const ORIGIN = 'https://jlc-ingenieros.com';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RAW = process.env.MIGRATE_RAW ?? path.join(os.tmpdir(), 'jlc-migrate-raw');
const OUT = {
  pages: path.join(ROOT, 'src/content/pages/es'),
  projects: path.join(ROOT, 'src/content/projects/es'),
  assets: path.join(ROOT, 'src/assets/images'),
  publicImg: path.join(ROOT, 'public/img'),
  redirects: path.join(ROOT, 'redirects/map.json'),
  publications: path.join(ROOT, 'src/content/publications.yaml'),
  clients: path.join(ROOT, 'src/content/clients.yaml'),
};

const PAGES = [
  { key: 'home', url: '/' },
  { key: 'studio', url: '/estudio/' },
  { key: 'clients', url: '/clientes/' },
  { key: 'projects', url: '/proyectos/' },
  { key: 'publications', url: '/publicaciones/' },
  { key: 'contact', url: '/contacto/' },
  { key: 'cookies', url: '/politica-de-cookies-ue/' },
  { key: 'terms', url: '/terminos-y-condiciones/' },
];
const PROJECT_SLUGS = [
  'instalacion-solar-fotovoltaica-en-modalidad-de-autoconsumo',
  'instalacion-solar-fotovoltaica',
  'fabrica-de-hielo',
  'instalacion-de-captacion-de-energia-solar-termica-en-edificio-de-viviendas',
  'nave-industrial',
  'apartamentos-turisticos',
];
// Descripciones a mano: en WordPress faltan o son basura (texto cortado, lista de títulos, nombre de un cliente).
const DESCRIPTION_OVERRIDE = {
  studio: 'Ingeniero Industrial colegiado en el COEIB desde 1998, especializado en la prescripción, dirección y seguimiento de proyectos de ingeniería.',
  publications: 'Publicaciones y materiales didácticos de JLC Ingenieros sobre máquinas y equipos térmicos, climatización y refrigeración.',
  home: 'Ingeniería en Eivissa: energía solar, sistemas frigoríficos, gestión técnica integral e innovación para edificios e industria.',
  clients: 'Administraciones públicas, hoteles y empresas que confían en JLC Ingenieros para sus proyectos de ingeniería.',
  projects: 'Proyectos de ingeniería de JLC Ingenieros: energía solar, refrigeración industrial, naves y edificios en Ibiza y Formentera.',
  contact: 'Contacte con JLC Ingenieros: correo electrónico, teléfono y formulario de contacto.',
  cookies: 'Política de cookies de jlc-ingenieros.com.',
  terms: 'Términos y condiciones de uso de jlc-ingenieros.com.',
};

const log = (...a) => console.log(...a);
const slug = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Complemento interactivo (https://met.jlc-ingenieros.com/): clave = ASIN Kindle (el que enlaza WordPress).
const MET_BASE = 'https://met.jlc-ingenieros.com/';
const MET_BOOKS = {
  B09BNMRBZT: { print: '8461660870', path: '' },
  B09BDM2K7L: { print: 'B09BGHZ3K6', path: 'unidades/ud01-magnitudes/' },
  B09BFLFJ6V: { print: 'B09BMBF4CL', path: 'unidades/ud02-higrometria/' },
  B09BFRPY6K: { print: 'B09BM38K12', path: 'unidades/ud03-cargas-termicas/' },
  B09BG68YTJ: { print: 'B09BG77471', path: 'unidades/ud04-generacion-calor/' },
  B09BG35C8H: { print: 'B09BGPG2Q1', path: 'unidades/ud05-ciclo-frigorifico/' },
  B09BNZTMBW: { print: 'B09BJQGG16', path: 'unidades/ud06-refrigerantes-lubricantes/' },
};
const q = (s) => JSON.stringify(s); // cadena YAML válida entre comillas dobles
const clean = (s) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

function truncate(s, max = 160) {
  s = clean(s);
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

async function fetchBuf(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} al descargar ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---------- 1. Descarga del HTML ----------
fs.mkdirSync(RAW, { recursive: true });
const docs = {};
for (const p of [...PAGES, ...PROJECT_SLUGS.map((s) => ({ key: s, url: `/proyectos/${s}/` }))]) {
  const html = (await fetchBuf(ORIGIN + p.url)).toString('utf8');
  fs.writeFileSync(path.join(RAW, slug(p.url) + '.html'), html);
  docs[p.key] = parse(html);
}
log(`HTML descargado en ${RAW}`);

// ---------- 2. Limpieza del destino ----------
for (const d of [OUT.pages, OUT.projects, OUT.assets, OUT.publicImg]) {
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
}
fs.mkdirSync(path.dirname(OUT.redirects), { recursive: true });

// ---------- 3. Imágenes ----------
const VARIANT = /-\d+x\d+(?=\.[a-z]+$)/i;
const upl = (u) => {
  const url = new URL(u.replace(/^['"]|['"]$/g, ''), ORIGIN);
  return url.origin === ORIGIN && url.pathname.startsWith('/wp-content/uploads/') ? url.pathname : null;
};
const images = new Map(); // ruta de upload original -> { assetRel, basename, owner }
const redirects = {};
const usedBasenames = new Map(); // basename -> ruta de upload

/** Registra una imagen y devuelve su ruta bajo src/assets/images/. */
function registerImage(srcUrl, ownerDir) {
  const p = upl(srcUrl);
  if (!p) throw new Error(`Imagen fuera de uploads: ${srcUrl}`);
  const original = p.replace(VARIANT, '');
  const found = images.get(original);
  if (found) {
    if (original !== p) redirects[p] = '/img/' + found.basename;
    return found.assetRel;
  }
  let base = path.posix.basename(original);
  if (usedBasenames.has(base)) {
    const [, y, m] = original.match(/uploads\/(\d{4})\/(\d{2})\//) ?? [];
    base = `${y}-${m}-${base}`;
  }
  if (usedBasenames.has(base)) throw new Error(`Colisión no resuelta: ${base}`);
  usedBasenames.set(base, original);
  const assetRel = `${ownerDir}/${base}`;
  images.set(original, { assetRel, basename: base, variantUsed: original !== p ? p : null });
  redirects[original] = '/img/' + base;
  if (original !== p) redirects[p] = '/img/' + base;
  return assetRel;
}

async function downloadImages() {
  for (const [original, info] of images) {
    let buf;
    try {
      buf = await fetchBuf(ORIGIN + original);
    } catch (e) {
      if (!info.variantUsed) throw e;
      log(`Original no disponible, se usa la variante: ${info.variantUsed}`);
      buf = await fetchBuf(ORIGIN + info.variantUsed);
    }
    const dest = path.join(OUT.assets, info.assetRel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    let pipe = sharp(buf).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true });
    const ext = path.extname(info.basename).toLowerCase();
    pipe = ext === '.png' ? pipe.png({ compressionLevel: 9 }) : pipe.jpeg({ quality: 80, mozjpeg: true });
    fs.writeFileSync(path.join(OUT.publicImg, info.basename), await pipe.toBuffer());
  }
  log(`${images.size} imágenes descargadas`);
}

// ---------- 4. Conversión a Markdown ----------
const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*' });
td.remove(['script', 'style', 'noscript', 'form', 'img']);
td.addRule('emptyLinks', {
  filter: (n) => n.nodeName === 'A' && !n.textContent.trim(),
  replacement: () => '',
});

const mainOf = (doc) => {
  const mc = doc.querySelector('.container.main-content');
  if (!mc) throw new Error('No se encuentra .container.main-content');
  for (const sel of ['script', 'style', 'noscript', 'form', '.cmplz-cookiebanner', '#cmplz-cookiebanner-container']) {
    mc.querySelectorAll(sel).forEach((n) => n.remove());
  }
  return mc;
};
const toMd = (html) =>
  td
    .turndown(html)
    .replaceAll(ORIGIN + '/', '/')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
const metaTitle = (doc) =>
  clean(doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? doc.querySelector('title').text)
    .replace(/\s*\|\s*JLC Ingenieros$/, '')
    .replace(/\.$/, '');
const metaDesc = (doc, key) => {
  const manual = DESCRIPTION_OVERRIDE[key];
  if (manual) return truncate(manual);
  const d = doc.querySelector('meta[name="description"]')?.getAttribute('content');
  if (!d) throw new Error('Falta descripción: ' + key);
  return truncate(d);
};
const bgImages = (mc) => [...mc.outerHTML.matchAll(/url\(([^)]*wp-content\/uploads[^)]*)\)/g)].map((m) => m[1]);
const frontMatter = (obj) => {
  const lines = ['---'];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      for (const it of v) {
        if (typeof it === 'object') {
          const e = Object.entries(it);
          e.forEach(([ik, iv], i) => lines.push(`${i === 0 ? '  - ' : '    '}${ik}: ${q(iv)}`));
        } else lines.push(`  - ${q(it)}`);
      }
    } else lines.push(`${k}: ${typeof v === 'string' ? q(v) : v}`);
  }
  lines.push('---');
  return lines.join('\n');
};
const relFromContent = (assetRel) => `../../../assets/images/${assetRel}`;
const writeMd = (dir, name, fm, body) =>
  fs.writeFileSync(path.join(dir, name + '.md'), frontMatter(fm) + '\n\n' + (body ? body + '\n' : ''));

/** Restos de WordPress en los textos legales (se reescriben en la tarea 6). */
const legalFixes = (md) =>
  md
    // Domicilio fiscal actual (el texto de WordPress traía el antiguo domicilio de la calle anterior).
    .replace(/C\/\. Carlos\s+III, 28 Bajo/g, 'C/. Des Periodista Marià Tur Tur, 14')
    .replace(/^(#{1,6} \d+)\\\./gm, '$1.') // «## 1\.» -> «## 1.»
    .replaceAll('http://18.191.198.48/', '/')
    .replace(/info@(?:ex\.com)?18\.191\.198\.48/g, 'info@jlc-ingenieros.com')
    .replace(/\n+## 22\. Descargar\n+[^\n]*\n?/, '\n') // enlace al plugin Complianz, que desaparece
    .trim();

// ---------- 5. Páginas ----------
const pagesDone = {};
for (const { key } of PAGES) {
  const doc = docs[key];
  const mc = mainOf(doc);
  const fm = { key, lang: 'es', title: metaTitle(doc), description: metaDesc(doc, key) };
  let body = '';
  const bgs = bgImages(mc);
  if (bgs.length && key !== 'cookies' && key !== 'terms') fm.hero = relFromContent(registerImage(bgs[0], 'pages'));
  // Los demás fondos (banners secundarios y logos de clientes) solo se conservan para las redirecciones.
  const otherBgs = bgs.slice(1).map((u) => registerImage(u, key === 'clients' ? 'clients' : 'pages'));

  if (key === 'home') {
    fm.title = 'Soluciones integrales en ingeniería';
    const h3 = mc.querySelectorAll('h3').map((n) => clean(n.text));
    const ps = mc.querySelectorAll('p.vc_custom_heading').map((n) => clean(n.text));
    if (h3.length !== 4 || ps.length !== 4) throw new Error('La home debería tener 4 servicios');
    fm.services = h3.map((title, i) => ({ title, text: ps[i] }));
  } else if (key === 'clients') {
    const names = mc.querySelectorAll('p').map((n) => clean(n.text)).filter(Boolean);
    if (names.length !== 12) throw new Error(`Se esperaban 12 clientes, hay ${names.length}`);
    if (otherBgs.length !== names.length) throw new Error(`Logos de clientes (${otherBgs.length}) y nombres (${names.length}) no cuadran`);
    // Clientes añadidos a mano (no estaban en WordPress): [nombre, logo, insertar tras este nombre o null = al final]
    const extra = [
      ['Ministerio de Cultura', 'clients/ministerio-cultura.png', 'Ajuntament de Sant Antoni de Portmany'],
      ['Paraíso de los Pinos', 'clients/paraiso-de-los-pinos.png', null],
    ];
    const list = names.map((n, i) => [n, otherBgs[i]]);
    for (const [n, logo, after] of extra) {
      const at = after ? list.findIndex(([m]) => m === after) + 1 : list.length;
      list.splice(at || list.length, 0, [n, logo]);
    }
    fs.writeFileSync(OUT.clients, list.map(([n, logo]) => `- name: ${q(n)}\n  logo: ${q(`../assets/images/${logo}`)}\n`).join(''));
  } else if (key === 'projects') {
    // Sin texto: solo el listado (se genera desde la colección projects).
  } else if (key === 'publications') {
    body = mc.querySelectorAll('p').filter((p) => !p.querySelector('em') && !p.querySelector('a')).map((p) => toMd(p.outerHTML)).join('\n\n');
    const h2 = mc.querySelectorAll('h2').map((n) => clean(n.text));
    const sum = mc.querySelectorAll('p').filter((p) => p.querySelector('em')).map((p) => clean(p.text));
    const imgs = mc.querySelectorAll('img').map((n) => n.getAttribute('src'));
    const links = mc.querySelectorAll('a').map((a) => a.getAttribute('href')).filter((h) => /amazon\./.test(h));
    if (new Set([h2.length, sum.length, imgs.length, links.length]).size !== 1) throw new Error('Libros descuadrados');
    const yaml = h2.map((title, i) => {
      const m = decodeURI(links[i]).match(/^(https:\/\/www\.amazon\.es\/)([^/]+)\/dp\/([A-Z0-9]{10})/);
      if (!m) throw new Error('Enlace Amazon inesperado: ' + links[i]);
      // WordPress enlaza la edición Kindle; el ASIN impreso y la página del complemento salen de MET_BOOKS.
      const kindle = m[3];
      const met = MET_BOOKS[kindle];
      if (!met) throw new Error('ASIN sin mapeo en MET_BOOKS: ' + kindle);
      const cover = `../assets/images/${registerImage(imgs[i], 'publications')}`;
      return [
        `- id: ${q(slug(title))}`,
        `  cover: ${q(cover)}`,
        `  amazon:`,
        `    print: ${q(met.print)}`,
        `    kindle: ${q(kindle)}`,
        `  companionUrl: ${q(MET_BASE + met.path)}`,
        `  title:`,
        `    es: ${q(title)}`,
        `    en: ${q(title)}`,
        `    ca: ${q(title)}`,
        `  summary:`,
        `    es: ${q(sum[i])}`,
        `    en: ${q(sum[i])}`,
        `    ca: ${q(sum[i])}`,
      ].join('\n');
    });
    // Volumen II (en redacción, no estaba en WordPress): va justo después del Volumen I.
    // Se conserva el bloque ya editado del YAML actual (portada en assets/images/publications/vol2-cover.jpg).
    const current = fs.existsSync(OUT.publications) ? fs.readFileSync(OUT.publications, 'utf8') : '';
    const vol2 = current.match(/^- id: "maquinas-y-equipos-termicos-ii"\n(?:  .*\n)+/m);
    if (vol2) yaml.splice(1, 0, vol2[0].trimEnd());
    fs.writeFileSync(OUT.publications, yaml.join('\n') + '\n');
  } else if (key === 'contact') {
    // Sin cuerpo: el domicilio es solo fiscal y la vista de contacto muestra correo y teléfono (ui.ts).
    body = '';
  } else if (key === 'studio') {
    body = mc.querySelectorAll('p').map((p) => toMd(p.outerHTML)).join('\n\n');
  } else {
    // cookies, terms: el contenido legal tal cual
    body = legalFixes(toMd(mc.innerHTML));
  }
  pagesDone[key] = true;
  writeMd(OUT.pages, key, fm, body);
}

// contactThanks no existe en WordPress: página nueva.
writeMd(
  OUT.pages,
  'contactThanks',
  { key: 'contactThanks', lang: 'es', title: 'Gracias por su mensaje', description: 'Hemos recibido su mensaje y le responderemos lo antes posible.', noindex: true },
  'Hemos recibido su mensaje correctamente. Le responderemos lo antes posible.',
);

// ---------- 6. Proyectos ----------
const listing = mainOf(docs.projects);
const thumbs = listing.querySelectorAll('img').map((n) => n.getAttribute('src'));
const links = listing.querySelectorAll('a').map((a) => a.getAttribute('href')).filter((h) => h.includes('/proyectos/'));
if (thumbs.length !== 6 || links.length !== 6) throw new Error('El listado de proyectos debería tener 6 elementos');
links.forEach((href, i) => {
  const s = href.split('/').filter(Boolean).pop();
  const doc = docs[s];
  if (!doc) throw new Error('Proyecto desconocido: ' + s);
  const mc = mainOf(doc);
  const title = metaTitle(doc);
  // Topónimo oficial (Nomenclàtor): la web antigua escribía «Mitjorn».
  const location = mc.querySelector('h1') ? clean(mc.querySelector('h1').text).replace(/\bMitjorn\b/g, 'Migjorn') : null;
  mc.querySelectorAll('h1').forEach((n) => n.remove());
  const paragraphs = mc.querySelectorAll('p').map((p) => toMd(p.outerHTML)).filter(Boolean);
  const body = [location ? `**Ubicación:** ${location}` : null, ...paragraphs].filter(Boolean).join('\n\n');
  const dir = `projects/${s}`;
  const cover = relFromContent(registerImage(thumbs[i], dir));
  const gallery = [...new Set(mc.querySelectorAll('img').map((n) => n.getAttribute('src')))].map((u) =>
    relFromContent(registerImage(u, dir)),
  );
  writeMd(
    OUT.projects,
    s,
    { translationKey: s, lang: 'es', slug: s, title, description: truncate(paragraphs[0] ?? title), order: i + 1, cover, gallery },
    body,
  );
});
// og:image de cada documento, por si alguna no se usó en el contenido
for (const doc of Object.values(docs)) {
  const og = doc.querySelector('meta[property="og:image"]')?.getAttribute('content');
  if (og && upl(og) && !images.has(upl(og).replace(VARIANT, ''))) registerImage(og, 'pages');
}

// Logos de publicidad de la financiación europea (Kit Digital): salen en el pie de todas las páginas de WordPress.
for (const u of [
  `${ORIGIN}/wp-content/uploads/2024/09/Plan-resiliencia.png`,
  `${ORIGIN}/wp-content/uploads/2025/02/ES_Financiado_por_la_Union_Europea_RGB_BLACK.png`,
]) registerImage(u, 'eu');

await downloadImages();
// El logo del Plan trae amplios márgenes transparentes: la copia de src/assets (la que se muestra) se recorta;
// la de public/img queda intacta para las redirecciones de la URL antigua.
{
  const plan = path.join(OUT.assets, 'eu/Plan-resiliencia.png');
  fs.writeFileSync(plan, await sharp(plan).trim({ threshold: 10 }).png({ compressionLevel: 9 }).toBuffer());
}

// ---------- 7. Redirecciones ----------
Object.assign(redirects, {
  '/en/home/': '/en/',
  '/ca/inici/': '/ca/',
  '/feed/': '/',
  '/comments/feed/': '/',
  '/en/feed/': '/en/',
  '/en/comments/feed/': '/en/',
  '/ca/feed/': '/ca/',
  '/ca/comments/feed/': '/ca/',
  // Sitemaps antiguos de Rank Math (siguen registrados en buscadores).
  '/sitemap_index.xml': '/sitemap.xml',
  '/page-sitemap.xml': '/sitemap.xml',
  '/portfolio-sitemap.xml': '/sitemap.xml',
});
const sorted = Object.fromEntries(Object.entries(redirects).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(OUT.redirects, JSON.stringify(sorted, null, 2) + '\n');
log(`${Object.keys(sorted).length} redirecciones; migración completada`);
