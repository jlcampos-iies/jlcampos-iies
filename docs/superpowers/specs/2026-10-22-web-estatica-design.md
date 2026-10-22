# Migración de jlc-ingenieros.com de WordPress a web estática — Diseño

- **Fecha:** 2026-10-22
- **Estado:** aprobado en conversación, pendiente de revisión escrita
- **Repo:** `jlcampos-iies/jlcampos-iies`

## 1. Objetivos y criterios de éxito

Por orden de prioridad:

1. **No afectar a la infraestructura del área privada.** `areaprivada.jlc-ingenieros.com`, `demo.jlc-ingenieros.com` y `met.jlc-ingenieros.com` (EC2 `3.12.236.157`, SPA Angular + API `/api/gesnorm`, Firebase `gesnormauth`, MongoDB Atlas) siguen funcionando exactamente igual durante y después de la migración. El correo (iCloud), el SES que ya se usa con el dominio y los registros DNS de Apple, Firebase y DMARC tampoco cambian.
2. **Seguridad:** la web pública deja de ejecutar PHP y de usar base de datos (motivo: CVE-2026-109618 y CVE-2026-109619). No queda ningún servidor que parchear para la web pública.
3. **SEO:** las URLs actuales en castellano se mantienen idénticas. Las URLs que desaparecen redirigen con 301. Se corrige el `canonical`/`og:url` que hoy apunta a `http://3.133.180.219`.
4. **Funcionalidad equivalente o mejor:** mismo contenido, formulario de contacto operativo, trilingüe completo (ES/EN/CA), identidad visual compartida con el área privada.
5. **Coste:** menos de 1 €/mes adicional en AWS; al final se retira la instancia Lightsail de WordPress.

Mantenimiento: el titular edita Markdown en el repo pocas veces al año (o lo pide a Claude). No hay CMS.

## 2. Inventario de la web actual (rastreo externo, 2026-10-22)

| Elemento | Situación actual | Destino |
|---|---|---|
| Páginas ES | `/`, `/estudio/`, `/clientes/`, `/proyectos/`, `/publicaciones/`, `/contacto/` | Se migran con la misma URL |
| Portfolio | 6 proyectos en `/proyectos/<slug>/` | Se migran con la misma URL |
| Legales | `/politica-de-cookies-ue/`, `/terminos-y-condiciones/` | Se migran y se reescriben; se añaden aviso legal y política de privacidad (no existen) |
| Entradas de blog | Ninguna | — |
| Idiomas (Polylang) | EN y CA solo traducen la home (`/en/home/`, `/ca/inici/`), a medias; el menú de las páginas ES sale en inglés | Trilingüe completo |
| Formulario | Contact Form 7 + reCAPTCHA | Lambda + SES + Turnstile |
| Cookies | Complianz; no se detecta analítica | Sin cookies de terceros, sin banner |
| SEO | Rank Math PRO; canonical a IP; restos de `atomic4dev.net` y `18.191.198.48` | Generado por Astro, correcto |
| Rendimiento | WP Rocket | No hace falta (estático + CDN) |
| Tema | Salient + WPBakery + Salient Portfolio | Diseño nuevo propio |
| Publicaciones | 6 libros con enlaces a Amazon con parámetros de seguimiento | Enlaces limpios a Amazon |
| Servidor | Apache en una instancia **Lightsail**, IP estática `3.133.180.219` | Se retira tras el corte |

DNS: zona pública alojada en **Route 53** (confirmado en la consola; 17 registros):
- Apex: A `3.133.180.219`; MX `mx01/mx02.mail.icloud.com`; NS/SOA; TXT `apple-domain=…`, `firebase=gesnormauth`, `v=spf1 include:icloud.com include:_spf.firebasemail.com ~all` y otro TXT de verificación.
- `www` CNAME → `jlc-ingenieros.com` (TTL 300).
- `areaprivada` (A `3.12.236.157` y un TXT), `demo` (A `3.12.236.157`) y `met` (A `3.12.236.157`).
- `_dmarc` TXT `v=DMARC1; p=none;`.
- DKIM: `sig1._domainkey` (iCloud), `firebase1._domainkey` y `firebase2._domainkey` (Firebase), y tres `<token>._domainkey` de **Amazon SES Easy DKIM**: ya existe una identidad SES del dominio en alguna región, usada por el área privada.

