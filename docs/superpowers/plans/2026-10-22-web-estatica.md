# Web estática jlc-ingenieros.com — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir el WordPress de jlc-ingenieros.com por una web estática trilingüe (Astro) servida desde S3 + CloudFront, con un formulario en Lambda + SES, sin afectar a la infraestructura del área privada.

**Architecture:** Astro genera HTML estático a partir de colecciones Markdown validadas. Un registro de rutas único (`src/lib/registry.ts`) alimenta las páginas, los `hreflang`, el sitemap y los tests. Una CloudFront Function, generada a partir de `redirects/map.json`, aplica las 301, el bloqueo de sondas de WordPress y la reescritura a `index.html`. La Lambda del formulario es independiente del sitio. La infraestructura está en CloudFormation/SAM y la despliega el titular. GitHub Actions publica en S3 mediante OIDC.

**Tech Stack:**
- Astro (última estable, ≥ 5) y TypeScript.
- Vitest, `node-html-parser`, `html-validate`.
- `@fontsource/open-sans`.
- `turndown` y `sharp` (solo para el script de migración).
- Node.js 22 y `@aws-sdk/client-sesv2` + `@aws-sdk/client-ssm` (Lambda).
- CloudFront Functions (`cloudfront-js-2.0`).
- AWS SAM / CloudFormation, `cfn-lint`, GitHub Actions y `actionlint`.

**Spec:** `docs/superpowers/specs/2026-10-22-web-estatica-design.md`

## Global Constraints

- **Requisito nº 1:** ningún paso crea, modifica ni borra recursos del área privada (EC2 `3.12.236.157`) ni registros DNS distintos del A/AAAA del apex. Ningún script ni plantilla toca `areaprivada`, `demo`, `met`, MX, los TXT del apex, `_dmarc`, `*._domainkey` existentes, NS/SOA ni `www`.
- Regiones: pila principal en `eu-west-3` (París); certificado ACM en `us-east-1`.
- Las URLs ES existentes se conservan idénticas y todas las rutas terminan en `/` (`trailingSlash: 'always'`, `build.format: 'directory'`).
- Slugs EN/CA y de proyectos: exactamente los de las tablas de la spec §4.
- Colores: marino `#1E2A78`, slate blue `#5c8fbe` (nunca como color de texto normal sobre blanco); contraste WCAG 2.1 AA.
- Sin `<script>` ni `<style>` en línea (`build.inlineStylesheets: 'never'`); el único tercero en tiempo de ejecución es Turnstile, y solo en las páginas de contacto.
- Ningún secreto en el repo (es público). Clave de sitio de Turnstile: variable `PUBLIC_TURNSTILE_SITE_KEY`; secreto en SSM `/jlc-web-publica/turnstile-secret`; secreto de origen en SSM `/jlc-web-publica/origin-verify`.
- Formulario: destino `jlcampos@jlc-ingenieros.com`, remitente `JLC Ingenieros web <web@jlc-ingenieros.com>`, Reply-To = email del visitante.
- Lambda `jlc-web-contact`: Node.js 22, 128 MB, 10 s, concurrencia reservada 2, logs 30 días, sin datos personales en los logs.
- Códigos de la Lambda: 200/303 si va bien; 400 `validation`; 400 `captcha`; 502 `send`; 403 solo cuando falta `x-origin-verify`. Nunca 403/404 para errores de usuario, porque CloudFront los convierte en la 404.
- Etiqueta `project=jlc-web-publica` en todos los recursos AWS.
- Datos del titular (aviso legal y JSON-LD): José Luis Campos Giménez, NIF 20151498W, C/. Carlos III, 28 Bajo, 07800 Eivissa (Illes Balears), jlcampos@jlc-ingenieros.com, (+34) 616 992 440, colegiado n.º 403 del COEIB. Contacto para ejercer derechos RGPD: info@jlc-ingenieros.com.

## Review Focus

1. **Acentos, `·` y caracteres no latinos en el formulario** (`José Luis Giménez`, `Col·legi`, emojis): el correo llega con asunto y cuerpo legibles en UTF-8. Un CR/LF en el nombre no inyecta cabeceras. → Tests en la Tarea 9.
2. **URLs antiguas sin barra final o con mayúsculas** (`/proyectos/fabrica-de-hielo`, `/Contacto/`): 301 a la versión canónica, nunca un 403/404 de S3. → Tests en la Tarea 8.
3. **Enlaces antiguos con *query string*** (`/?p=12`, `/?page_id=7`, `/contacto/?utm_source=x`): los parámetros de WordPress redirigen a la home y los `utm_*` se conservan. → Tests en la Tarea 8.
4. **Envío sin JavaScript con error**: la redirección 303 vuelve a la página de contacto **del idioma del visitante**, con un mensaje de error visible. → Tests en las Tareas 9 y 10.
5. **Lambda limitada (429) o caída (5xx/HTML en lugar de JSON)**: el visitante ve un mensaje de error en su idioma y el botón vuelve a estar activo, nunca un JSON crudo ni un botón bloqueado. → Test en la Tarea 10.

---

## Estructura de ficheros

