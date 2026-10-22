import { describe, expect, it } from 'vitest';
import { readPage } from './helpers';

describe('smoke', () => {
  it('la home existe y es español', () => {
    const html = readPage('/').querySelector('html');
    expect(html?.getAttribute('lang')).toBe('es');
  });
});
