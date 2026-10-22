import { site } from '../config/site';
import { LANGS, type Lang } from '../i18n/routes';
import type { RouteEntry } from './registry';

export function absoluteUrl(path: string): string {
  return new URL(path, site.url).href;
}

export interface Alternate {
  hreflang: string;
  href: string;
}

/** hreflang absolutos de los idiomas existentes, más x-default → ES (si existe). */
export function alternates(entry: Pick<RouteEntry, 'alternates'>): Alternate[] {
  const list: Alternate[] = [];
  for (const lang of LANGS) {
    const path = entry.alternates[lang];
    if (path) list.push({ hreflang: lang, href: absoluteUrl(path) });
  }
  if (entry.alternates.es) list.push({ hreflang: 'x-default', href: absoluteUrl(entry.alternates.es) });
  return list;
}

const OG_LOCALE: Record<Lang, string> = { es: 'es_ES', en: 'en_GB', ca: 'ca_ES' };
export const ogLocale = (lang: Lang): string => OG_LOCALE[lang];

export function jsonLdOrganization(lang: Lang): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfessionalService',
    name: site.name,
    url: absoluteUrl(lang === 'es' ? '/' : `/${lang}/`),
    telephone: site.phone,
    email: site.email,
    inLanguage: lang,
    address: {
      '@type': 'PostalAddress',
      streetAddress: site.address.street,
      postalCode: site.address.postalCode,
      addressLocality: site.address.locality,
      addressRegion: site.address.region,
      addressCountry: 'ES',
    },
    areaServed: 'Illes Balears',
  };
}
