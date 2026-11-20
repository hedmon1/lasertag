import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain .mjs build script, no type declarations
import { TEXT } from '../../scripts/build-rules.mjs';

describe('database.rules.json', () => {
  it('is what scripts/build-rules.mjs builds (run npm run rules after changing it, or a gun)', () => {
    expect(readFileSync(resolve(import.meta.dirname, '../../database.rules.json'), 'utf8')).toBe(TEXT);
  });
});
