import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// Tool input schemas must not carry a JSON-schema "pattern". Some model
// gateways reject any tool list containing a regex they cannot prove safe
// (unsafe_schema_pattern), and one bad tool fails every agent turn, even for
// agents that only use other tools. zod's .regex() and .uuid() emit "pattern";
// validate with .refine((v) => RE.test(v), msg) instead, which keeps the same
// runtime check without exporting the regex.
const FORBIDDEN = /\.(regex|uuid)\(/;

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

test('tool schemas avoid zod validators that emit a JSON-schema pattern', () => {
  const offenders = [];
  for (const file of sourceFiles(new URL('../src', import.meta.url).pathname)) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (FORBIDDEN.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(offenders, [], `use .refine() instead:\n${offenders.join('\n')}`);
});
