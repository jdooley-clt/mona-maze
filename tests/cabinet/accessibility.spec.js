import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { watchHealth, watchPolicy, ready, start, moveAndCollect } from './helpers.js';

const GATE = ['serious', 'critical']; // blocks anywhere on the page, including the cabinet chrome
const GAME_GATE = [...GATE, 'moderate', 'minor']; // the game's own document must be clean at every impact
const GAME = '#frame-host iframe';
const CONTRAST_MINIMUM = 4.5;

const healthChecks = new WeakMap();
test.beforeEach(async ({ page, baseURL }, testInfo) => {
  healthChecks.set(page, watchHealth(page, [baseURL]));
  await watchPolicy(page);
  await page.goto(testInfo.tags.includes('@standalone') ? '/mona-maze/' : '/arcade/');
});
test.afterEach(async ({ page }) => healthChecks.get(page)());

// Reports `rule (target): why` for every blocking violation. The game's own document (the
// standalone page, or the frame inside the cabinet) must be clean at every impact; the cabinet
// chrome around it belongs to the arcade repository and is gated at serious/critical only. axe
// reports a node inside the frame with a two-part target: the frame selector, then the node.
async function audit(page, state) {
  const results = await new AxeBuilder({ page }).analyze();
  const standalone = (await page.locator(GAME).count()) === 0;
  const blocking = results.violations.flatMap(violation => violation.nodes
    .filter(node => (standalone || node.target.length > 1 ? GAME_GATE : GATE).includes(violation.impact))
    .map(node => `${violation.id} (${node.target.join(' ')}): ${(node.failureSummary ?? violation.help).replace(/\s+/g, ' ')}`));
  expect(blocking, `Accessibility violations in the ${state} state`).toEqual([]);
  return results;
}

async function pause(page, game) {
  await page.keyboard.press('p');
  await expect(game.locator('#message-title')).toHaveText('Paused.');
}

// Renders the level-complete and game-over panels through the same DOM state updateUI applies,
// because reaching them through real play depends on the enemy chase.
async function showOutcome(game, status) {
  await game.locator('#message').evaluate((message, status) => {
    const copy = {
      won: ['DEPLOYMENT COMPLETE', 'Level 1 shipped!', '1,230 points. Heading to level 2 with your score and lives intact.', 'Next level now →'],
      over: ['BUILD FAILED. TRY AGAIN.', 'One more branch?', '1,230 points. Start a fresh board at level 1.', 'New run →'],
    }[status];
    const $ = id => document.getElementById(id);
    [$('message-kicker').textContent, $('message-title').textContent, $('message-detail').textContent, $('resume').textContent] = copy;
    message.hidden = false;
    $('pause').disabled = true;
    $('stage').classList.remove('playing');
    document.querySelector('.game-shell').classList.remove('playing');
    if (status === 'won') {
      $('minimap-box').hidden = false;
      $('objective').classList.add('unlocked');
    }
  }, status);
  await expect(game.locator('#message')).toBeVisible();
}

async function auditGameStates(page, game, where) {
  // Colour audits are only deterministic with the page's transitions disabled (the config emulates
  // reduced motion); otherwise axe can sample the theme button mid-way through the light-to-dark fade.
  expect(await game.locator('html').evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'the cabinet config must emulate prefers-reduced-motion').toBe(true);
  await audit(page, `${where} start screen`);
  await game.locator('#help').click();
  await expect(game.locator('#help-dialog')).toBeVisible();
  await audit(page, `${where} help dialog`);
  await game.locator('#close-help').click();
  await expect(game.locator('#help-dialog')).toBeHidden();
  await start(game);
  await moveAndCollect(page, game);
  await audit(page, `${where} mid-game`);
  await pause(page, game);
  await audit(page, `${where} paused`);
  await game.locator('#theme').click();
  await expect(game.locator('html')).toHaveAttribute('data-theme', 'dark');
  await audit(page, `${where} paused, dark theme`);
  await game.locator('#theme').click();
  await page.keyboard.press('p');
  await page.keyboard.press('v');
  await expect(game.locator('#first')).toHaveAttribute('aria-pressed', 'true');
  await pause(page, game);
  await audit(page, `${where} first person`);
  await showOutcome(game, 'won');
  await audit(page, `${where} level complete panel`);
  await showOutcome(game, 'over');
  await audit(page, `${where} game over panel`);
}

test('standalone game has no accessibility violations at any impact', { tag: '@standalone' }, async ({ page }) => {
  await ready(page);
  await auditGameStates(page, page, 'standalone');
});

test('game inside the cabinet has no accessibility violations at any impact', async ({ page }) => {
  await page.getByRole('button', { name: "Play Mona's Merge Maze", exact: true }).click();
  const game = page.frameLocator(GAME);
  await ready(game);
  await auditGameStates(page, game, 'cabinet');
});