Dependencias del área privada con el dominio principal (revisado en `GesAdmin_SPA`): solo enlaces salientes a `https://jlc-ingenieros.com` (`marca.web`) y a `http://www.jlc-ingenieros.com` (firma de comunicaciones). Siguen funcionando, porque `www` redirige con 301 al apex.

## 3. Arquitectura

```
Navegador ──HTTPS──> CloudFront (ACM us-east-1, cabeceras de seguridad)
                       ├─ viewer-request: CloudFront Function (301, index.html, bloqueo de rutas WP)
                       ├─ origen por defecto: S3 privado (OAC) — eu-west-3
                       └─ /api/contact: Lambda Function URL (cabecera secreta de origen) — eu-west-3 ──> SES eu-west-3 ──> jlcampos@jlc-ingenieros.com
                                                                 └─> Cloudflare Turnstile (siteverify)
GitHub Actions ──OIDC──> rol IAM (solo s3 sync en el bucket + invalidación de esta distribución)
```

### 3.1 Generador: Astro

- Salida 100 % estática (`output: 'static'`, `build.format: 'directory'`, `trailingSlash: 'always'`), para que las rutas coincidan exactamente con las de WordPress (`/estudio/` → `estudio/index.html`).
- Sin JavaScript en el cliente salvo dos islas pequeñas: el menú móvil y el envío del formulario (mejora progresiva).
- Contenido en *content collections* con esquema (zod): `pages`, `projects`, `publications`, `clients`, `legal`. Si a un contenido le falta un campo o tiene un tipo incorrecto, el build falla.
- Cada entrada tiene un `translationKey` común a sus tres idiomas; con él se generan el selector de idioma y los `hreflang`.
- `build.inlineStylesheets: 'never'` y nada de `<script>` en línea, para cumplir la CSP sin `'unsafe-inline'`.
- Imágenes procesadas con `astro:assets` (AVIF/WebP, `srcset`, `width`/`height`).
- Sitemap con alternativas de idioma (`@astrojs/sitemap` con i18n).

### 3.2 Estructura del repo

```
/                     proyecto Astro
  src/content/        Markdown por colección e idioma (es/, en/, ca/)
  src/layouts/        layout base (cabecera, pie, selector de idioma, SEO)
  src/components/     componentes (tarjeta de proyecto, galería, formulario…)
  src/i18n/           diccionario de textos de interfaz y mapa de rutas por idioma
  src/assets/         imágenes y logos
  public/             fuentes autoalojadas, favicons, robots.txt
  redirects/map.json  mapa de 301 (fuente única)
  edge/               CloudFront Function (generada a partir de map.json) + tests
  lambda/contact/     función del formulario + tests
  infra/              plantilla CloudFormation/SAM + README de despliegue
  scripts/            verificación de DNS y del área privada, comprobación de redirecciones
  .github/workflows/  ci.yml (PR), deploy.yml (main)
```

Cada unidad tiene una interfaz clara: `map.json` es la única fuente de las 301; la Function y los tests de redirecciones se derivan de él. La Lambda no depende del sitio: solo recibe un POST y envía un correo.

## 4. Estructura de URLs

Las URLs en castellano no cambian. Todas terminan en `/`.

