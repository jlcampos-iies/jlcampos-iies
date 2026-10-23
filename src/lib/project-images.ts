import { getCollection, type CollectionEntry } from 'astro:content';
import type { ImageMetadata } from 'astro';

export interface ProjectImages {
  cover: ImageMetadata;
  gallery: ImageMetadata[];
}

/** Las imágenes de un proyecto son siempre las de su versión en castellano (mismo translationKey). */
export async function projectImages(project: CollectionEntry<'projects'>): Promise<ProjectImages> {
  const { translationKey } = project.data;
  const [es] = await getCollection(
    'projects',
    (p) => p.data.lang === 'es' && p.data.translationKey === translationKey,
  );
  if (!es?.data.cover) throw new Error(`Sin proyecto en castellano con portada para ${translationKey}`);
  return { cover: es.data.cover, gallery: es.data.gallery ?? [] };
}