test('the accessibility gate catches an injected serious violation inside the game frame', async ({ page }) => {
  await page.getByRole('button', { name: "Play Mona's Merge Maze", exact: true }).click();
  const game = page.frameLocator(GAME);
  await ready(game);
  await audit(page, 'cabinet start screen');
  await game.locator('body').evaluate(body => {
    const probe = document.createElement('a');
    probe.id = 'axe-probe';
    probe.href = '#';
    body.append(probe);
  });
  const results = await new AxeBuilder({ page }).analyze();
  const linkName = results.violations.find(violation => violation.id === 'link-name');
  expect(linkName?.impact).toBe('serious');
  expect(linkName.nodes.map(node => node.target.at(-1))).toContain('#axe-probe');
  await game.locator('#axe-probe').evaluate(probe => probe.remove());
  await audit(page, 'cabinet start screen after removing the probe');
});

// updateUI re-syncs the unlocked objective and the active pickup timers from game state every
// frame, so their styling is audited on structural probes that mirror the real markup instead.
async function contrastOfStateDependentText(page) {
  await page.evaluate(() => {
    document.getElementById('contrast-probe-objective')?.remove();
    document.getElementById('contrast-probe-pickup')?.remove();
    document.querySelector('.control-dock').insertAdjacentHTML('beforeend',
      '<div class="objective-inline unlocked" id="contrast-probe-objective"><b>DEPLOY PORTAL / OPEN</b></div>');
    document.querySelector('.item-statusbar').insertAdjacentHTML('beforeend',
      '<span class="item-status" data-active="true" id="contrast-probe-pickup"><span>Overclock</span><strong>6.0s</strong></span>');
  });
  const results = await new AxeBuilder({ page }).include('#contrast-probe-objective').include('#contrast-probe-pickup')
    .withRules(['color-contrast']).analyze();
  const contrast = kind => results[kind].find(rule => rule.id === 'color-contrast')?.nodes ?? [];
  await page.evaluate(() => ['contrast-probe-objective', 'contrast-probe-pickup'].forEach(id => document.getElementById(id).remove()));
  return { violations: contrast('violations').map(node => node.target.join(' ')), incomplete: contrast('incomplete').length, passes: contrast('passes').length };
}

async function legendGlyphContrast(page) {
  await page.locator('#help').click();
  await expect(page.locator('#help-dialog')).toBeVisible();
  const ratios = await page.locator('#help-dialog').evaluate(dialog => {
    const channel = value => (value /= 255) <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    const luminance = rgb => { const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).map(Number); return .2126 * channel(r) + .7152 * channel(g) + .0722 * channel(b); };
    const background = luminance(getComputedStyle(dialog).backgroundColor);
    return [...dialog.querySelectorAll('#enemy-legend b')].map(glyph => {
      const ink = luminance(getComputedStyle(glyph).color);
      return { symbol: glyph.textContent, ratio: (Math.max(ink, background) + .05) / (Math.min(ink, background) + .05) };
    });
  });
  await page.locator('#close-help').click();
  await expect(page.locator('#help-dialog')).toBeHidden();
  return ratios;
}

test('state-dependent text and legend glyphs keep 4.5:1 contrast in both themes', { tag: '@standalone' }, async ({ page }) => {
  await ready(page);
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.locator('#theme').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const text = await contrastOfStateDependentText(page);
    expect(text.violations, `${theme} theme: unlocked objective / active pickup timer contrast`).toEqual([]);
    expect(text.incomplete, `${theme} theme: axe could not evaluate the contrast probes`).toBe(0);
    expect(text.passes).toBeGreaterThanOrEqual(2);
    const glyphs = await legendGlyphContrast(page);
    expect(glyphs.length).toBeGreaterThanOrEqual(4);
    for (const { symbol, ratio } of glyphs) expect(ratio, `${theme} theme: legend glyph "${symbol}"`).toBeGreaterThanOrEqual(CONTRAST_MINIMUM);
  }
});

test('letter shortcuts only act while the stage has focus and a pointer toggle hands focus back', { tag: '@standalone' }, async ({ page }) => {
  await ready(page);
  await start(page);
  await page.locator('#theme').focus();
  await page.keyboard.press('p');
  await expect(page.locator('#message')).toBeHidden();
  await expect(page.locator('#stage')).toHaveClass(/playing/);
  await page.locator('#stage').focus();
  await pause(page, page);
  await expect(page.locator('#announcer')).toHaveText(/^WORK IN PROGRESS\. Paused\./);
  await page.locator('#theme').click();
  await expect(page.locator('#stage')).toBeFocused();
  await page.keyboard.press('p');
  await expect(page.locator('#message')).toBeHidden();
  await expect(page.locator('#announcer')).toHaveText('Resumed.');
  await page.keyboard.press('Escape');
  await expect(page.locator('#message-title')).toHaveText('Paused.');
});
