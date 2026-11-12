import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { stampPolicy } from './csp.mjs';

const result = await build({
  entryPoints: ['main.js'], bundle: true, minify: true,
  format: 'iife', write: false, target: 'es2022',
});
const source = await readFile('index.html', 'utf8');
const template = stampPolicy(source);
// Keep the template's own policy current so opening index.html directly stays self-consistent.
if (template !== source) {
  await writeFile('index.html', template);
  console.log('Refreshed the Content Security Policy hashes in index.html');
}
const css = await readFile('style.css', 'utf8');
const font = (await readFile('assets/mona-sans.woff2')).toString('base64');
const markSvg = await readFile('assets/mark-github.svg', 'utf8');
const mark = markSvg.replace('<svg ', '<svg aria-hidden="true" fill="currentColor" ');
const licenses = await readFile('assets/Mona-Sans-OFL.txt', 'utf8') + '\n\n' + await readFile('assets/Octicons-LICENSE.txt', 'utf8');
const html = stampPolicy(template.replace('/* APP_STYLE */', () => css)
  .replace('MONA_SANS_FONT_DATA', () => font)
  .replace('GITHUB_FAVICON_DATA', () => Buffer.from(markSvg).toString('base64'))
  .replace('<!-- GITHUB_MARK -->', () => mark)
  .replace('<!-- ASSET_LICENSES -->', () => `<script type="text/plain" id="third-party-licenses">${licenses}</script>`)
  .replace('/* APP_SCRIPT */', () => result.outputFiles[0].text.replaceAll('</script', '<\\/script')));
await mkdir('dist', { recursive: true });
await writeFile('dist/mona-merge-maze.html', html);
console.log('Built dist/mona-merge-maze.html (self-contained, offline-ready)');
