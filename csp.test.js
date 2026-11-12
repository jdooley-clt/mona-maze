import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { hashSource, inlineSources, readPolicy, stampPolicy } from './csp.mjs';

const META = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src; style-src; img-src data:">';
const HASH = /^'sha256-[A-Za-z0-9+/]{43}='$/;
const pages = await Promise.all(['index.html', 'dist/mona-merge-maze.html'].map(file => readFile(file, 'utf8')));

test('hashes ignore the checkout line-ending style, as browsers do', () => {
  assert.equal(hashSource('a\r\nb\rc\n'), hashSource('a\nb\nc\n'));
  assert.notEqual(hashSource('a\nb'), hashSource('a\n\nb'));
  assert.match(hashSource(''), HASH);
});

test('only executable inline scripts and style blocks are hashed', () => {
  const html = `<head>${META}<script>one()</script><script type="module">two()</script>
    <script type="text/plain" id="licenses">not code</script><script src="x.js"></script>
    <style>a{}</style><style media="print">b{}</style><script>one()</script></head>`;
  assert.deepEqual(inlineSources(html), {
    scripts: [hashSource('one()'), hashSource('two()')],
    styles: [hashSource('a{}'), hashSource('b{}')],
  });
});

test('stamping rewrites only script-src and style-src and refuses pages without a policy', () => {
  const stamped = stampPolicy(`${META}<script>run()</script>`);
  assert.deepEqual(readPolicy(stamped), {
    'default-src': ["'none'"], 'script-src': [hashSource('run()')], 'style-src': [], 'img-src': ['data:'],
  });
  assert.equal(stampPolicy(stamped), stamped);
  assert.throws(() => stampPolicy('<head><script>run()</script></head>'), /Content-Security-Policy/);
});

for (const [index, file] of ['index.html', 'dist/mona-merge-maze.html'].entries()) {
  test(`${file} carries the hashes of its own inline blocks and a strict policy`, () => {
    const html = pages[index];
    assert.equal(stampPolicy(html), html, 'run `npm run build` after editing inline scripts or styles');
    const policy = readPolicy(html);
    const { scripts, styles } = inlineSources(html);
    assert.ok(scripts.length >= 3 && styles.length === 1, 'theme scripts, app script and the style block are inline');
    assert.deepEqual(policy['script-src'], scripts);
    assert.deepEqual(policy['style-src'], styles);
    for (const source of [...scripts, ...styles]) assert.match(source, HASH);
    assert.deepEqual(policy['default-src'], ["'none'"]);
    assert.deepEqual(policy['base-uri'], ["'none'"]);
    assert.deepEqual(policy['form-action'], ["'none'"]);
    assert.doesNotMatch(html, /unsafe-(?:inline|eval|hashes)/);
    assert.ok(html.indexOf('http-equiv="Content-Security-Policy"') < html.search(/<(?:script|style|link)\b/),
      'the policy must precede every script, style and link so it governs all of them');
    assert.ok(html.includes('<meta name="referrer" content="strict-origin-when-cross-origin">'));
  });
}

test('the built page keeps every non-hash directive of the template', () => {
  const [template, built] = pages.map(readPolicy);
  const fixed = policy => Object.fromEntries(Object.entries(policy).filter(([name]) => !['script-src', 'style-src'].includes(name)));
  assert.deepEqual(fixed(built), fixed(template));
});
