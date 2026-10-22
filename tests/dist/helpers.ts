import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse, type HTMLElement } from 'node-html-parser';

const DIST = resolve(process.cwd(), 'dist');

export function readPage(urlPath: string): HTMLElement {
  const file =
    urlPath === '/404.html'
      ? join(DIST, '404.html')
      : join(DIST, urlPath.replace(/^\/+|\/+$/g, ''), 'index.html');
  if (!existsSync(file)) {
    throw new Error(`No existe ${relative(process.cwd(), file)} (¿se ejecutó npm run build?)`);
  }
  return parse(readFileSync(file, 'utf8'));
}

export function distFiles(): string[] {
  if (!existsSync(DIST)) {
    throw new Error('No existe dist/ (¿se ejecutó npm run build?)');
  }
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html')) out.push(relative(DIST, full));
    }
  };
  walk(DIST);
  return out.sort();
}