| Página | ES | EN | CA |
|---|---|---|---|
| Inicio | `/` | `/en/` | `/ca/` |
| Estudio | `/estudio/` | `/en/studio/` | `/ca/estudi/` |
| Clientes | `/clientes/` | `/en/clients/` | `/ca/clients/` |
| Proyectos | `/proyectos/` | `/en/projects/` | `/ca/projectes/` |
| Publicaciones | `/publicaciones/` | `/en/publications/` | `/ca/publicacions/` |
| Contacto | `/contacto/` | `/en/contact/` | `/ca/contacte/` |
| Gracias (formulario) | `/contacto/gracias/` | `/en/contact/thanks/` | `/ca/contacte/gracies/` |
| Política de cookies | `/politica-de-cookies-ue/` | `/en/cookie-policy/` | `/ca/politica-de-galetes/` |
| Términos y condiciones | `/terminos-y-condiciones/` | `/en/terms-and-conditions/` | `/ca/termes-i-condicions/` |
| Aviso legal (nuevo) | `/aviso-legal/` | `/en/legal-notice/` | `/ca/avis-legal/` |
| Privacidad (nuevo) | `/politica-de-privacidad/` | `/en/privacy-policy/` | `/ca/politica-de-privacitat/` |

Proyectos (`/proyectos/…`, `/en/projects/…`, `/ca/projectes/…`):

| ES (actual) | EN | CA |
|---|---|---|
| `instalacion-solar-fotovoltaica-en-modalidad-de-autoconsumo` | `solar-pv-self-consumption-installation` | `installacio-solar-fotovoltaica-en-modalitat-dautoconsum` |
| `instalacion-solar-fotovoltaica` | `solar-pv-installation` | `installacio-solar-fotovoltaica` |
| `fabrica-de-hielo` | `ice-factory` | `fabrica-de-gel` |
| `instalacion-de-captacion-de-energia-solar-termica-en-edificio-de-viviendas` | `solar-thermal-installation-in-residential-building` | `installacio-de-captacio-denergia-solar-termica-en-edifici-dhabitatges` |
| `nave-industrial` | `industrial-building` | `nau-industrial` |
| `apartamentos-turisticos` | `tourist-apartments` | `apartaments-turistics` |

Las páginas "gracias" y la 404 llevan `noindex`.

### 4.1 Redirecciones 301 (`redirects/map.json`)

- `/en/home/` → `/en/`; `/ca/inici/` → `/ca/`.
- `/feed/`, `/comments/feed/`, `/en/feed/`, `/en/comments/feed/`, `/ca/feed/`, `/ca/comments/feed/` → home del idioma correspondiente.
- `/wp-content/uploads/…` usadas en la web actual (og:image, fotos de proyectos, portadas de libros, banners): cada una a su nueva ruta de imagen. Las demás `/wp-content/…` devuelven 404.
- `www.jlc-ingenieros.com/<ruta>` → `https://jlc-ingenieros.com/<ruta>`.
- La regla se aplica con y sin barra final (`/en/home` → `/en/`).

### 4.2 Bloqueo de sondas

`/wp-admin*`, `/wp-login.php`, `/xmlrpc.php`, `/wp-json*`, `/wp-includes*`, `*.php`: la CloudFront Function responde 404 directamente (no llega a S3), con `Cache-Control` corto.

### 4.3 SEO técnico

- `<link rel="canonical">` absoluto a `https://jlc-ingenieros.com/…`.
- `hreflang` es, en, ca y `x-default` (→ ES) en todas las páginas indexables, recíprocos.
- `sitemap.xml` con `xhtml:link` alternos; `robots.txt` apuntando a él.
- Open Graph y Twitter Card por página, con imagen propia.
- JSON-LD `ProfessionalService` (nombre, dirección de C/. Carlos III, 28 Bajo, 07800 Eivissa, teléfono, URL, `areaServed` Illes Balears) en la home; `BreadcrumbList` en proyectos.
- `<html lang>` correcto por idioma.

## 5. Diseño visual y contenido