```
package.json, astro.config.mjs, tsconfig.json, vitest.config.ts, .nvmrc, .html-validate.json
src/
  config/site.ts               datos de empresa y URLs (única fuente)
  i18n/routes.ts               LANGS, PageKey, PAGE_ROUTES, pagePath, projectPath
  i18n/ui.ts                   textos de interfaz por idioma: t(lang, key)
  lib/registry.ts              allRoutes(): RouteEntry[] (páginas + proyectos)
  lib/seo.ts                   alternates(), jsonLdOrganization()
  content.config.ts            colecciones: pages, projects, publications, clients
  content/pages/{es,en,ca}/*.md
  content/projects/{es,en,ca}/*.md
  content/publications.yaml, content/clients.yaml
  assets/brand/ (logos), assets/images/ (fotos)
  layouts/Base.astro           <head> SEO + cabecera + pie
  components/ Header.astro, Footer.astro, LangSwitcher.astro, ProjectCard.astro, Gallery.astro, ContactForm.astro, Turnstile.astro
  views/  Home.astro, Studio.astro, Clients.astro, Projects.astro, Project.astro, Publications.astro, Contact.astro, Thanks.astro, Prose.astro
  pages/[...path].astro        getStaticPaths desde allRoutes()
  pages/404.astro, pages/sitemap.xml.ts, pages/robots.txt.ts
  scripts/menu.ts, scripts/contact-form.ts   (únicas islas JS)
  styles/tokens.css, styles/global.css
public/img/ (copias estables de imágenes legadas y OG), favicons
redirects/map.json
edge/viewer-request.template.js, edge/build.mjs, edge/load.ts
lambda/contact/ index.mjs, validate.mjs, turnstile.mjs, mail.mjs, paths.mjs
infra/cert.yaml, infra/template.yaml, infra/render.mjs, infra/README.md
scripts/migrate/extract.mjs
scripts/check-isolation.sh, scripts/smoke.sh, scripts/dns/{render.sh,baseline.txt}
tests/unit/*.test.ts, tests/dist/*.test.ts, tests/dist/helpers.ts
.github/workflows/ci.yml, .github/workflows/deploy.yml
docs/runbook-corte.md, docs/retirada-wordpress.md
```

Scripts de npm (los define la Tarea 1 y los usan todas las demás):
- `npm run build`: `astro check && astro build`.
- `npm run test:unit`: `vitest run tests/unit`.
- `npm run test:dist`: `vitest run tests/dist` (requiere haber ejecutado antes `npm run build`).
- `npm test`: `npm run build && npm run test:unit && npm run test:dist`. El build va primero porque algunos tests unitarios (como el de la Function de la Tarea 8) dependen de `dist/`.

---

### Task 1: Proyecto Astro y CI mínima

**Files:**
- Create: `package.json`, `.nvmrc` (`22`), `astro.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` (`node_modules`, `dist`, `.astro`, `edge/dist`, `infra/build`), `src/pages/[...path].astro` (temporal: solo `/`), `tests/dist/helpers.ts`, `tests/dist/smoke.test.ts`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: los scripts de npm anteriores; `tests/dist/helpers.ts` → `readPage(urlPath: string): HTMLElement` (lee `dist/<ruta>/index.html`, o `dist/404.html` para `'/404.html'`, con `node-html-parser`; lanza un error si no existe) y `distFiles(): string[]` (rutas relativas de todos los `.html` de `dist/`).

- [ ] **Step 1:** Escribir `tests/dist/smoke.test.ts`: `readPage('/')` existe y `querySelector('html').getAttribute('lang') === 'es'`.
- [ ] **Step 2:** `npm run test:dist` → FAIL (no hay `dist/`).
- [ ] **Step 3:** Configurar `astro.config.mjs`: `site: 'https://jlc-ingenieros.com'`, `output: 'static'`, `trailingSlash: 'always'`, `build: { format: 'directory', inlineStylesheets: 'never' }`. Página temporal con `<html lang="es">`.
- [ ] **Step 4:** `npm run build && npm run test:dist` → PASS.
- [ ] **Step 5:** `ci.yml`: en `push` y `pull_request`, Node desde `.nvmrc`, `npm ci`, `npm test` con `PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA` (clave de prueba de Cloudflare). Comprobar con `npx actionlint` → sin errores.
- [ ] **Step 6:** Commit `chore: proyecto Astro, Vitest y CI`.

### Task 2: Rutas i18n, registro y configuración del sitio

**Files:**
- Create: `src/config/site.ts`, `src/i18n/routes.ts`, `src/i18n/ui.ts`, `tests/unit/routes.test.ts`

**Interfaces:**
- Produces:
  - `site` (en `site.ts`): `{ name, url: 'https://jlc-ingenieros.com', areaPrivadaUrl: 'https://areaprivada.jlc-ingenieros.com', email, rightsEmail: 'info@jlc-ingenieros.com', phone, address: { street, postalCode, locality, region }, owner: { name, nif, collegiateNumber: '403', college } }`.
  - `LANGS = ['es','en','ca'] as const`; `type Lang`; `DEFAULT_LANG = 'es'`.
  - `type PageKey = 'home'|'studio'|'clients'|'projects'|'publications'|'contact'|'contactThanks'|'cookies'|'terms'|'legalNotice'|'privacy'`.
  - `PAGE_ROUTES: Record<PageKey, Record<Lang, string>>`, con las rutas exactas de la spec §4.
  - `pagePath(key: PageKey, lang: Lang): string` y `projectPath(slug: string, lang: Lang): string` (= `PAGE_ROUTES.projects[lang] + slug + '/'`).
  - `t(lang: Lang, key: UiKey): string`: menú, "Área privada / Private area / Àrea privada", etiquetas del formulario, errores `validation|captcha|send|network`, pie y 404.

- [ ] **Step 1:** Tests:
  - `pagePath('studio','ca') === '/ca/estudi/'`.
  - `pagePath('cookies','es') === '/politica-de-cookies-ue/'`.
  - `projectPath('ice-factory','en') === '/en/projects/ice-factory/'`.
  - Todas las rutas de `PAGE_ROUTES` empiezan y terminan en `/`.
  - Ninguna ruta se repite.
  - Cada `UiKey` tiene texto no vacío en los 3 idiomas.
- [ ] **Step 2:** `npm run test:unit` → FAIL.
- [ ] **Step 3:** Implementar los tres ficheros.
- [ ] **Step 4:** `npm run test:unit` → PASS.
- [ ] **Step 5:** Commit `feat: rutas i18n, textos de interfaz y configuración del sitio`.

### Task 3: Colecciones de contenido y migración del castellano

**Files:**
- Create: `src/content.config.ts`, `scripts/migrate/extract.mjs`, `src/content/pages/es/*.md` (home, studio, clients, projects, publications, contact, contactThanks, cookies, terms), `src/content/projects/es/*.md` (6), `src/content/publications.yaml`, `src/content/clients.yaml`, `src/assets/images/**`, `public/img/**`, `redirects/map.json`, `src/lib/registry.ts`, `tests/unit/registry.test.ts`

