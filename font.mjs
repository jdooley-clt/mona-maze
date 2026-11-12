import { readFile } from 'node:fs/promises';
import subsetFont from 'subset-font';

/**
 * Mona Sans is distributed under the SIL Open Font License with the Reserved
 * Font Name "Mona" (assets/Mona-Sans-OFL.txt). The committed
 * assets/mona-sans.woff2 is therefore the unmodified Original Version. The
 * build never writes a subset font file: it cuts the subset in memory and
 * embeds it only inside dist/mona-merge-maze.html, which the OFL FAQ allows
 * for fonts (full or subset) embedded in a document.
 */
export const FONT_FILE = 'assets/mona-sans.woff2';

/** Every printable ASCII character, U+0020 to U+007E. */
export const ASCII = Array.from({ length: 0x5f }, (_, i) => String.fromCharCode(0x20 + i)).join('');

/**
 * Characters outside ASCII that the page can render in Mona Sans: every
 * non-ASCII character in index.html, main.js and engine.js, plus the digit
 * group separators that score.toLocaleString() produces in some locales.
 * font.test.js fails when the sources use a character missing here. Mona Sans
 * lacks a few of these symbols; they fall back to the system font, exactly as
 * they did when the whole font was embedded.
 */
export const EXTRA_CHARACTERS = [
  '\u00a0', // no-break space (digit grouping, e.g. sv-SE)
  '\u00b0', // ° degree sign
  '\u00b7', // · middle dot
  '\u00d7', // × multiplication sign
  '\u00f8', // ø repository names
  '\u2019', // ’ right single quotation mark (digit grouping, e.g. de-CH)
  '\u202f', // narrow no-break space (digit grouping, e.g. fr-FR)
  '\u2161', // Ⅱ Roman numeral two
  '\u2190', '\u2191', '\u2192', '\u2193', // ← ↑ → ↓ arrows
  '\u21bb', // ↻ restart arrow
  '\u2260', // ≠ not equal to
  '\u2442', // ⑂ fork symbol
  '\u25b2', // ▲ black up-pointing triangle
  '\u25b7', // ▷ white right-pointing triangle
  '\u25c8', // ◈ white diamond containing black small diamond
  '\u25ce', // ◎ bullseye
  '\u25cf', // ● black circle
  '\u2661', '\u2665', // ♡ ♥ hearts
].join('');

export const SUBSET_TEXT = ASCII + EXTRA_CHARACTERS;

/** Font weights the page uses (style.css, canvas labels in main.js) all fall inside this range. */
export const WEIGHT_RANGE = { min: 400, max: 800 };

/**
 * Subsetting options shared by the build and font.test.js. The width axis is
 * pinned to its default because no style requests another width; the weight
 * axis is narrowed to the range in use; the optical-size axis is kept intact
 * so text and display sizes render exactly as the original design intends.
 * Only the features browsers apply by default are kept, plus tabular figures
 * (tnum) for the scoreboard; the stylistic sets, fractions, super/subscripts
 * and the all-alternates feature are never requested by the page.
 */
export const SUBSET_OPTIONS = {
  targetFormat: 'woff2',
  variationAxes: { wdth: 100, wght: WEIGHT_RANGE },
  keepFeatures: ['ccmp', 'locl', 'mark', 'mkmk', 'kern', 'liga', 'calt', 'tnum', 'rlig', 'rclt', 'curs', 'dist'],
  // Keep the copyright, designer, vendor, license and family names (name IDs 0-25).
  preserveNameIds: Array.from({ length: 26 }, (_, id) => id),
};

/** Returns the embedded Mona Sans subset; targetFormat may be overridden to inspect it as an sfnt. */
export async function subsetMonaSans(options = {}) {
  return subsetFont(await readFile(FONT_FILE), SUBSET_TEXT, { ...SUBSET_OPTIONS, ...options });
}
