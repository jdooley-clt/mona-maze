import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

const { sizeBudget } = JSON.parse(await readFile('package.json', 'utf8'));

test('package.json declares a size budget for every published file', () => {
  assert.deepEqual(Object.keys(sizeBudget), ['dist/mona-merge-maze.html']);
  for (const budget of Object.values(sizeBudget)) assert.ok(Number.isInteger(budget) && budget > 0, 'budgets are whole bytes');
});

test('the standalone page stays within its documented size budget', async (t) => {
  for (const [file, budget] of Object.entries(sizeBudget)) {
    const bytes = await readFile(file);
    const gzipped = gzipSync(bytes, { level: 9 }).length;
    t.diagnostic(`${file}: ${bytes.length.toLocaleString('en-US')} bytes raw (${gzipped.toLocaleString('en-US')} gzipped), budget ${budget.toLocaleString('en-US')}`);
    assert.ok(
      bytes.length <= budget,
      `${file} is ${bytes.length} bytes, over the ${budget}-byte budget in package.json. Shrink the payload, or raise "sizeBudget" deliberately and record why (README, "Payload budget").`,
    );
  }
});
