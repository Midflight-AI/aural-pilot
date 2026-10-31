import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
const require = createRequire(import.meta.url);
const match = require('minimatch');

test('legacy ESLint consumers retain callable, constructor and defaulted glob APIs', () => {
  assert.equal(match('src/app/page.tsx', '**/*.{ts,tsx}'), true);
  assert.equal(match('src/app/page.js', '**/*.{ts,tsx}'), false);
  assert.equal(new match.Minimatch('src/**', { dot: true }).match('src/.hidden'), true);
  assert.equal(match.defaults({ dot: true })('.hidden', '*'), true);
  assert.deepEqual(match.match(['a.ts', 'b.js'], '*.ts'), ['a.ts']);
  assert.equal(match.makeRe('*.tsx').test('page.tsx'), true);
  assert.equal(match.minimatch('a.ts', '*.ts'), true);
});

test('globparts amplification is bounded by the patched upstream implementation', () => {
  const pattern = Array(30).fill('**/../a/b').join('/');
  const matcher = new match.Minimatch(pattern, { optimizationLevel: 2, braceExpandMax: 64 });
  assert.ok(matcher.set.length <= 64);
});

test('legacy import lint rule still rejects forbidden internal imports', () => {
  const { Linter } = require('eslint');
  const plugin = require('eslint-plugin-import');
  const messages = new Linter().verify("import value from 'pkg/private/file';", [{
    plugins: { import: plugin },
    rules: { 'import/no-internal-modules': ['error', { forbid: ['pkg/private/**'] }] },
  }]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].ruleId, 'import/no-internal-modules');
});