- **Paleta:** azul marino `#1E2A78` (cabecera, pie, titulares, texto sobre fondo claro cuando haga falta contraste), slate blue `#5c8fbe` (acentos, botones, enlaces sobre fondo oscuro o en texto grande), blanco y gris claro de fondo. Contraste WCAG 2.1 AA comprobado; el slate blue no se usa para texto normal sobre blanco.
- **Logos:** `jlc.png` y `logo-JLC.png` de `GesAdmin_SPA/src/assets` (copiados al repo). Favicons generados a partir de ellos.
- **Tipografía:** Open Sans autoalojada (woff2, subconjunto latino), sin Google Fonts.
- **Cabecera:** logo, menú en el idioma de la página (Inicio, Estudio, Clientes, Proyectos, Publicaciones, Contacto), selector ES · EN · CA que enlaza a la página equivalente y botón destacado "Área privada" (`https://areaprivada.jlc-ingenieros.com`; "Private area" / "Àrea privada").
- **Pie:** dirección, correo, enlaces a aviso legal, privacidad, cookies y términos, y © con el año del build.
- **Páginas:**
  - Home: hero con imagen y titular, y los 4 bloques de servicio.
  - Estudio: texto.
  - Clientes: lista de 12.
  - Proyectos: cuadrícula de tarjetas, y una ficha con galería por proyecto.
  - Publicaciones: 6 libros con portada y enlace limpio a Amazon.
  - Contacto: dirección, formulario y mapa estático (imagen enlazada a Google Maps, sin iframe).
- **Adaptable** (móvil primero), accesible (navegación con teclado, `alt` en imágenes, foco visible), sin dependencias de terceros en tiempo de ejecución salvo Turnstile en Contacto.
- **Migración de contenido:** extracción del HTML público a Markdown con *front-matter* y descarga de las imágenes de `uploads`. Se revisa a mano el texto final (eliminando restos del constructor visual).
- **Traducciones EN y CA:** las redacta Claude a partir del castellano con terminología técnica correcta; el titular las revisa (sobre todo el catalán).
- **Textos legales** (redactados por Claude, revisados por el titular), en los tres idiomas:
  - Aviso legal (LSSI-CE art. 10): titular José Luis Campos Giménez, NIF 20151498W, C/. Carlos III, 28 Bajo, 07800 Eivissa, jlcampos@jlc-ingenieros.com, (+34) 616 992 440, profesión regulada Ingeniero Industrial (título UPV), colegiado n.º 403 del Col·legi Oficial d'Enginyers Industrials de les Illes Balears (COEIB); normas profesionales: las del COEIB y la normativa estatal de la profesión.
  - Política de privacidad (RGPD/LOPDGDD): tratamiento de los datos del formulario. Finalidad: responder a la consulta. Base jurídica: consentimiento. Encargados: AWS (UE, París) y Cloudflare (Turnstile). Sin cesiones. Conservación: la del hilo de correo. Derechos ejercibles ante info@jlc-ingenieros.com, con reclamación ante la AEPD (coherente con lo que ya usa el área privada).
  - Política de cookies: solo almacenamiento técnico; Turnstile en la página de contacto.
  - Términos y condiciones: actualización del texto actual.

## 6. Formulario de contacto

**Cliente** (`/contacto/` y equivalentes):
- Campos: nombre (obligatorio, ≤ 100), email (obligatorio, formato), teléfono (opcional, ≤ 30), mensaje (obligatorio, 10–5000), casilla de aceptación de la política de privacidad (obligatoria), campo trampa oculto `website`, widget Turnstile e idioma oculto `lang`.
- `<form method="post" action="/api/contact">`. Sin JS: la Lambda responde 303 a la página "gracias" del idioma (o a la de contacto con `?error=<código>`, que muestra un mensaje). Con JS: `fetch` con `Accept: application/json`; la respuesta se muestra en la misma página sin recargar.