**Interfaces:**
- Consumes: `LANGS`, `PageKey`, `pagePath`, `projectPath` (Tarea 2).
- Produces:
  - Colección `pages`, con ruta `src/content/pages/<lang>/<key>.md` y front-matter `{ key: PageKey, lang: Lang, title: string, description: string (≤ 160), hero?: image(), services?: {title,text}[] (solo home), noindex?: boolean }`.
  - Colección `projects`, con ruta `src/content/projects/<lang>/<slug>.md` y front-matter `{ translationKey: string, lang, slug, title, description, order: number, cover?: image(), gallery?: image()[] }`. `cover` es obligatorio cuando `lang === 'es'` (refine de zod); EN/CA reutilizan las imágenes del ES con el mismo `translationKey`.
  - `publications.yaml`: `[{ id, cover: image(), amazonUrl, title: {es,en,ca}, summary: {es,en,ca} }]`. `amazonUrl` sin query string.
  - `clients.yaml`: `[{ name }]` (12, en el orden actual).
  - `allRoutes(): Promise<RouteEntry[]>` con `RouteEntry = { path: string, lang: Lang, kind: 'page'|'project', key: string, alternates: Partial<Record<Lang,string>>, noindex: boolean }`. Se genera una entrada por cada `(PageKey, lang)` que tenga contenido y por cada proyecto.
  - `redirects/map.json`: `{ "<ruta antigua>": "<ruta nueva>" }`.

- [ ] **Step 1:** Escribir `scripts/migrate/extract.mjs`, que se ejecuta una sola vez y queda en el repo como registro de cómo se migró:
  - Descarga las 13 URLs ES del inventario (spec §2).
  - Extrae el contenido principal (sin cabecera, pie ni banner de Complianz) y lo convierte a Markdown con `turndown`.
  - Escribe borradores con front-matter (título y `description` desde `<title>` y `meta description`).
  - Descarga cada imagen de `/wp-content/uploads/` referenciada (sin variantes `-WxH`) a `src/assets/images/<pagina|proyecto>/` y una copia redimensionada (≤ 1600 px, JPEG con calidad 80, mediante `sharp`) a `public/img/<basename>`.
  - Escribe `redirects/map.json` con cada `/wp-content/uploads/...` → `/img/<basename>` y las entradas fijas de la spec §4.1 (`/en/home/`, `/ca/inici/` y las 6 rutas de feed).
  - Ejecutar con `node scripts/migrate/extract.mjs` en un directorio temporal limpio.
- [ ] **Step 2:** Revisar a mano los Markdown:
  - Quitar los restos de WPBakery.
  - Pasar los 4 bloques de la home a `services`.
  - Pasar libros y clientes a YAML.
  - Limpiar los enlaces de Amazon (`https://www.amazon.es/<ruta>/dp/<ASIN>`).
  - Commit `content: migración del contenido en castellano`.
- [ ] **Step 3:** Tests de `registry.test.ts`:
  - `allRoutes()` incluye `/`, `/estudio/`, `/clientes/`, `/proyectos/`, `/publicaciones/`, `/contacto/`, `/politica-de-cookies-ue/`, `/terminos-y-condiciones/` y las 6 `/proyectos/<slug>/` actuales.
  - `contactThanks` tiene `noindex: true`.
  - Ningún `path` se repite.

  Para usar `astro:content` en Vitest, se configura con `getViteConfig` de `astro/config`.
- [ ] **Step 4:** `npm run test:unit` → FAIL. Implementar `content.config.ts` (`glob` loader) y `registry.ts`. Volver a ejecutar → PASS.
- [ ] **Step 5:** Commit `feat: colecciones de contenido y registro de rutas`.

### Task 4: Layout, identidad visual y SEO de `<head>`

**Files:**
- Create: `src/styles/tokens.css`, `src/styles/global.css`, `src/assets/brand/jlc.png`, `src/assets/brand/logo-JLC.png` (copiados de `GesAdmin_SPA/src/assets/`; clonar ese repo en solo lectura), `public/favicon.ico`, `public/apple-touch-icon.png`, `src/lib/seo.ts`, `src/layouts/Base.astro`, `src/components/{Header,Footer,LangSwitcher}.astro`, `src/scripts/menu.ts`, `tests/unit/seo.test.ts`, `tests/dist/layout.test.ts`
- Modify: `src/pages/[...path].astro` (usa `allRoutes()` y `Base`; contenido provisional = título)

**Interfaces:**
- Consumes: `site`, `t`, `pagePath`, `RouteEntry`.
- Produces:
  - `Base.astro`, con props `{ lang: Lang, title: string, description: string, path: string, alternates: Partial<Record<Lang,string>>, noindex?: boolean, ogImage?: string, jsonLd?: object[] }`.
  - `alternates(entry): {hreflang: string, href: string}[]`, que devuelve `es`, `en`, `ca` (los que existan) y `x-default` → la URL ES, todas absolutas.
  - `jsonLdOrganization(lang): object` (`@type: 'ProfessionalService'`, `areaServed: 'Illes Balears'`).

- [ ] **Step 1:** `seo.test.ts`:
  - `alternates` de un `RouteEntry` con los 3 idiomas devuelve 4 entradas, con `x-default` = `https://jlc-ingenieros.com/estudio/`.
  - `jsonLdOrganization('es').address.postalCode === '07800'`.
- [ ] **Step 2:** `layout.test.ts`. En `readPage('/estudio/')`:
  - `link[rel=canonical]` = `https://jlc-ingenieros.com/estudio/`.
  - Ningún atributo del documento contiene `3.133.180.219` ni `atomic4dev`.
  - Existe `a[href="https://areaprivada.jlc-ingenieros.com"]`.
  - El menú contiene el texto `Estudio` (no `STUDIO`).
  - No hay `<script>` sin `src` ni `<style>`, salvo `<script type="application/ld+json">`. Por eso la CSP permite `script-src 'self'` y JSON-LD no es ejecutable.
  - No hay ninguna URL a `fonts.googleapis.com`.
