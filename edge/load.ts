import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type EdgeEvent = { request: Record<string, any> };
export type EdgeHandler = (event: EdgeEvent) => any;

/** Evalua edge/dist/viewer-request.js (generado por `npm run build:edge`). */
export function loadHandler(): EdgeHandler {
  const code = readFileSync(join(process.cwd(), 'edge/dist/viewer-request.js'), 'utf8');
  return new Function(code + '; return handler;')() as EdgeHandler;
}