**Lambda `jlc-web-contact`** (Node.js 22, eu-west-3, 128 MB, timeout 10 s, concurrencia reservada 2):
1. Acepta solo `POST` con `application/x-www-form-urlencoded` o `application/json` y cuerpo ≤ 16 KB.
2. Si el campo trampa tiene contenido, responde éxito sin enviar nada.
3. Valida campos y longitudes; si falla → 400 / `error=validation`.
4. Verifica el token con `https://challenges.cloudflare.com/turnstile/v0/siteverify` (secreto en variable de entorno cifrada, cargada desde un parámetro `SecureString` de SSM; nunca en el repo). Si falla → 403 / `error=captcha`.
5. Envía con SES `SendEmail`: From `JLC Ingenieros web <web@jlc-ingenieros.com>`, To `jlcampos@jlc-ingenieros.com`, Reply-To el email del visitante (validado; sin saltos de línea), asunto `[Web] Contacto de <nombre>`, cuerpo en texto plano con los campos, idioma y fecha.
6. Si SES falla → 502 / `error=send`.
7. Logs: solo el resultado y el código de error, sin datos personales. Retención de logs: 30 días.

**Acceso:** la Function URL usa `AuthType NONE` (OAC con `POST` exigiría al navegador la cabecera `x-amz-content-sha256`, incompatible con un formulario sin JS). CloudFront añade al origen la cabecera `X-Origin-Verify` con un secreto aleatorio (parámetro de la pila, guardado en SSM) y la Lambda rechaza con 403 cualquier petición que no la lleve; así una llamada directa a la Function URL no sirve de nada. El comportamiento `/api/*` de CloudFront no usa caché y reenvía el cuerpo y las cabeceras necesarias.

**SES (eu-west-3):** el dominio ya tiene una identidad SES (3 CNAME Easy DKIM existentes), probablemente en otra región y usada por el área privada. Antes de desplegar se comprueba con `aws sesv2 get-email-identity --email-identity jlc-ingenieros.com --region eu-west-3`. Parámetro de la pila `CreateSesIdentity`:
- **`true`** (no existe en París): se crea una identidad nueva en eu-west-3 con Easy DKIM (3 CNAME **nuevos**, con nombres distintos de los existentes). La reputación de envío queda separada por región, así que el spam que pudiera llegar al formulario no afecta a los envíos del área privada.
- **`false`** (ya existe en París): se reutiliza sin modificarla.

En ambos casos se mantiene en sandbox, porque el único destinatario es una dirección verificada (jlcampos@jlc-ingenieros.com, que se verifica con el correo que envía SES). MAIL FROM por defecto (amazonses.com): no se modifica el SPF.

## 7. Infraestructura AWS (`infra/`)

Pila CloudFormation/SAM `jlc-web-publica` en `eu-west-3`, más una pila pequeña `jlc-web-publica-cert` en `us-east-1` solo para el certificado ACM. Todos los recursos llevan la etiqueta `project=jlc-web-publica`.

