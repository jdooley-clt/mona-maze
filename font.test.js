import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import fontverter from 'fontverter';
import * as hb from 'harfbuzzjs';
import { EXTRA_CHARACTERS, FONT_FILE, SUBSET_OPTIONS, SUBSET_TEXT, WEIGHT_RANGE, subsetMonaSans } from './font.mjs';

/** SHA-256 of the unmodified Original Version of Mona Sans; the OFL Reserved Font Name "Mona" forbids committing a subset in its place. */
const ORIGINAL_SHA256 = '875ad1fab0c1f4854927fa8086963fb6ddd4608b04a58b267cddf8a9d78f80d3';
const PAGE_SOURCES = ['index.html', 'style.css', 'main.js', 'engine.js', 'music.js', 'timing.js'];
const original = await readFile(FONT_FILE);
const subset = await subsetMonaSans();
const dist = await readFile('dist/mona-merge-maze.html', 'utf8');

const face = async (woff2) => new hb.Face(new hb.Blob(await fontverter.convert(woff2, 'sfnt')), 0);
const codePoints = (text) => [...new Set(Array.from(text, (ch) => ch.codePointAt(0)))].sort((a, b) => a - b);
const describe = (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')} ${JSON.stringify(String.fromCodePoint(cp))}`;

test('every non-ASCII character the page sources can render is in the subset inventory', async () => {
  const wanted = new Set(codePoints(SUBSET_TEXT));
  for (const file of PAGE_SOURCES) {
    const text = (await readFile(file, 'utf8'))
      .replace(/\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})/gi, (_, braced, plain) => String.fromCodePoint(parseInt(braced ?? plain, 16)))
      .replace(/&#x([0-9a-f]+);|&#(\d+);/gi, (_, hex, dec) => String.fromCodePoint(hex ? parseInt(hex, 16) : Number(dec)));
    assert.doesNotMatch(text, /&[a-z]+;/i, `${file}: write characters literally rather than as named entities so the font inventory can see them`);
    const missing = codePoints(text).filter((cp) => cp > 0x7e && !wanted.has(cp));
    assert.deepEqual(missing.map(describe), [], `${file} uses characters missing from EXTRA_CHARACTERS in font.mjs`);
  }
  assert.equal(codePoints(EXTRA_CHARACTERS).length, Array.from(EXTRA_CHARACTERS).length, 'EXTRA_CHARACTERS lists each character once');
});

test('styles request only the weights and widths the embedded subset carries', async () => {
  const css = await readFile('style.css', 'utf8');
  const main = await readFile('main.js', 'utf8');
  const face = /@font-face\s*\{([^}]*)\}/.exec(css)[1];
  assert.match(face, new RegExp(`font-weight:\\s*${WEIGHT_RANGE.min} ${WEIGHT_RANGE.max};`));
  assert.match(face, /font-stretch:\s*normal;/);
  assert.match(face, /src:\s*url\("data:font\/woff2;base64,MONA_SANS_FONT_DATA"\)/);
  const weights = [
    ...css.replace(face, '').matchAll(/font-weight:\s*(\d{3})\b|font:\s*(\d{3})\s/g),
    ...main.matchAll(/font = [`'"](\d{3}) /g),
  ].map((match) => Number(match[1] ?? match[2]));
  assert.ok(weights.length >= 5, 'the page declares numeric weights for Mona Sans text');
  for (const weight of weights) assert.ok(weight >= WEIGHT_RANGE.min && weight <= WEIGHT_RANGE.max, `weight ${weight} is outside WEIGHT_RANGE`);
  assert.equal(css.replace(face, '').match(/font-stretch/g), null, 'the width axis is pinned, so no rule may request another width');
});

test('assets/mona-sans.woff2 is the unmodified Original Version and the page embeds exactly its subset', () => {
  assert.equal(createHash('sha256').update(original).digest('hex'), ORIGINAL_SHA256);
  const embedded = /url\("data:font\/woff2;base64,([A-Za-z0-9+/=]+)"\)/.exec(dist)?.[1];
  assert.equal(embedded, subset.toString('base64'), 'run `npm run build` after changing font.mjs, the sources or the dependencies');
  assert.ok(subset.length < original.length / 5, `the subset (${subset.length} bytes) should be a small fraction of the original (${original.length} bytes)`);
});

test('the subset keeps the glyphs, axes, features and license metadata the page relies on', async () => {
  const [before, after] = await Promise.all([face(original), face(subset)]);
  const wanted = new Set(codePoints(SUBSET_TEXT));
  assert.deepEqual(Array.from(after.collectUnicodes()), Array.from(before.collectUnicodes()).filter((cp) => wanted.has(cp)));
  const axes = after.getAxisInfos();
  assert.deepEqual(Object.keys(axes).sort(), ['opsz', 'wght']);
  assert.deepEqual({ min: axes.wght.min, max: axes.wght.max }, WEIGHT_RANGE);
  const range = ({ min, default: initial, max }) => ({ min, initial, max });
  assert.deepEqual(range(axes.opsz), range(before.getAxisInfos().opsz), 'the optical size axis stays intact');
  for (const table of ['GSUB', 'GPOS']) {
    const kept = after.getTableFeatureTags(table);
    assert.ok(kept.every((tag) => SUBSET_OPTIONS.keepFeatures.includes(tag)), `${table} keeps only allowed features: ${kept}`);
  }
  assert.ok(after.getTableFeatureTags('GSUB').includes('tnum'), 'tabular figures for the scoreboard');
  assert.ok(after.getTableFeatureTags('GPOS').includes('kern'));
  for (const nameId of [0, 1, 8, 9, 13, 14]) assert.equal(after.getName(nameId, 'en'), before.getName(nameId, 'en'), `name ID ${nameId} is preserved`);
  assert.match(after.getName(13, 'en'), /SIL Open Font License/);
});
