import { createHash } from 'node:crypto';

// Script types the HTML parser executes; anything else (text/plain license text) never reaches CSP.
const EXECUTABLE_TYPE = /^(?:module|(?:text|application)\/(?:x-)?(?:java|ecma)script|text\/(?:javascript1\.[0-5]|jscript|livescript))$/i;
const META = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/;

// Browsers normalize CRLF to LF before hashing inline element text, so a CRLF checkout hashes the same.
export const hashSource = text =>
  `'sha256-${createHash('sha256').update(text.replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}'`;

export function inlineSources(html) {
  const scripts = new Set();
  const styles = new Set();
  for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\ssrc\s*=/i.test(attributes)) continue;
    const type = /\stype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attributes);
    const value = (type?.[1] ?? type?.[2] ?? type?.[3] ?? '').trim();
    if (value && !EXECUTABLE_TYPE.test(value)) continue;
    scripts.add(hashSource(body));
  }
  for (const [, , body] of html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi)) styles.add(hashSource(body));
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
