import type { APIRoute } from 'astro';
import { allRoutes } from '../lib/registry';
import { absoluteUrl, alternates } from '../lib/seo';

export const GET: APIRoute = async () => {
  const routes = (await allRoutes()).filter((r) => !r.noindex);
  const urls = routes.map((r) => {
    const links = alternates(r)
      .map((a) => `    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${a.href}"/>`)
      .join('\n');
    return `  <url>\n    <loc>${absoluteUrl(r.path)}</loc>\n${links}\n  </url>`;
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
