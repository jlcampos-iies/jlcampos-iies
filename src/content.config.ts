import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { file, glob } from 'astro/loaders';
import { parse } from 'yaml';
import { LANGS, PAGE_ROUTES } from './i18n/routes';

const lang = z.enum(LANGS);
const pageKeys = Object.keys(PAGE_ROUTES) as [keyof typeof PAGE_ROUTES, ...(keyof typeof PAGE_ROUTES)[]];

const pages = defineCollection({
  loader: glob({ pattern: '*/*.md', base: './src/content/pages' }),
  schema: ({ image }) =>
    z
      .object({
        key: z.enum(pageKeys),
        lang,
        title: z.string(),
        // <title> alternativo y corto cuando title + " | JLC Ingenieros" pasaría de 70 caracteres.
        seoTitle: z.string().max(60).optional(),
        description: z.string().max(160),
        hero: image().optional(),
        heroAlt: z.string().optional(),
        services: z.array(z.object({ title: z.string(), text: z.string() })).optional(),
        noindex: z.boolean().optional(),
      })
      .refine((p) => p.hero === undefined || (p.heroAlt ?? '').trim() !== '', {
        message: 'heroAlt es obligatorio cuando hay hero',
        path: ['heroAlt'],
      }),
});

const projects = defineCollection({
  loader: glob({ pattern: '*/*.md', base: './src/content/projects' }),
  schema: ({ image }) =>
    z
      .object({
        translationKey: z.string(),
        lang,
        slug: z.string(),
        title: z.string(),
        // <title> alternativo y corto cuando title + " | JLC Ingenieros" pasaría de 70 caracteres.
        seoTitle: z.string().max(60).optional(),
        description: z.string().max(160),
        order: z.number(),
        cover: image().optional(),
        gallery: z.array(image()).optional(),
      })
      .refine((p) => p.lang !== 'es' || p.cover !== undefined, {
        message: 'cover es obligatorio en los proyectos en castellano',
        path: ['cover'],
      }),
});

const localized = z.object({ es: z.string(), en: z.string(), ca: z.string() });

const publications = defineCollection({
  // order = posición en el YAML (getCollection no conserva el orden del fichero).
  loader: file('src/content/publications.yaml', {
    parser: (text) => (parse(text) as { id: string }[]).map((b, order) => ({ order, ...b })),
  }),
  schema: ({ image }) =>
    z
      .object({
        cover: image(),
        // Sin amazonUrl = libro aún no publicado (inProgress); infoUrl enlaza a más información.
        amazonUrl: z.url().refine((u) => !u.includes('?'), 'amazonUrl sin query string').optional(),
        inProgress: z.boolean().optional(),
        infoUrl: z.url().optional(),
        title: localized,
        summary: localized,
        order: z.number(),
      })
      .refine((b) => b.amazonUrl || b.inProgress, { message: 'Falta amazonUrl (o inProgress: true)', path: ['amazonUrl'] }),
});

const clients = defineCollection({
  // clients.yaml es una lista de { name, logo }; el id es el nombre y order la posición en el YAML
  // (getCollection no conserva el orden del fichero).
  loader: file('src/content/clients.yaml', {
    parser: (text) => (parse(text) as { name: string }[]).map((c, order) => ({ id: c.name, order, ...c })),
  }),
  schema: ({ image }) => z.object({ name: z.string(), logo: image(), order: z.number() }),
});

export const collections = { pages, projects, publications, clients };