| Recurso | Configuración |
|---|---|
| S3 `jlc-web-publica-site-<cuenta>` | Bloqueo de acceso público, cifrado SSE-S3, versionado, regla de ciclo de vida que borra versiones antiguas a los 30 días; política que solo permite la distribución por OAC |
| ACM (us-east-1) | `jlc-ingenieros.com` + `www.jlc-ingenieros.com`, validación por DNS (CNAME nuevos) |
| CloudFront | HTTP/2+3, TLS 1.2+, *price class* 100; alias apex y `www` (se asignan en el corte); comportamiento por defecto con S3 y caché optimizada; `/api/*` con Lambda y sin caché; CloudFront Function de viewer-request; política de cabeceras de respuesta; errores 403/404 → `/404.html` con 404 |
| Cabeceras | `Strict-Transport-Security: max-age=63072000` (sin `includeSubDomains` ni `preload`, para no imponer HTTPS a `areaprivada`, `demo` u otros subdominios: requisito nº 1), CSP `default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self'; img-src 'self' data:; style-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restrictiva |
| Lambda + Function URL | Ver §6 |
| Rol IAM de despliegue | Confianza: OIDC de GitHub, `repo:jlcampos-iies/jlcampos-iies:ref:refs/heads/main`. Permisos: `s3:ListBucket`/`PutObject`/`DeleteObject` en el bucket, `cloudfront:CreateInvalidation` en la distribución, actualización de la CloudFront Function y de la Lambda de la pila |
| Proveedor OIDC | Parámetro `ExistingGitHubOidcProviderArn`: si se informa, se reutiliza; si va vacío, se crea |
| Presupuesto | AWS Budget mensual de 5 USD con aviso por correo a jlcampos@jlc-ingenieros.com al 80 % y al 100 % |

La plantilla **no** crea ni modifica registros DNS. Los registros nuevos (validación de ACM, DKIM) y el cambio del registro A del apex en el corte se hacen con comandos documentados (`scripts/dns/*.json` para `aws route53 change-resource-record-sets` con `UPSERT` solo sobre esos nombres), revisados antes de ejecutarse.

**Despliegue inicial:** lo ejecuta el titular con sus credenciales (`sam deploy` / `aws cloudformation deploy`), siguiendo `infra/README.md`. Claude no tiene acceso a la cuenta AWS.

## 8. Aislamiento del área privada (requisito nº 1)

1. Pilas propias; ningún recurso existente se importa, modifica ni referencia (EC2 del área privada, security groups, VPC, IAM ajeno, nginx, identidad SES existente). La instancia Lightsail de WordPress solo se toca en la retirada planificada (§10).
2. La zona de Route 53 no la gestiona la plantilla. Solo se **añaden** registros nuevos de nombre único y se **cambia un único registro**: el A de `jlc-ingenieros.com` (MX, TXT, NS y SOA del apex no se tocan), y se añade un AAAA ALIAS en el apex. `www` (CNAME → apex) **no se toca**: sigue al apex por sí solo. Lista de registros que **no se tocan nunca**: `areaprivada` (A y TXT), `demo`, `met`, MX, todos los TXT del apex (Apple, Firebase, SPF y verificación), `_dmarc`, todos los `*._domainkey` existentes (iCloud, Firebase y SES), NS y SOA. El DMARC existente (`p=none`) no se modifica.
3. SES no altera el SPF (MAIL FROM por defecto) ni la identidad SES existente (ver §6).
4. Proveedor OIDC reutilizado si ya existe.
5. **`scripts/check-isolation.sh`**: guarda una foto (`dig`/DoH) de todos los registros del dominio salvo los registros A/AAAA del apex, y la compara con una tomada antes. Comprueba que `areaprivada`, `demo` y `met` resuelven a `3.12.236.157`, que `https://areaprivada.jlc-ingenieros.com/` responde 200 y que `/api/gesnorm` responde (cualquier código distinto de 5xx o de un error de conexión). Se ejecuta antes y después de cada paso que toque DNS. Si detecta cualquier diferencia, ese paso se detiene y se deshace.

## 9. CI/CD (GitHub Actions)

- **`ci.yml`** (en cada PR y push):
  - `npm ci`, `astro check` y `astro build`.
  - Tests de la Lambda y de la CloudFront Function (Vitest).
  - **Test de redirecciones:** cada origen de `map.json` produce un 301 hacia un destino que existe en `dist/`, sin cadenas ni bucles.
  - **Test de conservación de URLs:** las 13 URLs del inventario actual existen en `dist/`.
  - **Test de i18n:** cada página indexable tiene sus tres versiones y `hreflang` recíprocos.
  - Comprobación de enlaces internos rotos y validación HTML del `dist/`.
- **`deploy.yml`** (push a `main`, después de que pase CI): OIDC → `aws s3 sync dist/ s3://… --delete` con `Cache-Control` adecuado (HTML `no-cache`; recursos con hash `max-age=31536000, immutable`), publicación de la CloudFront Function si ha cambiado, actualización del código de la Lambda si ha cambiado, invalidación de `/*` y prueba con `curl` de la home y de 3 redirecciones.
- Repo público: no se guarda ningún secreto. El ARN del rol y los IDs se configuran como *variables* de GitHub (no son secretos); la clave de sitio de Turnstile es pública por diseño.

## 10. Plan de corte

**Preparación (sin impacto):**
1. `check-isolation.sh --snapshot` (foto de referencia).
2. Despliegue de las pilas; la web queda en `*.cloudfront.net`.
3. Alta de los CNAME de ACM y DKIM; `check-isolation.sh`.
4. Configuración de Turnstile (dominio `jlc-ingenieros.com` + dominio de CloudFront de pruebas) y verificación en SES de `jlcampos@jlc-ingenieros.com`.
5. Revisión completa por el titular en la URL de pruebas, incluido un envío real del formulario.
6. Copia de seguridad de WordPress: **snapshot de la instancia Lightsail** y descarga de `wp-content/uploads` y de una exportación WXR.
7. TTL del registro A del apex a 60 s, 24 h antes del corte (`www` es un CNAME al apex y no necesita cambios); `check-isolation.sh`.

**Corte (unos 5 min, en una franja de poco tráfico):**
8. Se asignan los alias `jlc-ingenieros.com` y `www` a la distribución con el certificado ACM.
9. Un único lote de Route 53: `UPSERT` del A del apex (de `3.133.180.219` a ALIAS → CloudFront) y `CREATE` del AAAA ALIAS → CloudFront. `www` no cambia: su CNAME resuelve ya a CloudFront, que lo tiene como dominio alternativo, y la Function lo redirige al apex.
10. `check-isolation.sh` y una batería de humo: home en los 3 idiomas, 6 proyectos, 301 de `/en/home/`, `/ca/inici/`, `www` y `/feed/`, 404 de `/wp-login.php`, formulario y cabeceras de seguridad.
11. Search Console: envío del sitemap e inspección de las URLs principales. Se restaura el TTL a 300 s pasadas 48 h sin incidencias.

**Vuelta atrás:** un único lote: `UPSERT` del A del apex a `3.133.180.219` (TTL 60) y `DELETE` del AAAA ALIAS, con efecto en ≈ 1 min. WordPress sigue encendido hasta el paso 13.

**Retirada de WordPress:**
12. El titular comprueba en la instancia Lightsail (`3.133.180.219`) que no aloja nada más (*vhosts* de Apache, *crontab*, servicios en escucha, otros dominios), con la lista de `docs/retirada-wordpress.md`.
13. A las 2–4 semanas del corte: se **detiene** la instancia Lightsail.
14. A los 30 días de detenerla sin incidencias: se elimina la instancia y **se libera la IP estática de Lightsail** (si queda sin asociar se cobra), y se conserva el snapshot 6 meses (o se exporta a EC2/EBS si sale más barato). No se renuevan las licencias de Rank Math PRO, WP Rocket ni Salient.

## 11. Pruebas

- **Unitarias:** validación y flujo de la Lambda (SES y Turnstile simulados): éxito, campo trampa, validación, captcha y fallo de SES; respuestas 303 frente a JSON. CloudFront Function: cada regla de redirección, `index.html`, bloqueo de sondas y `www`.
- **Build:** conservación de URLs, redirecciones, i18n/hreflang, enlaces y HTML (§9).
- **Manual antes del corte:** revisión visual en móvil y escritorio, Lighthouse (objetivo ≥ 95 en rendimiento, accesibilidad, buenas prácticas y SEO) y envío real del formulario.
- **Después del corte:** batería de humo y `check-isolation.sh` (§10).

## 12. Fuera de alcance (posible más adelante)

- Analítica sin cookies (logs de CloudFront o Plausible/Umami), sin banner.
- CMS visual (Decap/Sveltia) si en el futuro edita otra persona.
- Blog o noticias.
- Endurecer el DMARC existente (`p=none` → `quarantine`/`reject`): requiere coordinarlo con iCloud, Firebase y SES.
