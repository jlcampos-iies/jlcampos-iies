import { getCollection } from 'astro:content';
import { pagePath, projectPath, type Lang, type PageKey } from '../i18n/routes';

export interface RouteEntry {
  path: string;
  lang: Lang;
  kind: 'page' | 'project';
  key: string;
  alternates: Partial<Record<Lang, string>>;
  noindex: boolean;
}

/** Una entrada por cada (PageKey, lang) con contenido y por cada proyecto. */
export async function allRoutes(): Promise<RouteEntry[]> {
  const [pages, projects] = await Promise.all([getCollection('pages'), getCollection('projects')]);

  const pageAlternates = new Map<PageKey, Partial<Record<Lang, string>>>();
  for (const { data } of pages) {
    const alt = pageAlternates.get(data.key) ?? {};
    alt[data.lang] = pagePath(data.key, data.lang);
    pageAlternates.set(data.key, alt);
  }
  const projectAlternates = new Map<string, Partial<Record<Lang, string>>>();
  for (const { data } of projects) {
    const alt = projectAlternates.get(data.translationKey) ?? {};
    alt[data.lang] = projectPath(data.slug, data.lang);
    projectAlternates.set(data.translationKey, alt);
  }

  const routes: RouteEntry[] = [
    ...pages.map(({ data }): RouteEntry => ({
      path: pagePath(data.key, data.lang),
      lang: data.lang,
      kind: 'page',
      key: data.key,
      alternates: pageAlternates.get(data.key)!,
      noindex: data.noindex ?? false,
    })),
    ...projects.map(({ data }): RouteEntry => ({
      path: projectPath(data.slug, data.lang),
      lang: data.lang,
      kind: 'project',
      key: data.translationKey,
      alternates: projectAlternates.get(data.translationKey)!,
      noindex: false,
    })),
  ];
  return routes;
}