- [ ] **Step 3:** Ejecutar ambos tests → FAIL.
- [ ] **Step 4:** Implementar:
  - Tokens: `--navy: #1E2A78`, `--slate: #5c8fbe` y grises.
  - Open Sans mediante `@fontsource/open-sans` (pesos 400, 600 y 700; subconjunto latino).
  - Cabecera con menú (hamburguesa en < 768 px mediante `menu.ts`, `aria-expanded`) y `LangSwitcher`, que enlaza a `alternates[lang]` y omite los idiomas que falten.
  - Pie con dirección, correo, enlaces legales y `© {año del build}`.
  - Open Graph y Twitter Card; `noindex` → `<meta name="robots" content="noindex">`.
- [ ] **Step 5:** `npm test` → PASS. Comprobar el contraste de texto y fondo con un verificador (por ejemplo, `npx wcag-contrast` o un cálculo manual) → ≥ 4.5:1 en texto normal.
- [ ] **Step 6:** Commit `feat: layout, identidad visual y SEO`.

### Task 5: Vistas de las páginas (castellano)

**Files:**
- Create: `src/views/{Home,Studio,Clients,Projects,Project,Publications,Contact,Thanks,Prose}.astro`, `src/components/{ProjectCard,Gallery}.astro`, `src/assets/images/mapa-contacto.png`, `src/pages/404.astro`, `src/pages/sitemap.xml.ts`, `src/pages/robots.txt.ts`, `tests/dist/pages.test.ts`
- Modify: `src/pages/[...path].astro` (despacha a la vista según `kind`/`key`)

**Interfaces:**
- Consumes: colecciones (Tarea 3), `Base` (Tarea 4).
- Produces: `Contact.astro` reserva `<div id="contact-form-slot">`, que la Tarea 10 sustituye por `ContactForm`. `Prose.astro` renderiza cualquier página Markdown (estudio y legales).

- [ ] **Step 1:** `pages.test.ts`:
  - Cada ruta ES de `allRoutes()` tiene un `<h1>` igual al `title` de su entrada.
  - `/proyectos/` enlaza a las 6 fichas.
  - `/clientes/` contiene `Consell d’Eivissa` y `Bridgestone`.
  - `/publicaciones/` tiene 6 enlaces a `https://www.amazon.es/` sin `?`.
  - `/contacto/` contiene `C/. Carlos III, 28 Bajo` y un enlace a un mapa.
  - Las imágenes de `<main>` tienen `alt`, `width` y `height`.
  - `readPage('/404.html')` contiene los títulos en ES, EN y CA y `noindex`.
  - `dist/sitemap.xml` contiene cada ruta indexable con `xhtml:link` alternos y no contiene `/contacto/gracias/`.
  - `dist/robots.txt` contiene `Sitemap: https://jlc-ingenieros.com/sitemap.xml`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implementar las vistas:
  - Home: hero, `services` y CTA "Ver proyectos".
  - Proyectos: cuadrícula ordenada por `order`.
  - Ficha: `Gallery` con `astro:assets` `<Picture formats={['avif','webp']}>` y `BreadcrumbList` JSON-LD.
  - Contacto: dirección y mapa estático. El mapa es una captura de OpenStreetMap de C/. Carlos III 28, Eivissa (coordenadas obtenidas una vez con Nominatim), con el texto "© OpenStreetMap" y enlazada a `https://www.google.com/maps/search/?api=1&query=C.+Carlos+III+28+07800+Eivissa`.
  - 404 trilingüe.
  - Sitemap y robots generados desde `allRoutes()`.
- [ ] **Step 4:** `npm test` → PASS. Revisión visual con `npx astro preview` en 375 px y 1280 px (Playwright con `executablePath: '/opt/pw-browsers/chromium'`; capturas en el scratchpad, no en el repo).
- [ ] **Step 5:** Commit `feat: páginas en castellano, 404, sitemap y robots`.

### Task 6: Traducciones EN/CA y textos legales

**Files:**
- Create: `src/content/pages/{en,ca}/*.md` (las mismas claves que ES), `src/content/projects/{en,ca}/*.md` (6 + 6, con los slugs de la spec §4), `src/content/pages/{es,en,ca}/{legalNotice,privacy}.md`, `tests/dist/i18n.test.ts`
- Modify: `src/content/pages/{es,en,ca}/{cookies,terms}.md` (reescritos según la spec §5)

**Interfaces:**
- Consumes: el esquema de la Tarea 3 (EN/CA sin `cover`/`gallery`).

