import { createHash } from 'node:crypto';

// Script types the HTML parser executes; anything else (text/plain license text) never reaches CSP.
const EXECUTABLE_TYPE = /^(?:module|(?:text|application)\/(?:x-)?(?:java|ecma)script|text\/(?:javascript1\.[0-5]|jscript|livescript))$/i;
const META = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/;

// Browsers normalize CRLF to LF before hashing inline element text, so a CRLF checkout hashes the same.
export const hashSource = text =>
  `'sha256-${createHash('sha256').update(text.replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}'`;

const isTagBoundary = char => char === '>' || char === '/' || /\s/.test(char ?? '');

// Index of the `>` that ends a start tag whose name ends at `from`; quoted attribute values may contain `>`.
function endOfStartTag(html, from) {
  let quote = '';
  let expectValue = false;
  for (let i = from; i < html.length; i++) {
    const char = html[i];
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '>') return i;
    if (char === '=') expectValue = true;
    else if ((char === '"' || char === "'") && expectValue) { quote = char; expectValue = false; }
    else if (!/\s/.test(char)) expectValue = false;
  }
  return -1;
}

// Attribute names are case-insensitive; values may be double-quoted, single-quoted or unquoted.
function parseAttributes(text) {
  const attributes = new Map();
  for (const [, name, double, single, bare] of text.matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attributes.set(name.toLowerCase(), double ?? single ?? bare ?? '');
  }
  return attributes;
}

// Yields every <script> or <style> element the way the HTML tokenizer sees it: a start tag is the name
// followed by whitespace, `/` or `>`, and the raw text runs to the next `</name` that is followed by
// whitespace, `/` or `>`, whatever else that end tag carries. Plain index scanning, no tag regexes.
function* rawTextElements(html, name) {
  const lower = html.toLowerCase();
  const open = `<${name}`;
  const close = `</${name}`;
  for (let at = lower.indexOf(open); at !== -1; at = lower.indexOf(open, at)) {
    const nameEnd = at + open.length;
    if (!isTagBoundary(lower[nameEnd])) { at = nameEnd; continue; }
    const tagEnd = endOfStartTag(html, nameEnd);
    if (tagEnd === -1) return;
    let end = lower.indexOf(close, tagEnd + 1);
    while (end !== -1 && !isTagBoundary(lower[end + close.length])) end = lower.indexOf(close, end + 1);
    if (end === -1) return;
    yield { attributes: parseAttributes(html.slice(nameEnd, tagEnd)), body: html.slice(tagEnd + 1, end) };
    at = end + close.length;
  }
}

export function inlineSources(html) {
  const scripts = new Set();
  const styles = new Set();
  for (const { attributes, body } of rawTextElements(html, 'script')) {
    if (attributes.has('src')) continue;
    const type = (attributes.get('type') ?? '').trim();
    if (type && !EXECUTABLE_TYPE.test(type)) continue;
    scripts.add(hashSource(body));
  }
  for (const { body } of rawTextElements(html, 'style')) styles.add(hashSource(body));
  return { scripts: [...scripts], styles: [...styles] };
}

export function readPolicy(html) {
  const match = META.exec(html);
  if (!match) throw new Error('The page must declare <meta http-equiv="Content-Security-Policy"> in <head>.');
  return Object.fromEntries(match[2].split(';').map(directive => directive.trim()).filter(Boolean)
    .map(directive => { const [name, ...sources] = directive.split(/\s+/); return [name, sources]; }));
}

// Rewrites script-src and style-src to exactly the hashes of the page's own inline blocks.
export function stampPolicy(html) {
  const policy = readPolicy(html);
  const { scripts, styles } = inlineSources(html);
  policy['script-src'] = scripts;
  policy['style-src'] = styles;
  const content = Object.entries(policy).map(([name, sources]) => [name, ...sources].join(' ')).join('; ');
  return html.replace(META, (_, open, __, close) => `${open}${content}${close}`);
}
