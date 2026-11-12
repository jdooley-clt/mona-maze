import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { watchHealth, watchPolicy, ready, start, moveAndCollect } from './helpers.js';

const GATE = ['serious', 'critical'];
const GAME = '#frame-host iframe';

const healthChecks = new WeakMap();
test.beforeEach(async ({ page, baseURL }, testInfo) => {
  healthChecks.set(page, watchHealth(page, [baseURL]));
  await watchPolicy(page);
  await page.goto(testInfo.tags.includes('@standalone') ? '/mona-maze/' : '/arcade/');
});
test.afterEach(async ({ page }) => healthChecks.get(page)());

// Reports `rule (target): why` for every serious or critical violation; the gate requires none.
async function audit(page, state) {
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(violation => GATE.includes(violation.impact))
    .flatMap(violation => violation.nodes.map(node =>
      `${violation.id} (${node.target.join(' ')}): ${(node.failureSummary ?? violation.help).replace(/\s+/g, ' ')}`));
  expect(blocking, `Serious or critical accessibility violations in the ${state} state`).toEqual([]);
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

test('standalone game has no serious or critical accessibility violations', { tag: '@standalone' }, async ({ page }) => {
  await ready(page);
  await auditGameStates(page, page, 'standalone');
});

test('game inside the cabinet has no serious or critical accessibility violations', async ({ page }) => {
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