- [ ] **Step 1:** `i18n.test.ts`:
  - Cada `PageKey` y cada `translationKey` de proyecto existe en los 3 idiomas.
  - En cada página indexable, el conjunto de `link[rel=alternate][hreflang]` es exactamente `{es, en, ca, x-default}` y recíproco: la página `B` enlazada como alternativa de `A` enlaza de vuelta a `A`.
  - `<html lang>` coincide con el idioma de la ruta.
  - `/en/legal-notice/` contiene `20151498W` y `403`.
  - `/politica-de-privacidad/` contiene `info@jlc-ingenieros.com`, `Agencia Española de Protección de Datos` y `Cloudflare`.
  - `/politica-de-cookies-ue/` no menciona Google Analytics.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Redactar:
  - Las traducciones EN y CA (registro profesional; terminología: *autoconsum fotovoltaic*, *captació d'energia solar tèrmica*, *solar PV self-consumption*).
  - Los cuatro textos legales en los 3 idiomas, con los datos de Global Constraints y el contenido de la spec §5: encargados AWS (UE, París) y Cloudflare; base jurídica, consentimiento; sin cesiones; derechos ante info@jlc-ingenieros.com; reclamación ante la AEPD.

  Las páginas de proyecto EN/CA muestran las imágenes del ES con su mismo `translationKey`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `content: traducciones EN/CA y textos legales`.

### Task 7: Comprobaciones globales del build

**Files:**
- Create: `tests/dist/integrity.test.ts`, `.html-validate.json` (`extends: ["html-validate:recommended"]`)

**Interfaces:**
- Consumes: `distFiles()`, `readPage()`, `redirects/map.json`, `lambda/contact/paths.mjs` (Tarea 9; si se ejecuta antes que la 9, ese caso queda `skip` hasta entonces).

- [ ] **Step 1:** `integrity.test.ts`:
  - **Conservación:** existen los 14 ficheros `dist/` de las rutas ES del inventario (`/`, `/estudio/`, `/clientes/`, `/proyectos/`, `/publicaciones/`, `/contacto/`, 6 fichas, cookies y términos).
  - **Enlaces:** cada `href` y `src` interno (que empieza por `/`) de cada HTML resuelve a un fichero de `dist/` (`/x/` → `x/index.html`).
  - **Redirecciones:** cada destino de `map.json` existe en `dist/` (o en `public/img/`); ningún destino es a su vez una clave de `map.json` (sin cadenas); ninguna clave es una ruta servida en `dist/` (no se tapa contenido vivo).
  - **Lambda:** cada ruta de `paths.mjs` (`thanks` y `contact` por idioma) existe en `dist/`.
  - **HTML:** `html-validate` sobre todos los HTML → 0 errores.
- [ ] **Step 2:** `npm test` → FAIL en lo que falte. Corregir el contenido o las plantillas (no los tests) hasta → PASS.
- [ ] **Step 3:** Commit `test: integridad del build (URLs, enlaces, 301, HTML)`.

### Task 8: CloudFront Function (301, sondas, índice)

**Files:**
- Create: `edge/viewer-request.template.js`, `edge/build.mjs`, `edge/load.ts`, `tests/unit/edge.test.ts`
- Modify: `package.json`: `"build:edge": "node edge/build.mjs"`, y `build` pasa a ser `astro check && astro build && node edge/build.mjs`.

**Interfaces:**
- Consumes: `redirects/map.json`.
- Produces:
  - `edge/dist/viewer-request.js`: código `cloudfront-js-2.0` sin `import`/`export`, con `function handler(event)`.
  - `loadHandler(): (event) => request | response` (en `edge/load.ts`; evalúa el fichero generado con `new Function(code + '; return handler;')`).
  - El build falla si el código generado supera 10 KB.

- [ ] **Step 1:** Tests (`ev(uri, {host='jlc-ingenieros.com', qs={}})` construye el evento):
  - `www.jlc-ingenieros.com` + `/estudio/?a=1` → 301 `Location: https://jlc-ingenieros.com/estudio/?a=1`.
  - `/en/home/` y `/en/home` → 301 `/en/`. `/feed/` → 301 `/`.
  - Un `/wp-content/uploads/...jpg` de `map.json` → 301 `/img/<basename>`.
  - `/wp-login.php`, `/xmlrpc.php`, `/wp-admin/`, `/wp-json/wp/v2/users`, `/x.php` → 404 con `cache-control: public, max-age=300`.
  - `/?p=12` y `/?page_id=7` → 301 `/`. `/contacto/?utm_source=x` → petición reescrita a `/contacto/index.html` con la query intacta.
  - `/proyectos/fabrica-de-hielo` → 301 `/proyectos/fabrica-de-hielo/`. `/Contacto/` → 301 `/contacto/` (normalización a minúsculas solo si la versión en minúsculas está en el conjunto de rutas conocidas que inyecta el build, a partir de `dist/`).
  - `/estudio/` → petición con `uri` `/estudio/index.html`. `/_astro/a.css` y `/img/x.jpg` → sin cambios. `/api/contact` → sin cambios.
- [ ] **Step 2:** `npm run test:unit` → FAIL.
- [ ] **Step 3:** Implementar la plantilla y `build.mjs`. El generador inyecta `REDIRECTS` (de `map.json`) y `KNOWN` (las rutas en minúsculas de `dist/`; por eso `build:edge` se ejecuta después de `astro build`). Orden de reglas en `handler`: `www` → sondas → WP query → mapa → minúsculas → barra final → `index.html`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: CloudFront Function con 301 y bloqueo de sondas`.

### Task 9: Lambda del formulario

**Files:**
- Create: `lambda/contact/{index,validate,turnstile,mail,paths}.mjs`, `lambda/contact/package.json` (`"type":"module"`, sin dependencias de runtime: el SDK v3 viene incluido en Node 22), `tests/unit/contact-*.test.ts`

**Interfaces:**
- Produces:
  - `paths.mjs`: `PATHS = { es: { contact:'/contacto/', thanks:'/contacto/gracias/' }, en: {...'/en/contact/','/en/contact/thanks/'}, ca: {...'/ca/contacte/','/ca/contacte/gracies/'} }`.
  - `validateForm(input: Record<string,string>): {ok:true, data:{name,email,phone,message,lang}} | {ok:false}`, con estas reglas: nombre de 1 a 100; email RFC simple de ≤ 254 caracteres y sin CR/LF; teléfono opcional de ≤ 30 con `[0-9 +()-]`; mensaje de 10 a 5000; `privacy === 'on'`; `lang ∈ LANGS` (si no, `es`). Recorta espacios.
  - `isHoneypot(input): boolean`: `website` no vacío.
  - `verifyTurnstile(token: string, secret: string, remoteip?: string, fetchImpl = fetch): Promise<boolean>`: hace POST `application/x-www-form-urlencoded` a `https://challenges.cloudflare.com/turnstile/v0/siteverify` y devuelve `success === true`; ante un error de red, `false`.
  - `buildEmail(data, now: Date): { subject: string, text: string, replyTo: string }`: el asunto es `[Web] Contacto de ${nombre sin CR/LF, ≤ 100}`.
  - `makeHandler({ sendEmail: (msg) => Promise<void>, getTurnstileSecret: () => Promise<string>, fetchImpl, env: { ORIGIN_VERIFY, TO, FROM } })` y `handler = makeHandler(<SESv2 SendEmailCommand con Charset 'UTF-8' + SSM GetParameter WithDecryption, cacheado en el arranque>)`.
  - Evento: formato de payload 2.0 de la Function URL. El cuerpo puede venir en base64, como `x-www-form-urlencoded` o como JSON. La IP se toma de `cloudfront-viewer-address` (parte antes del último `:`).

- [ ] **Step 1:** Tests de `validateForm`:
  - Un caso válido con `José Luis Giménez` y `Col·legi` se conserva intacto.
  - Un mensaje de 9 caracteres → `ok:false`.
  - `email: "a@b.com\r\nBcc: x@y.z"` → `ok:false`.
  - Sin `privacy` → `ok:false`.
  - `lang: 'fr'` → `data.lang === 'es'`.
- [ ] **Step 2:** Tests de `buildEmail`:
  - El nombre `"Eve\r\nBcc: x"` produce un asunto sin `\r` ni `\n`.
  - El cuerpo contiene nombre, email, teléfono, mensaje, idioma y la fecha ISO.
  - `replyTo === data.email`.
- [ ] **Step 3:** Tests del handler con dependencias simuladas:
  - Sin `x-origin-verify` correcto → 403 y no se envía nada.
  - `GET` → 405.
  - Cuerpo > 16 KB → 400 `validation`.
  - Campo trampa → 303 a `PATHS[lang].thanks` y `sendEmail` no se llama.
  - Validación fallida en un envío de formulario (`accept: text/html`) con `lang=ca` → 303 `Location: /ca/contacte/?error=validation#form-error-validation`. El fragmento permite que la Tarea 10 muestre el error sin JS mediante `:target`.
  - Lo mismo con `accept: application/json` → 400 `{"ok":false,"error":"validation"}`.
  - Turnstile `false` → 400 `captcha`.
  - `sendEmail` lanza una excepción → 502 `send` (o 303 `?error=send`).
  - Caso correcto → `sendEmail` se llama una vez con `To` `jlcampos@jlc-ingenieros.com` y `From` `JLC Ingenieros web <web@jlc-ingenieros.com>`, y la respuesta es 303 `/contacto/gracias/` o 200 `{"ok":true}` según `accept`.
  - `console.log` nunca recibe el email ni el nombre: se espía `console` y se comprueba.
- [ ] **Step 4:** `npm run test:unit` → FAIL. Implementar. Volver a ejecutar → PASS.
- [ ] **Step 5:** Activar el caso Lambda de `integrity.test.ts` (Tarea 7). `npm test` → PASS.
- [ ] **Step 6:** Commit `feat: Lambda de contacto (validación, Turnstile, SES)`.

### Task 10: Formulario en el sitio

**Files:**
- Create: `src/components/ContactForm.astro`, `src/components/Turnstile.astro`, `src/scripts/contact-form.ts`, `tests/unit/contact-form.test.ts` (con `happy-dom`), `tests/dist/contact.test.ts`
- Modify: `src/views/Contact.astro` (sustituye `#contact-form-slot`)

**Interfaces:**
- Consumes: `t(lang, …)`, los nombres de campo de la Tarea 9 (`name,email,phone,message,privacy,website,lang,cf-turnstile-response`) y `PATHS`.
- Produces: `submitContact(form: HTMLFormElement, fetchImpl = fetch): Promise<'ok'|'validation'|'captcha'|'send'|'network'>`, exportada desde `contact-form.ts` para los tests.

- [ ] **Step 1:** `contact-form.test.ts`:
  - Respuesta 200 `{"ok":true}` → `'ok'`.
  - 400 `{"error":"captcha"}` → `'captcha'`.
  - 429 con cuerpo HTML → `'network'`.
  - `fetch` rechazado → `'network'`.
  - Después de cualquier resultado distinto de `ok`, el botón vuelve a estar activo y `[role=alert]` muestra el texto de `t(lang, 'error.<código>')` del idioma del `<html lang>`.
- [ ] **Step 2:** `contact.test.ts` (dist), en `/contacto/`, `/en/contact/` y `/ca/contacte/`:
  - `form[method=post][action="/api/contact"]`.
  - `input[name=lang]` con el valor del idioma.
  - `input[name=website]` oculto (`tabindex=-1`, `autocomplete=off`, fuera de pantalla por CSS, sin `display:none` en línea).
  - Casilla `privacy` `required` con enlace a la política de privacidad del idioma.
  - Script de Turnstile `https://challenges.cloudflare.com/turnstile/v0/api.js` solo en estas 3 páginas, en ninguna otra.
  - Hay un elemento `#form-error-<código>` por cada código (`validation`, `captcha`, `send`), oculto por defecto y visible con `:target`. Así el error se ve sin JS, porque la Lambda redirige a `?error=X#form-error-X`.
- [ ] **Step 3:** `npm test` → FAIL. Implementar. Con JS, `submit` → `fetch` con `Accept: application/json`; en `ok`, `location.assign(thanksPath)`. Volver a ejecutar → PASS.
- [ ] **Step 4:** Commit `feat: formulario de contacto con mejora progresiva`.

### Task 11: Infraestructura como código

**Files:**
- Create: `infra/cert.yaml`, `infra/template.yaml`, `infra/render.mjs`, `infra/README.md`, `tests/unit/infra.test.ts`

**Interfaces:**
- Consumes: `edge/dist/viewer-request.js` (Tarea 8) y `lambda/contact/` (Tarea 9).
- Produces:
  - `node infra/render.mjs` → `infra/build/template.yaml`, con el código de la Function insertado en `FunctionCode`.
  - Outputs de la pila: `BucketName`, `DistributionId`, `DistributionDomain`, `DeployRoleArn`, `ContactFunctionName`, `EdgeFunctionName`.

- [ ] **Step 1:** `infra.test.ts`. Parsea el YAML con `yaml` y esquema CFN de etiquetas personalizadas:
  - No existe ningún recurso `AWS::Route53::*` ni `AWS::EC2::*`.
  - Todos los recursos que admiten `Tags` llevan `project=jlc-web-publica`.
  - El bucket tiene `PublicAccessBlockConfiguration` con los 4 `true`, versionado y la regla de ciclo de vida de 30 días.
  - La política de cabeceras de respuesta tiene HSTS `63072000` **sin** `IncludeSubdomains` ni `Preload`, y una CSP idéntica a la de la spec §7.
  - Los errores personalizados son solo 403 y 404 → `/404.html` con 404.
  - El comportamiento `/api/*` usa la caché gestionada `CachingDisabled`, la *origin request policy* `AllViewerExceptHostHeader`, los métodos `GET,HEAD,OPTIONS,PUT,POST,PATCH,DELETE` y la cabecera de origen `X-Origin-Verify` con el valor `{{resolve:ssm:/jlc-web-publica/origin-verify}}`.
  - La Lambda tiene `ReservedConcurrentExecutions: 2`, `Runtime: nodejs22.x`, `MemorySize: 128`, `Timeout: 10`, `FunctionUrlConfig.AuthType: NONE` y permisos `lambda:InvokeFunctionUrl` y `lambda:InvokeFunction` para el principal `*` (los dos son necesarios desde el cambio de AWS de 2025), además de un `LogGroup` de 30 días.
  - La política IAM de la Lambda solo permite `ses:SendEmail` sobre la identidad del dominio y `ssm:GetParameter` sobre `/jlc-web-publica/*`.
  - La confianza del rol de despliegue tiene `token.actions.githubusercontent.com:sub` = `repo:jlcampos-iies/jlcampos-iies:ref:refs/heads/main`, y sus permisos están limitados al ARN del bucket, de la distribución, de la Function y de la Lambda.
  - Existen las condiciones `CreateOidcProvider` (parámetro `ExistingGitHubOidcProviderArn` vacío) y `CreateSesIdentity` (parámetro `true`).
  - Existe un `AWS::Budgets::Budget` de 5 USD con avisos al 80 % y al 100 % a `jlcampos@jlc-ingenieros.com`.
  - `cert.yaml` declara un `AWS::CertificateManager::Certificate` con `jlc-ingenieros.com` + `www.jlc-ingenieros.com`, validación `DNS` y **sin** `HostedZoneId`, para que no escriba en Route 53.
- [ ] **Step 2:** `npm run test:unit` → FAIL. Escribir las plantillas.
  - Alias `jlc-ingenieros.com` y `www.jlc-ingenieros.com` en la distribución mediante el parámetro `EnableAliases` (`false` por defecto). Se activa en el corte, porque un alias con certificado ACM válido no afecta al DNS.
  - S3 con OAC.
  - Price class 100, HTTP/2 y HTTP/3, TLS `TLSv1.2_2021`.
  - Parámetro `CertificateArn`.
  - La Lambda lee el secreto de Turnstile de SSM.
  - `X-Origin-Verify` se compara con la variable de entorno `ORIGIN_VERIFY` = `{{resolve:ssm:/jlc-web-publica/origin-verify}}`.
  - `TO`/`FROM` como variables de entorno.
- [ ] **Step 3:** `npm run test:unit` → PASS. Ejecutar `pip install cfn-lint && cfn-lint infra/cert.yaml infra/build/template.yaml` → sin errores.
- [ ] **Step 4:** Escribir `infra/README.md` con los pasos en orden y los comandos exactos:
  1. `scripts/check-isolation.sh --snapshot`.
  2. Crear los parámetros SSM: `aws ssm put-parameter --region eu-west-3 --name /jlc-web-publica/turnstile-secret --type SecureString …` y `/jlc-web-publica/origin-verify --type String --value "$(openssl rand -hex 32)"`.
  3. Comprobar SES en París: `aws sesv2 get-email-identity --email-identity jlc-ingenieros.com --region eu-west-3`. Un `NotFoundException` significa `CreateSesIdentity=true`.
  4. Comprobar si existe el proveedor OIDC: `aws iam list-open-id-connect-providers`.
  5. Desplegar `cert.yaml` en `us-east-1`. Crear el CNAME de validación con el botón "Crear registros en Route 53" de ACM, que solo **añade**. Ejecutar `check-isolation.sh`.
  6. `npm ci && npm run build && npm run build:edge && node infra/render.mjs && sam deploy --template-file infra/build/template.yaml --stack-name jlc-web-publica --region eu-west-3 --capabilities CAPABILITY_IAM --resolve-s3 --parameter-overrides …`.
  7. DKIM de SES con el botón "Publicar registros en Route 53", que solo **añade**. Ejecutar `check-isolation.sh`.
  8. Verificar `jlcampos@jlc-ingenieros.com` en SES.
  9. Crear el widget de Turnstile con los dominios `jlc-ingenieros.com` y `<DistributionDomain>`.
  10. Configurar las *variables* de GitHub `AWS_ROLE_ARN`, `S3_BUCKET`, `CF_DISTRIBUTION_ID`, `CF_FUNCTION_NAME`, `CONTACT_FUNCTION_NAME`, `SITE_URL` y `PUBLIC_TURNSTILE_SITE_KEY`.
- [ ] **Step 5:** Commit `feat: infraestructura AWS (CloudFormation/SAM)`.

### Task 12: Despliegue continuo

**Files:**
- Create: `.github/workflows/deploy.yml`, `scripts/smoke.sh`, `tests/unit/smoke-script.test.ts`

**Interfaces:**
- Consumes: las variables de GitHub de la Tarea 11 y los artefactos de las Tareas 8 y 9.
- Produces: `scripts/smoke.sh <base-url> [--host-check]`. Termina con código 0 si todo pasa e imprime una línea `OK|FAIL <comprobación>` por cada comprobación.

- [ ] **Step 1:** `smoke.sh` comprueba:
  - 200 en `/`, `/en/`, `/ca/`, `/estudio/` y las 6 fichas ES.
  - 301 `/en/home/` → `/en/`, `/ca/inici/` → `/ca/` y `/feed/` → `/`.
  - 404 `/wp-login.php`.
  - En `/`: cabeceras `strict-transport-security`, `content-security-policy` y `x-content-type-options`.
  - `POST /api/contact` con `Accept: application/json` y cuerpo vacío → 400 `{"ok":false,"error":"validation"}` (no 403/404/5xx), lo que demuestra que CloudFront llega a la Lambda con la cabecera de origen.
  - Con `--host-check`, además, `https://www.jlc-ingenieros.com/estudio/` → 301 `https://jlc-ingenieros.com/estudio/`.

  `smoke-script.test.ts` ejecuta el script contra un servidor HTTP local de prueba que simula esas respuestas y comprueba el código de salida 0, y 1 cuando una ruta devuelve 500.
- [ ] **Step 2:** Test → FAIL. Implementar. → PASS.
- [ ] **Step 3:** `deploy.yml`, en push a `main`:
  - Job `test`, igual que CI.
  - Job `deploy` (`needs: test`, `permissions: id-token: write, contents: read`, `concurrency: deploy`):
    1. `aws-actions/configure-aws-credentials` con `role-to-assume: ${{ vars.AWS_ROLE_ARN }}` y `aws-region: eu-west-3`.
    2. `npm ci`, `npm run build` y `npm run build:edge`.
    3. `aws s3 sync dist/_astro s3://$S3_BUCKET/_astro --cache-control "public,max-age=31536000,immutable"`.
    4. `aws s3 sync dist s3://$S3_BUCKET --delete --exclude "_astro/*" --cache-control "no-cache"`.
    5. Actualizar la Function si cambió: `describe-function` (ETag) → `update-function` → `publish-function`.
    6. Actualizar la Lambda: `zip -j` de `lambda/contact/*.mjs` → `aws lambda update-function-code`.
    7. `aws cloudfront create-invalidation --paths "/*"`.
    8. `scripts/smoke.sh "$SITE_URL"`.

  Comprobar con `npx actionlint` → sin errores.
- [ ] **Step 4:** Commit `ci: despliegue a S3/CloudFront por OIDC`.

### Task 13: Aislamiento, DNS y runbook del corte

**Files:**
- Create: `scripts/check-isolation.sh`, `scripts/dns/render.sh`, `scripts/dns/baseline.txt` (generado), `docs/runbook-corte.md`, `docs/retirada-wordpress.md`, `tests/unit/dns-render.test.ts`

**Interfaces:**
- Produces:
  - `check-isolation.sh --snapshot | --compare`. Consulta por DoH (`https://dns.google/resolve`) estos registros: `jlc-ingenieros.com` MX/NS/TXT; `_dmarc` TXT; `www` CNAME; los 6 `_domainkey` (`6wmkdnrfnxi3midc2doz4m5wc77qz7g3`, `h3glg2fy22z7qzzye6g6zhg3tcuingqn`, `vdd56aijvyidt5xoo5g2lbdy73d7m2uh`, `firebase1`, `firebase2`, `sig1`); `areaprivada` A/TXT; `demo` A; `met` A.
    - `--snapshot` escribe `scripts/dns/baseline.txt` ordenado.
    - `--compare` hace `diff` contra el *baseline* (código de salida 1 si hay diferencias). Además exige que `areaprivada`, `demo` y `met` = `3.12.236.157`, que `https://areaprivada.jlc-ingenieros.com/` devuelva 200 y que `https://areaprivada.jlc-ingenieros.com/api/gesnorm` no devuelva 5xx ni error de conexión.
  - `scripts/dns/render.sh <cutover|rollback|ttl60|ttl300> [cloudfront-domain]` imprime el JSON de `aws route53 change-resource-record-sets`. **Solo** puede contener cambios sobre `Name: jlc-ingenieros.com.` y `Type ∈ {A, AAAA}`:
    - `cutover`: `UPSERT` A ALIAS + `CREATE` AAAA ALIAS, con `HostedZoneId` `Z2FDTNDATAQYW2` y `DNSName` = el dominio de CloudFront.
    - `rollback`: `UPSERT` A `3.133.180.219` con TTL 60 + `DELETE` AAAA ALIAS.
    - `ttl60`/`ttl300`: `UPSERT` A `3.133.180.219` con ese TTL.
- [ ] **Step 1:** `dns-render.test.ts`: para cada modo, el JSON parseado tiene en todas sus `Changes` `ResourceRecordSet.Name === 'jlc-ingenieros.com.'` y `Type ∈ {A,AAAA}`, y contiene los valores anteriores. Además, `cutover` sin dominio → código de salida ≠ 0.
- [ ] **Step 2:** → FAIL. Implementar ambos scripts → PASS. Ejecutar `shellcheck scripts/*.sh scripts/dns/*.sh` → limpio.
- [ ] **Step 3:** Ejecutar en vivo (solo lectura) `scripts/check-isolation.sh --snapshot && scripts/check-isolation.sh --compare` → código de salida 0. Hacer commit del `baseline.txt`.
- [ ] **Step 4:** Escribir `docs/runbook-corte.md` con los pasos 1–14 de la spec §10, cada uno con su comando exacto:
  - Los TTL con `render.sh ttl60`, aplicados con `aws route53 change-resource-record-sets --hosted-zone-id <ZONA> --change-batch file://…`.
  - El corte, con el despliegue de la pila con `EnableAliases=true` seguido de `render.sh cutover`.
  - `check-isolation.sh --compare` y `smoke.sh https://jlc-ingenieros.com --host-check` después de cada paso que toque DNS.
  - La vuelta atrás con `render.sh rollback`.

  Escribir `docs/retirada-wordpress.md` con la lista de comprobación de la instancia Lightsail:
  - `apachectl -S` (*vhosts*), `crontab -l` de todos los usuarios, `ss -tlnp`, `ls /etc/apache2/sites-enabled`.
  - Snapshot de Lightsail.
  - Detener → 30 días → eliminar → **liberar la IP estática**.
  - Conservar el snapshot 6 meses.
  - No renovar las licencias de Rank Math PRO, WP Rocket ni Salient.
- [ ] **Step 5:** Commit `ops: verificación de aislamiento, cambios DNS y runbook del corte`.

---

## Cobertura de la spec

| Spec | Tarea |
|---|---|
| §1 objetivos, §8 aislamiento | 11 (sin Route53/EC2 en la plantilla), 13 (`check-isolation`, `render.sh` limitado al apex) |
| §2 inventario y conservación de URLs | 3, 7 |
| §3 Astro y estructura | 1–5 |
| §4 URLs, 301, sondas y SEO | 2, 3, 4, 5, 6, 8 |
| §5 diseño, contenido, traducciones y legales | 4, 5, 6 |
| §6 formulario | 9, 10, 11 |
| §7 infraestructura | 11 |
| §9 CI/CD | 1, 12 |
| §10 corte y retirada | 13 (runbook; lo ejecuta el titular) |
| §11 pruebas | todas; Lighthouse y la revisión visual, en la Tarea 5 y en el runbook |
