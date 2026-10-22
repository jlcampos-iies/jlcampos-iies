export const LANGS = ['es', 'en', 'ca'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'es';

export type PageKey =
  | 'home'
  | 'studio'
  | 'clients'
  | 'projects'
  | 'publications'
  | 'contact'
  | 'contactThanks'
  | 'cookies'
  | 'terms'
  | 'legalNotice'
  | 'privacy';

export const PAGE_ROUTES: Record<PageKey, Record<Lang, string>> = {
  home: { es: '/', en: '/en/', ca: '/ca/' },
  studio: { es: '/estudio/', en: '/en/studio/', ca: '/ca/estudi/' },
  clients: { es: '/clientes/', en: '/en/clients/', ca: '/ca/clients/' },
  projects: { es: '/proyectos/', en: '/en/projects/', ca: '/ca/projectes/' },
  publications: { es: '/publicaciones/', en: '/en/publications/', ca: '/ca/publicacions/' },
  contact: { es: '/contacto/', en: '/en/contact/', ca: '/ca/contacte/' },
  contactThanks: {
    es: '/contacto/gracias/',
    en: '/en/contact/thanks/',
    ca: '/ca/contacte/gracies/',
  },
  cookies: {
    es: '/politica-de-cookies-ue/',
    en: '/en/cookie-policy/',
    ca: '/ca/politica-de-galetes/',
  },
  terms: {
    es: '/terminos-y-condiciones/',
    en: '/en/terms-and-conditions/',
    ca: '/ca/termes-i-condicions/',
  },
  legalNotice: { es: '/aviso-legal/', en: '/en/legal-notice/', ca: '/ca/avis-legal/' },
  privacy: {
    es: '/politica-de-privacidad/',
    en: '/en/privacy-policy/',
    ca: '/ca/politica-de-privacitat/',
  },
};

export function pagePath(key: PageKey, lang: Lang): string {
  return PAGE_ROUTES[key][lang];
}

export function projectPath(slug: string, lang: Lang): string {
  return PAGE_ROUTES.projects[lang] + slug + '/';
}
